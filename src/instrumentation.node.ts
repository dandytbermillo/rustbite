// Node-only instrumentation startup.
//
// This module is dynamically imported from `src/instrumentation.ts` only when
// `NEXT_RUNTIME === "nodejs"`. It may use Node APIs freely; keeping them out of
// `instrumentation.ts` prevents the Edge instrumentation bundle from parsing
// unsupported modules like `node:async_hooks`.

import { flushAll, markShuttingDown } from "./lib/observability/server";

const FLUSH_TIMEOUT_MS = 2_000;
const SENTINEL_KEY = Symbol.for("rushbite.observability.signalHooksRegistered");

type SignalSentinelHolder = Record<symbol, boolean | undefined>;

export function registerNodeObservabilitySignalHooks(): void {
  if (typeof process === "undefined" || typeof process.on !== "function") {
    return;
  }

  const g = globalThis as unknown as SignalSentinelHolder;
  if (g[SENTINEL_KEY]) return;
  g[SENTINEL_KEY] = true;

  const handler = (signal: NodeJS.Signals): void => {
    markShuttingDown();
    const exitCode = signal === "SIGINT" ? 130 : 143;
    void flushAll(FLUSH_TIMEOUT_MS)
      .catch(() => {
        // Swallow; shutdown must still complete.
      })
      .finally(() => {
        process.exit(exitCode);
      });
  };

  process.on("SIGTERM", handler);
  process.on("SIGINT", handler);
}
