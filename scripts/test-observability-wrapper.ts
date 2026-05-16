// Tests for src/lib/observability/server.ts.
//
// Each test uses a "recording adapter" that captures every event so we can
// assert the wrapper's pipeline behavior precisely. Between tests we call
// `__resetForTests()` to restore defaults.

import assert from "node:assert/strict";
import {
  __configureForTests,
  __resetForTests,
  captureException,
  captureMessage,
  flushAll,
  markShuttingDown,
} from "../src/lib/observability/server";
import { runWithRequestContext } from "../src/lib/observability/context";
import type {
  Adapter,
  CaptureContext,
  SanitizedExceptionEvent,
  SanitizedMessageEvent,
} from "../src/lib/observability/types";

type Recorded = {
  exceptions: SanitizedExceptionEvent[];
  messages: SanitizedMessageEvent[];
  flushes: number;
};

function createRecordingAdapter(opts: {
  failOnCapture?: boolean;
  failOnFlush?: boolean;
} = {}): { adapter: Adapter; rec: Recorded } {
  const rec: Recorded = { exceptions: [], messages: [], flushes: 0 };
  const adapter: Adapter = {
    captureException(event) {
      if (opts.failOnCapture) throw new Error("recording adapter: forced fail");
      rec.exceptions.push(event);
    },
    captureMessage(event) {
      if (opts.failOnCapture) throw new Error("recording adapter: forced fail");
      rec.messages.push(event);
    },
    async flush(_t) {
      rec.flushes += 1;
      if (opts.failOnFlush) throw new Error("recording adapter: forced flush fail");
    },
  };
  return { adapter, rec };
}

