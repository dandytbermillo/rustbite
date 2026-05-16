// Controlled-exception probe route coverage (Slice 1 follow-up).
//
// Proves the deferred-then-built guarded throw route:
//   - Disabled by default: every verb → 404, NOT captured, still tagged
//     with x-request-id (the route does not reveal its own existence).
//   - Fails closed: enabled but no/short secret → 404; enabled + secret
//     but missing/wrong/non-decodable signature → 404; none captured.
//   - Pre-auth invisibility (signature is the FIRST gate): an UNSIGNED
//     wrong-method request → 404 (NOT 405); an UNSIGNED POST flood → all
//     404, never 429, never captured, and it does NOT consume the signed
//     probe's per-IP budget (a signed POST from the same IP immediately
//     after still succeeds). Authenticated wrong-method → 405 (Allow:
//     POST) — observable only by a secret-holder.
//   - Happy path: enabled + secret + valid HMAC signature → the handler
//     throws and `withObservability` returns a sanitized generic 500
//     (surface=api ⇒ NO requestId in body) with x-request-id; the error
//     is captured exactly once; event.name === "ObservabilityProbeError";
//     the synthetic Error.cause is captured recursively; the response
//     x-request-id equals the captured event's reqId (operator
//     correlation).
//   - Dedicated rate limiter (POST-authenticated only): strict default
//     (5/min), 6th → 429, per-IP independent, env-tunable, and 429 is NOT
//     captured (it is a returned response).
//
// Adapter swap via `__configureForTests` (no-op in production) so the
// pipeline's emitted events can be asserted directly.
//
// Run: npm run test:observability-test-exception

process.env.INTERNAL_REQUEST_ID_HMAC_SECRET = "test-secret-32-chars-long-AAAA";
(process.env as Record<string, string | undefined>).NODE_ENV = "test";

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";

import { CLIENT_REQUEST_ID_HEADER } from "../src/lib/observability/request-id";
import {
  __configureForTests,
  __resetForTests,
} from "../src/lib/observability/server";
import type {
  Adapter,
  SanitizedExceptionEvent,
  SanitizedMessageEvent,
} from "../src/lib/observability/types";
import * as route from "../src/app/api/observability/test-exception/route";

const REQ_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const URL = "http://localhost/api/observability/test-exception";
const SECRET = "probe-secret-32-chars-long-XXXXX"; // ≥16
const SIGNATURE_PAYLOAD = "observability-test-exception";

type RecordingAdapter = Adapter & {
  exceptions: SanitizedExceptionEvent[];
  messages: SanitizedMessageEvent[];
};

function createRecordingAdapter(): RecordingAdapter {
  const exceptions: SanitizedExceptionEvent[] = [];
  const messages: SanitizedMessageEvent[] = [];
  return {
    exceptions,
    messages,
    captureException(event) {
      exceptions.push(event);
    },
    captureMessage(event) {
      messages.push(event);
    },
    flush() {
      return Promise.resolve();
    },
  };
}

function reset(adapter: RecordingAdapter): void {
  adapter.exceptions.length = 0;
  adapter.messages.length = 0;
  route.__resetTestExceptionRateLimitForTests();
}

function validSignature(secret = SECRET): string {
  return createHmac("sha256", secret).update(SIGNATURE_PAYLOAD).digest("base64url");
}

function req(
  method: string,
  opts: { sig?: string; ip?: string } = {},
): NextRequest {
  const headers: Record<string, string> = {
    "x-forwarded-for": opts.ip ?? "203.0.113.50",
  };
  if (opts.sig !== undefined) headers["x-observability-test-signature"] = opts.sig;
  return new NextRequest(URL, { method, headers });
}

function enable(): void {
  process.env.OBSERVABILITY_TEST_ROUTE_ENABLED = "true";
  process.env.OBSERVABILITY_TEST_SECRET = SECRET;
}
function disable(): void {
  delete process.env.OBSERVABILITY_TEST_ROUTE_ENABLED;
  delete process.env.OBSERVABILITY_TEST_SECRET;
  delete process.env.OBSERVABILITY_TEST_ROUTE_MAX_PER_MIN;
}

function assertTagged(res: Response, label: string): string {
  const id = res.headers.get(CLIENT_REQUEST_ID_HEADER);
  assert.match(id ?? "", REQ_ID_PATTERN, `${label}: x-request-id present`);
  return id as string;
}

