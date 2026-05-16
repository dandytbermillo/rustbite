// Provider-neutral observability wrapper. Caller-facing API:
//
//   captureException(error, context?)
//   captureMessage(message, context?)
//   flushAll(timeoutMs)
//
// Plus internal test-only helpers (`__configureForTests`, `__resetForTests`)
// for swapping the backend and simulating kill-switch / shutdown states.
//
// Pipeline (every capture call):
//   1. Merge caller `CaptureContextInput` with current ALS context.
//   2. Normalize required fields (default `surface` to `"api"`).
//   3. Allow-list emitted context fields.
//   4. Scrub the context via redaction.scrub.
//   5. For exceptions: extract Error.name / message / stack and recurse
//      Error.cause, scrubbing each string and the cause sub-event.
//   6. Build `SanitizedExceptionEvent` / `SanitizedMessageEvent`.
//   7. Call `adapter.captureException(event)` / `adapter.captureMessage(event)`.
//
// The adapter API type accepts only sanitized events — there is no path
// from caller through the wrapper that lets a raw `Error` or raw user
// message reach the adapter. See `types.ts`.
//
// Defensive behaviors:
//   - Re-entrancy guard: nested capture calls inside the wrapper body are
//     dropped to `console.error` instead of re-entering the pipeline.
//   - Circuit breaker: after N consecutive adapter failures the wrapper
//     stops invoking the adapter until `flush` succeeds or
//     `__resetForTests` runs.
//   - Kill switch (`OBSERVABILITY_ENABLED=false`): wrapper accepts no new
//     events and the adapter is not invoked. Local `console.error` fallback
//     still emits so the deployment platform's stdout collection works.
//   - Shutdown (`markShuttingDown()`): after the signal hook runs, the
//     wrapper stops enqueuing to the adapter but still emits local
//     `console.error` for last-resort diagnostics.

import { getRequestContext } from "./context";
import { describeDroppedField, isSensitiveKey, scrub } from "./redaction";
import { createStubAdapter } from "./adapters/stub";
import {
  VALID_SURFACES,
  type Adapter,
  type CaptureContext,
  type CaptureContextInput,
  type SanitizedExceptionEvent,
  type SanitizedMessageEvent,
  type Surface,
} from "./types";

// Capture the raw console.error reference at module load. The wrapper's
// last-resort fallback uses THIS reference, not the global `console.error`,
// so user code that has rebound `console.error` (e.g., for tests) cannot
// silently steal the fallback path.
const RAW_CONSOLE_ERROR: (...args: unknown[]) => void = console.error.bind(
  console,
);

const CONTEXT_ALLOW_LIST: ReadonlyArray<keyof CaptureContext> = [
  "surface",
  "outletId",
  "deviceId",
  "adminUserId",
  "requestId",
  "clientRequestId",
  "jobId",
  "jobName",
  "startedAt",
];

const CIRCUIT_BREAKER_THRESHOLD = 10;

// Module-level mutable state. Each piece is exposed for inspection or
// mutation only through the internal test hooks below.
const moduleState = {
  adapter: createStubAdapter() as Adapter,
  killSwitch: readKillSwitchFromEnv(),
  isShuttingDown: false,
  consecutiveAdapterFailures: 0,
  reentrant: false,
};

function readKillSwitchFromEnv(): boolean {
  // `OBSERVABILITY_ENABLED=false` flips the kill switch ON (disables capture).
  // Default: capture is enabled.
  const raw = process.env.OBSERVABILITY_ENABLED;
  if (raw === undefined) return false;
  return raw.toLowerCase() === "false" || raw === "0";
}

// --- Pipeline helpers -----------------------------------------------------

// Per-field safe-shape patterns. Anchored, bounded, no nested quantifiers
// (ReDoS-safe). A value that matches its field's safe shape is operational
// metadata and proceeds to the value-pattern scanner unless its shape is
// structurally rigid (see SCAN_EXEMPT_SHAPES below).
const ID_SHAPE = /^[A-Za-z0-9_\-:.@/]{1,128}$/;
const ISO_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const JOB_NAME_SHAPE = /^[A-Za-z0-9_\-:. /]{1,64}$/;

