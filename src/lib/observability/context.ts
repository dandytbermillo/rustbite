// Request-scoped observability context backed by Node's AsyncLocalStorage.
//
// Why ALS as the source of truth: Next.js route handlers run as async
// functions across multiple microtasks, and we need a per-request bag of
// allow-listed tags (`requestId`, `outletId`, `deviceId`, `surface`, etc.)
// that the capture wrapper can pick up without callers explicitly threading
// it through every function.
//
// ALS propagates through bare `setImmediate` / `queueMicrotask` / `setTimeout`
// callbacks. That is its design and the rest of this module assumes it. If a
// piece of work must run WITHOUT the parent request's context — typically
// background work that should not inherit the request's identity tags —
// callers use `runDetached(fn)` for an empty scope or `runWithJobContext`
// (in job-context.ts) for a fresh job scope.
//
// Middleware runs in the Edge runtime and cannot use ALS at all (no
// `async_hooks` there). The middleware/handler request-id handshake lives in
// the route handler entry, not here.

import { AsyncLocalStorage } from "node:async_hooks";
import type { CaptureContext } from "./types";

const storage = new AsyncLocalStorage<CaptureContext>();

/**
 * Run `fn` with `ctx` as the active observability context for the duration
 * of `fn` and any async work it spawns (via await, microtasks, setImmediate,
 * setTimeout, etc.). Nested calls compose normally — the inner `ctx` shadows
 * the outer for the lifetime of the inner call.
 */
export function runWithRequestContext<T>(
  ctx: CaptureContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(ctx, fn);
}

/**
 * Return the current observability context, or `null` if no
 * `runWithRequestContext` (or `runWithJobContext`) frame is active.
 */
export function getRequestContext(): CaptureContext | null {
  return storage.getStore() ?? null;
}

/**
 * Return a defensive copy of the current context, or `null` if none is
 * active. Use this when a background job needs to forward a *safe subset*
 * of the originating request's context (e.g., a `correlationId`) but is
 * starting a separate logical unit of work.
 *
 * The wrapper does NOT scrub this snapshot — values in the active context
 * are already allow-listed by construction. Callers must still pass only
 * allow-listed fields when they hand the snapshot to `runWithJobContext`.
 */
export function snapshotContext(): CaptureContext | null {
  const current = storage.getStore();
  return current ? { ...current } : null;
}

/**
 * Run `fn` in an empty observability scope. Any `getRequestContext()` call
 * inside `fn` (or async work it spawns) will return `null` until the inner
 * `fn` returns. Use this for fire-and-forget background work that must not
 * inherit the originating request's identity tags.
 *
 * Internally implemented via `storage.run(undefined as never, fn)` plus a
 * sentinel check in `getRequestContext` (ALS's `run(undefined, fn)` is the
 * documented way to clear the store for the duration of `fn`).
 */
export function runDetached<T>(fn: () => Promise<T>): Promise<T> {
  // AsyncLocalStorage.run accepts `undefined` as a valid "no value" store.
  // `getStore()` will return `undefined` inside `fn`, which `getRequestContext`
  // normalizes to `null` via the `?? null` coalesce.
  return storage.run(undefined as unknown as CaptureContext, fn);
}

// --- Internal helpers used by job-context.ts ------------------------------

/**
 * Internal: run `fn` with the *exact* given store value. Used by
 * `runWithJobContext` to overwrite (not merge) the active context with a
 * fresh job context. Exposed only within the module surface; downstream
 * callers should not import this directly.
 */
export function __runWithExactContext<T>(
  ctx: CaptureContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(ctx, fn);
}
