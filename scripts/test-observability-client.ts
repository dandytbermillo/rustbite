// Unit tests for the browser-side observability wrapper.
//
// Covers:
//   - captureClientException scrubs error name / message / stack
//   - PII patterns (email, card, token) in the message are redacted
//   - Error.cause chain is captured with the same scrubbing
//   - Non-Error inputs (string, plain object, undefined) are coerced
//   - Adapter throw is caught (defensive — pipeline never escapes)
//   - Scrub failure is caught (the pipeline does not propagate)
//   - installClientErrorHandlers is idempotent across N calls
//   - "error" and "unhandledrejection" listeners route to capture
//   - Allow-list context discipline: unknown keys are dropped
//   - Test seam reset restores defaults
//
// Run: npm run test:observability-client

(process.env as Record<string, string | undefined>).NODE_ENV = "test";

import assert from "node:assert/strict";

import {
  __configureForTests,
  __resetForTests,
  __resetInstallSentinelForTests,
  type ClientAdapter,
  type ClientExceptionEvent,
  type ClientMessageEvent,
  captureClientException,
  captureClientMessage,
  getClientContext,
  installClientErrorHandlers,
  setClientContext,
} from "../src/lib/observability/client";

const REDACTED = "[REDACTED]";

type RecordingAdapter = ClientAdapter & {
  exceptions: ClientExceptionEvent[];
  messages: ClientMessageEvent[];
};

function createRecordingAdapter(): RecordingAdapter {
  const exceptions: ClientExceptionEvent[] = [];
  const messages: ClientMessageEvent[] = [];
  return {
    exceptions,
    messages,
    captureException(event) {
      exceptions.push(event);
    },
    captureMessage(event) {
      messages.push(event);
    },
  };
}

function reset(adapter: RecordingAdapter): void {
  adapter.exceptions.length = 0;
  adapter.messages.length = 0;
}

