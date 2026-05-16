// Integration test for the Edge-runtime middleware (`src/middleware.ts`).
//
// Codifies the middleware-side request-id behavior the reviewer flagged as
// untested in find.md round 3:
//   - Middleware ALWAYS attaches `x-request-id` to outbound responses
//     (auth-blocked 401s, redirects, and pass-through alike).
//   - Middleware strips client-supplied `x-internal-*` headers from the
//     forwarded request before signing its own.
//   - Middleware writes a freshly-signed `x-internal-request-id` onto the
//     forwarded request via Next's header rewrite path.
//   - The signature on the forwarded `x-internal-request-id` verifies with
//     the same secret on the handler side (closing the handshake).
//   - Middleware production missing-secret → THROWS (no silent degrade).
//   - Middleware non-production missing-secret → keeps requests flowing.
//
// Importing `middleware()` directly is safe because `admin-auth` and
// `device-auth` have no top-level prisma/db side effects (verified via
// `head -15` in the patch session).
//
// Run: npm run test:observability-middleware

process.env.INTERNAL_REQUEST_ID_HMAC_SECRET = "test-secret-32-chars-long-AAAA";

import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { middleware } from "../src/middleware";
import {
  CLIENT_REQUEST_ID_HEADER,
  INTERNAL_REQUEST_ID_HEADER,
  readHmacSecretFromEnv,
  verifyInternalRequestIdHeader,
} from "../src/lib/observability/request-id";

const REQ_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/**
 * Read the forwarded `x-internal-request-id` value that middleware set
 * via `NextResponse.next({ request: { headers } })`.
 *
 * Next conveys the override using two internal response headers:
 *   - `x-middleware-override-headers`: comma-joined list of overridden names
 *   - `x-middleware-request-<lowercase-name>`: the override value for each
 *
 * This is an internal Next.js convention. The shape may shift between
 * versions; if it does, this test will fail loudly and we can adjust.
 */
function readForwardedInternalRequestId(res: Response): string | null {
  const overridden = res.headers.get("x-middleware-override-headers");
  if (!overridden) return null;
  const names = overridden.split(",").map((n) => n.trim().toLowerCase());
  if (!names.includes(INTERNAL_REQUEST_ID_HEADER)) return null;
  return res.headers.get(`x-middleware-request-${INTERNAL_REQUEST_ID_HEADER}`);
}

function makeReq(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, { headers });
}

