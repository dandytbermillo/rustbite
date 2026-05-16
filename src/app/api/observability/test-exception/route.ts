// Controlled-exception probe route — deliberately throws so the FULL
// production error-capture path can be validated end-to-end in a real
// deployed route: middleware/handler request-id handshake → withObservability
// catch → captureException (redaction + adapter) → sanitized surface-aware
// 500 → x-request-id correlation header.
//
// Plan: docs/production-observability-plan-2026-05-14.md lines 317-320, 357
// ("a guarded route / test mode to verify remote capture end-to-end").
//
// Why a dedicated route exists: every other wrapped route catches its own
// errors, so `withObservability`'s uncaught-throw safety net is otherwise
// never exercised in production. This route is the single place that proves
// that path is live, without waiting for a real incident.
//
// Defense-in-depth gating. Each layer FAILS CLOSED; the order is chosen so
// the route is invisible unless deliberately enabled, then unreachable
// without the secret:
//
//   1. Env flag `OBSERVABILITY_TEST_ROUTE_ENABLED` must be exactly "true".
//      Anything else (unset / "false" / "1" / "TRUE") → 404 for EVERY verb,
//      so the route does not reveal its own existence by default and is
//      inert in production unless an operator deliberately enables it.
//   2. Signed-secret header `x-observability-test-signature` =
//      base64url(HMAC-SHA256("observability-test-exception",
//      OBSERVABILITY_TEST_SECRET)) — the FIRST gate after the flag, and
//      the ONLY thing an unauthenticated caller can observe. Verified
//      constant-time via `crypto.subtle.verify`. The raw secret never
//      travels on the wire (only its HMAC), so it cannot leak via
//      proxy/access logs. An unset or short (<16) secret → 404 (fail
//      closed: enabling the flag WITHOUT a secret does not open the
//      route). Missing / bad / non-decodable signature → 404. EVERY
//      pre-authentication rejection is an identical 404 so an
//      unauthenticated caller cannot distinguish "absent / disabled" from
//      "enabled" — not via status, not via an Allow header, not via 429.
//
//      Intentionally NOT replay-protected (no timestamp/nonce): the route
//      is strictly side-effect-free (it only throws), so replay is harmless
//      and a skew window would be unjustified complexity. Documented here so
//      a future reader does not "fix" a non-bug.
//   3. Method: POST only. Checked AFTER the signature, so a valid-signature
//      non-POST → 405 (Allow: POST) but an UNSIGNED non-POST → 404. The
//      405 is observable only by an authenticated caller and leaks nothing.
//   4. Rate limit: a dedicated, strict per-IP fixed-window limiter
//      (default 5/min), checked AFTER the signature. Unsigned traffic
//      never reaches or increments it, so unauthenticated callers cannot
//      exhaust the legitimate probe's budget and a 429 is observable only
//      by a secret-holder. Independent from the health limiter on purpose
//      (separate map) — a probe loop must not consume the health
//      endpoints' budget or vice versa, and it leaves the verified Slice 2
//      module untouched (zero blast radius).
//
// On success it throws `ObservabilityProbeError` (benign explicit message +
// a synthetic `cause`, so the probe also exercises the
// name/message/stack/cause event shape end-to-end). `withObservability`
// catches it, runs it through `captureException`, and returns a generic 500
// with `x-request-id`. The surface is `api` (path starts with `/api/`, not
// `/api/admin`), so the 500 body is fully generic — operators correlate via
// the `x-request-id` RESPONSE HEADER and the captured event's
// `name="ObservabilityProbeError"`, never via the body.
//
// The route is intentionally OUTSIDE the `src/middleware.ts` matcher: it
// must be drivable by CI / SRE with only the secret (no device or admin
// session), and `withObservability` still resolves a fresh server
// request-id when middleware did not run for the path.

import { NextResponse, type NextRequest } from "next/server";
import { withObservability } from "@/lib/observability/route-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const ENV_FLAG = "OBSERVABILITY_TEST_ROUTE_ENABLED";
const SECRET_ENV = "OBSERVABILITY_TEST_SECRET";
const MAX_PER_MIN_ENV = "OBSERVABILITY_TEST_ROUTE_MAX_PER_MIN";
const SIGNATURE_HEADER = "x-observability-test-signature";
// Fixed label the client HMACs. Constant by design — see the replay note
// in the file header. Changing this is a breaking change for any caller
// (CI monitor / SRE script) that precomputes the signature.
const SIGNATURE_PAYLOAD = "observability-test-exception";
const MIN_SECRET_LEN = 16;
const MAX_SIGNATURE_LEN = 512;

class ObservabilityProbeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ObservabilityProbeError";
  }
}

// --- Dedicated strict rate limiter ---------------------------------------
//
// In-memory, no DB, fail-open — mirrors the safe design of
// `health-rate-limit.ts` but with an INDEPENDENT bucket map on purpose:
// probe traffic and health traffic must not be able to exhaust each
// other's budget, and a separate map keeps the verified Slice 2 limiter
// module untouched. Per-process best-effort; the primary control for a
// publicly enabled probe would still be edge/proxy limiting, same as the
// health endpoints.

const RL_WINDOW_MS = 60_000;
const RL_DEFAULT_MAX = 5; // strict: this route only exists to throw
const RL_MAP_HARD_CAP = 2_000;

type Bucket = { count: number; windowStart: number };
const rlBuckets = new Map<string, Bucket>();

function rlMax(): number {
  const raw = process.env[MAX_PER_MIN_ENV];
  if (raw !== undefined) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1 && n <= 10_000) return Math.floor(n);
  }
  return RL_DEFAULT_MAX;
}

function clientIpKey(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip =
    (xff && xff.length > 0 ? xff : null) ??
    req.headers.get("x-real-ip")?.trim() ??
    req.headers.get("cf-connecting-ip")?.trim() ??
    null;
  return ip && ip.length > 0 ? ip : "unknown";
}

function rateLimited(req: NextRequest): boolean {
  try {
    const now = Date.now();
    if (rlBuckets.size > 0) {
      const cutoff = now - RL_WINDOW_MS * 2;
      for (const [k, b] of rlBuckets) {
        if (b.windowStart < cutoff) rlBuckets.delete(k);
      }
      if (rlBuckets.size > RL_MAP_HARD_CAP) rlBuckets.clear();
    }
    const key = clientIpKey(req);
    const max = rlMax();
    const existing = rlBuckets.get(key);
    if (!existing || now - existing.windowStart >= RL_WINDOW_MS) {
      rlBuckets.set(key, { count: 1, windowStart: now });
      return false;
    }
    existing.count += 1;
    return existing.count > max;
  } catch {
    // Fail open — a briefly un-throttled probe is harmless; a limiter bug
    // must never mask the capture path that is under test.
    return false;
  }
}

/** Test-only: clear buckets between cases. Hard no-op in production. */
export function __resetTestExceptionRateLimitForTests(): void {
  if (process.env.NODE_ENV === "production") return;
  rlBuckets.clear();
}

// --- Signed-secret verification (constant-time via subtle.verify) --------

const encoder = new TextEncoder();

function base64UrlDecode(str: string): Uint8Array {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  const bin = globalThis.atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function signatureValid(req: NextRequest): Promise<boolean> {
  const secret = process.env[SECRET_ENV];
  if (typeof secret !== "string" || secret.length < MIN_SECRET_LEN) {
    // Fail closed: no usable secret ⇒ the route stays invisible even if
    // the env flag was set. Prevents an "enabled but unconfigured" deploy
    // from accidentally opening an unauthenticated throw endpoint.
    return false;
  }
  const provided = req.headers.get(SIGNATURE_HEADER);
  if (!provided || provided.length === 0 || provided.length > MAX_SIGNATURE_LEN) {
    return false;
  }
  let sigBytes: Uint8Array;
  try {
    sigBytes = base64UrlDecode(provided);
  } catch {
    return false;
  }
  try {
    const key = await globalThis.crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    // `subtle.verify` compares in constant time internally — preferred
    // over recomputing + string-comparing the digest ourselves.
    return await globalThis.crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes as unknown as BufferSource,
      encoder.encode(SIGNATURE_PAYLOAD) as unknown as BufferSource,
    );
  } catch {
    return false;
  }
}

// --- Response helpers (operational endpoint → never cache) ---------------

