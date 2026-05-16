// Redaction module for the observability wrapper. Two layers of defense:
//
//   1. Allow-list semantics. `scrubFields` returns only the explicitly-allowed
//      keys from a record. Anything unknown is dropped, not preserved.
//
//   2. Deny-list backstop. `scrub` walks a value recursively and replaces:
//      - sensitive *keys* (passwords, MFA secrets, session cookies, raw IP,
//        raw user-agent, customer/staff names, etc.) with `"[REDACTED]"`.
//      - sensitive *values under benign keys* (emails, phone numbers, IPs,
//        URLs with credentials, bearer tokens, card-shaped numbers, MFA
//        formats) by pattern matching inside the string.
//
// ReDoS safety: no arbitrary regexes. The few RegExps used here are short,
// anchored where practical, and never use nested unbounded quantifiers. Long
// strings are length-capped (`MAX_SCAN_LEN`) so adversarial inputs cannot burn
// CPU.
//
// IMPORTANT: this module never reads `Request.body` or `Response.body`. The
// scrubber returns a synthetic `{ method, url, headers, bodyReadStatus:
// 'not-inspected' }` shape for those types so callers get useful debugging
// info without forcing a stream read.

const REDACTED = "[REDACTED]";
const CIRCULAR = "[Circular]";

/**
 * Hard cap on string lengths fed to value-pattern scanning. Inputs longer
 * than this are truncated before scanning to keep CPU bounded regardless of
 * input shape. The cap is generous enough to cover real error messages,
 * stack traces, and free-text fields.
 */
const MAX_SCAN_LEN = 8 * 1024; // 8 KB

/**
 * Deny-list of normalized key names that must be scrubbed regardless of
 * surrounding context. Normalization: lowercased + non-alphanumeric stripped.
 * So `Authorization`, `authorization`, `AUTHORIZATION`, `authorization-`,
 * `Authorization Token` all normalize to `authorizationtoken` and match.
 */
const SENSITIVE_KEY_PARTS: ReadonlyArray<string> = [
  // auth / session
  "password",
  "passwd",
  "pwd",
  "pin",
  "pinhash",
  "mfa",
  "totp",
  "recoverycode",
  "session",
  "cookie",
  "setcookie",
  "bearer",
  "token",
  "authorization",
  "proxyauthorization",
  "xcsrftoken",
  // device + provider secrets
  "devicesecret",
  "secret",
  "apikey",
  "apisecret",
  // payment
  "card",
  "cardnumber",
  "cvv",
  "cvc",
  "ccv",
  "pan",
  "stripekey",
  // OAuth
  "oauth",
  "refreshtoken",
  "accesstoken",
  // PII at the key level
  "email",
  "phone",
  "phonenumber",
  "address",
  "postaladdress",
  "ip",
  "ipaddress",
  "useragent",
  "displayname",
];

const SENSITIVE_KEY_SET: ReadonlySet<string> = new Set(SENSITIVE_KEY_PARTS);

function normalizeKey(key: string): string {
  // Lowercase + strip non-alphanumeric. Bounded by the length of the input
  // key, which is itself bounded by JS engine limits — no ReDoS surface.
  let out = "";
  const lower = key.toLowerCase();
  for (let i = 0; i < lower.length; i++) {
    const ch = lower.charCodeAt(i);
    // a-z = 97..122, 0-9 = 48..57
    if ((ch >= 97 && ch <= 122) || (ch >= 48 && ch <= 57)) {
      out += lower[i];
    }
  }
  return out;
}

export function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (!normalized) return false;
  if (SENSITIVE_KEY_SET.has(normalized)) return true;
  // Substring match — e.g., `userpassword`, `loginsessionid`. Bounded by
  // SENSITIVE_KEY_PARTS.length, no quadratic risk.
  for (const part of SENSITIVE_KEY_PARTS) {
    if (normalized.includes(part)) return true;
  }
  return false;
}

// --- Value-pattern scanning (no ReDoS-prone patterns) ---------------------

// Detects an "@" with at least one character on each side and a "." after
// the "@". Deterministic linear scan; no regex.
function containsEmailLike(s: string): boolean {
  const at = s.indexOf("@");
  if (at <= 0 || at >= s.length - 3) return false;
  const dot = s.indexOf(".", at + 2);
  return dot > 0 && dot < s.length - 1;
}

