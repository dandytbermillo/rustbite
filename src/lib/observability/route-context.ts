// Route-handler-side helper for the request-id handshake.
//
// `withObservability(req, handler)` wraps a Next.js route handler so the
// rest of the request runs inside `runWithRequestContext({...})` with the
// canonical server request-id resolved from the trusted internal header
// (or freshly generated as a defensive fallback).
//
// What it does, per request:
//
//   1. Reads `x-internal-request-id` from the inbound request and verifies
//      its HMAC against `INTERNAL_REQUEST_ID_HMAC_SECRET`. On verify
//      success, the unwrapped reqId becomes the canonical server id.
//
//   2. If the header is missing (middleware didn't run for this route) OR
//      the signature fails (forged), the wrapper generates a fresh
//      server-side reqId. The inbound state is treated as untrusted.
//
//   3. Reads `x-request-id` from the inbound request and validates it via
//      `validateClientRequestId`. The validated string becomes
//      `clientRequestId`. Malformed or absent → undefined.
//
//   4. Builds a `CaptureContext` with `surface` (inferred from path),
//      `requestId`, `clientRequestId`, and any caller-supplied extras
//      (e.g., `outletId`, `deviceId` from upstream auth).
//
//   5. Invokes `handler(req, ctx)` inside `runWithRequestContext(ctx, …)`
//      so any `captureException`/`captureMessage` calls during the
//      handler pick up the context automatically.
//
//   6. After the handler resolves, sets `x-request-id: <reqId>` on the
//      outbound response so clients can correlate.
//
// This wrapper only touches headers — it never reads or buffers the
// response body, so it is safe with streaming responses (per Slice 3
// streaming-response rule in the production observability plan).

import { NextResponse } from "next/server";
import { runWithRequestContext } from "./context";
import {
  CLIENT_REQUEST_ID_HEADER,
  INTERNAL_REQUEST_ID_HEADER,
  generateRequestId,
  inferSurfaceFromPath,
  readHmacSecretFromEnv,
  validateClientRequestId,
  verifyInternalRequestIdHeader,
} from "./request-id";
import { captureException } from "./server";
import type { CaptureContext, CaptureContextInput } from "./types";

/**
 * Surfaces that may include the resolved `requestId` as a safe lookup
 * reference in throw-path 500 response bodies, per the production
 * observability plan §347 ("admin-facing routes may return a generic
 * message plus a safe lookup reference, such as the server request id").
 * Customer-facing surfaces (kiosk, board, counter, kitchen, generic api)
 * never include the reqId in the body — operators correlate via the
 * `x-request-id` header instead so the kiosk screen does not surface
 * internal identifiers to customers.
 */
const ADMIN_FACING_SURFACES = new Set<CaptureContext["surface"]>([
  "admin",
  "workspace",
]);

/**
 * Route-handler signature. Receives the original request plus the resolved
 * `CaptureContext` (in case the handler wants to read the requestId or
 * surface for ad-hoc logging).
 */
export type ObservedHandler<TReq extends Request = Request> = (
  req: TReq,
  ctx: CaptureContext,
) => Promise<Response>;

/**
 * Subset of `CaptureContextInput` that callers may merge into the resolved
 * context. The canonical fields owned by the wrapper — `requestId`,
 * `clientRequestId`, `surface` — are excluded at the type level so a caller
 * cannot accidentally (or maliciously) overwrite the trusted values resolved
 * from the HMAC-verified header / inbound `x-request-id` / path inference.
 *
 * `surface` has its own dedicated `WithObservabilityOptions.surface` slot
 * for explicit overrides; routing it through `extra` is not supported.
 *
 * The wrapper ALSO defends at runtime by spreading `extra` first and the
 * canonical fields last (see `resolveContext`), so even an `as any` bypass
 * cannot replace the trusted reqId.
 */
export type ExtraContext = Omit<
  CaptureContextInput,
  "requestId" | "clientRequestId" | "surface"
>;

export type WithObservabilityOptions = {
  /**
   * Extra context fields to merge in (e.g., `outletId`, `deviceId`,
   * `adminUserId`, `jobId`, `jobName` from upstream auth or job dispatch).
   * Cannot include `requestId`, `clientRequestId`, or `surface` — those
   * are owned by the wrapper.
   */
  extra?: ExtraContext;
  /**
   * Override the surface inference. Useful for routes whose path does not
   * map cleanly via `inferSurfaceFromPath` (e.g., `/api/menu` is `api` by
   * default; a kiosk-only menu surface might want `"kiosk"`).
   */
  surface?: CaptureContext["surface"];
};

/**
 * Wrap a Next.js route handler with the observability handshake.
 *
 * Usage:
 *
 * ```ts
 * export async function GET(req: NextRequest) {
 *   return withObservability(req, async (req, ctx) => {
 *     // ...handler body...
 *     return NextResponse.json({ ok: true });
 *   });
 * }
 * ```
 *
 * The wrapper does not throw on its own — internal failures (HMAC verify
 * exception, missing secret in dev) fall back to fresh server-side id
 * generation so the route remains responsive. Uncaught throws from the
 * handler are also caught: the error is sent through `captureException`
 * (so observability sees it with full context) and a sanitized 500 with
 * `x-request-id` is returned to the caller. Handlers that want to control
 * the 5xx response shape themselves should still catch their own errors
 * and return a `Response` — the wrapper's catch is the safety net for
 * unhandled cases only.
 */