// Shapes that are structurally rigid enough to skip the value-pattern
// scanner without risk: every char position is constrained, and no PII
// pattern (email, phone, IP, card, token) can fit through. The scanner
// would otherwise produce false positives on, e.g., UUIDs whose 12-hex
// tail can be all digits and trip the phone heuristic.
const UUID_SHAPE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function isScanExemptShape(value: string): boolean {
  // ISO timestamp shape is exempted by field name in `buildContext`. UUIDs
  // can appear in any ID-shaped field (requestId, jobId, etc.) and are
  // exempted by VALUE shape here.
  return UUID_SHAPE.test(value);
}

function isSafeContextShape(
  field: Exclude<keyof CaptureContext, "surface">,
  value: string,
): boolean {
  switch (field) {
    case "startedAt":
      return ISO_SHAPE.test(value);
    case "jobName":
      return JOB_NAME_SHAPE.test(value);
    case "outletId":
    case "deviceId":
    case "adminUserId":
    case "requestId":
    case "clientRequestId":
    case "jobId":
      return ID_SHAPE.test(value);
    default:
      return false;
  }
}

function buildContext(input: CaptureContextInput | undefined): CaptureContext {
  const fromAls = getRequestContext();
  const merged: Record<string, unknown> = {
    ...(fromAls ?? {}),
    ...(input ?? {}),
  };
  // Normalize: ensure `surface` is present and a valid value.
  if (typeof merged.surface !== "string") {
    merged.surface = "api";
  }

  // Validate surface against the known set. Arbitrary strings (from buggy
  // callers or injection attempts) fall back to "api" to keep metric label
  // cardinality bounded.
  const surface: Surface =
    typeof merged.surface === "string" &&
    VALID_SURFACES.has(merged.surface as Surface)
      ? (merged.surface as Surface)
      : "api";

  // Per-field defense in depth:
  //
  //   1. Allow-list filter (loop over CONTEXT_ALLOW_LIST). Keys not in the
  //      list never reach the adapter.
  //
  //   2. Key-level deny-list (`isSensitiveKey`). If an operator allow-lists
  //      a sensitive key by mistake, the value is dropped here.
  //
  //   3. Per-field SHAPE gate. The value MUST match its documented shape
  //      (UUID, opaque ID charset, templated job name, ISO timestamp). A
  //      value that fails the shape is dropped entirely — it isn't
  //      operational metadata and we should not log anomalous content.
  //
  //   4. Per-field VALUE SCAN. The plan's `Safety Rules` require scanning
  //      string values for PII patterns "even when they appear under benign
  //      keys" — the shape gate is necessary but NOT sufficient. A value
  //      like `requestId: "alice@example.com"` matches the ID charset
  //      (because `@` and `.` are valid ID chars) but is still PII and must
  //      be REDACTED. Same for compact card numbers (`4111111111111111`)
  //      and 10-digit phone numbers (`5551234567`) hiding in opaque-ID
  //      fields.
  //
  //   5. The ONE exception is `startedAt`: ISO_SHAPE constrains the value
  //      to digits at fixed positions with literal separators (`-`, `T`,
  //      `:`, `.`, `Z`, `+`/`-`). No PII can hide there, so we skip the
  //      value scan to avoid the YYYY-MM-DD false positive. This exemption
  //      is justified by the structural rigidity of the regex, not by
  //      hand-waving.
  //
  //   6. Final cap: every emitted value is truncated to 128 chars to bound
  //      metric-label cardinality and log line length.
  const out: CaptureContext = { surface };
  for (const key of CONTEXT_ALLOW_LIST) {
    if (key === "surface") continue;
    const raw = merged[key];
    if (typeof raw !== "string") continue;
    if (isSensitiveKey(key)) continue;
    // Shape gate. Failure → drop the field outright (anomalous content).
    if (!isSafeContextShape(key, raw)) continue;
    let value: string;
    if (key === "startedAt" || isScanExemptShape(raw)) {
      // Structurally-rigid shapes (ISO timestamp at this field, UUIDs at
      // any ID-shaped field) skip the value scan to avoid false positives
      // (year-month-day digit run, UUID's 12-digit tail). The shape regex
      // itself proves no PII pattern can fit through.
      value = raw;
    } else {
      // Every other field: scan even though the field shape passed.
      // Catches compact emails, phones, cards, IPs, and tokens hiding in
      // ID-shaped slots (per the production plan's "scan even under benign
      // keys" rule).
      value = scrubStringField(raw);
    }
    if (value.length > 128) value = `${value.slice(0, 128)}…`;
    (out as Record<string, string>)[key] = value;
  }
  return out;
}

