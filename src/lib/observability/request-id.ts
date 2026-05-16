// Request-id provenance + the middleware/handler trusted-header handshake.
//
// The flow:
//
//   1. Edge-runtime middleware runs first. It generates a fresh server
//      request-id, HMAC-signs it with a deployment-scoped secret, and
//      attaches the signed token to the FORWARDED request as
//      `x-internal-request-id: <reqId>.<base64url(HMAC)>`. The same
//      middleware also sets `x-request-id: <reqId>` on any response it
//      itself returns (auth-blocked redirects, 401s, etc.).
//
//   2. Node-runtime route handlers extract `x-internal-request-id` from
//      the inbound request, verify the HMAC, and use the unwrapped reqId
//      as the canonical server request-id. If the header is missing OR
//      its signature fails, the handler falls back to generating its own
//      fresh server request-id and treats the inbound state as untrusted.
//
//   3. A client-supplied `x-request-id` header is NEVER trusted as the
//      canonical server id. It is validated and stored separately as
//      `clientRequestId` for cross-system correlation.
//
// Why HMAC vs. strip-only: the existing middleware matcher in
// `src/middleware.ts` doesn't cover every critical route (`/api/menu` is
// excluded). With strip-only, a forged `x-internal-request-id` from the
// client would pass through unchanged on uncovered routes. HMAC works
// regardless of whether middleware ran for the route.
//
// Web Crypto: this module uses `globalThis.crypto.subtle.{importKey,sign,
// verify}` so it works identically in Edge runtime (middleware) and Node
// 16+ runtime (route handlers). No Node-specific imports.

import type { Surface } from "./types";

export const INTERNAL_REQUEST_ID_HEADER = "x-internal-request-id";
export const CLIENT_REQUEST_ID_HEADER = "x-request-id";

/** Env var holding the HMAC secret. Required in production. */
export const HMAC_SECRET_ENV = "INTERNAL_REQUEST_ID_HMAC_SECRET";

const ID_LEN = 22; // base64url chars from 16 random bytes
const MAX_CLIENT_ID_LEN = 64;
const MIN_CLIENT_ID_LEN = 1;

// --- Generation ----------------------------------------------------------

/**
 * Generate a fresh URL-safe server request-id. 22 base64url chars from 16
 * random bytes (~128 bits of entropy — collision-resistant for any plausible
 * RushBite traffic volume).
 */
export function generateRequestId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

// --- Client-id validation ------------------------------------------------

/**
 * Validate an inbound `x-request-id` header value supplied by the client.
 * Returns the validated string OR `null` if malformed.
 *
 * Validation: max 64 chars, min 1 char, charset `[A-Za-z0-9_\-:.]`. Rejects
 * control characters, whitespace, and common log-injection vectors.
 */
export function validateClientRequestId(
  raw: string | null | undefined,
): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string") return null;
  if (raw.length < MIN_CLIENT_ID_LEN || raw.length > MAX_CLIENT_ID_LEN) {
    return null;
  }
  for (let i = 0; i < raw.length; i++) {
    const ch = raw.charCodeAt(i);
    const allowed =
      (ch >= 48 && ch <= 57) || // 0-9
      (ch >= 65 && ch <= 90) || // A-Z
      (ch >= 97 && ch <= 122) || // a-z
      ch === 45 || // '-'
      ch === 95 || // '_'
      ch === 58 || // ':'
      ch === 46; // '.'
    if (!allowed) return null;
  }
  return raw;
}

// --- HMAC sign / verify --------------------------------------------------

/**
 * Sign `reqId` and return the wrapped header value
 * `<reqId>.<base64url(HMAC-SHA256(reqId))>`. The middleware sets this on the
 * forwarded request; the handler verifies it.
 *
 * `secret` must be a deployment-scoped env var (NOT process-local), so the
 * same HMAC produced in Edge-runtime middleware verifies in Node-runtime
 * handlers. See plan §Critical #1.
 */
export async function buildInternalRequestIdHeader(
  reqId: string,
  secret: string,
): Promise<string> {
  if (!reqId || reqId.includes(".")) {
    throw new Error("buildInternalRequestIdHeader: reqId must not contain '.'");
  }
  const hmac = await hmacSign(reqId, secret);
  return `${reqId}.${hmac}`;
}