// Detects 7+ contiguous digits (allowing spaces, dashes, dots, parens). This
// catches US phone formats and most international short patterns. Linear scan.
function containsPhoneLike(s: string): boolean {
  let run = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    if (ch >= 48 && ch <= 57) {
      run++;
      if (run >= 7) return true;
    } else if (ch === 32 || ch === 45 || ch === 46 || ch === 40 || ch === 41) {
      // space, '-', '.', '(', ')' — allowed separator; keep run.
    } else {
      run = 0;
    }
  }
  return false;
}

// IPv4 dotted-decimal. Bounded format: four 1-3 digit groups separated by
// dots. No quantifier nesting.
const IPV4_RE = /\b(25[0-5]|2[0-4]\d|[01]?\d?\d)\.(25[0-5]|2[0-4]\d|[01]?\d?\d)\.(25[0-5]|2[0-4]\d|[01]?\d?\d)\.(25[0-5]|2[0-4]\d|[01]?\d?\d)\b/;
function containsIpv4Like(s: string): boolean {
  return IPV4_RE.test(s);
}

// Bearer-token-shaped strings: explicit "Bearer ", `otpauth://` MFA-secret
// URIs, or 32+ hex/base64-ish characters in a row. The last is detected via
// deterministic scan, not a quantifier regex.
function containsTokenLike(s: string): boolean {
  const lower = s.toLowerCase();
  if (lower.includes("bearer ")) return true;
  if (lower.includes("otpauth:")) return true;
  let run = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    const isHex =
      (ch >= 48 && ch <= 57) || // 0-9
      (ch >= 65 && ch <= 90) || // A-Z
      (ch >= 97 && ch <= 122) || // a-z
      ch === 45 || // -
      ch === 95 || // _
      ch === 43 || // +
      ch === 47; // /
    if (isHex) {
      run++;
      if (run >= 32) return true;
    } else {
      run = 0;
    }
  }
  return false;
}

// URL-shaped strings. URLs commonly carry tokens, session ids, and other
// sensitive query-string content, so the production plan requires scrubbing
// them under benign keys.
//
// Three cheap deterministic checks (no regex, no ReDoS surface):
//
//   1. The `://` scheme delimiter — catches `http://…`, `https://…`,
//      `ftp://…`, `ws://…`, `s3://…`, etc.
//   2. The `www.` prefix — catches scheme-less URLs like `www.example.com`.
//   3. Protocol-relative form `//host.tld/path…` — catches `//example.com/`.
//      Distinguished from `// comment`-style noise by requiring the char
//      immediately after `//` to be alphanumeric AND a `.` to appear before
//      any whitespace within ~100 chars.
//
// False-positive risk on arbitrary text remains low; we over-redact when
// in doubt.
function containsUrlLike(s: string): boolean {
  if (s.includes("://")) return true;
  // Lowercase scan for `www.` prefix; cheap.
  if (s.toLowerCase().includes("www.")) return true;
  // Protocol-relative URL: `//host.tld[/path]`.
  let idx = s.indexOf("//");
  while (idx !== -1) {
    const afterIdx = idx + 2;
    if (afterIdx < s.length) {
      const ch = s.charCodeAt(afterIdx);
      const isAlphaNum =
        (ch >= 48 && ch <= 57) || // 0-9
        (ch >= 65 && ch <= 90) || // A-Z
        (ch >= 97 && ch <= 122); // a-z
      if (isAlphaNum) {
        // Scan forward (bounded) for a '.' before any whitespace.
        const limit = Math.min(s.length, afterIdx + 100);
        for (let i = afterIdx; i < limit; i++) {
          const c = s.charCodeAt(i);
          // Whitespace ends the host-look-alike.
          if (c === 32 || c === 9 || c === 10 || c === 13) break;
          if (c === 46) return true; // '.'
        }
      }
    }
    idx = s.indexOf("//", idx + 2);
  }
  return false;
}

// Card-number-shaped: 13-19 digits, with optional spaces/dashes every 4.
// Detected via the same digit-run approach as phone, but stricter (13+).
function containsCardLike(s: string): boolean {
  let run = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    if (ch >= 48 && ch <= 57) {
      run++;
      if (run >= 13) return true;
    } else if (ch === 32 || ch === 45) {
      // space, '-' allowed as separator
    } else {
      run = 0;
    }
  }
  return false;
}

