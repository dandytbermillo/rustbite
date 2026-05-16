// Console-only stub adapter. The provider-neutral default backend used when
// no real observability vendor (Sentry, Datadog, etc.) is wired. This is
// what `OBSERVABILITY_ENABLED=true` without a vendor selection routes to.
//
// Invariants:
//   - Never throws. Adapter contract requires this — the wrapper's circuit
//     breaker relies on it.
//   - Emits structured JSON to stderr — exceptions via `console.error` and
//     non-exception messages via `console.warn`. (Both go to fd 2 in Node.)
//     This matches the convention most log-shipping agents follow:
//     warning/error level → stderr; info level → stdout. Note that this is
//     deliberately NOT the wrapper's captured "fallback" `console.error`
//     reference — that one is reserved for drop-path/adapter-failure
//     diagnostics in `server.ts`.
//   - Never reads beyond the sanitized event it receives. The wrapper has
//     already scrubbed every field; the adapter just serializes.

import type {
  Adapter,
  SanitizedExceptionEvent,
  SanitizedMessageEvent,
} from "../types";

function safeSerialize(payload: unknown): string {
  try {
    return JSON.stringify(payload);
  } catch {
    // JSON.stringify can throw on bigints / circular structures the scrubber
    // missed. Fall back to a marker so we don't propagate the throw.
    return '{"observability":"stub","error":"serialize-failed"}';
  }
}

export function createStubAdapter(): Adapter {
  return {
    captureException(event: SanitizedExceptionEvent): void {
      try {
        const payload = {
          level: "error" as const,
          source: "observability.stub",
          kind: "exception",
          ...event,
        };
        // eslint-disable-next-line no-console
        console.error(safeSerialize(payload));
      } catch {
        // Adapter must never throw. Swallow.
      }
    },

    captureMessage(event: SanitizedMessageEvent): void {
      try {
        const payload = {
          level: "warn" as const,
          source: "observability.stub",
          kind: "message",
          ...event,
        };
        // eslint-disable-next-line no-console
        console.warn(safeSerialize(payload));
      } catch {
        // Adapter must never throw. Swallow.
      }
    },

    async flush(_timeoutMs: number): Promise<void> {
      // Stub writes synchronously to stderr; nothing to flush.
      void _timeoutMs;
    },
  };
}