/**
 * Verify an inbound `x-internal-request-id` header value. Returns the
 * unwrapped server request-id on success, or `null` if the header is
 * missing, malformed, or its HMAC fails.
 *
 * The handler MUST treat a `null` return as "no trusted id from middleware
 * — generate a fresh server-side id and treat the inbound flow as
 * untrusted."
 */
export async function verifyInternalRequestIdHeader(
  raw: string | null | undefined,
  secret: string,
): Promise<string | null> {
  if (raw == null || typeof raw !== "string") return null;
  // Format: <reqId>.<sig>
  const dot = raw.indexOf(".");
  if (dot <= 0 || dot === raw.length - 1) return null;
  const reqId = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  // Bounds-check both halves before doing any crypto work.
  if (reqId.length === 0 || reqId.length > 128) return null;
  if (sig.length === 0 || sig.length > 128) return null;
  // Charset: reqId must be base64url-safe (we generate them that way).
  for (let i = 0; i < reqId.length; i++) {
    const ch = reqId.charCodeAt(i);
    const allowed =
      (ch >= 48 && ch <= 57) ||
      (ch >= 65 && ch <= 90) ||
      (ch >= 97 && ch <= 122) ||
      ch === 45 ||
      ch === 95;
    if (!allowed) return null;
  }
  const ok = await hmacVerify(reqId, sig, secret);
  return ok ? reqId : null;
}

// --- Env helper ----------------------------------------------------------

/**
 * Read the HMAC secret from env. In production, missing or empty throws.
 * In non-production, returns `null` so callers can short-circuit (e.g.,
 * skip signing during local dev without ceremony).
 */
export function readHmacSecretFromEnv(): string | null {
  const raw = process.env[HMAC_SECRET_ENV];
  if (typeof raw === "string" && raw.length >= 16) return raw;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `${HMAC_SECRET_ENV} must be set (≥16 chars) in production for the ` +
        `request-id HMAC handshake. See docs/production-observability-plan-2026-05-14.md.`,
    );
  }
  return null;
}

// --- Surface inference ---------------------------------------------------

/**
 * Map a request pathname to a `Surface`. Used by the route-context wrapper
 * to set the `surface` tag on the active `CaptureContext` without each
 * route having to remember it.
 */
export function inferSurfaceFromPath(pathname: string): Surface {
  if (pathname.startsWith("/api/admin/workspace")) return "workspace";
  if (pathname.startsWith("/api/admin")) return "admin";
  if (pathname.startsWith("/api/")) return "api";
  if (pathname === "/kiosk" || pathname.startsWith("/kiosk/")) return "kiosk";
  if (pathname === "/admin" || pathname.startsWith("/admin/"))
    return pathname.includes("/workspace") ? "workspace" : "admin";
  if (pathname === "/counter" || pathname.startsWith("/counter/")) return "counter";
  if (pathname === "/kitchen" || pathname.startsWith("/kitchen/")) return "kitchen";
  if (pathname === "/board" || pathname.startsWith("/board/")) return "board";
  return "api";
}

// --- Internal: HMAC + base64url helpers ----------------------------------

const encoder = new TextEncoder();

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function hmacSign(payload: string, secret: string): Promise<string> {
  const key = await importHmacKey(secret);
  const sig = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload),
  );
  return base64UrlEncode(new Uint8Array(sig));
}

async function hmacVerify(
  payload: string,
  expectedB64Url: string,
  secret: string,
): Promise<boolean> {
  let expectedBytes: Uint8Array;
  try {
    expectedBytes = base64UrlDecode(expectedB64Url);
  } catch {
    return false;
  }
  const key = await importHmacKey(secret);
  // `subtle.verify` does constant-time comparison internally — preferred
  // over computing our own sig and string-comparing.
  // Cast to BufferSource to satisfy the strict TS lib narrowing that
  // disallows SharedArrayBuffer-backed views; we own these allocations
  // and they are always plain ArrayBuffer.
  return globalThis.crypto.subtle.verify(
    "HMAC",
    key,
    expectedBytes as unknown as BufferSource,
    encoder.encode(payload) as unknown as BufferSource,
  );
}

function base64UrlEncode(bytes: Uint8Array): string {
  // Avoid Node's `Buffer` so this works in Edge runtime too.
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = globalThis.btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  // Restore standard base64 padding/charset.
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  const bin = globalThis.atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
