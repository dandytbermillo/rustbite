import "server-only";
import { createHash, createHmac, randomInt } from "node:crypto";
import argon2 from "argon2";

// Operational PIN — used by counter/kitchen Active Operator switching.
// Separate from the admin password and from MFA recovery codes:
//   - own pepper env (`OPERATIONAL_PIN_PEPPER`)
//   - own HMAC label
//   - own sentinel value
// Phase 3 will wire this into order-action enforcement; Phase 1 only ships
// the parse / hash / verify primitives and the API that uses them.
//
// Pepper rotation note: rotating `OPERATIONAL_PIN_PEPPER` invalidates every
// stored `AdminUser.operationalPinHash`. The runbook is to clear those rows
// and force fresh PIN setup. There is no automatic re-keying.

const OPERATIONAL_PIN_PEPPER_ENV = "OPERATIONAL_PIN_PEPPER";
const HMAC_LABEL = "rushbite-operational-pin:v1:";
const SENTINEL_PIN = "rushbite-operational-pin-sentinel-not-used-for-auth";

export const OPERATIONAL_PIN_MIN_LENGTH = 6;
export const OPERATIONAL_PIN_MAX_LENGTH = 8;

// Weak-PIN block-list. Hardcoded; do not research at implementation time.
// 4-digit entries are matched as substrings against the (6-8 digit) input
// so e.g. "1234" rejects "123456", "012345", "001234". 6/7/8-digit entries
// match against the full PIN exactly.
const WEAK_PIN_BLOCKLIST_4: ReadonlySet<string> = new Set([
  "0000", "1111", "2222", "3333", "4444",
  "5555", "6666", "7777", "8888", "9999",
  "1234", "2345", "3456", "4567", "5678", "6789",
  "4321", "5432", "6543", "7654", "8765", "9876",
  "1212", "1313", "1414", "2121", "2323", "2525",
  "6969", "7878", "9090",
  "1004", "2000", "2001", "2580", "1379", "1397",
  "0123", "0007", "0852",
]);

const WEAK_PIN_BLOCKLIST_EXACT: ReadonlySet<string> = new Set([
  // 6-digit common patterns from frequency studies
  "123456", "234567", "345678", "456789",
  "654321", "765432", "876543", "987654",
  "111111", "000000", "222222", "333333", "444444",
  "555555", "666666", "777777", "888888", "999999",
  "121212", "123123", "456456", "112233",
  "696969", "159753", "147258", "101010", "313131",
  // 7-digit
  "1234567", "7654321", "1111111", "0000000",
  // 8-digit
  "12345678", "87654321", "11111111", "00000000",
]);

function getOperationalPinPepper(): Buffer {
  const configured = process.env[OPERATIONAL_PIN_PEPPER_ENV]?.trim();
  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(`${OPERATIONAL_PIN_PEPPER_ENV} is required in production.`);
    }
    // Dev-only deterministic fallback. Different label than the MFA dev
    // fallback so a leaked dev MFA key cannot accidentally unlock dev PINs.
    return createHash("sha256")
      .update("rushbite-dev-operational-pin-pepper", "utf8")
      .digest();
  }
  if (/^[a-f0-9]{64}$/i.test(configured)) {
    return Buffer.from(configured, "hex");
  }
  const decoded = Buffer.from(configured, "base64");
  if (decoded.length === 32) return decoded;
  return createHash("sha256").update(configured, "utf8").digest();
}

export type ParseOperationalPinResult =
  | { ok: true; pin: string }
  | { ok: false; reason: "format" | "length" | "weak" };

export function parseOperationalPin(input: unknown): ParseOperationalPinResult {
  if (typeof input !== "string") {
    return { ok: false, reason: "format" };
  }
  if (!/^\d+$/.test(input)) {
    return { ok: false, reason: "format" };
  }
  if (
    input.length < OPERATIONAL_PIN_MIN_LENGTH ||
    input.length > OPERATIONAL_PIN_MAX_LENGTH
  ) {
    return { ok: false, reason: "length" };
  }
  if (isWeakPin(input)) {
    return { ok: false, reason: "weak" };
  }
  return { ok: true, pin: input };
}

