// Slice 2 health-endpoint core tests.
//
// Covers the plan's Slice 2 acceptance + test-plan items for the core
// (synthetic monitors / investigation-mode are deferred):
//   - /api/health 200 + shape + no-store; stays 200 even when DB is down
//   - GET/HEAD supported; mutation methods → 405 with Allow header
//   - /api/health/ready success (200, database:ok) / failure (503) /
//     timeout (503 within the deadline)
//   - single-flight: repeated/slow readiness probes invoke the DB once and
//     do not serialize (pool-safe), fresh probe after settle (no stale cache)
//   - rate limiting works, is per-IP, returns 429, and does NOT depend on
//     Prisma/DB (static import check)
//   - no version / SHA / env / db-url / stack leakage in any response
//
// Uses the injectable readiness-probe seam so DB paths are deterministic
// without a live database.
//
// Run: npm run test:observability-health

(process.env as Record<string, string | undefined>).NODE_ENV = "test";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";

import {
  HEALTH_READINESS_TIMEOUT_MS,
  __setReadinessProbeForTests,
} from "../src/lib/observability/health";
import { __resetHealthRateLimitForTests } from "../src/lib/observability/health-rate-limit";
import * as liveness from "../src/app/api/health/route";
import * as readiness from "../src/app/api/health/ready/route";

const ALLOWED_LIVENESS_KEYS = new Set(["status", "generatedAt"]);
const ALLOWED_READINESS_KEYS = new Set(["status", "generatedAt", "database"]);
const LEAK_KEYS = [
  "version",
  "gitSha",
  "sha",
  "commit",
  "env",
  "environment",
  "nodeEnv",
  "databaseUrl",
  "dbUrl",
  "stack",
  "packageVersion",
];

function req(method: string, ip = "203.0.113.7"): NextRequest {
  return new NextRequest("http://localhost/api/health", {
    method,
    headers: { "x-forwarded-for": ip },
  });
}

function assertNoStore(res: Response, label: string): void {
  assert.strictEqual(
    res.headers.get("cache-control"),
    "no-store",
    `${label}: must set Cache-Control: no-store`,
  );
}

function assertNoLeak(body: Record<string, unknown>, label: string): void {
  for (const k of LEAK_KEYS) {
    assert.ok(!(k in body), `${label}: response must not expose "${k}"`);
  }
}