function assertNoStore(res: Response, label: string): void {
  assert.strictEqual(
    res.headers.get("cache-control"),
    "no-store",
    `${label}: Cache-Control: no-store`,
  );
}

async function main(): Promise<void> {
  const adapter = createRecordingAdapter();
  __configureForTests({ adapter });

  try {
    // -- 1. Disabled by default: POST → 404, NOT captured, still tagged --
    {
      reset(adapter);
      disable();
      const res = await route.POST(req("POST", { sig: validSignature() }));
      assert.strictEqual(res.status, 404, "1: disabled → 404");
      assertNoStore(res, "1");
      assertTagged(res, "1");
      assert.deepStrictEqual(await res.json(), { error: "Not Found" }, "1: body");
      assert.strictEqual(adapter.exceptions.length, 0, "1: not captured");
    }

    // -- 2. Disabled: EVERY verb → 404, none captured (no existence leak) --
    {
      for (const m of ["GET", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"] as const) {
        reset(adapter);
        disable();
        const handler = route[m] as (r: NextRequest) => Promise<Response>;
        const res = await handler(req(m, { sig: validSignature() }));
        assert.strictEqual(res.status, 404, `2:${m} disabled → 404`);
        assert.strictEqual(adapter.exceptions.length, 0, `2:${m} not captured`);
      }
    }

    // -- 3. Enabled but NO secret → 404 (fail closed), not captured --
    {
      reset(adapter);
      disable();
      process.env.OBSERVABILITY_TEST_ROUTE_ENABLED = "true"; // flag on, no secret
      const res = await route.POST(req("POST", { sig: validSignature() }));
      assert.strictEqual(res.status, 404, "3: enabled w/o secret → 404");
      assert.strictEqual(adapter.exceptions.length, 0, "3: not captured");
    }

    // -- 4. Enabled + secret, MISSING signature header → 404 --
    {
      reset(adapter);
      enable();
      const res = await route.POST(req("POST")); // no sig header
      assert.strictEqual(res.status, 404, "4: missing signature → 404");
      assert.strictEqual(adapter.exceptions.length, 0, "4: not captured");
    }

    // -- 5. Enabled + secret, WRONG signature (valid b64url, wrong key) --
    {
      reset(adapter);
      enable();
      const res = await route.POST(
        req("POST", { sig: validSignature("a-different-secret-xxxxxxxxxxxx") }),
      );
      assert.strictEqual(res.status, 404, "5: wrong signature → 404");
      assert.strictEqual(adapter.exceptions.length, 0, "5: not captured");
    }

    // -- 6. Enabled + secret, NON-decodable signature → 404 (decode fail) --
    {
      reset(adapter);
      enable();
      const res = await route.POST(req("POST", { sig: "@@@not-base64@@@" }));
      assert.strictEqual(res.status, 404, "6: bad-encoding signature → 404");
      assert.strictEqual(adapter.exceptions.length, 0, "6: not captured");
    }

    // -- 7. Happy path: valid signature → 500, generic body, captured once,
    //       cause captured, header reqId === event reqId --
    {
      reset(adapter);
      enable();
      const res = await route.POST(req("POST", { sig: validSignature() }));
      assert.strictEqual(res.status, 500, "7: valid → 500");
      const headerId = assertTagged(res, "7");
      const body = await res.json();
      assert.deepStrictEqual(
        body,
        { error: "Internal Server Error" },
        "7: api surface ⇒ generic body, NO requestId leaked",
      );
      assert.strictEqual(adapter.exceptions.length, 1, "7: captured exactly once");
      const ev = adapter.exceptions[0];
      assert.strictEqual(ev.name, "ObservabilityProbeError", "7: error name");
      assert.strictEqual(ev.context.surface, "api", "7: surface=api");
      assert.strictEqual(ev.context.requestId, headerId, "7: header ↔ event reqId");
      assert.ok(ev.cause, "7: synthetic cause captured");
      assert.strictEqual(
        ev.cause!.name,
        "ObservabilityProbeError",
        "7: cause name (recursive capture)",
      );
    }

    // -- 8. AUTHENTICATED wrong method (valid sig, GET) → 405 (Allow:
    //       POST), not captured. Observable only by a secret-holder. --
    {
      reset(adapter);
      enable();
      const res = await route.GET(req("GET", { sig: validSignature() }));
      assert.strictEqual(res.status, 405, "8: authed GET → 405");
      assert.strictEqual(res.headers.get("allow"), "POST", "8: Allow: POST");
      assertNoStore(res, "8");
      assert.strictEqual(adapter.exceptions.length, 0, "8: 405 not captured");
    }

    // -- 9. UNSIGNED wrong method on an ENABLED route → 404, NOT 405.
    //       Signature is the first gate: an unauthenticated caller cannot
    //       learn the route is enabled via a method error. --
    {
      reset(adapter);
      enable();
      const res = await route.GET(req("GET")); // no signature header
      assert.strictEqual(res.status, 404, "9: unsigned GET (enabled) → 404");
      assert.strictEqual(res.headers.get("allow"), null, "9: no Allow leak");
      assert.deepStrictEqual(await res.json(), { error: "Not Found" }, "9: body");
      assert.strictEqual(adapter.exceptions.length, 0, "9: not captured");
    }

    // -- 10. Regression (reviewer finding): an UNSIGNED POST flood on an
    //        enabled route → every response 404 (never 429, no enabled-
    //        state leak), none captured, AND it does NOT consume the
    //        signed probe's per-IP budget — a signed POST from the SAME
    //        IP immediately after still succeeds (500). --
    {
      reset(adapter);
      enable();
      const ip = "198.51.100.77";
      for (let i = 1; i <= 8; i++) {
        const r = await route.POST(req("POST", { ip })); // unsigned
        assert.strictEqual(r.status, 404, `10: unsigned POST ${i} → 404`);
      }
      assert.strictEqual(adapter.exceptions.length, 0, "10: flood not captured");
      // The signed budget was untouched by the 8 unsigned hits:
      const signed = await route.POST(req("POST", { sig: validSignature(), ip }));
      assert.strictEqual(
        signed.status,
        500,
        "10: signed POST from same IP still works (budget not consumed)",
      );
      assert.strictEqual(adapter.exceptions.length, 1, "10: signed throw captured");
    }

    // -- 11. Dedicated rate limiter (POST-authenticated): default 5/min;
    //        6th → 429 (not captured); a distinct IP has its own budget --
    {
      reset(adapter);
      enable();
      const sig = validSignature();
      for (let i = 1; i <= 5; i++) {
        const r = await route.POST(req("POST", { sig, ip: "198.51.100.1" }));
        assert.strictEqual(r.status, 500, `11: probe ${i} within budget → 500`);
      }
      assert.strictEqual(adapter.exceptions.length, 5, "11: 5 throws captured");
      const limited = await route.POST(req("POST", { sig, ip: "198.51.100.1" }));
      assert.strictEqual(limited.status, 429, "11: 6th → 429");
      assertNoStore(limited, "11");
      assert.strictEqual(limited.headers.get("retry-after"), "60", "11: Retry-After");
      assert.strictEqual(
        adapter.exceptions.length,
        5,
        "11: 429 is a returned response, NOT captured",
      );
      // A different IP is unaffected (per-IP buckets).
      const otherIp = await route.POST(req("POST", { sig, ip: "198.51.100.2" }));
      assert.strictEqual(otherIp.status, 500, "11: distinct IP not limited");
    }

    // -- 12. Env override widens the limit (config knob works) --
    {
      reset(adapter);
      enable();
      process.env.OBSERVABILITY_TEST_ROUTE_MAX_PER_MIN = "2";
      const sig = validSignature();
      assert.strictEqual(
        (await route.POST(req("POST", { sig, ip: "192.0.2.1" }))).status,
        500,
        "12: 1st ok",
      );
      assert.strictEqual(
        (await route.POST(req("POST", { sig, ip: "192.0.2.1" }))).status,
        500,
        "12: 2nd ok (max=2)",
      );
      assert.strictEqual(
        (await route.POST(req("POST", { sig, ip: "192.0.2.1" }))).status,
        429,
        "12: 3rd → 429 at max=2",
      );
      delete process.env.OBSERVABILITY_TEST_ROUTE_MAX_PER_MIN;
    }

    console.log("OK: 12 controlled-exception-route tests passed");
  } finally {
    disable();
    __resetForTests();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
