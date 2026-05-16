// Throw-path coverage for `withObservability` (Slice 1c-server).
//
// What this codifies:
//   - Handler `throw` → wrapper returns a sanitized 500 with `x-request-id`
//     (does NOT rethrow into Next's framework-default 500 path).
//   - `captureException` is invoked exactly once with the thrown error and
//     the resolved context.
//   - Body shape is surface-aware:
//       * Admin-facing surfaces (`admin`, `workspace`) → body includes
//         `requestId` as a safe lookup reference per plan §347.
//       * Customer-facing surfaces (`api`, `kiosk`, `counter`, `kitchen`,
//         `board`) → body is fully generic; reqId only on the header.
//   - Normal returned-response paths (2xx, 4xx, 5xx returned by handler
//     itself) do NOT trigger captureException — only uncaught throws do.
//   - `Error.cause` chain is preserved through the captured event.
//   - The response's `x-request-id` matches the captured event's reqId
//     (operator correlation).
//
// Adapter swap: uses `__configureForTests` (no-op in production) to install
// a recording adapter so we can assert what the pipeline actually emitted.
//
// Run: npm run test:observability-throw-path

process.env.INTERNAL_REQUEST_ID_HMAC_SECRET = "test-secret-32-chars-long-AAAA";
(process.env as Record<string, string | undefined>).NODE_ENV = "test";

import assert from "node:assert/strict";

import {
  CLIENT_REQUEST_ID_HEADER,
} from "../src/lib/observability/request-id";
import { withObservability } from "../src/lib/observability/route-context";
import {
  __configureForTests,
  __resetForTests,
} from "../src/lib/observability/server";
import type {
  Adapter,
  SanitizedExceptionEvent,
  SanitizedMessageEvent,
} from "../src/lib/observability/types";

const REQ_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

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
}