function isWeakPin(pin: string): boolean {
  if (WEAK_PIN_BLOCKLIST_EXACT.has(pin)) return true;

  // 4-digit blocklist substring match
  for (let start = 0; start + 4 <= pin.length; start += 1) {
    if (WEAK_PIN_BLOCKLIST_4.has(pin.slice(start, start + 4))) return true;
  }

  // All same digit
  if (/^(\d)\1+$/.test(pin)) return true;

  // Strictly ascending / descending across the full PIN
  if (isStrictlyAscending(pin) || isStrictlyDescending(pin)) return true;

  // Two-digit alternation (ABAB...) across the full PIN
  if (pin.length >= 4 && isTwoDigitAlternation(pin)) return true;

  return false;
}

function isStrictlyAscending(pin: string): boolean {
  for (let i = 1; i < pin.length; i += 1) {
    if (pin.charCodeAt(i) - pin.charCodeAt(i - 1) !== 1) return false;
  }
  return true;
}

function isStrictlyDescending(pin: string): boolean {
  for (let i = 1; i < pin.length; i += 1) {
    if (pin.charCodeAt(i - 1) - pin.charCodeAt(i) !== 1) return false;
  }
  return true;
}

function isTwoDigitAlternation(pin: string): boolean {
  if (pin[0] === pin[1]) return false;
  for (let i = 2; i < pin.length; i += 1) {
    if (pin[i] !== pin[i - 2]) return false;
  }
  return true;
}

/**
 * Generate a fresh 6-digit PIN that passes `parseOperationalPin`. Used by
 * the Owner-driven PIN reset endpoint when the Owner does NOT supply a
 * manual PIN — the generated PIN is shown ONCE in the response and never
 * returned again.
 */
export function generateOperationalPin(): string {
  // Loop until we land on a value that passes the policy. With 6 digits
  // (10^6 = 1,000,000 candidates) and a relatively small block-list, this
  // converges in 1-2 attempts in practice.
  for (let attempt = 0; attempt < 64; attempt += 1) {
    let pin = "";
    for (let i = 0; i < 6; i += 1) {
      pin += String(randomInt(0, 10));
    }
    if (parseOperationalPin(pin).ok) return pin;
  }
  // This is statistically impossible (block-list rejects ≪0.01% of the
  // 10^6 space). Throw to flag a misconfigured block-list rather than
  // returning a weak fallback.
  throw new Error("Could not generate a non-weak operational PIN after 64 attempts");
}

function applyPepper(pin: string): Buffer {
  return createHmac("sha256", getOperationalPinPepper())
    .update(HMAC_LABEL, "utf8")
    .update(pin, "utf8")
    .digest();
}

export async function hashOperationalPin(pin: string): Promise<string> {
  const parsed = parseOperationalPin(pin);
  if (!parsed.ok) {
    throw new Error(`Operational PIN rejected: ${parsed.reason}`);
  }
  const peppered = applyPepper(parsed.pin);
  return argon2.hash(peppered, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

let sentinelHashPromise: Promise<string> | null = null;

function getSentinelHashPromise(): Promise<string> {
  if (!sentinelHashPromise) {
    const peppered = applyPepper(SENTINEL_PIN);
    sentinelHashPromise = argon2.hash(peppered, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
  }
  return sentinelHashPromise;
}

/**
 * Verify an operational PIN against a stored hash.
 *
 * If `storedHash` is null/empty, this still runs an argon2 verify against
 * a precomputed sentinel hash so the response time is constant regardless
 * of whether the user exists or has a PIN configured. This prevents the
 * Switch operator endpoint from leaking user-existence via timing.
 */
export async function verifyOperationalPin(
  storedHash: string | null | undefined,
  pin: string
): Promise<boolean> {
  // We deliberately do NOT short-circuit on weak/invalid PIN format here —
  // the API layer parses input first, and the sentinel branch catches the
  // "no hash" case. If a malformed PIN reaches this function we still run
  // a verify so timing is the same as the happy path.
  const peppered = applyPepperSafe(pin);

  if (!storedHash) {
    try {
      await argon2.verify(await getSentinelHashPromise(), peppered);
    } catch {
      // sentinel verify never matches — swallow any error
    }
    return false;
  }

  try {
    return await argon2.verify(storedHash, peppered);
  } catch {
    return false;
  }
}

/**
 * Apply pepper without throwing on bad input — verify must always run a
 * full argon2 cycle so the request timing carries no signal about input
 * shape. If the input is not a string we substitute a fixed placeholder so
 * the HMAC step still completes.
 */
function applyPepperSafe(pin: unknown): Buffer {
  const value = typeof pin === "string" ? pin : "";
  return createHmac("sha256", getOperationalPinPepper())
    .update(HMAC_LABEL, "utf8")
    .update(value, "utf8")
    .digest();
}