async function main() {

// --- 1. Happy path: scrubs context + Error fields before reaching adapter ---
{
  __resetForTests();
  const { adapter, rec } = createRecordingAdapter();
  __configureForTests({ adapter });

  const err = new Error("login failed for alice@example.com from 198.51.100.42");
  (err as Error & { cause?: unknown }).cause = new Error(
    "Bearer eyJhbGciOiJIUzI1NiJ9.malicious_token_with_lots_of_chars_here",
  );

  captureException(err, {
    surface: "api",
    outletId: "outlet_1",
    deviceId: "dev_1",
    // These are sensitive *fields* by name — must be dropped.
    password: "hunter2",
    sessionCookie: "sess_abc",
  } as unknown as Parameters<typeof captureException>[1]);

  assert.equal(rec.exceptions.length, 1);
  const ev = rec.exceptions[0];
  // Top-level Error.message: contains email → REDACTED.
  assert.equal(ev.message, "[REDACTED]");
  // Error.cause: contains bearer-token-shape → REDACTED.
  assert.ok(ev.cause, "cause should be present");
  assert.equal(ev.cause?.message, "[REDACTED]");
  // Context: allow-listed fields kept; sensitive fields dropped entirely.
  assert.equal(ev.context.surface, "api");
  assert.equal(ev.context.outletId, "outlet_1");
  assert.equal(ev.context.deviceId, "dev_1");
  assert.equal(
    (ev.context as Record<string, unknown>).password,
    undefined,
    "password must not appear in context",
  );
  assert.equal(
    (ev.context as Record<string, unknown>).sessionCookie,
    undefined,
    "sessionCookie must not appear in context",
  );
}

// --- 2. captureMessage: scrubs message body too -------------------------------
{
  __resetForTests();
  const { adapter, rec } = createRecordingAdapter();
  __configureForTests({ adapter });

  captureMessage("user email=foo@bar.com placed order", { surface: "api" });
  assert.equal(rec.messages.length, 1);
  assert.equal(rec.messages[0].message, "[REDACTED]");
}

// --- 3. Surface normalization defaults to "api" --------------------------------
{
  __resetForTests();
  const { adapter, rec } = createRecordingAdapter();
  __configureForTests({ adapter });

  captureException(new Error("no context provided"));
  assert.equal(rec.exceptions[0].context.surface, "api");

  rec.exceptions.length = 0;
  captureException(new Error("kiosk surface"), { surface: "kiosk" });
  assert.equal(rec.exceptions[0].context.surface, "kiosk");
}

// --- 4. ALS context flows into captures ---------------------------------------
{
  __resetForTests();
  const { adapter, rec } = createRecordingAdapter();
  __configureForTests({ adapter });

  const ctx: CaptureContext = {
    surface: "kiosk",
    requestId: "req-als-1",
    outletId: "outlet_als",
  };
  await runWithRequestContext(ctx, async () => {
    captureException(new Error("boom"));
  });

  assert.equal(rec.exceptions[0].context.requestId, "req-als-1");
  assert.equal(rec.exceptions[0].context.outletId, "outlet_als");
  assert.equal(rec.exceptions[0].context.surface, "kiosk");
}

// --- 5. Circular Error handled without throwing -------------------------------
{
  __resetForTests();
  const { adapter, rec } = createRecordingAdapter();
  __configureForTests({ adapter });

  const err = new Error("outer");
  (err as Error & { cause?: unknown }).cause = err; // self-cause
  captureException(err);
  assert.equal(rec.exceptions.length, 1);
  // The wrapper's exception-walker uses a WeakSet seen guard, so the
  // circular cause resolves to a "Circular" placeholder, not an infinite loop.
  assert.ok(rec.exceptions[0].cause);
  assert.equal(rec.exceptions[0].cause?.message, "[Circular]");
}

// --- 6. Adapter failure caught + console.error fallback + circuit breaker -----
{
  __resetForTests();
  const { adapter } = createRecordingAdapter({ failOnCapture: true });
  __configureForTests({ adapter });

  // Drive the adapter past the circuit-breaker threshold (10) and one more.
  for (let i = 0; i < 11; i++) {
    captureException(new Error(`attempt-${i}`));
  }

  // Now flip the adapter to non-failing; the breaker should still be open.
  const { adapter: goodAdapter, rec: goodRec } = createRecordingAdapter();
  __configureForTests({ adapter: goodAdapter });
  // Note: __configureForTests does NOT reset the consecutiveAdapterFailures
  // counter unless `consecutiveAdapterFailures: 0` is passed, so the breaker
  // stays open and the next capture is dropped.
  captureException(new Error("should be dropped by breaker"));
  assert.equal(
    goodRec.exceptions.length,
    0,
    "circuit breaker should drop captures past threshold",
  );

  // Reset the counter and verify captures flow again.
  __configureForTests({ consecutiveAdapterFailures: 0 });
  captureException(new Error("flows after reset"));
  assert.equal(goodRec.exceptions.length, 1);
}

// --- 7. Kill switch drops captures, doesn't invoke adapter --------------------
{
  __resetForTests();
  const { adapter, rec } = createRecordingAdapter();
  __configureForTests({ adapter, killSwitch: true });

  captureException(new Error("kill switch on"));
  captureMessage("kill switch on", { surface: "api" });
  assert.equal(rec.exceptions.length, 0);
  assert.equal(rec.messages.length, 0);

  // Flipping off restores capture.
  __configureForTests({ killSwitch: false });
  captureException(new Error("kill switch off"));
  assert.equal(rec.exceptions.length, 1);
}

// --- 8. isShuttingDown drops captures without invoking the adapter ------------
{
  __resetForTests();
  const { adapter, rec } = createRecordingAdapter();
  __configureForTests({ adapter });

  // Verify normal capture works first.
  captureException(new Error("pre-shutdown"));
  assert.equal(rec.exceptions.length, 1);

  markShuttingDown();
  captureException(new Error("post-shutdown"));
  assert.equal(
    rec.exceptions.length,
    1,
    "post-shutdown capture must not reach adapter",
  );
}

// --- 9. flushAll: adapter throw during flush does not propagate ---------------
{
  __resetForTests();
  const { adapter, rec } = createRecordingAdapter({ failOnFlush: true });
  __configureForTests({ adapter });

  // Must resolve without throwing.
  await flushAll(50);
  // Adapter's flush WAS invoked.
  assert.equal(rec.flushes, 1);
}

// --- 10. Non-Error throws are coerced into NonError events --------------------
{
  __resetForTests();
  const { adapter, rec } = createRecordingAdapter();
  __configureForTests({ adapter });

  captureException("plain string with secret=abc123def456ghi789jkl012mno345pqr678");
  captureException({ kind: "obj", reason: "weird" });

  assert.equal(rec.exceptions.length, 2);
  assert.equal(rec.exceptions[0].name, "NonError");
  // Token-shape pattern in the string → redacted.
  assert.equal(rec.exceptions[0].message, "[REDACTED]");
  assert.equal(rec.exceptions[1].name, "NonError");
  // JSON-stringified object survives scrub (no sensitive markers).
  assert.ok(rec.exceptions[1].message.includes("weird"));
}

// --- 10b. Non-Error OBJECT throws are scrubbed key-aware before serialize ---
{
  __resetForTests();
  const { adapter, rec } = createRecordingAdapter();
  __configureForTests({ adapter });

  // The classic case: object with a sensitive KEY whose VALUE doesn't match
  // any value-pattern. Naive `scrub(JSON.stringify(...))` would miss this.
  captureException({ password: "hunter2", outletId: "outlet_1" });

  assert.equal(rec.exceptions.length, 1);
  // The serialized message must NOT contain "hunter2" anywhere — the key
  // was deny-listed and its value redacted before serialization.
  assert.ok(
    !rec.exceptions[0].message.includes("hunter2"),
    "non-Error object throw must not leak password value through JSON",
  );
  // The non-sensitive key flows through.
  assert.ok(
    rec.exceptions[0].message.includes("outlet_1"),
    "non-sensitive object fields should still appear",
  );
}

// --- 10c. Surface validation: arbitrary strings fall back to "api" --------
{
  __resetForTests();
  const { adapter, rec } = createRecordingAdapter();
  __configureForTests({ adapter });

  // Cast to bypass TS — simulating a buggy/malicious caller that passes
  // an unknown surface string at runtime.
  captureException(new Error("bad surface"), {
    surface: "<injection>" as unknown as "api",
  });

  assert.equal(
    rec.exceptions[0].context.surface,
    "api",
    "invalid surface must default to 'api'",
  );

  // Valid surfaces flow through unchanged.
  rec.exceptions.length = 0;
  captureException(new Error("ok"), { surface: "kiosk" });
  assert.equal(rec.exceptions[0].context.surface, "kiosk");
}

// --- 10d. Drop paths log only reason + safe marker, never error.message ----
{
  __resetForTests();
  // Capture stdout/stderr writes from the wrapper's RAW_CONSOLE_ERROR path.
  // We replace globalThis.console.error with a recorder. Note: the wrapper
  // captured `console.error` at module load via `console.error.bind(console)`,
  // so this monkey-patch wouldn't catch the bound reference; instead we hook
  // process.stderr.write which `console.error` ultimately calls.
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  const captured: string[] = [];
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    captured.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stderr.write;

  try {
    const { adapter } = createRecordingAdapter();
    __configureForTests({ adapter, killSwitch: true });

    const sneaky = new Error("password=hunter2 leaked into message");
    captureException(sneaky);
    captureMessage("user email=alice@example.com placed order");

    const text = captured.join("");
    assert.ok(
      !text.includes("hunter2"),
      "drop-path log must not include error.message contents",
    );
    assert.ok(
      !text.includes("alice@example.com"),
      "drop-path log must not include captureMessage body",
    );
    assert.ok(
      text.includes("reason=kill-switch"),
      "drop-path log should still report the drop reason",
    );
  } finally {
    process.stderr.write = origStderrWrite;
  }
}

// --- 10e. Test hooks are hard no-ops in production --------------------------
{
  __resetForTests();
  const { adapter, rec } = createRecordingAdapter();
  __configureForTests({ adapter });

  // Confirm the test recording adapter is wired now.
  captureException(new Error("baseline"));
  assert.equal(rec.exceptions.length, 1);

  // Flip NODE_ENV to production. The hook MUST refuse to swap state.
  // Cast: NODE_ENV is declared readonly in @types/node augmented by Next,
  // but the runtime env is mutable. Cast through Record to write.
  const env = process.env as Record<string, string | undefined>;
  const originalNodeEnv = env.NODE_ENV;
  env.NODE_ENV = "production";
  try {
    const replacement = createRecordingAdapter();
    __configureForTests({ adapter: replacement.adapter, killSwitch: true });
    // Both options must have been ignored. Capture should still go to the
    // pre-production-flag adapter, and kill switch should still be off.
    captureException(new Error("after-prod-noop"));
    assert.equal(
      rec.exceptions.length,
      2,
      "production __configureForTests must NOT swap the adapter",
    );
    assert.equal(
      replacement.rec.exceptions.length,
      0,
      "replacement adapter must NOT have been wired in production mode",
    );

    // __resetForTests is also a no-op in production.
    __resetForTests();
    captureException(new Error("after-prod-reset-noop"));
    assert.equal(
      rec.exceptions.length,
      3,
      "production __resetForTests must NOT replace the adapter",
    );
  } finally {
    env.NODE_ENV = originalNodeEnv;
  }
}

// --- 10f. Shape-failing context values must NOT reach adapter unchanged -----
//
// Regression guard for the original "context bypass" finding. Values that
// fail the per-field shape are dropped entirely (even safer than REDACTING).
// Either outcome is acceptable: the assertion is "did not leak the raw value."
{
  __resetForTests();
  const { adapter, rec } = createRecordingAdapter();
  __configureForTests({ adapter });

  captureException(new Error("ctx bypass test"), {
    surface: "api",
    jobName: "email alice@example.com" as string, // @ not in JOB_NAME_SHAPE
    requestId: "4111 1111 1111 1111",              // spaces not in ID_SHAPE
    outletId: "outlet 198.51.100.42",              // spaces not in ID_SHAPE
  });

  assert.equal(rec.exceptions.length, 1);
  const ctx = rec.exceptions[0].context;
  for (const [field, raw] of [
    ["jobName", "email alice@example.com"],
    ["requestId", "4111 1111 1111 1111"],
    ["outletId", "outlet 198.51.100.42"],
  ] as const) {
    const v = (ctx as Record<string, string | undefined>)[field];
    // Acceptable outcomes: dropped (undefined) or REDACTED. Forbidden: raw.
    assert.notEqual(
      v,
      raw,
      `${field}: raw value with leak vector must not reach adapter`,
    );
    assert.ok(
      v === undefined || v === "[REDACTED]",
      `${field}: must be dropped or REDACTED; got ${JSON.stringify(v)}`,
    );
  }
}

// --- 10f-bis. Compact PII inside ID-shape fields must still be REDACTED -----
//
// Critical regression guard: the previous fix was incomplete. The opaque-ID
// shape (`[A-Za-z0-9_\-:.@/]{1,128}`) accepts compact emails, pure-digit
// phones, and pure-digit card numbers because `@`, `.`, and digits are all
// valid ID characters. Shape match alone is NOT sufficient — the value
// scanner MUST also run on every context field (per the production plan's
// "scan even under benign keys" rule). The ONLY exemption is `startedAt`,
// whose ISO shape is structurally rigid.
{
  __resetForTests();
  const { adapter, rec } = createRecordingAdapter();
  __configureForTests({ adapter });

  // Compact PII in ID-shaped slots — all match ID_SHAPE.
  captureException(new Error("compact PII bypass"), {
    surface: "api",
    requestId: "alice@example.com",      // email-shape inside ID slot
    deviceId: "5551234567",              // phone-shape inside ID slot (10 digits)
    jobId: "4111111111111111",           // card-shape inside ID slot (16 digits)
    adminUserId: "127.0.0.1",            // IPv4 inside ID slot
  });

  assert.equal(rec.exceptions.length, 1);
  const ctx = rec.exceptions[0].context;
  assert.equal(
    ctx.requestId,
    "[REDACTED]",
    "compact email in requestId must be REDACTED",
  );
  assert.equal(
    ctx.deviceId,
    "[REDACTED]",
    "compact phone in deviceId must be REDACTED",
  );
  assert.equal(
    ctx.jobId,
    "[REDACTED]",
    "compact card number in jobId must be REDACTED",
  );
  assert.equal(
    ctx.adminUserId,
    "[REDACTED]",
    "IPv4 in adminUserId must be REDACTED",
  );
}

// --- 10f-ter. URL-shaped values must be REDACTED in all surfaces ------------
//
// URLs can carry tokens / session ids in query strings. The scrubber must
// REDACT URL-shaped strings whether they appear in:
//   - Error.message
//   - Error.stack (covered indirectly via the message scrub of stack)
//   - captureMessage body
//   - any context field that passes shape (here: requestId)
{
  __resetForTests();
  const { adapter, rec } = createRecordingAdapter();
  __configureForTests({ adapter });

  // Error.message containing a URL with a token in the query string.
  captureException(
    new Error("upstream POST https://api.example.com/v1/widgets?token=secret123 failed"),
  );
  assert.equal(rec.exceptions.length, 1);
  assert.equal(
    rec.exceptions[0].message,
    "[REDACTED]",
    "URL in Error.message must be REDACTED (carries query-string secrets)",
  );

  // captureMessage body containing a URL.
  captureMessage("webhook arrived from https://api.stripe.com/v1/events/evt_abc?sig=xyz");
  assert.equal(rec.messages.length, 1);
  assert.equal(
    rec.messages[0].message,
    "[REDACTED]",
    "URL in captureMessage body must be REDACTED",
  );

  // Context field containing a URL (passes ID_SHAPE because chars are fine).
  rec.exceptions.length = 0;
  captureException(new Error("ctx-url"), {
    surface: "api",
    requestId: "https://example.com/path",
  });
  assert.equal(
    rec.exceptions[0].context.requestId,
    "[REDACTED]",
    "URL in requestId context field must be REDACTED",
  );
}

// --- 10g. Safe-shape context values pass through unchanged ------------------
//
// Counter-test for #10f: the legitimate ISO timestamp / opaque-ID / numeric-ID
// shapes that previously triggered the false-positive must NOT be redacted.
{
  __resetForTests();
  const { adapter, rec } = createRecordingAdapter();
  __configureForTests({ adapter });

  captureException(new Error("safe context"), {
    surface: "api",
    outletId: "outlet_abc123",          // typical opaque ID
    deviceId: "12345",                   // numeric ID — phone heuristic would false-positive
    requestId: "550e8400-e29b-41d4-a716-446655440000", // UUID
    jobName: "email-outbox-send",        // templated name
    startedAt: "2026-05-14T10:00:00.000Z", // ISO timestamp — would false-positive on YYYY-MM-DD
  });

  assert.equal(rec.exceptions.length, 1);
  const ctx = rec.exceptions[0].context;
  assert.equal(ctx.outletId, "outlet_abc123");
  assert.equal(ctx.deviceId, "12345");
  assert.equal(ctx.requestId, "550e8400-e29b-41d4-a716-446655440000");
  assert.equal(ctx.jobName, "email-outbox-send");
  assert.equal(ctx.startedAt, "2026-05-14T10:00:00.000Z");
}

// --- 10h. Oversized context values either drop or get capped ----------------
{
  __resetForTests();
  const { adapter, rec } = createRecordingAdapter();
  __configureForTests({ adapter });

  // 200-char "jobName" exceeds JOB_NAME_SHAPE (64 chars max). Acceptable
  // outcomes: dropped (current behavior — shape gate rejects) or truncated
  // to ≤128 chars (if the shape regex is ever widened). NEVER raw 200.
  const oversized = "x".repeat(200);
  captureException(new Error("oversized"), {
    surface: "api",
    jobName: oversized,
  });
  assert.equal(rec.exceptions.length, 1);
  const jobName = rec.exceptions[0].context.jobName;
  assert.ok(
    jobName === undefined || jobName.length <= 129,
    `jobName must be dropped or capped to ≤128 chars (+ ellipsis); got ${
      jobName === undefined ? "undefined" : `length=${jobName.length}`
    }`,
  );
  assert.notEqual(jobName, oversized, "raw 200-char jobName must not pass through");
}

// --- 11. Re-entrancy: adapter that calls captureException recursively -----
{
  __resetForTests();
  let depth = 0;
  let recursionDepthSeen = 0;
  const adapter: Adapter = {
    captureException() {
      depth += 1;
      recursionDepthSeen = Math.max(recursionDepthSeen, depth);
      try {
        // Recursive call from inside the adapter — should be dropped by guard.
        captureException(new Error("re-entrant"));
      } finally {
        depth -= 1;
      }
    },
    captureMessage() {},
    async flush() {},
  };
  __configureForTests({ adapter });
  captureException(new Error("outer"));
  // Without the guard this would have stacked to MAX_RECURSION; with it,
  // the inner call short-circuits and depth stays at 1.
  assert.equal(recursionDepthSeen, 1);
}

}

main().then(
  () => console.log("✓ test-observability-wrapper passed"),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