function noStore(
  body: unknown,
  status: number,
  extraHeaders?: Record<string, string>,
): Response {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store", ...(extraHeaders ?? {}) },
  });
}

const notFound = (): Response => noStore({ error: "Not Found" }, 404);

// --- The probe handler ---------------------------------------------------

async function handle(req: NextRequest, method: string): Promise<Response> {
  // 1. Env flag — first, so a disabled route is invisible to EVERY verb.
  if (process.env[ENV_FLAG] !== "true") return notFound();

  // 2. Signed-secret header is the FIRST gate after the flag. EVERY
  //    pre-authentication rejection — missing/short secret, missing/bad/
  //    non-decodable signature, AND (below) wrong method or over-budget —
  //    returns an identical 404. An unauthenticated caller therefore
  //    cannot distinguish "absent / disabled" from "enabled": not via the
  //    status, not via an `Allow` header, not via a 429.
  //
  //    (Earlier this gate ran AFTER the method/rate checks, so an
  //    unauthenticated caller could observe a 405/429 — leaking the
  //    enabled state — and unsigned traffic could spend the signed
  //    probe's per-IP budget. Both are fixed by making the signature the
  //    sole pre-auth gate.)
  if (!(await signatureValid(req))) return notFound();

  // --- Past this point the caller proved knowledge of
  //     OBSERVABILITY_TEST_SECRET. The checks below are observable ONLY by
  //     an authenticated caller, so they may use specific status codes. ---

  // 3. Method — POST only. A valid-signature non-POST is a fat-fingered
  //    SRE/CI call; 405 + Allow helps them and leaks nothing (authed).
  if (method !== "POST") {
    return noStore({ error: "Method Not Allowed" }, 405, { allow: "POST" });
  }

  // 4. Rate limit — POST-authenticated only. Unsigned traffic never
  //    reaches or increments this counter, so unauthenticated callers
  //    cannot exhaust the legitimate probe's per-IP budget, and a 429 is
  //    only ever observable by a secret-holder.
  //
  //    Deliberate trade-off: there is intentionally NO pre-auth limiter,
  //    so an unsigned flood still costs one HMAC verify per request
  //    before its 404. Accepted because (a) the route is OFF by default
  //    and only enabled briefly under operator control, (b) edge/proxy
  //    rate limiting is the documented primary control (in-memory is
  //    defense-in-depth only, same stance as the health limiter), and
  //    (c) the verify is a single SHA-256 HMAC over ~28 bytes, not a KDF.
  //    Escalation if the probe is ever left enabled long-term on a public
  //    origin: add a pre-auth limiter that ALSO returns 404 (never 429),
  //    so it bounds CPU without re-introducing the enabled-state leak.
  if (rateLimited(req)) {
    return noStore({ error: "Too Many Requests" }, 429, { "retry-after": "60" });
  }

  // 5. Deliberate throw. `withObservability`'s catch captures it
  //    (redaction + adapter) and returns a sanitized generic 500 with
  //    `x-request-id`. The synthetic `cause` exercises recursive
  //    Error.cause capture through a real route.
  throw new ObservabilityProbeError(
    "Deliberate observability pipeline probe. This route exists only to " +
      "validate end-to-end error capture; no remediation is required.",
    {
      cause: new ObservabilityProbeError(
        "Synthetic probe cause — exercises Error.cause capture.",
      ),
    },
  );
}

export function POST(req: NextRequest): Promise<Response> {
  return withObservability(req, (r) => handle(r, "POST"));
}
export function GET(req: NextRequest): Promise<Response> {
  return withObservability(req, (r) => handle(r, "GET"));
}
export function PUT(req: NextRequest): Promise<Response> {
  return withObservability(req, (r) => handle(r, "PUT"));
}
export function PATCH(req: NextRequest): Promise<Response> {
  return withObservability(req, (r) => handle(r, "PATCH"));
}
export function DELETE(req: NextRequest): Promise<Response> {
  return withObservability(req, (r) => handle(r, "DELETE"));
}
export function OPTIONS(req: NextRequest): Promise<Response> {
  return withObservability(req, (r) => handle(r, "OPTIONS"));
}
export function HEAD(req: NextRequest): Promise<Response> {
  return withObservability(req, (r) => handle(r, "HEAD"));
}