function buildExceptionEvent(
  error: unknown,
  context: CaptureContext,
): SanitizedExceptionEvent {
  return buildExceptionEventFrom(error, context, new WeakSet<object>());
}

function buildExceptionEventFrom(
  error: unknown,
  context: CaptureContext,
  seen: WeakSet<object>,
): SanitizedExceptionEvent {
  // Normalize non-Error throws into an Error-shaped payload so the adapter
  // always sees the same structure. For object throws we MUST scrub the
  // object first (key-aware deny-list) before serializing — JSON-stringifying
  // an object like `{ password: "hunter2" }` would lose the key context and
  // value-pattern scanning would not catch the secret.
  if (!(error instanceof Error)) {
    let message: string;
    if (typeof error === "string") {
      message = scrubStringField(error);
    } else if (error !== null && typeof error === "object") {
      // Key-aware scrub first, then serialize the scrubbed result.
      const scrubbedObj = scrub(error);
      message = safeJsonStringify(scrubbedObj);
    } else {
      // null, undefined, number, bigint, boolean, symbol, function
      message = scrubStringField(String(error));
    }
    return {
      name: "NonError",
      message,
      stack: null,
      context,
      asOf: new Date().toISOString(),
    };
  }

  if (seen.has(error)) {
    return {
      name: "Error",
      message: "[Circular]",
      stack: null,
      context,
      asOf: new Date().toISOString(),
    };
  }
  seen.add(error);

  const event: SanitizedExceptionEvent = {
    name: scrubStringField(error.name) || "Error",
    message: scrubStringField(error.message) || "",
    stack: error.stack ? scrubStringField(error.stack) : null,
    context,
    asOf: new Date().toISOString(),
  };

  const cause = (error as { cause?: unknown }).cause;
  if (cause !== undefined) {
    event.cause = buildExceptionEventFrom(cause, context, seen);
  }
  return event;
}

function buildMessageEvent(
  message: string,
  context: CaptureContext,
): SanitizedMessageEvent {
  return {
    message: scrubStringField(message),
    context,
    asOf: new Date().toISOString(),
  };
}