async function main(): Promise<void> {
  const secret = readHmacSecretFromEnv();
  assert.ok(secret, "test setup: HMAC secret must be present");

  // -- 1. Pass-through path: /kiosk with valid device session is rejected
  //       upstream (no cookie set in this test) → 307 redirect to /device-login.
  //       The redirect MUST carry x-request-id.
  {
    const req = makeReq("http://localhost/kiosk");
    const res = await middleware(req);
    const reqId = res.headers.get(CLIENT_REQUEST_ID_HEADER);
    assert.ok(reqId, "1: redirect response must carry x-request-id");
    assert.match(reqId!, REQ_ID_PATTERN, "1: x-request-id must be well-formed");
  }

  // -- 2. Auth-blocked /api/admin without auth → 401 JSON. MUST have x-request-id. --
  {
    const req = makeReq("http://localhost/api/admin/users");
    const res = await middleware(req);
    assert.strictEqual(res.status, 401, "2: missing auth → 401");
    const reqId = res.headers.get(CLIENT_REQUEST_ID_HEADER);
    assert.ok(reqId, "2: 401 response must carry x-request-id");
    assert.match(reqId!, REQ_ID_PATTERN);
  }

  // -- 3. Auth-blocked /admin (page) without auth → 307 redirect to /admin/login.
  //       MUST have x-request-id on the redirect. --
  {
    const req = makeReq("http://localhost/admin/dashboard");
    const res = await middleware(req);
    assert.strictEqual(res.status, 307, "3: unauth admin page → redirect");
    assert.match(res.headers.get(CLIENT_REQUEST_ID_HEADER) ?? "", REQ_ID_PATTERN, "3: redirect tagged");
  }

  // -- 4. Forwarded header: a passing request (admin login page is exempt) sets
  //       x-internal-request-id on the FORWARDED request via Next's override.
  //       Verify the signature matches the same secret. --
  {
    const req = makeReq("http://localhost/admin/login");
    const res = await middleware(req);
    const responseReqId = res.headers.get(CLIENT_REQUEST_ID_HEADER);
    assert.ok(responseReqId, "4: response x-request-id present");

    const forwarded = readForwardedInternalRequestId(res);
    assert.ok(forwarded, "4: forwarded x-internal-request-id present");

    const verified = await verifyInternalRequestIdHeader(forwarded!, secret);
    assert.ok(verified, "4: forwarded HMAC must verify with the deploy secret");
    assert.strictEqual(
      verified,
      responseReqId,
      "4: unwrapped reqId must equal the response x-request-id (closes handshake)",
    );
  }

  // -- 5. Client-supplied x-internal-* headers MUST be stripped from the
  //       forwarded request. We send a forged x-internal-request-id; the
  //       middleware strips it AND replaces it with its own signed value.
  //       The forwarded value must NOT equal the client's forged value. --
  {
    const req = makeReq("http://localhost/admin/login", {
      [INTERNAL_REQUEST_ID_HEADER]: "ATTACKERREQID000000.fakesigvalue",
      "x-internal-something-else": "evil",
    });
    const res = await middleware(req);
    const forwarded = readForwardedInternalRequestId(res);
    assert.ok(forwarded, "5: middleware still sets its own forwarded header");
    assert.notStrictEqual(
      forwarded,
      "ATTACKERREQID000000.fakesigvalue",
      "5: client-forged x-internal-request-id MUST be stripped",
    );
    const verified = await verifyInternalRequestIdHeader(forwarded!, secret);
    assert.ok(verified, "5: replacement value must verify with the real secret");

    // Other x-internal-* keys: the forwarded request should NOT carry them.
    // Override headers list should not include the bogus key.
    const overridden = res.headers.get("x-middleware-override-headers") ?? "";
    assert.ok(
      !overridden.toLowerCase().split(",").map((s) => s.trim()).includes("x-internal-something-else"),
      "5: stray x-internal-* keys must not be set on forwarded headers",
    );
  }

  // -- 6. Production missing-secret → middleware THROWS. This is the
  //       regression test for find.md round 2 #3 — the previous swallow
  //       silently degraded; the fix lets the throw bubble so the deploy
  //       log surfaces the misconfig immediately. --
  {
    const savedNodeEnv = process.env.NODE_ENV;
    const savedSecret = process.env.INTERNAL_REQUEST_ID_HMAC_SECRET;
    try {
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      delete process.env.INTERNAL_REQUEST_ID_HMAC_SECRET;
      const req = makeReq("http://localhost/kiosk");
      await assert.rejects(
        middleware(req),
        /INTERNAL_REQUEST_ID_HMAC_SECRET/,
        "6: production missing secret → middleware throws (loud)",
      );
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = savedNodeEnv;
      if (savedSecret !== undefined) {
        process.env.INTERNAL_REQUEST_ID_HMAC_SECRET = savedSecret;
      }
    }
  }

  // -- 7. Non-production missing-secret → middleware does NOT throw and
  //       still tags responses with x-request-id (degrades gracefully but
  //       without HMAC sign — the forwarded request will not carry the
  //       internal header). Keeps dev/local ergonomic. --
  {
    const savedNodeEnv = process.env.NODE_ENV;
    const savedSecret = process.env.INTERNAL_REQUEST_ID_HMAC_SECRET;
    try {
      (process.env as Record<string, string | undefined>).NODE_ENV = "development";
      delete process.env.INTERNAL_REQUEST_ID_HMAC_SECRET;
      const req = makeReq("http://localhost/admin/login");
      const res = await middleware(req);
      assert.match(
        res.headers.get(CLIENT_REQUEST_ID_HEADER) ?? "",
        REQ_ID_PATTERN,
        "7: dev with no secret → x-request-id still set",
      );
      // No secret → no signed forwarded header.
      const forwarded = readForwardedInternalRequestId(res);
      assert.strictEqual(forwarded, null, "7: no signed forwarded header without secret");
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = savedNodeEnv;
      if (savedSecret !== undefined) {
        process.env.INTERNAL_REQUEST_ID_HMAC_SECRET = savedSecret;
      }
    }
  }

  // -- 8. Each request gets a unique reqId (no module-state leak). --
  {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const req = makeReq("http://localhost/admin/login");
      const res = await middleware(req);
      const id = res.headers.get(CLIENT_REQUEST_ID_HEADER);
      assert.ok(id);
      ids.add(id!);
    }
    assert.strictEqual(ids.size, 50, "8: every request gets a fresh, unique reqId");
  }

  console.log("OK: 8 middleware integration tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