export async function withObservability<TReq extends Request = Request>(
  req: TReq,
  handler: ObservedHandler<TReq>,
  options?: WithObservabilityOptions,
): Promise<Response> {
  const ctx = await resolveContext(req, options);
  let response: Response;
  try {
    response = await runWithRequestContext(ctx, () => handler(req, ctx));
  } catch (err) {
    // The handler threw. Capture for observability, then return a
    // sanitized 500 with `x-request-id` so operators can correlate.
    //
    // Why we do NOT rethrow: Next's framework-default 500 path builds
    // the response itself and there is no hook to attach our header or
    // a surface-aware body. Rethrowing forfeits both correlation and
    // the customer-message guarantee. Catching here is the only place
    // that has the request-id + surface + ALS-built ctx all available.
    //
    // captureException is fire-and-forget and is documented to never
    // throw, but we wrap defensively so a hypothetical observability
    // bug cannot block the safe-500 path the customer ultimately sees.
    try {
      captureException(err, ctx);
    } catch {
      // intentionally swallowed — see comment above
    }
    response = buildSanitized500(ctx);
  }
  // resolveContext always sets requestId; the optional type comes from
  // CaptureContext being broad enough for non-request surfaces (jobs).
  return attachRequestIdHeader(response, ctx.requestId ?? "");
}

/**
 * Build the throw-path 500 response. Body is surface-aware: admin-facing
 * surfaces get the `requestId` as a safe lookup reference so operators
 * can map the failure to the captured event. Customer-facing surfaces
 * get a fully generic body — the reqId is still present on the response
 * header for header-level correlation, just not in the rendered body.
 */
function buildSanitized500(ctx: CaptureContext): Response {
  const isAdminFacing = ADMIN_FACING_SURFACES.has(ctx.surface);
  const body = isAdminFacing
    ? { error: "Internal Server Error", requestId: ctx.requestId ?? null }
    : { error: "Internal Server Error" };
  return NextResponse.json(body, { status: 500 });
}

/**
 * Build a `CaptureContext` from the inbound request's headers + the
 * configured surface. Exported separately so middleware-blocked responses
 * (auth 401s, redirects) can also attach a request-id consistently.
 */
export async function resolveContext<TReq extends Request>(
  req: TReq,
  options?: WithObservabilityOptions,
): Promise<CaptureContext> {
  const headers = req.headers;
  const internalRaw = headers.get(INTERNAL_REQUEST_ID_HEADER);
  const clientRaw = headers.get(CLIENT_REQUEST_ID_HEADER);

  // `readHmacSecretFromEnv` THROWS in production when the env var is
  // missing or shorter than 16 chars, and returns `null` in non-production
  // when the env var is unset. We do NOT catch the production throw —
  // the route handler 500s loudly so the misconfig surfaces in deploy logs
  // immediately. Catching would silently degrade to fresh-id generation,
  // the exact failure mode the production-throw exists to prevent.
  const secret = readHmacSecretFromEnv();
  let requestId: string;
  if (secret && internalRaw) {
    const verified = await verifyInternalRequestIdHeader(internalRaw, secret);
    requestId = verified ?? generateRequestId();
  } else {
    requestId = generateRequestId();
  }

  const clientRequestId = validateClientRequestId(clientRaw) ?? undefined;

  const url = safeUrl(req.url);
  const surface =
    options?.surface ??
    (url ? inferSurfaceFromPath(url.pathname) : "api");

  // Defense in depth: even if a caller bypasses the `ExtraContext` type
  // with `as any` and shoves a `requestId` / `clientRequestId` / `surface`
  // into `extra`, those keys are explicitly stripped at runtime BEFORE
  // merging. Spread order alone is insufficient because `clientRequestId`
  // is conditionally included when the inbound header is missing — without
  // the strip, `extra.clientRequestId` would leak through that path.
  const safeExtra = stripCanonicalFields(options?.extra);
  const ctx: CaptureContext = {
    ...safeExtra,
    surface,
    requestId,
    ...(clientRequestId ? { clientRequestId } : {}),
  };
  return ctx;
}

/**
 * Strip canonical wrapper-owned fields (`requestId`, `clientRequestId`,
 * `surface`) from caller-supplied `extra` so a misuse / type-cast cannot
 * replace the trusted values resolved by `resolveContext`.
 */
function stripCanonicalFields(
  extra: ExtraContext | undefined,
): Omit<ExtraContext, never> {
  if (!extra) return {};
  const cast = extra as Record<string, unknown>;
  const {
    requestId: _droppedReqId,
    clientRequestId: _droppedClientId,
    surface: _droppedSurface,
    ...rest
  } = cast;
  return rest as ExtraContext;
}

/**
 * Set `x-request-id` on `response` and return it. Mutates the existing
 * `Headers` rather than cloning so streaming bodies, status, cookies, etc.
 * survive untouched. If the response uses an immutable header bag (rare),
 * we fall back to constructing a new response with the same body.
 */
export function attachRequestIdHeader<R extends Response>(
  response: R,
  requestId: string,
): R | Response {
  try {
    response.headers.set(CLIENT_REQUEST_ID_HEADER, requestId);
    return response;
  } catch {
    // Headers were immutable (rare). Reconstruct with the new header set.
    const headers = new Headers(response.headers);
    headers.set(CLIENT_REQUEST_ID_HEADER, requestId);
    if (response instanceof NextResponse || response instanceof Response) {
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
    return response;
  }
}

function safeUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}