function scrubStringField(value: string): string {
  // `scrub` only does value-pattern scanning on strings; pass-through is safe.
  const out = scrub(value);
  return typeof out === "string" ? out : String(out);
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

// --- Gate predicate -------------------------------------------------------

function shouldDropCapture(): "kill-switch" | "shutdown" | "circuit" | null {
  if (moduleState.killSwitch) return "kill-switch";
  if (moduleState.isShuttingDown) return "shutdown";
  if (moduleState.consecutiveAdapterFailures >= CIRCUIT_BREAKER_THRESHOLD)
    return "circuit";
  return null;
}

// --- Public API -----------------------------------------------------------

export function captureException(
  error: unknown,
  context?: CaptureContextInput,
): void {
  if (moduleState.reentrant) {
    // Re-entrant call — fall back to raw console.error to break the cycle.
    try {
      RAW_CONSOLE_ERROR(
        describeDroppedField("captureException", "re-entrant"),
      );
    } catch {
      // Last-resort: do nothing.
    }
    return;
  }

  const dropReason = shouldDropCapture();
  if (dropReason) {
    try {
      // Log only the reason and a SAFE class-name marker. Never log the
      // raw error.message or String(error) — those bypass redaction and
      // local stdout collection would capture sensitive content.
      const safeMarker = error instanceof Error ? error.name : "non-error";
      RAW_CONSOLE_ERROR(
        `[observability] drop captureException reason=${dropReason} kind=${safeMarker}`,
      );
    } catch {
      // ignore
    }
    return;
  }

  moduleState.reentrant = true;
  try {
    const ctx = buildContext(context);
    const event = buildExceptionEvent(error, ctx);
    moduleState.adapter.captureException(event);
    moduleState.consecutiveAdapterFailures = 0;
  } catch (adapterErr) {
    moduleState.consecutiveAdapterFailures += 1;
    try {
      // Adapter's own throw — log the reason only. Even adapter exceptions
      // can carry user payload via .cause, so don't pass adapterErr.message.
      const safeMarker =
        adapterErr instanceof Error ? adapterErr.name : "non-error";
      RAW_CONSOLE_ERROR(
        `[observability] adapter.captureException threw kind=${safeMarker}`,
      );
    } catch {
      // ignore
    }
  } finally {
    moduleState.reentrant = false;
  }
}

export function captureMessage(
  message: string,
  context?: CaptureContextInput,
): void {
  if (moduleState.reentrant) {
    try {
      RAW_CONSOLE_ERROR(
        describeDroppedField("captureMessage", "re-entrant"),
      );
    } catch {
      // ignore
    }
    return;
  }

  const dropReason = shouldDropCapture();
  if (dropReason) {
    try {
      // Log only the reason. The message body may contain PII or secrets;
      // do not pass it to console here.
      RAW_CONSOLE_ERROR(
        `[observability] drop captureMessage reason=${dropReason}`,
      );
    } catch {
      // ignore
    }
    return;
  }

  moduleState.reentrant = true;
  try {
    const ctx = buildContext(context);
    const event = buildMessageEvent(message, ctx);
    moduleState.adapter.captureMessage(event);
    moduleState.consecutiveAdapterFailures = 0;
  } catch (adapterErr) {
    moduleState.consecutiveAdapterFailures += 1;
    try {
      const safeMarker =
        adapterErr instanceof Error ? adapterErr.name : "non-error";
      RAW_CONSOLE_ERROR(
        `[observability] adapter.captureMessage threw kind=${safeMarker}`,
      );
    } catch {
      // ignore
    }
  } finally {
    moduleState.reentrant = false;
  }
}

export async function flushAll(timeoutMs: number): Promise<void> {
  try {
    await Promise.race([
      moduleState.adapter.flush(timeoutMs),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  } catch (err) {
    // Adapter flush threw. Surface via local fallback but do NOT propagate —
    // the SIGTERM hook depends on this never blocking process exit. Log
    // only the kind, not err.message (may carry sensitive .cause data).
    try {
      const safeMarker = err instanceof Error ? err.name : "non-error";
      RAW_CONSOLE_ERROR(
        `[observability] flushAll: adapter.flush threw kind=${safeMarker}`,
      );
    } catch {
      // ignore
    }
  }
}

/**
 * Mark the wrapper as shutting down. After this returns, `captureException`
 * and `captureMessage` short-circuit to the local fallback and never invoke
 * the adapter. Called by the SIGTERM/SIGINT hook in `src/instrumentation.ts`.
 */
export function markShuttingDown(): void {
  moduleState.isShuttingDown = true;
}

// --- Test-only state controls --------------------------------------------
//
// Both `__configureForTests` and `__resetForTests` are HARD NO-OPS when
// `NODE_ENV === "production"`. Even if application code accidentally imports
// them, they cannot mutate runtime state in a production build. The leading
// `__` is the call-site convention; the env check is the runtime contract.
//
// We re-read `process.env.NODE_ENV` on every call (not at module load) so
// the gate respects late changes — useful in tests, harmless in prod.

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * INTERNAL — used only by `scripts/test-observability-*.ts`. Swaps the
 * backend adapter and/or simulates kill-switch / shutdown states.
 *
 * In production (`NODE_ENV === "production"`) this function is a no-op: it
 * does NOT swap the adapter, does NOT flip kill-switch state, does NOT
 * mutate any module state. Use the real `OBSERVABILITY_ENABLED` env var to
 * disable capture in production.
 */
export function __configureForTests(options: {
  adapter?: Adapter;
  killSwitch?: boolean;
  isShuttingDown?: boolean;
  consecutiveAdapterFailures?: number;
}): void {
  if (isProductionRuntime()) return; // hard no-op in production builds
  if (options.adapter !== undefined) moduleState.adapter = options.adapter;
  if (options.killSwitch !== undefined)
    moduleState.killSwitch = options.killSwitch;
  if (options.isShuttingDown !== undefined)
    moduleState.isShuttingDown = options.isShuttingDown;
  if (options.consecutiveAdapterFailures !== undefined)
    moduleState.consecutiveAdapterFailures = options.consecutiveAdapterFailures;
}

/**
 * INTERNAL — restore module state to defaults between tests.
 * Hard no-op in production. See `__configureForTests` for the contract.
 */
export function __resetForTests(): void {
  if (isProductionRuntime()) return; // hard no-op in production builds
  moduleState.adapter = createStubAdapter();
  moduleState.killSwitch = readKillSwitchFromEnv();
  moduleState.isShuttingDown = false;
  moduleState.consecutiveAdapterFailures = 0;
  moduleState.reentrant = false;
}
