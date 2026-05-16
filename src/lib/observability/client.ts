// Browser-side observability wrapper. Mirrors `server.ts` in spirit (scrub
// pipeline, fire-and-forget, never-throws, console-stub adapter) but runs
// in the browser bundle — NO Node imports (no `async_hooks`, no `crypto`,
// no `fs`). Universal helpers only: `redaction.ts` is pure and safe to
// import here.
//
// What this module owns:
//
//   - `captureClientException(err, context?)`: scrub + dispatch through the
//     active adapter. Never throws.
//   - `captureClientMessage(message, context?)`: same for messages.
//   - `setClientContext(ctx)`: merge page-level tags (surface, pagePath,
//     deviceId, outletId) into the module-local context so later capture
//     calls don't have to repeat them.
//   - `installClientErrorHandlers()`: idempotent registration of
//     `error` and `unhandledrejection` listeners on `globalThis`.
//     Routes uncaught browser errors into `captureClientException`.
//   - Test seam: `__configureForTests({ adapter, context })` /
//     `__resetForTests()`. Both no-op in production.
//
// What this module deliberately does NOT do (yet):
//
//   - No vendor SDK; stub adapter logs JSON via `console.error` /
//     `console.warn`. The plan keeps this provider-neutral.
//   - No cross-tier request-id propagation. Server-side reqId is on the
//     `x-request-id` response header; clients that need it must read the
//     header from the failing fetch. global-error.tsx does NOT surface
//     the server reqId in this slice (operator choice — see find.md
//     round 7 design decision; can be added later via cookie or meta).
//   - No replay / breadcrumbs / performance — out of scope.

import {
  scrub,
  scrubFields,
  scrubUrl,
} from "./redaction";

// --- Types ----------------------------------------------------------------

/**
 * Subset of fields the client wrapper recognizes for tagging events.
 * Mirrors the allow-list discipline of the server side: only the named
 * fields make it onto the captured event; anything else is dropped.
 */
export type ClientContext = {
  surface?: string;
  pagePath?: string;
  deviceId?: string;
  outletId?: string;
  requestId?: string;
  clientRequestId?: string;
};

export type ClientExceptionEvent = {
  name: string;
  message: string;
  stack: string | null;
  cause?: ClientExceptionEvent;
  context: ClientContext;
  asOf: string;
};

export type ClientMessageEvent = {
  message: string;
  context: ClientContext;
  asOf: string;
};

export interface ClientAdapter {
  captureException(event: ClientExceptionEvent): void;
  captureMessage(event: ClientMessageEvent): void;
}

// --- Module state --------------------------------------------------------

const INSTALL_SENTINEL = Symbol.for(
  "rushbite.observability.clientHandlersInstalled",
);

let currentAdapter: ClientAdapter = createStubAdapter();
let currentContext: ClientContext = { surface: "kiosk" };

function createStubAdapter(): ClientAdapter {
  return {
    captureException(event) {
      safeConsoleLog("error", event);
    },
    captureMessage(event) {
      safeConsoleLog("warn", event);
    },
  };
}

