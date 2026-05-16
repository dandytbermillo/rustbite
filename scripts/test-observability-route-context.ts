// Integration test for the route-handler-side observability wrapper.
//
// Covers the gaps the reviewer flagged:
//   - The middleware-to-handler trusted-header handshake (signed roundtrip).
//   - Forged-header rejection (handler must NOT trust a forged reqId).
//   - Missing-header fallback (handler generates a fresh reqId).
//   - Response preservation (status/body/extra headers untouched).
//   - `x-request-id` attached to the outbound response.
//   - Client `x-request-id` validated and stored in `clientRequestId`.
//   - Surface inference + caller override.
//   - ALS context active inside the handler.
//   - Production missing-secret throws (no silent degrade).
//   - Handler errors propagate (wrapper does not swallow).
//
// Run: npm run test:observability-route-context

// MUST be set before any module that calls `readHmacSecretFromEnv()`.
// Long enough to satisfy the >=16 chars guard.
process.env.INTERNAL_REQUEST_ID_HMAC_SECRET = "test-secret-32-chars-long-AAAA";

import assert from "node:assert/strict";

import {
  CLIENT_REQUEST_ID_HEADER,
  INTERNAL_REQUEST_ID_HEADER,
  buildInternalRequestIdHeader,
  generateRequestId,
  readHmacSecretFromEnv,
} from "../src/lib/observability/request-id";
import {
  attachRequestIdHeader,
  resolveContext,
  withObservability,
} from "../src/lib/observability/route-context";
import { getRequestContext } from "../src/lib/observability/context";

const REQ_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