async function main(): Promise<void> {
  const adapter = createRecordingAdapter();
  __configureForTests({ adapter });

  try {
    // -- 1. api surface throw → 500, generic body, header, capture once --
    {
      reset(adapter);
      const req = new Request("http://localhost/api/orders");
      const res = await withObservability(req, async () => {
        throw new Error("kaboom-1");
      });
      assert.strictEqual(res.status, 500, "1: status 500");
      const reqId = res.headers.get(CLIENT_REQUEST_ID_HEADER);
      assert.match(reqId ?? "", REQ_ID_PATTERN, "1: x-request-id set");
      const body = await res.json();
      assert.deepStrictEqual(body, { error: "Internal Server Error" }, "1: generic body, no requestId");
      assert.strictEqual(adapter.exceptions.length, 1, "1: captured exactly once");
      assert.strictEqual(adapter.exceptions[0].context.requestId, reqId, "1: capture reqId matches header");
      assert.strictEqual(adapter.exceptions[0].context.surface, "api", "1: surface=api");
    }

    // -- 2. admin surface throw → body includes requestId as lookup ref --
    {
      reset(adapter);
      const req = new Request("http://localhost/api/admin/users");
      const res = await withObservability(req, async () => {
        throw new Error("kaboom-2");
      });
      assert.strictEqual(res.status, 500);
      const reqId = res.headers.get(CLIENT_REQUEST_ID_HEADER);
      const body = await res.json();
      assert.strictEqual(body.error, "Internal Server Error", "2: generic message");
      assert.strictEqual(body.requestId, reqId, "2: admin body includes reqId (lookup ref)");
      assert.strictEqual(adapter.exceptions[0].context.surface, "admin", "2: surface=admin");
    }

    // -- 3. workspace surface throw → body includes requestId --
    {
      reset(adapter);
      const req = new Request("http://localhost/api/admin/workspace/orders/summary");
      const res = await withObservability(req, async () => {
        throw new Error("kaboom-3");
      });
      const reqId = res.headers.get(CLIENT_REQUEST_ID_HEADER);
      const body = await res.json();
      assert.strictEqual(body.requestId, reqId, "3: workspace body includes reqId");
      assert.strictEqual(adapter.exceptions[0].context.surface, "workspace", "3: surface=workspace");
    }

    // -- 4. kiosk surface (via options.surface) → body has NO requestId --
    {
      reset(adapter);
      const req = new Request("http://localhost/api/orders");
      const res = await withObservability(
        req,
        async () => {
          throw new Error("kaboom-4");
        },
        { surface: "kiosk" },
      );
      const body = await res.json();
      assert.deepStrictEqual(
        body,
        { error: "Internal Server Error" },
        "4: kiosk body has no requestId (customer-facing)",
      );
      assert.strictEqual(adapter.exceptions[0].context.surface, "kiosk", "4: surface=kiosk");
    }

    // -- 5. counter/kitchen/board surfaces → operator devices, also generic --
    for (const surface of ["counter", "kitchen", "board"] as const) {
      reset(adapter);
      const req = new Request("http://localhost/api/orders");
      const res = await withObservability(
        req,
        async () => {
          throw new Error(`kaboom-${surface}`);
        },
        { surface },
      );
      const body = await res.json();
      assert.deepStrictEqual(
        body,
        { error: "Internal Server Error" },
        `5: ${surface} body must NOT include requestId`,
      );
      assert.strictEqual(adapter.exceptions[0].context.surface, surface);
    }

    // -- 6. Handler RETURNS a 5xx (not throws) → NOT captured --
    // Handlers that catch their own errors and synthesize a 5xx response
    // own the failure semantics. The wrapper's catch is a safety net for
    // truly uncaught throws only.
    {
      reset(adapter);
      const req = new Request("http://localhost/api/orders");
      const res = await withObservability(req, async () =>
        new Response(JSON.stringify({ error: "handler-owned 500" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
      );
      assert.strictEqual(res.status, 500, "6: returned 500 is preserved");
      assert.strictEqual(adapter.exceptions.length, 0, "6: handler-owned 5xx must not double-capture");
      const body = await res.json();
      assert.deepStrictEqual(body, { error: "handler-owned 500" }, "6: handler body preserved");
      assert.match(res.headers.get(CLIENT_REQUEST_ID_HEADER) ?? "", REQ_ID_PATTERN, "6: still tagged");
    }

    // -- 7. Handler returns 2xx → NOT captured --
    {
      reset(adapter);
      const req = new Request("http://localhost/api/orders");
      const res = await withObservability(req, async () =>
        new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }),
      );
      assert.strictEqual(res.status, 200);
      assert.strictEqual(adapter.exceptions.length, 0, "7: 2xx must not trigger capture");
    }

    // -- 8. Handler returns 4xx (auth/validation) → NOT captured --
    {
      reset(adapter);
      const req = new Request("http://localhost/api/orders");
      const res = await withObservability(req, async () =>
        new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
      );
      assert.strictEqual(res.status, 401);
      assert.strictEqual(adapter.exceptions.length, 0, "8: 4xx must not trigger capture");
    }

    // -- 9. Captured event's error name + message reflect the throw --
    {
      reset(adapter);
      const req = new Request("http://localhost/api/orders");
      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = "CustomError";
        }
      }
      await withObservability(req, async () => {
        throw new CustomError("specific message text");
      });
      assert.strictEqual(adapter.exceptions.length, 1, "9: captured once");
      assert.strictEqual(adapter.exceptions[0].name, "CustomError", "9: error name preserved");
      assert.ok(
        adapter.exceptions[0].message.includes("specific message text"),
        "9: error message preserved (scrubbed but text intact)",
      );
    }

    // -- 10. Error.cause chain captured (recursive scrubbing) --
    {
      reset(adapter);
      const req = new Request("http://localhost/api/orders");
      const root = new Error("root cause text");
      root.name = "RootError";
      const wrapper = new Error("wrapper text", { cause: root });
      wrapper.name = "WrapperError";
      await withObservability(req, async () => {
        throw wrapper;
      });
      assert.strictEqual(adapter.exceptions.length, 1);
      const event = adapter.exceptions[0];
      assert.strictEqual(event.name, "WrapperError");
      assert.ok(event.cause, "10: cause attached");
      assert.strictEqual(event.cause!.name, "RootError", "10: cause.name preserved");
      assert.ok(event.cause!.message.includes("root cause text"), "10: cause.message preserved");
    }

    // -- 11. Correlation proof: response x-request-id === captured reqId --
    // Already asserted in test 1 but worth pinning explicitly as the
    // operator-facing contract that motivated this slice.
    {
      reset(adapter);
      const req = new Request("http://localhost/api/admin/users");
      const res = await withObservability(req, async () => {
        throw new Error("correlation-test");
      });
      const headerReqId = res.headers.get(CLIENT_REQUEST_ID_HEADER);
      const body = await res.json();
      const bodyReqId = body.requestId;
      const eventReqId = adapter.exceptions[0].context.requestId;
      assert.strictEqual(headerReqId, eventReqId, "11: header ↔ event reqId match");
      assert.strictEqual(headerReqId, bodyReqId, "11: header ↔ body reqId match");
    }

    // -- 12. Multiple sequential throws each captured independently --
    {
      reset(adapter);
      for (let i = 0; i < 5; i++) {
        const req = new Request("http://localhost/api/orders");
        await withObservability(req, async () => {
          throw new Error(`seq-${i}`);
        });
      }
      assert.strictEqual(adapter.exceptions.length, 5, "12: each throw captured once");
      const reqIds = new Set(adapter.exceptions.map((e) => e.context.requestId));
      assert.strictEqual(reqIds.size, 5, "12: each capture has a unique reqId");
    }

    console.log("OK: 12 throw-path tests passed");
  } finally {
    __resetForTests();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