function safeConsoleLog(level: "error" | "warn", payload: unknown): void {
  if (typeof console === "undefined") return;
  const tag = "[client-observability]";
  try {
    const serialized = safeJsonStringify(payload);
    if (level === "error") {
      console.error(tag, serialized);
    } else {
      console.warn(tag, serialized);
    }
  } catch {
    // intentionally swallowed — stub adapter must never throw
  }
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isProductionRuntime(): boolean {
  return typeof process !== "undefined" && process.env.NODE_ENV === "production";
}

// --- Public API ----------------------------------------------------------

/**
 * Merge additional context fields into the module-local context. Called
 * once per page mount (typically from a layout/bootstrap client component)
 * so later captures don't have to repeat surface/pagePath/etc.
 */
export function setClientContext(ctx: ClientContext): void {
  currentContext = { ...currentContext, ...ctx };
}

/** Snapshot the current module-local context (mainly for tests). */
export function getClientContext(): ClientContext {
  return { ...currentContext };
}

/**
 * Scrub + dispatch a thrown error. Fire-and-forget; never throws even if
 * the adapter or scrub pipeline does. The error's `name`, `message`,
 * `stack`, and recursive `cause` chain are all run through the redaction
 * pipeline before reaching the adapter.
 */
export function captureClientException(
  err: unknown,
  context?: ClientContext,
): void {
  try {
    const event = buildClientExceptionEvent(err, context);
    try {
      currentAdapter.captureException(event);
    } catch (adapterErr) {
      // Adapter is documented to never throw, but defend anyway. We log
      // ONLY a safe marker (the error's name) — never the raw adapterErr —
      // because in a future vendor-SDK adapter the error could carry
      // provider keys, tokens, or partially-sanitized payloads, and the
      // browser console is visible to anyone who opens devtools. The
      // server wrapper follows the same rule.
      safeMarkerLog("adapter.captureException threw", adapterErr);
    }
  } catch (scrubErr) {
    // Scrub itself blew up — should be impossible (redaction is pure and
    // tested) but defend anyway. Same safe-marker discipline.
    safeMarkerLog("capture pipeline threw", scrubErr);
  }
}

/**
 * Scrub + dispatch a structured log message. Same defensive guarantees
 * as `captureClientException`.
 */
export function captureClientMessage(
  message: string,
  context?: ClientContext,
): void {
  try {
    const event: ClientMessageEvent = {
      message: scrubString(typeof message === "string" ? message : String(message)),
      context: buildContext(context),
      asOf: new Date().toISOString(),
    };
    try {
      currentAdapter.captureMessage(event);
    } catch (adapterErr) {
      // Safe-marker logging only — see captureClientException for rationale.
      safeMarkerLog("adapter.captureMessage threw", adapterErr);
    }
  } catch (scrubErr) {
    safeMarkerLog("captureMessage pipeline threw", scrubErr);
  }
}

/**
 * Log a single safe marker line — `kind=<error.name>` — to the browser
 * console without exposing the raw error. Used when our own pipeline /
 * adapter throws unexpectedly. Mirrors server.ts's `RAW_CONSOLE_ERROR`
 * convention.
 */
function safeMarkerLog(reason: string, err: unknown): void {
  if (typeof console === "undefined") return;
  const kind = err instanceof Error ? err.name : "non-error";
  try {
    console.error(`[client-observability] ${reason} kind=${kind}`);
  } catch {
    // give up — last resort, nothing to fall back to
  }
}

/**
 * Idempotently register browser-level error handlers. Safe to call
 * multiple times (e.g., from multiple React mounts during HMR / Fast
 * Refresh) — the second call is a no-op.
 *
 * Listeners route ALL uncaught browser errors and unhandled promise
 * rejections into `captureClientException`. The redaction pipeline runs
 * on the resulting event before the stub adapter sees it.
 */
export function installClientErrorHandlers(): void {
  const g = globalThis as unknown as Record<symbol, unknown> & {
    addEventListener?: (
      type: string,
      handler: (event: unknown) => void,
    ) => void;
  };
  if (g[INSTALL_SENTINEL]) return;
  if (typeof g.addEventListener !== "function") return;
  g[INSTALL_SENTINEL] = true;

  g.addEventListener("error", (event: unknown) => {
    const e = event as {
      error?: unknown;
      message?: string;
      filename?: string;
      lineno?: number;
      colno?: number;
    };
    // Pass the RAW thrown value straight to captureClientException — it
    // scrubs non-Error objects key-aware before stringify. Pre-coercing
    // an object `e.error` into `new Error(JSON.stringify(...))` here would
    // defeat that (the value would arrive as an Error string and only
    // value-pattern scanning, not key-aware deny-listing, would run).
    // Only synthesize a message-only Error when there is no thrown value
    // (cross-origin script errors set `error` to null but provide a
    // generic `message`).
    if (e.error !== undefined && e.error !== null) {
      captureClientException(e.error, { pagePath: readCurrentPagePath() });
    } else {
      captureClientException(
        new Error(
          typeof e.message === "string" && e.message.length > 0
            ? e.message
            : "Uncaught error event",
        ),
        { pagePath: readCurrentPagePath() },
      );
    }
  });

  g.addEventListener("unhandledrejection", (event: unknown) => {
    const e = event as { reason?: unknown };
    // Same rule as the "error" handler: forward the raw rejection reason
    // so object reasons (e.g. `Promise.reject({ password: "..." })`) get
    // key-aware scrubbing inside captureClientException. The previous
    // `new Error(safeJsonStringify(reason))` coercion leaked the keys.
    captureClientException(e.reason, { pagePath: readCurrentPagePath() });
  });
}

// --- Internal: event construction ---------------------------------------

function buildClientExceptionEvent(
  err: unknown,
  context: ClientContext | undefined,
): ClientExceptionEvent {
  // Non-Error throws need key-aware scrubbing BEFORE stringify. If we
  // JSON-stringify `{ password: "hunter2" }` first and run value-pattern
  // scanning afterwards, the key context is lost and the secret survives.
  // The server wrapper has the same rule (see `server.ts` for the
  // identical pattern). For Errors, message/stack are scrubbed as strings.
  if (!(err instanceof Error)) {
    let message: string;
    if (typeof err === "string") {
      message = scrubString(err);
    } else if (err !== null && typeof err === "object") {
      // Object throw: scrub the OBJECT first (key-aware deny-list runs),
      // then serialize the scrubbed result.
      const scrubbedObj = scrub(err);
      message = safeJsonStringify(scrubbedObj);
    } else {
      // null, undefined, number, bigint, boolean, symbol, function
      message = scrubString(String(err));
    }
    return {
      name: "NonError",
      message,
      stack: null,
      context: buildContext(context),
      asOf: new Date().toISOString(),
    };
  }

  const cause = (err as Error & { cause?: unknown }).cause;
  return {
    name: scrubString(err.name || "Error"),
    message: scrubString(err.message || ""),
    stack: err.stack ? scrubString(err.stack) : null,
    cause: cause ? buildClientExceptionEvent(cause, context) : undefined,
    context: buildContext(context),
    asOf: new Date().toISOString(),
  };
}

const ALLOWED_CONTEXT_KEYS = [
  "surface",
  "pagePath",
  "deviceId",
  "outletId",
  "requestId",
  "clientRequestId",
] as const;

function buildContext(extra: ClientContext | undefined): ClientContext {
  const merged = { ...currentContext, ...(extra ?? {}) };
  // Allow-list discipline + per-field scrubbing. pagePath may contain a
  // URL with query params, so scrubUrl applies; the IDs are short and we
  // assume they pass through the standard scan (no PII patterns expected).
  const safe: Record<string, string | undefined> = {};
  for (const key of ALLOWED_CONTEXT_KEYS) {
    const value = (merged as Record<string, unknown>)[key];
    if (typeof value !== "string" || value.length === 0) continue;
    if (key === "pagePath") {
      safe[key] = scrubUrl(value);
    } else {
      safe[key] = scrubString(value);
    }
  }
  // Re-narrow via scrubFields to keep one consistent allow-list semantics.
  return scrubFields<keyof ClientContext>(
    safe as Record<string, unknown>,
    ALLOWED_CONTEXT_KEYS as unknown as Array<keyof ClientContext>,
  ) as ClientContext;
}

function scrubString(s: string): string {
  const r = scrub(s);
  return typeof r === "string" ? r : String(r);
}

function readCurrentPagePath(): string | undefined {
  const w = globalThis as unknown as { location?: { pathname?: string } };
  if (w.location && typeof w.location.pathname === "string") {
    return w.location.pathname;
  }
  return undefined;
}

// --- Test seam (no-op in production) -------------------------------------

export function __configureForTests(options: {
  adapter?: ClientAdapter;
  context?: ClientContext;
}): void {
  if (isProductionRuntime()) return;
  if (options.adapter) currentAdapter = options.adapter;
  if (options.context) currentContext = options.context;
}

export function __resetForTests(): void {
  if (isProductionRuntime()) return;
  currentAdapter = createStubAdapter();
  currentContext = { surface: "kiosk" };
}

/**
 * Test-only: clear the install sentinel so a subsequent
 * `installClientErrorHandlers()` call re-registers. Production callers
 * should never need this — the production sentinel is meant to survive.
 */
export function __resetInstallSentinelForTests(): void {
  if (isProductionRuntime()) return;
  const g = globalThis as unknown as Record<symbol, unknown>;
  delete g[INSTALL_SENTINEL];
}