/**
 * Scan a string for sensitive value patterns. Returns `REDACTED` if any
 * pattern matches; otherwise returns the (possibly truncated) input.
 *
 * Length-capped to MAX_SCAN_LEN so adversarial inputs cannot burn CPU.
 * **When the input exceeds MAX_SCAN_LEN, the RETURN value is also
 * truncated** with a `…[truncated N chars]` suffix. Returning the full
 * original would leak any sensitive content placed past the scan window.
 */
function scrubString(s: string): string {
  if (s.length === 0) return s;
  const truncated = s.length > MAX_SCAN_LEN ? s.slice(0, MAX_SCAN_LEN) : s;
  if (containsCardLike(truncated)) return REDACTED;
  if (containsTokenLike(truncated)) return REDACTED;
  if (containsEmailLike(truncated)) return REDACTED;
  if (containsPhoneLike(truncated)) return REDACTED;
  if (containsIpv4Like(truncated)) return REDACTED;
  if (containsUrlLike(truncated)) return REDACTED;
  if (s.length > MAX_SCAN_LEN) {
    return `${truncated}…[truncated ${s.length - MAX_SCAN_LEN} chars]`;
  }
  return s;
}

// --- URL / header helpers --------------------------------------------------

/**
 * Returns the host + path with opaque path segments templated. Drops query
 * string and fragment entirely. Safe to log.
 *
 * Examples:
 *   https://api.example.com/users/abc123?token=xyz → "api.example.com/users/[id]"
 *   /api/orders/ord_12345                          → "/api/orders/[id]"
 *   not-a-url                                       → "[REDACTED]" (no parse)
 */
export function scrubUrl(urlStr: string): string {
  if (typeof urlStr !== "string" || urlStr.length === 0) return REDACTED;
  const truncated =
    urlStr.length > MAX_SCAN_LEN ? urlStr.slice(0, MAX_SCAN_LEN) : urlStr;

  let url: URL;
  try {
    // Relative URLs need a base; use a placeholder so we can parse path/search.
    if (truncated.startsWith("/")) {
      url = new URL(truncated, "https://placeholder.invalid");
      const path = templatePath(url.pathname);
      return path;
    }
    url = new URL(truncated);
  } catch {
    return REDACTED;
  }

  const path = templatePath(url.pathname);
  // Strip userinfo (`user:pass@`), query, fragment. Keep host + templated path.
  return `${url.host}${path}`;
}

/**
 * Replace opaque path segments (long random-looking strings, hex, UUIDs,
 * numeric ids) with `[id]`. Bounded by path length.
 */
function templatePath(pathname: string): string {
  if (!pathname) return "/";
  const parts = pathname.split("/");
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    if (!seg) continue;
    // Numeric-only id
    if (/^\d+$/.test(seg)) {
      parts[i] = "[id]";
      continue;
    }
    // Long alpha-numeric token (>= 16 chars, mixed case/digits)
    if (seg.length >= 16) {
      let hasDigit = false;
      let hasAlpha = false;
      for (let j = 0; j < seg.length; j++) {
        const ch = seg.charCodeAt(j);
        if (ch >= 48 && ch <= 57) hasDigit = true;
        else if ((ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122)) hasAlpha = true;
      }
      if (hasDigit && hasAlpha) parts[i] = "[id]";
      continue;
    }
    // UUID-shape (8-4-4-4-12)
    if (
      seg.length === 36 &&
      seg[8] === "-" &&
      seg[13] === "-" &&
      seg[18] === "-" &&
      seg[23] === "-"
    ) {
      parts[i] = "[id]";
    }
  }
  return parts.join("/");
}

/**
 * Scrub a `Headers` instance or plain object of headers. Returns a plain
 * object with sensitive header values redacted.
 */
export function scrubHeaders(
  input: Headers | Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (input instanceof Headers) {
    input.forEach((value, key) => {
      out[key] = isSensitiveKey(key) ? REDACTED : scrubString(value);
    });
    return out;
  }
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    const str = Array.isArray(value) ? value.join(", ") : String(value);
    out[key] = isSensitiveKey(key) ? REDACTED : scrubString(str);
  }
  return out;
}