async function main(): Promise<void> {
  __resetHealthRateLimitForTests();
  __setReadinessProbeForTests(null);

  // -- 1. GET /api/health → 200, exact shape, no-store, no leak --
  {
    const res = await liveness.GET(req("GET"));
    assert.strictEqual(res.status, 200, "1: liveness 200");
    assertNoStore(res, "1");
    const body = await res.json();
    assert.strictEqual(body.status, "ok", "1: status ok");
    assert.match(body.generatedAt, /^\d{4}-\d{2}-\d{2}T/, "1: ISO generatedAt");
    for (const k of Object.keys(body)) {
      assert.ok(ALLOWED_LIVENESS_KEYS.has(k), `1: unexpected key "${k}" in liveness body`);
    }
    assertNoLeak(body, "1");
  }

  // -- 2. HEAD /api/health → 200, empty body, no-store --
  {
    __resetHealthRateLimitForTests();
    const res = await liveness.HEAD(req("HEAD"));
    assert.strictEqual(res.status, 200, "2: HEAD 200");
    assertNoStore(res, "2");
    assert.strictEqual(await res.text(), "", "2: HEAD has no body");
  }

  // -- 3. Mutation methods → 405 with Allow header --
  {
    for (const m of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const) {
      const handler = liveness[m] as () => Response;
      const res = handler();
      assert.strictEqual(res.status, 405, `3: ${m} → 405`);
      assert.strictEqual(res.headers.get("allow"), "GET, HEAD", `3: ${m} Allow header`);
      assertNoStore(res, `3:${m}`);
    }
  }

  // -- 4. /api/health stays 200 even when the DB probe FAILS (liveness
  //       must not consult the DB at all) --
  {
    __resetHealthRateLimitForTests();
    __setReadinessProbeForTests(async () => {
      throw new Error("DB is down");
    });
    const res = await liveness.GET(req("GET"));
    assert.strictEqual(res.status, 200, "4: liveness stays 200 with DB down");
    const body = await res.json();
    assert.ok(!("database" in body), "4: liveness body has no database field");
    __setReadinessProbeForTests(null);
  }

  // -- 5. GET /api/health/ready success → 200, database:ok --
  {
    __resetHealthRateLimitForTests();
    __setReadinessProbeForTests(async () => {
      /* resolves = healthy */
    });
    const res = await readiness.GET(req("GET"));
    assert.strictEqual(res.status, 200, "5: readiness 200 on healthy DB");
    assertNoStore(res, "5");
    const body = await res.json();
    assert.strictEqual(body.status, "ok", "5: status ok");
    assert.strictEqual(body.database, "ok", "5: database ok");
    for (const k of Object.keys(body)) {
      assert.ok(ALLOWED_READINESS_KEYS.has(k), `5: unexpected key "${k}"`);
    }
    assertNoLeak(body, "5");
  }

  // -- 6. GET /api/health/ready DB failure → 503, database:down --
  {
    __resetHealthRateLimitForTests();
    __setReadinessProbeForTests(async () => {
      throw new Error("connection refused");
    });
    const res = await readiness.GET(req("GET"));
    assert.strictEqual(res.status, 503, "6: readiness 503 on DB failure");
    assertNoStore(res, "6");
    const body = await res.json();
    assert.strictEqual(body.status, "down", "6: status down");
    assert.strictEqual(body.database, "down", "6: database down");
    assertNoLeak(body, "6");
  }

  // -- 7. Readiness timeout → 503 within ~the deadline (not hung) --
  {
    __resetHealthRateLimitForTests();
    __setReadinessProbeForTests(() => new Promise<void>(() => {})); // never settles
    const start = Date.now();
    const res = await readiness.GET(req("GET"));
    const elapsed = Date.now() - start;
    assert.strictEqual(res.status, 503, "7: hung DB → 503");
    assert.ok(
      elapsed >= HEALTH_READINESS_TIMEOUT_MS - 100,
      `7: should wait ~${HEALTH_READINESS_TIMEOUT_MS}ms (was ${elapsed}ms)`,
    );
    assert.ok(
      elapsed < HEALTH_READINESS_TIMEOUT_MS + 600,
      `7: must not hang past the deadline (was ${elapsed}ms)`,
    );
    __setReadinessProbeForTests(null);
  }

  // -- 8. HEAD /api/health/ready failure → 503, empty body --
  {
    __resetHealthRateLimitForTests();
    __setReadinessProbeForTests(async () => {
      throw new Error("db down");
    });
    const res = await readiness.HEAD(req("HEAD"));
    assert.strictEqual(res.status, 503, "8: HEAD readiness 503");
    assert.strictEqual(await res.text(), "", "8: HEAD no body");
    __setReadinessProbeForTests(null);
  }

  // -- 9. Single-flight: 10 concurrent slow probes → DB invoked ONCE,
  //       all bounded by the deadline (no serialization, pool-safe) --
  {
    __resetHealthRateLimitForTests();
    let invocations = 0;
    __setReadinessProbeForTests(
      () =>
        new Promise<void>((resolve) => {
          invocations += 1;
          setTimeout(resolve, 3_000); // slower than the 1500ms deadline
        }),
    );
    const start = Date.now();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        readiness.GET(req("GET", `198.51.100.${i}`)),
      ),
    );
    const elapsed = Date.now() - start;
    assert.strictEqual(invocations, 1, "9: slow probe invoked exactly once (single-flight)");
    for (const r of results) {
      assert.strictEqual(r.status, 503, "9: each timed-out request → 503");
    }
    assert.ok(
      elapsed < HEALTH_READINESS_TIMEOUT_MS + 600,
      `9: concurrent requests must not serialize (was ${elapsed}ms)`,
    );
    __setReadinessProbeForTests(null);
  }

  // -- 10. Fresh probe after settle (no stale caching) --
  {
    __resetHealthRateLimitForTests();
    let invocations = 0;
    __setReadinessProbeForTests(async () => {
      invocations += 1;
    });
    await readiness.GET(req("GET"));
    await readiness.GET(req("GET"));
    assert.strictEqual(
      invocations,
      2,
      "10: each sequential readiness check starts a fresh probe after settle",
    );
    __setReadinessProbeForTests(null);
  }

  // -- 11. Rate limit: 60 ok, 61st → 429; independent per IP --
  {
    __resetHealthRateLimitForTests();
    __setReadinessProbeForTests(null);
    const ipA = "192.0.2.10";
    for (let i = 1; i <= 60; i++) {
      const res = await liveness.GET(req("GET", ipA));
      assert.strictEqual(res.status, 200, `11: request ${i} within budget → 200`);
    }
    const limited = await liveness.GET(req("GET", ipA));
    assert.strictEqual(limited.status, 429, "11: 61st request → 429");
    assertNoStore(limited, "11");
    const body = await limited.json();
    assert.strictEqual(body.status, "rate_limited", "11: generic rate-limit body");
    assertNoLeak(body, "11");
    // A different IP has its own bucket.
    const otherIp = await liveness.GET(req("GET", "192.0.2.99"));
    assert.strictEqual(otherIp.status, 200, "11: distinct IP not limited");
  }

  // -- 12. Rate limiter does NOT depend on Prisma/DB (static guard) --
  {
    const src = readFileSync(
      join(process.cwd(), "src/lib/observability/health-rate-limit.ts"),
      "utf8",
    );
    assert.ok(
      !/from\s+["']@\/lib\/db["']/.test(src) &&
        !/\bprisma\b/.test(src) &&
        !/\$queryRaw/.test(src),
      "12: health-rate-limit must not import prisma or @/lib/db (plan: limiter must not depend on DB)",
    );
  }

  console.log("OK: 12 health-endpoint tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