function main(): void {
  const adapter = createRecordingAdapter();
  __configureForTests({ adapter, context: { surface: "kiosk" } });

  try {
    // -- 1. Plain Error → name + message + stack captured + asOf set --
    {
      reset(adapter);
      const err = new Error("simple failure");
      err.name = "DemoError";
      captureClientException(err);
      assert.strictEqual(adapter.exceptions.length, 1, "1: captured once");
      const ev = adapter.exceptions[0];
      assert.strictEqual(ev.name, "DemoError", "1: name preserved");
      assert.ok(ev.message.includes("simple failure"), "1: message preserved");
      assert.ok(typeof ev.stack === "string" && ev.stack.length > 0, "1: stack captured");
      assert.match(ev.asOf, /^\d{4}-\d{2}-\d{2}T/, "1: asOf is ISO timestamp");
      assert.strictEqual(ev.context.surface, "kiosk", "1: surface from module context");
    }

    // -- 2. PII in message → scrubbed --
    {
      reset(adapter);
      captureClientException(
        new Error("user email=alice@example.com placed order"),
      );
      assert.strictEqual(adapter.exceptions.length, 1);
      const ev = adapter.exceptions[0];
      assert.ok(
        !ev.message.includes("alice@example.com"),
        "2: raw email must not leak into captured event",
      );
      assert.ok(
        ev.message.includes(REDACTED),
        "2: email should be replaced with redaction marker",
      );
    }

    // -- 3. Bearer token in stack → scrubbed --
    {
      reset(adapter);
      const err = new Error("call failed");
      err.stack =
        "Error: call failed\n    at fetch (auth header Bearer aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa)";
      captureClientException(err);
      const ev = adapter.exceptions[0];
      assert.ok(ev.stack, "3: stack present");
      assert.ok(
        !/Bearer\s+a{40,}/.test(ev.stack!),
        "3: long bearer token must be redacted in stack",
      );
    }

    // -- 4. Error.cause chain captured (recursive) --
    {
      reset(adapter);
      const root = new Error("root cause text");
      root.name = "RootError";
      const wrapper = new Error("wrapper text", { cause: root });
      wrapper.name = "WrapperError";
      captureClientException(wrapper);
      const ev = adapter.exceptions[0];
      assert.strictEqual(ev.name, "WrapperError");
      assert.ok(ev.cause, "4: cause attached");
      assert.strictEqual(ev.cause!.name, "RootError");
      assert.ok(ev.cause!.message.includes("root cause text"));
    }

    // -- 5. Non-Error inputs coerced --
    {
      reset(adapter);
      captureClientException("a string error");
      captureClientException({ what: "plain object" });
      captureClientException(undefined);
      assert.strictEqual(adapter.exceptions.length, 3, "5: all coerced");
      assert.ok(
        adapter.exceptions[0].message.includes("a string error"),
        "5a: string preserved",
      );
      assert.ok(
        adapter.exceptions[1].message.includes("plain object") ||
          adapter.exceptions[1].message.includes("what"),
        "5b: plain object stringified into message",
      );
      assert.strictEqual(
        adapter.exceptions[1].name,
        "NonError",
        "5b: non-Error objects emit name='NonError' (not 'Error')",
      );
      assert.strictEqual(adapter.exceptions[2].name, "NonError", "5c: undefined → NonError marker");
    }

    // -- 5b. SECURITY: object throws with sensitive keys MUST be
    //        key-aware-scrubbed BEFORE stringify. Reviewer's reproducer
    //        was `captureClientException({ password: "hunter2" })`. Earlier
    //        the wrapper stringified first, losing key context — the
    //        password value survived value-pattern scanning. The fix
    //        mirrors the server wrapper: scrub the object first. --
    {
      reset(adapter);
      captureClientException({ password: "hunter2", note: "ok" });
      assert.strictEqual(adapter.exceptions.length, 1);
      const msg = adapter.exceptions[0].message;
      assert.ok(
        !msg.includes("hunter2"),
        "5b-i: password value must NOT survive into the captured message",
      );

      reset(adapter);
      captureClientException({ mfaSecret: "JBSWY3DPEHPK3PXP" });
      assert.ok(
        !adapter.exceptions[0].message.includes("JBSWY3DPEHPK3PXP"),
        "5b-ii: MFA secret value must NOT survive (key-aware deny-list)",
      );

      reset(adapter);
      captureClientException({
        nested: { sessionToken: "abc123def456ghi789" },
      });
      assert.ok(
        !adapter.exceptions[0].message.includes("abc123def456ghi789"),
        "5b-iii: nested sensitive values must NOT survive",
      );

      reset(adapter);
      captureClientException({ Authorization: "Bearer xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" });
      assert.ok(
        !adapter.exceptions[0].message.includes(
          "Bearer xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        ),
        "5b-iv: Authorization header value (sensitive key) must NOT survive",
      );
    }

    // -- 6. Caller-supplied context merges with module-local context --
    {
      reset(adapter);
      setClientContext({ deviceId: "device-K1", outletId: "outlet-A" });
      captureClientException(new Error("ctx-test"), { pagePath: "/kiosk" });
      const ev = adapter.exceptions[0];
      assert.strictEqual(ev.context.surface, "kiosk", "6: surface kept");
      assert.strictEqual(ev.context.deviceId, "device-K1", "6: deviceId merged");
      assert.strictEqual(ev.context.outletId, "outlet-A", "6: outletId merged");
      assert.strictEqual(ev.context.pagePath, "/kiosk", "6: pagePath from call site");
    }

    // -- 7. Allow-list context discipline — unknown keys dropped --
    {
      reset(adapter);
      __resetForTests();
      __configureForTests({ adapter });
      captureClientException(new Error("ctx-allowlist"), {
        // Bypass the type to simulate misuse:
        ...({ secret: "leak-me", password: "hunter2", customField: "x" } as any),
      });
      const ev = adapter.exceptions[0];
      assert.ok(
        !("secret" in ev.context),
        "7: secret must not appear in captured context",
      );
      assert.ok(
        !("password" in ev.context),
        "7: password must not appear in captured context",
      );
      assert.ok(
        !("customField" in ev.context),
        "7: unknown keys dropped by allow-list",
      );
    }

    // -- 8. Adapter throw is caught — pipeline never escapes --
    {
      const throwing: ClientAdapter = {
        captureException() {
          throw new Error("adapter blew up");
        },
        captureMessage() {
          throw new Error("adapter blew up");
        },
      };
      __resetForTests();
      __configureForTests({ adapter: throwing });
      // Must not throw out of these calls:
      captureClientException(new Error("safe-from-throw-1"));
      captureClientMessage("safe-from-throw-2");
      // Restore for later tests:
      __resetForTests();
      __configureForTests({ adapter });
      assert.ok(true, "8: pipeline did not propagate adapter throws");
    }

    // -- 9. captureClientMessage — happy path + scrub --
    {
      reset(adapter);
      captureClientMessage("page loaded for user@example.com");
      assert.strictEqual(adapter.messages.length, 1);
      const m = adapter.messages[0];
      assert.ok(!m.message.includes("user@example.com"), "9: email scrubbed");
      assert.match(m.asOf, /^\d{4}-\d{2}-\d{2}T/);
    }

    // -- 10. installClientErrorHandlers is idempotent --
    {
      __resetInstallSentinelForTests();
      let addCount = 0;
      const g = globalThis as unknown as {
        addEventListener?: (...args: unknown[]) => void;
      };
      const originalAdd = g.addEventListener;
      g.addEventListener = ((..._args: unknown[]) => {
        addCount++;
      }) as typeof g.addEventListener;
      try {
        installClientErrorHandlers();
        installClientErrorHandlers();
        installClientErrorHandlers();
        // Only the FIRST install should register handlers (2 listeners:
        // "error" + "unhandledrejection"). Subsequent calls are no-ops.
        assert.strictEqual(addCount, 2, "10: idempotent — handlers only register once");
      } finally {
        g.addEventListener = originalAdd;
        __resetInstallSentinelForTests();
      }
    }

    // -- 11. "error" listener routes to captureClientException --
    {
      __resetInstallSentinelForTests();
      reset(adapter);
      __resetForTests();
      __configureForTests({ adapter });

      // Capture registered handlers so we can call them directly.
      const registered: Record<string, (event: unknown) => void> = {};
      const g = globalThis as unknown as {
        addEventListener?: (type: string, handler: (event: unknown) => void) => void;
      };
      const originalAdd = g.addEventListener;
      g.addEventListener = ((type: string, handler: (event: unknown) => void) => {
        registered[type] = handler;
      }) as typeof g.addEventListener;
      try {
        installClientErrorHandlers();
        assert.ok(registered.error, "11: error handler registered");
        registered.error({
          error: new Error("from-window-error"),
          message: "from-window-error",
        });
        assert.strictEqual(adapter.exceptions.length, 1, "11: error event routed to capture");
        assert.ok(
          adapter.exceptions[0].message.includes("from-window-error"),
          "11: error message preserved through routing",
        );

        // 11b: object thrown as `e.error` (e.g. `throw { password: ... }`)
        // must be key-aware scrubbed — NOT pre-coerced to a leaked Error
        // string. This is the same class of bug as the direct-capture
        // path (find.md round 8/9).
        reset(adapter);
        registered.error({
          error: { password: "hunter2", detail: "boom" },
          message: "secondary message",
        });
        assert.strictEqual(adapter.exceptions.length, 1, "11b: object error routed");
        assert.ok(
          !adapter.exceptions[0].message.includes("hunter2"),
          "11b: object e.error password value must NOT leak",
        );

        // 11c: cross-origin-style event — no `error`, only a message.
        reset(adapter);
        registered.error({ error: null, message: "Script error." });
        assert.strictEqual(adapter.exceptions.length, 1, "11c: message-only error routed");
        assert.ok(
          adapter.exceptions[0].message.includes("Script error."),
          "11c: falls back to message when no error object",
        );
      } finally {
        g.addEventListener = originalAdd;
        __resetInstallSentinelForTests();
      }
    }

    // -- 12. "unhandledrejection" listener routes to capture --
    {
      __resetInstallSentinelForTests();
      reset(adapter);
      __resetForTests();
      __configureForTests({ adapter });

      const registered: Record<string, (event: unknown) => void> = {};
      const g = globalThis as unknown as {
        addEventListener?: (type: string, handler: (event: unknown) => void) => void;
      };
      const originalAdd = g.addEventListener;
      g.addEventListener = ((type: string, handler: (event: unknown) => void) => {
        registered[type] = handler;
      }) as typeof g.addEventListener;
      try {
        installClientErrorHandlers();
        assert.ok(registered.unhandledrejection, "12: rejection handler registered");
        registered.unhandledrejection({ reason: new Error("from-rejection") });
        assert.strictEqual(adapter.exceptions.length, 1);
        assert.ok(
          adapter.exceptions[0].message.includes("from-rejection"),
          "12: rejection reason routed",
        );
        // Non-Error string reason
        reset(adapter);
        registered.unhandledrejection({ reason: "string rejection" });
        assert.strictEqual(adapter.exceptions.length, 1);
        assert.ok(adapter.exceptions[0].message.includes("string rejection"));

        // 12b: SECURITY — object rejection reason must be key-aware
        // scrubbed. Reviewer's reproducer (find.md round 9):
        // `Promise.reject({ password: "hunter2" })`. Before the fix the
        // handler did `new Error(JSON.stringify(reason))` first, so the
        // password key survived value-pattern scanning.
        reset(adapter);
        registered.unhandledrejection({ reason: { password: "hunter2", ok: "x" } });
        assert.strictEqual(adapter.exceptions.length, 1, "12b: object reason routed");
        assert.ok(
          !adapter.exceptions[0].message.includes("hunter2"),
          "12b: object rejection password value must NOT leak",
        );

        // 12c: nested sensitive value in object reason
        reset(adapter);
        registered.unhandledrejection({
          reason: { meta: { sessionToken: "abc123def456ghi789" } },
        });
        assert.ok(
          !adapter.exceptions[0].message.includes("abc123def456ghi789"),
          "12c: nested sensitive value in object reason must NOT leak",
        );

        // 12d: undefined reason → coerced NonError, no throw
        reset(adapter);
        registered.unhandledrejection({ reason: undefined });
        assert.strictEqual(adapter.exceptions.length, 1, "12d: undefined reason still captured");
      } finally {
        g.addEventListener = originalAdd;
        __resetInstallSentinelForTests();
      }
    }

    // -- 13. Test seam reset restores defaults --
    {
      setClientContext({ deviceId: "device-test-reset" });
      __resetForTests();
      const ctx = getClientContext();
      assert.strictEqual(ctx.deviceId, undefined, "13: __resetForTests cleared deviceId");
      assert.strictEqual(ctx.surface, "kiosk", "13: __resetForTests reset default surface");
    }

    // -- 14. Defensive logging: when adapter throws, the marker line MUST
    //        NOT include the raw error object. We intercept console.error
    //        to inspect what was actually written. --
    {
      const captured: string[][] = [];
      const origConsoleError = console.error;
      console.error = ((...args: unknown[]) => {
        captured.push(args.map((a) => String(a)));
      }) as typeof console.error;
      try {
        const throwing: ClientAdapter = {
          captureException() {
            throw new Error("adapter says password=hunter2 and secret=abc123");
          },
          captureMessage() {
            throw new Error("adapter says token=xyz789");
          },
        };
        __resetForTests();
        __configureForTests({ adapter: throwing });
        captureClientException(new Error("trigger-1"));
        captureClientMessage("trigger-2");
        __resetForTests();
        __configureForTests({ adapter });

        // None of the captured console.error args should contain the
        // sensitive substrings carried in the throwing adapter's message.
        const flat = captured.map((a) => a.join(" ")).join(" || ");
        assert.ok(
          !flat.includes("hunter2"),
          "14: safe-marker log must NOT include adapter error message contents (hunter2)",
        );
        assert.ok(
          !flat.includes("xyz789"),
          "14: safe-marker log must NOT include adapter error message contents (xyz789)",
        );
        assert.ok(
          flat.includes("kind=Error"),
          "14: safe-marker log must include the error's name as 'kind=' for ops",
        );
      } finally {
        console.error = origConsoleError;
      }
    }

    console.log("OK: 15 client wrapper tests passed (incl. object error/rejection leak guards)");
  } finally {
    __resetForTests();
    __resetInstallSentinelForTests();
  }
}

main();
