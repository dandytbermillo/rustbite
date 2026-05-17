// Synthetic-monitor trusted-identity token.
//
// Mirrors the request-id.ts HMAC pattern (Web Crypto `globalThis.crypto.
// subtle`; identical in Edge + Node; no Node-only imports). The small
// HMAC/base64url helpers are intentionally DUPLICATED from request-id.ts so
// the critical, separately-tested request-id module is left untouched for
// this slice.
//
// Static token: managed SaaS uptime monitors send a fixed custom header, not
// a per-request HMAC. The token is generated once
// (scripts/print-synthetic-monitor-token.ts), pasted into the provider's
// custom-header config, and verified statelessly here. Rotation = rotate
// SYNTHETIC_MONITOR_HMAC_SECRET, regenerate, update the provider.
//
// Treat the token as a credential: HTTPS-only, least-privilege (it only
// classifies a request as synthetic — grants no real access), never logged
// (redaction.ts already scrubs any key containing "token").

export const SYNTHETIC_MONITOR_SECRET_ENV = "SYNTHETIC_MONITOR_HMAC_SECRET";
export const SYNTHETIC_MONITOR_TAG_HEADER = "x-monitor";
export const SYNTHETIC_MONITOR_TOKEN_HEADER = "x-monitor-token";

const LABEL = "synthetic-monitor";
const MIN_SECRET_LEN = 16;
const MAX_TOKEN_LEN = 128;

const encoder = new TextEncoder();

// --- HMAC + base64url (duplicated from request-id.ts by design) ----------

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return globalThis
    .btoa(bin)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  const bin = globalThis.atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function hmacSign(payload: string, secret: string): Promise<string> {
  const key = await importHmacKey(secret);
  const sig = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload)
  );
  return base64UrlEncode(new Uint8Array(sig));
}

async function hmacVerify(
  payload: string,
  expectedB64Url: string,
  secret: string
): Promise<boolean> {
  let expectedBytes: Uint8Array;
  try {
    expectedBytes = base64UrlDecode(expectedB64Url);
  } catch {
    return false;
  }
  const key = await importHmacKey(secret);
  // subtle.verify is constant-time internally.
  return globalThis.crypto.subtle.verify(
    "HMAC",
    key,
    expectedBytes as unknown as BufferSource,
    encoder.encode(payload) as unknown as BufferSource
  );
}

// --- Token build / verify ------------------------------------------------

export async function buildSyntheticMonitorToken(
  secret: string
): Promise<string> {
  if (!secret || secret.length < MIN_SECRET_LEN) {
    throw new Error(
      `${SYNTHETIC_MONITOR_SECRET_ENV} must be >= ${MIN_SECRET_LEN} chars`
    );
  }
  const sig = await hmacSign(LABEL, secret);
  return `${LABEL}.${sig}`;
}

/**
 * Strict parse + constant-time verify. Requires the exact
 * `synthetic-monitor.<sig>` shape: exactly one dot, the exact label, a
 * base64url-only signature, bounded length. Returns false on any deviation
 * (never throws).
 */
export async function verifySyntheticMonitorToken(
  raw: string | null | undefined,
  secret: string
): Promise<boolean> {
  if (raw == null || typeof raw !== "string") return false;
  if (raw.length === 0 || raw.length > MAX_TOKEN_LEN) return false;
  const dot = raw.indexOf(".");
  if (dot <= 0 || dot === raw.length - 1) return false;
  if (raw.indexOf(".", dot + 1) !== -1) return false; // reject >= 2 dots
  const label = raw.slice(0, dot);
  if (label !== LABEL) return false; // exact label only
  const sig = raw.slice(dot + 1);
  for (let i = 0; i < sig.length; i++) {
    const ch = sig.charCodeAt(i);
    const ok =
      (ch >= 48 && ch <= 57) ||
      (ch >= 65 && ch <= 90) ||
      (ch >= 97 && ch <= 122) ||
      ch === 45 ||
      ch === 95;
    if (!ok) return false;
  }
  if (!secret || secret.length < MIN_SECRET_LEN) return false;
  return hmacVerify(LABEL, sig, secret);
}

// --- Env readers ---------------------------------------------------------

/**
 * Classifier path. Missing / too-short secret => null (caller fails closed).
 * NEVER throws: synthetic classification is auxiliary and must not 500 real
 * traffic. (Deliberately NOT request-id.ts's throw-in-prod semantics.)
 */
export function readSyntheticMonitorSecretOrNull(): string | null {
  const raw = process.env[SYNTHETIC_MONITOR_SECRET_ENV];
  if (typeof raw === "string" && raw.length >= MIN_SECRET_LEN) return raw;
  return null;
}

/**
 * Token-generator script + optional deploy preflight ONLY. Throws on
 * missing/short so misconfig surfaces loudly OFF the request path.
 */
export function readSyntheticMonitorSecretStrict(): string {
  const raw = process.env[SYNTHETIC_MONITOR_SECRET_ENV];
  if (typeof raw === "string" && raw.length >= MIN_SECRET_LEN) return raw;
  throw new Error(
    `${SYNTHETIC_MONITOR_SECRET_ENV} must be set (>= ${MIN_SECRET_LEN} chars). ` +
      `Used only by the synthetic-monitor token generator / deploy preflight.`
  );
}

// --- Request classification ---------------------------------------------

/**
 * True iff the request carries the exact `x-monitor: true` tag AND a valid
 * signed `x-monitor-token`. Fail-closed: any miss / null secret => false
 * (never mis-classify real traffic as synthetic). Async because Web Crypto
 * verification is async (same as request-id.ts verify).
 */
export async function classifySyntheticRequest(req: {
  headers: { get(name: string): string | null };
}): Promise<boolean> {
  if (req.headers.get(SYNTHETIC_MONITOR_TAG_HEADER) !== "true") return false;
  const secret = readSyntheticMonitorSecretOrNull();
  if (secret == null) return false;
  return verifySyntheticMonitorToken(
    req.headers.get(SYNTHETIC_MONITOR_TOKEN_HEADER),
    secret
  );
}