async function main(): Promise<void> {
  const secret = readHmacSecretFromEnv();
  assert.ok(secret, "test setup: HMAC secret should be present");

  // -- 1. Signed-header roundtrip (middleware → handler handshake) --
  {
    const reqId = generateRequestId();
    const signed = await buildInternalRequestIdHeader(reqId, secret);
    const req = new Request("http://localhost/api/orders", {
      headers: { [INTERNAL_REQUEST_ID_HEADER]: signed },
    });
    let observed: string | undefined;
    const res = await withObservability(req, async (_, ctx) => {
      observed = ctx.requestId;
      return new Response("ok");
    });
    assert.strictEqual(observed, reqId, "1: handler must see the unwrapped reqId");
    assert.strictEqual(
      res.headers.get(CLIENT_REQUEST_ID_HEADER),
      reqId,
      "1: response x-request-id must equal the trusted reqId",
    );
  }

  // -- 2. Forged signature → fresh fallback (NEVER trusts the bogus reqId) --
  {
    const req = new Request("http://localhost/api/orders", {
      headers: { [INTERNAL_REQUEST_ID_HEADER]: "ATTACKERREQID000000000.invalidsigvalue" },
    });
    let observed: string | undefined;
    await withObservability(req, async (_, ctx) => {
      observed = ctx.requestId;
      return new Response("ok");
    });
    assert.notStrictEqual(observed, "ATTACKERREQID000000000", "2: forged id must NOT be trusted");
    assert.match(observed!, REQ_ID_PATTERN, "2: must fall back to a freshly generated id");
  }

  // -- 3. Tampered signature (last byte flipped) → fresh fallback --
  {
    const reqId = generateRequestId();
    const signed = await buildInternalRequestIdHeader(reqId, secret);
    const dot = signed.indexOf(".");
    const sig = signed.slice(dot + 1);
    const tampered = `${reqId}.${sig.slice(0, -1)}${sig.slice(-1) === "A" ? "B" : "A"}`;
    const req = new Request("http://localhost/api/orders", {
      headers: { [INTERNAL_REQUEST_ID_HEADER]: tampered },
    });
    let observed: string | undefined;
    await withObservability(req, async (_, ctx) => {
      observed = ctx.requestId;
      return new Response("ok");
    });
    assert.notStrictEqual(observed, reqId, "3: flipped-bit signature must fail verify");
    assert.match(observed!, REQ_ID_PATTERN);
  }

  // -- 4. No internal header → fresh id (matcher gap path) --
  {
    const req = new Request("http://localhost/api/menu");
    let observed: string | undefined;
    const res = await withObservability(req, async (_, ctx) => {
      observed = ctx.requestId;
      return new Response("ok");
    });
    assert.match(observed!, REQ_ID_PATTERN, "4: missing header → fresh id");
    assert.strictEqual(res.headers.get(CLIENT_REQUEST_ID_HEADER), observed);
  }

  // -- 5. Response preservation (status, headers, body, content-type) --
  {
    const req = new Request("http://localhost/api/orders");
    const res = await withObservability(req, async () =>
      new Response(JSON.stringify({ orderId: "ord_1" }), {
        status: 201,
        statusText: "Created",
        headers: {
          "content-type": "application/json",
          "x-custom-header": "preserved",
          "cache-control": "no-store",
        },
      }),
    );
    assert.strictEqual(res.status, 201, "5: status preserved");
    assert.strictEqual(res.headers.get("content-type"), "application/json", "5: ct preserved");
    assert.strictEqual(res.headers.get("x-custom-header"), "preserved", "5: custom header preserved");
    assert.strictEqual(res.headers.get("cache-control"), "no-store", "5: cache-control preserved");
    assert.match(res.headers.get(CLIENT_REQUEST_ID_HEADER) ?? "", REQ_ID_PATTERN, "5: x-request-id added");
    const body = await res.json();
    assert.deepStrictEqual(body, { orderId: "ord_1" }, "5: body untouched");
  }

  // -- 6. Streaming response (ReadableStream) survives header attach --
  {
    const req = new Request("http://localhost/api/orders");
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("chunk-1"));
        controller.enqueue(new TextEncoder().encode("chunk-2"));
        controller.close();
      },
    });
    const res = await withObservability(req, async () =>
      new Response(stream, { status: 200, headers: { "content-type": "text/plain" } }),
    );
    assert.match(res.headers.get(CLIENT_REQUEST_ID_HEADER) ?? "", REQ_ID_PATTERN);
    const body = await res.text();
    assert.strictEqual(body, "chunk-1chunk-2", "6: streaming body survives header set");
  }

  // -- 7. Valid client x-request-id captured to ctx.clientRequestId --
  {
    const req = new Request("http://localhost/api/orders", {
      headers: { [CLIENT_REQUEST_ID_HEADER]: "client-trace-123" },
    });
    let observedClientId: string | undefined = "init";
    await withObservability(req, async (_, ctx) => {
      observedClientId = ctx.clientRequestId;
      return new Response("ok");
    });
    assert.strictEqual(observedClientId, "client-trace-123", "7: valid client id captured");
  }

  // -- 8. Malformed client x-request-id (whitespace, control char) → undefined --
  {
    const req = new Request("http://localhost/api/orders", {
      headers: { [CLIENT_REQUEST_ID_HEADER]: "has space and stuff" },
    });
    let observedClientId: string | undefined = "init";
    await withObservability(req, async (_, ctx) => {
      observedClientId = ctx.clientRequestId;
      return new Response("ok");
    });
    assert.strictEqual(observedClientId, undefined, "8: malformed client id rejected");
  }

  // -- 9. Surface inferred from path --
  {
    const cases: Array<[string, string]> = [
      ["http://localhost/api/orders", "api"],
      ["http://localhost/api/admin/users", "admin"],
      ["http://localhost/api/admin/workspace/stock", "workspace"],
      ["http://localhost/kiosk", "kiosk"],
      ["http://localhost/kitchen", "kitchen"],
      ["http://localhost/board", "board"],
      ["http://localhost/counter", "counter"],
    ];
    for (const [url, expected] of cases) {
      const req = new Request(url);
      let surface: string | undefined;
      await withObservability(req, async (_, ctx) => {
        surface = ctx.surface;
        return new Response("ok");
      });
      assert.strictEqual(surface, expected, `9: ${url} → surface "${expected}"`);
    }
  }

  // -- 10. Surface override via options --
  {
    const req = new Request("http://localhost/api/menu");
    let surface: string | undefined;
    await withObservability(
      req,
      async (_, ctx) => {
        surface = ctx.surface;
        return new Response("ok");
      },
      { surface: "kiosk" },
    );
    assert.strictEqual(surface, "kiosk", "10: explicit override wins");
  }

  // -- 11. Extra context (outletId, deviceId from upstream auth) --
  {
    const req = new Request("http://localhost/api/orders");
    let observed: { outletId?: string; deviceId?: string } = {};
    await withObservability(
      req,
      async (_, ctx) => {
        observed = { outletId: ctx.outletId, deviceId: ctx.deviceId };
        return new Response("ok");
      },
      { extra: { outletId: "outlet-A", deviceId: "device-K1" } },
    );
    assert.strictEqual(observed.outletId, "outlet-A", "11: extra outletId merged");
    assert.strictEqual(observed.deviceId, "device-K1", "11: extra deviceId merged");
  }

  // -- 12. ALS context active during handler execution --
  {
    const req = new Request("http://localhost/api/orders");
    let alsCtx: ReturnType<typeof getRequestContext> = null;
    await withObservability(req, async () => {
      alsCtx = getRequestContext();
      return new Response("ok");
    });
    assert.ok(alsCtx, "12: ALS must be set inside handler");
    assert.match((alsCtx as any).requestId, REQ_ID_PATTERN, "12: ALS reqId is well-formed");
  }

  // -- 13. Handler throws → wrapper catches and returns sanitized 500 --
  // Behavior changed in Slice 1c-server: the wrapper now turns handler
  // throws into a sanitized 500 with `x-request-id` (and routes the error
  // through captureException). Deep behavior — body shape per surface,
  // captured-event correlation, etc. — is covered in
  // `scripts/test-observability-throw-path.ts`.
  {
    const req = new Request("http://localhost/api/orders");
    const res = await withObservability(req, async () => {
      throw new Error("intentional handler error");
    });
    assert.strictEqual(res.status, 500, "13: handler throw → 500 (not rethrow)");
    assert.match(
      res.headers.get(CLIENT_REQUEST_ID_HEADER) ?? "",
      REQ_ID_PATTERN,
      "13: throw-path response carries x-request-id",
    );
    const body = await res.json();
    assert.strictEqual(body.error, "Internal Server Error", "13: generic body");
  }

  // -- 14. resolveContext() directly (used by middleware-blocked responses) --
  {
    const reqId = generateRequestId();
    const signed = await buildInternalRequestIdHeader(reqId, secret);
    const req = new Request("http://localhost/api/admin/users", {
      headers: {
        [INTERNAL_REQUEST_ID_HEADER]: signed,
        [CLIENT_REQUEST_ID_HEADER]: "external-corr-id",
      },
    });
    const ctx = await resolveContext(req);
    assert.strictEqual(ctx.requestId, reqId, "14: resolveContext unwraps signed id");
    assert.strictEqual(ctx.clientRequestId, "external-corr-id", "14: client id captured");
    assert.strictEqual(ctx.surface, "admin", "14: surface inferred");
  }

  // -- 15. attachRequestIdHeader() mutates in place (no clone) --
  {
    const original = new Response("hi", { status: 200, headers: { "x-x": "y" } });
    const out = attachRequestIdHeader(original, "REQID000000000000000AA");
    assert.strictEqual(out, original, "15: must reuse the same response object");
    assert.strictEqual(out.headers.get(CLIENT_REQUEST_ID_HEADER), "REQID000000000000000AA");
    assert.strictEqual(out.headers.get("x-x"), "y", "15: original headers preserved");
  }

  // -- 16. Production missing-secret → withObservability THROWS (no silent degrade) --
  // This is the regression test for the find.md #3 fix: the previous
  // implementation swallowed the throw and silently fell back to fresh-id
  // generation. The fix removes the swallow so misconfigs are loud.
  {
    const savedNodeEnv = process.env.NODE_ENV;
    const savedSecret = process.env.INTERNAL_REQUEST_ID_HMAC_SECRET;
    try {
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      delete process.env.INTERNAL_REQUEST_ID_HMAC_SECRET;
      const req = new Request("http://localhost/api/orders");
      await assert.rejects(
        withObservability(req, async () => new Response("ok")),
        /INTERNAL_REQUEST_ID_HMAC_SECRET/,
        "16: production missing secret must throw, not silently fall back",
      );
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = savedNodeEnv;
      if (savedSecret !== undefined) {
        process.env.INTERNAL_REQUEST_ID_HMAC_SECRET = savedSecret;
      }
    }
  }

  // -- 17a. extra cannot overwrite canonical requestId (find.md round 3, #1) --
  // Defense in depth: even if a caller bypasses the `ExtraContext` type with
  // `as any`, the resolveContext spread order must keep the trusted reqId.
  {
    const reqId = generateRequestId();
    const signed = await buildInternalRequestIdHeader(reqId, secret);
    const req = new Request("http://localhost/api/orders", {
      headers: { [INTERNAL_REQUEST_ID_HEADER]: signed },
    });
    let observed: { requestId?: string; clientRequestId?: string; surface?: string } = {};
    const res = await withObservability(
      req,
      async (_, ctx) => {
        observed = {
          requestId: ctx.requestId,
          clientRequestId: ctx.clientRequestId,
          surface: ctx.surface,
        };
        return new Response("ok");
      },
      // Bypass the ExtraContext type to simulate a misuse / type-cast
      // attempt — the runtime spread order must still defeat it.
      {
        extra: {
          requestId: "ATTACKER_OVERRIDE",
          clientRequestId: "ATTACKER_CLIENT",
          surface: "kiosk",
        } as unknown as Parameters<typeof withObservability>[2] extends infer O
          ? O extends { extra?: infer E }
            ? E
            : never
          : never,
      },
    );
    assert.strictEqual(observed.requestId, reqId, "17a: extra.requestId must NOT win");
    assert.notStrictEqual(observed.requestId, "ATTACKER_OVERRIDE", "17a: attacker override blocked");
    assert.strictEqual(observed.clientRequestId, undefined, "17a: extra.clientRequestId must NOT win");
    assert.strictEqual(observed.surface, "api", "17a: extra.surface must NOT win (path-inferred)");
    assert.strictEqual(
      res.headers.get(CLIENT_REQUEST_ID_HEADER),
      reqId,
      "17a: response x-request-id must remain canonical",
    );
  }

  // -- 17b. options.surface still wins over extra.surface AND over inference --
  {
    const req = new Request("http://localhost/api/orders");
    let observedSurface: string | undefined;
    await withObservability(
      req,
      async (_, ctx) => {
        observedSurface = ctx.surface;
        return new Response("ok");
      },
      {
        surface: "counter",
        extra: { surface: "kiosk" } as unknown as Parameters<
          typeof withObservability
        >[2] extends infer O
          ? O extends { extra?: infer E }
            ? E
            : never
          : never,
      },
    );
    assert.strictEqual(observedSurface, "counter", "17b: options.surface wins");
  }

  // -- 17c. extra cannot leak forged clientRequestId when no inbound header --
  {
    const req = new Request("http://localhost/api/orders");
    // No x-request-id from client. Even if extra tries to inject one,
    // the canonical clientRequestId remains undefined.
    let observedClientId: string | undefined = "init";
    await withObservability(
      req,
      async (_, ctx) => {
        observedClientId = ctx.clientRequestId;
        return new Response("ok");
      },
      {
        extra: { clientRequestId: "FORGED_CLIENT_ID" } as unknown as Parameters<
          typeof withObservability
        >[2] extends infer O
          ? O extends { extra?: infer E }
            ? E
            : never
          : never,
      },
    );
    assert.strictEqual(observedClientId, undefined, "17c: extra.clientRequestId blocked");
  }

  // -- 18. Non-production missing-secret → graceful fallback (dev/test ergonomics) --
  {
    const savedNodeEnv = process.env.NODE_ENV;
    const savedSecret = process.env.INTERNAL_REQUEST_ID_HMAC_SECRET;
    try {
      (process.env as Record<string, string | undefined>).NODE_ENV = "development";
      delete process.env.INTERNAL_REQUEST_ID_HMAC_SECRET;
      const req = new Request("http://localhost/api/orders", {
        headers: { [INTERNAL_REQUEST_ID_HEADER]: "anything.atall" },
      });
      let observed: string | undefined;
      const res = await withObservability(req, async (_, ctx) => {
        observed = ctx.requestId;
        return new Response("ok");
      });
      assert.match(observed!, REQ_ID_PATTERN, "17: dev with no secret → fresh id");
      assert.strictEqual(res.headers.get(CLIENT_REQUEST_ID_HEADER), observed);
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = savedNodeEnv;
      if (savedSecret !== undefined) {
        process.env.INTERNAL_REQUEST_ID_HMAC_SECRET = savedSecret;
      }
    }
  }

  console.log("OK: 20 route-context integration tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
