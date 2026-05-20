// Background-job observability context.
//
// `runWithJobContext` is the single approved way to start a unit of
// background work. It:
//
//   1. Creates a fresh ALS context with `{ surface: "api", jobId, jobName,
//      startedAt }` plus any allow-listed caller-supplied fields. The
//      originating request's context is intentionally NOT inherited unless
//      the caller passed values forward explicitly (use `snapshotContext()`
//      from `context.ts` to capture safe fields).
//
//   2. Runs `fn` inside that context.
//
//   3. If `fn` throws, calls `captureException` with the error AND
//      **rethrows the original error** so the caller's job-success/job-
//      failure semantics are preserved. Capture is observability, not
//      control flow.
//
//   4. Calls `flushAll(timeoutMs)` in a `finally` block before resolving,
//      so one-shot scripts get their buffered events out before process
//      exit. `flushAll` failures never propagate and never change the
//      job's resolve/reject outcome.
//
// Long-running watcher scripts (e.g., `email:worker:dev`) must call this
// per work item, not once around the whole loop — otherwise iteration N's
// errors would be tagged with iteration 1's `jobId`.

import { randomUUID } from "node:crypto";
import { __runWithExactContext } from "./context";
import {
  captureException,
  flushAll,
} from "./server";
import {
  logJobCompleted,
  logJobFailed,
  logJobStarted,
} from "./structured-logs";
import type { CaptureContext, CaptureContextInput } from "./types";

const DEFAULT_FLUSH_TIMEOUT_MS = 2_000;

export async function runWithJobContext<T>(
  jobName: string,
  fn: () => Promise<T>,
  context?: CaptureContextInput,
  options?: { flushTimeoutMs?: number },
): Promise<T> {
  const jobId = randomUUID();
  const startedAt = new Date().toISOString();
  // Build the fresh job context. Caller fields (allow-listed) win over
  // defaults except for `jobId`/`jobName`/`startedAt`, which are owned by
  // this helper.
  const merged: CaptureContext = {
    surface: "api",
    ...(context ?? {}),
    jobId,
    jobName,
    startedAt,
  };

  const flushTimeoutMs = options?.flushTimeoutMs ?? DEFAULT_FLUSH_TIMEOUT_MS;

  return await __runWithExactContext(merged, async () => {
    const startedAtMs = Date.now();
    logJobStarted(merged);
    try {
      const result = await fn();
      logJobCompleted(merged, Date.now() - startedAtMs);
      return result;
    } catch (err) {
      logJobFailed(merged, Date.now() - startedAtMs);
      // Capture for observability. Fire-and-forget by contract.
      try {
        captureException(err);
      } catch {
        // captureException is itself defensive; the inner try is paranoia.
      }
      // Rethrow so the caller's success/failure semantics are intact.
      throw err;
    } finally {
      // flushAll never throws. Its result does NOT change the job's
      // resolve/reject outcome — the throw above (if any) propagates first,
      // then the finally runs.
      await flushAll(flushTimeoutMs);
    }
  });
}