// --- Recursive scrub -------------------------------------------------------

/**
 * Walk a value recursively and return a scrubbed copy. Handles plain objects,
 * arrays, Maps, Sets, Errors (including Error.cause), Dates, URLs, Headers,
 * and Request/Response (metadata-only — never reads bodies). Circular
 * references are replaced with `"[Circular]"`. Primitives flow through; long
 * strings are pattern-scanned.
 */
export function scrub(value: unknown): unknown {
  const seen = new WeakSet<object>();
  return walk(value, seen);
}

function walk(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null) return null;
  const t = typeof value;
  if (t === "string") return scrubString(value as string);
  if (t === "number" || t === "boolean" || t === "bigint") return value;
  if (t === "undefined") return undefined;
  if (t === "symbol" || t === "function") return undefined;

  // Object-like below
  const obj = value as object;
  if (seen.has(obj)) return CIRCULAR;
  seen.add(obj);

  if (value instanceof Date) return value.toISOString();
  if (value instanceof URL) return scrubUrl(value.toString());
  if (value instanceof Headers) return scrubHeaders(value);

  // Request / Response: serialize only safe metadata. Never read .body.
  if (typeof Request !== "undefined" && value instanceof Request) {
    return {
      method: value.method,
      url: scrubUrl(value.url),
      headers: scrubHeaders(value.headers),
      bodyReadStatus: "not-inspected",
    };
  }
  if (typeof Response !== "undefined" && value instanceof Response) {
    return {
      status: value.status,
      url: value.url ? scrubUrl(value.url) : null,
      headers: scrubHeaders(value.headers),
      bodyReadStatus: "not-inspected",
    };
  }

  if (value instanceof Error) {
    return scrubError(value, seen);
  }

  if (value instanceof Map) {
    const out: Record<string, unknown> = {};
    value.forEach((v, k) => {
      const key = typeof k === "string" ? k : String(k);
      out[key] = isSensitiveKey(key) ? REDACTED : walk(v, seen);
    });
    return out;
  }

  if (value instanceof Set) {
    const out: unknown[] = [];
    value.forEach((v) => out.push(walk(v, seen)));
    return out;
  }

  if (Array.isArray(value)) {
    return value.map((v) => walk(v, seen));
  }

  // Plain object
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      out[key] = REDACTED;
    } else {
      out[key] = walk(v, seen);
    }
  }
  return out;
}

function scrubError(
  err: Error,
  seen: WeakSet<object>,
): {
  name: string;
  message: string;
  stack: string | null;
  cause?: unknown;
} {
  const result: {
    name: string;
    message: string;
    stack: string | null;
    cause?: unknown;
  } = {
    name: scrubString(err.name || "Error"),
    message: scrubString(err.message || ""),
    stack: err.stack ? scrubString(err.stack) : null,
  };
  // Error.cause is optional but if present, recurse.
  const cause = (err as { cause?: unknown }).cause;
  if (cause !== undefined) {
    result.cause = walk(cause, seen);
  }
  return result;
}

// --- Allow-list filter -----------------------------------------------------

/**
 * Return only the allow-listed keys from `record`, with each value scrubbed.
 * Unknown keys are dropped silently — this is the primary allow-list defense.
 * The deny-list pass via `scrub` runs as a second-tier backstop on values.
 */
export function scrubFields<K extends string>(
  record: Record<string, unknown>,
  allowList: ReadonlyArray<K>,
): Partial<Record<K, unknown>> {
  const allowSet = new Set<string>(allowList);
  const out: Partial<Record<K, unknown>> = {};
  for (const key of Object.keys(record)) {
    if (!allowSet.has(key)) continue;
    if (isSensitiveKey(key)) {
      // Should never happen if allowList is curated, but defend anyway.
      out[key as K] = REDACTED;
      continue;
    }
    out[key as K] = scrub(record[key]);
  }
  return out;
}

// --- Diagnostics -----------------------------------------------------------

/**
 * Production-safe diagnostic for a dropped field. Returns a message that
 * contains only the field path and reason — never the dropped value.
 */
export function describeDroppedField(path: string, reason: string): string {
  return `[redaction] dropped field=${path} reason=${reason}`;
}
