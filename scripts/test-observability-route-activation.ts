// Route-activation smoke test for the seven high-value handlers.
//
// What this codifies:
//   - Each wrapped handler returns `x-request-id` on its response.
//   - The id is well-formed (22 base64url chars from the wrapper's
//     `generateRequestId`).
//   - Existing auth-blocked status codes (401) are preserved — wrapping
//     does NOT alter handler-side behavior.
//
// Why no-auth path: every handler under test rejects the request via its
// own auth check before any DB call (cookie/header check returns null
// upstream of `prisma.*`). This means the test exercises the full wrapper
// path — including ALS context setup and `attachRequestIdHeader` — without
// requiring a running database. The route-activation contract is simple:
// the wrapper must run on every code path the handler can return through,
// auth-blocked included.
//
// Server-only shim: `admin-sessions.ts` and friends do `import "server-only"`,
// which throws when loaded outside a React Server Component. Other test
// scripts in this repo (`test-admin-rbac-active-outlet.ts`, etc.) use the
// same require.cache shim — see those for prior art.
//
// Run: npm run test:observability-route-activation

process.env.INTERNAL_REQUEST_ID_HMAC_SECRET = "test-secret-32-chars-long-AAAA";

import { createRequire } from "module";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

const require = createRequire(import.meta.url);

// Pre-populate `server-only` in require.cache with an empty exports object
// so admin-sessions / dashboard summary modules can be loaded by tsx.
function stubServerOnly(): void {
  const serverOnlyPath = require.resolve("server-only");
  require.cache[serverOnlyPath] = {
    id: serverOnlyPath,
    filename: serverOnlyPath,
    loaded: true,
    exports: {},
    children: [],
    paths: [],
  } as unknown as NodeJS.Module;
}

stubServerOnly();

const REQ_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
// Reuse one constant — the wrapper exports it. Imported lazily after stub.
let CLIENT_REQUEST_ID_HEADER = "x-request-id";

function emptyReq(url: string): NextRequest {
  return new NextRequest(url);
}

function jsonReq(url: string, method: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function assertWrapped(label: string, res: Response, expectedStatus: number): void {
  const reqId = res.headers.get(CLIENT_REQUEST_ID_HEADER);
  assert.ok(reqId, `${label}: response missing ${CLIENT_REQUEST_ID_HEADER}`);
  assert.match(reqId!, REQ_ID_PATTERN, `${label}: ${CLIENT_REQUEST_ID_HEADER} must be a fresh 22-char base64url id`);
  assert.strictEqual(res.status, expectedStatus, `${label}: status preserved`);
}

async function main(): Promise<void> {
  // Dynamic imports MUST run after stubServerOnly() so the no-op shim
  // wins the require.cache lookup before admin-sessions tries to throw.
  const reqIdMod = await import("../src/lib/observability/request-id");
  CLIENT_REQUEST_ID_HEADER = reqIdMod.CLIENT_REQUEST_ID_HEADER;

  const menu = await import("../src/app/api/menu/route");
  const paymentsSessions = await import("../src/app/api/payments/sessions/route");
  const paymentsSessionById = await import("../src/app/api/payments/sessions/[id]/route");
  const orders = await import("../src/app/api/orders/route");
  const dashboardSummary = await import(
    "../src/app/api/admin/workspace/dashboard/summary/route"
  );
  const ordersSummary = await import(
    "../src/app/api/admin/workspace/orders/summary/route"
  );
  const editorContext = await import(
    "../src/app/api/admin/workspace/menu/editor-context/route"
  );

  // -- 1. /api/menu GET — unauthorized → 401, x-request-id attached --
  {
    const res = await menu.GET(emptyReq("http://localhost/api/menu"));
    assertWrapped("/api/menu GET", res, 401);
  }

  // -- 2. /api/payments/sessions POST — unauthorized → 401, tagged --
  {
    const res = await paymentsSessions.POST(
      jsonReq("http://localhost/api/payments/sessions", "POST", { items: [] }),
    );
    assertWrapped("/api/payments/sessions POST", res, 401);
  }

  // -- 3. /api/payments/sessions/[id] GET — unauthorized → 401, tagged --
  {
    const res = await paymentsSessionById.GET(
      emptyReq("http://localhost/api/payments/sessions/abc-123"),
      { params: Promise.resolve({ id: "abc-123" }) },
    );
    assertWrapped("/api/payments/sessions/[id] GET", res, 401);
  }

  // -- 4. /api/orders POST — unauthorized → 401, tagged --
  {
    const res = await orders.POST(
      jsonReq("http://localhost/api/orders", "POST", {}),
    );
    assertWrapped("/api/orders POST", res, 401);
  }

  // -- 5. /api/orders GET — unauthorized → 401, tagged --
  {
    const res = await orders.GET(emptyReq("http://localhost/api/orders"));
    assertWrapped("/api/orders GET", res, 401);
  }

  // -- 6. /api/admin/workspace/dashboard/summary GET — unauth → 401, tagged --
  {
    const res = await dashboardSummary.GET(
      emptyReq("http://localhost/api/admin/workspace/dashboard/summary"),
    );
    assertWrapped("/api/admin/workspace/dashboard/summary GET", res, 401);
    assert.strictEqual(
      res.headers.get("cache-control"),
      "no-store",
      "dashboard/summary: cache-control must survive the wrap",
    );
  }

  // -- 7. /api/admin/workspace/orders/summary GET — unauth → 401, tagged --
  {
    const res = await ordersSummary.GET(
      emptyReq("http://localhost/api/admin/workspace/orders/summary"),
    );
    assertWrapped("/api/admin/workspace/orders/summary GET", res, 401);
    assert.strictEqual(
      res.headers.get("cache-control"),
      "no-store",
      "orders/summary: cache-control must survive the wrap",
    );
  }

  // -- 8. /api/admin/workspace/menu/editor-context GET — unauth → 401, tagged --
  {
    const res = await editorContext.GET(
      emptyReq("http://localhost/api/admin/workspace/menu/editor-context"),
    );
    assertWrapped("/api/admin/workspace/menu/editor-context GET", res, 401);
  }

  // -- 9. Each handler emits a UNIQUE reqId (no module-state caching). --
  {
    const ids = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const res = await menu.GET(emptyReq("http://localhost/api/menu"));
      const id = res.headers.get(CLIENT_REQUEST_ID_HEADER);
      assert.ok(id);
      ids.add(id!);
    }
    assert.strictEqual(ids.size, 20, "9: each request must get a fresh, unique reqId");
  }

  // -- 10. The wrapper preserves the response Content-Type body for the
  //        unauthorized JSON responses (sanity that response shape is intact). --
  {
    const res = await menu.GET(emptyReq("http://localhost/api/menu"));
    const body = await res.json();
    assert.strictEqual(body.error, "Unauthorized", "10: 401 body shape preserved");
    assert.strictEqual(body.errorCode, "unauthorized", "10: 401 errorCode preserved");
  }

  console.log("OK: 10 route-activation tests passed (8 handlers wrapped)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
