import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const MFA_ENCRYPTION_ENV = "ADMIN_MFA_SECRET_ENCRYPTION_KEY";
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const RECOVERY_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_CHARS = 12;

function base64Url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function fromBase64Url(value: string): Buffer {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  return Buffer.from(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="), "base64");
}

function getEncryptionKey(): Buffer {
  const configured = process.env[MFA_ENCRYPTION_ENV]?.trim();
  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(`${MFA_ENCRYPTION_ENV} is required in production.`);
    }
    return createHash("sha256")
      .update("rushbite-dev-mfa-secret-encryption-key", "utf8")
      .digest();
  }

  if (/^[a-f0-9]{64}$/i.test(configured)) {
    return Buffer.from(configured, "hex");
  }

  const decoded = Buffer.from(configured, "base64");
  if (decoded.length === 32) return decoded;

  return createHash("sha256").update(configured, "utf8").digest();
}

export function encryptMfaSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1:${base64Url(iv)}:${base64Url(tag)}:${base64Url(ciphertext)}`;
}

export function decryptMfaSecret(ciphertext: string): string {
  const [version, ivRaw, tagRaw, valueRaw] = ciphertext.split(":");
  if (version !== "v1" || !ivRaw || !tagRaw || !valueRaw) {
    throw new Error("MFA secret ciphertext is invalid.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    fromBase64Url(ivRaw)
  );
  decipher.setAuthTag(fromBase64Url(tagRaw));
  return Buffer.concat([
    decipher.update(fromBase64Url(valueRaw)),
    decipher.final(),
  ]).toString("utf8");
}

export function generateTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

export function generateMfaRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    let raw = "";
    for (let index = 0; index < RECOVERY_CODE_CHARS; index += 1) {
      raw += RECOVERY_CODE_ALPHABET[randomBytes(1)[0]! % RECOVERY_CODE_ALPHABET.length];
    }
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  });
}

export function normalizeMfaRecoveryCode(code: string): string {
  return code.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
}

export function hashMfaRecoveryCode(code: string): string {
  const normalized = normalizeMfaRecoveryCode(code);
  if (normalized.length !== RECOVERY_CODE_CHARS) return "";
  return createHmac("sha256", getEncryptionKey())
    .update("rushbite-admin-mfa-recovery-code:v1:", "utf8")
    .update(normalized, "utf8")
    .digest("hex");
}

function encodeBase32(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function decodeBase32(secret: string): Buffer {
  const normalized = secret.toUpperCase().replaceAll(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error("TOTP secret is invalid.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

function hotp(secret: string, counter: number): string {
  const key = decodeBase32(secret);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

export function generateTotpCode(secret: string, now = new Date()): string {
  return hotp(secret, Math.floor(now.getTime() / 1000 / TOTP_PERIOD_SECONDS));
}

export function verifyTotpCode(
  secret: string,
  code: string,
  now = new Date()
): boolean {
  const normalized = code.replaceAll(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) return false;

  const counter = Math.floor(now.getTime() / 1000 / TOTP_PERIOD_SECONDS);
  for (const drift of [-1, 0, 1]) {
    const expected = hotp(secret, counter + drift);
    if (
      timingSafeEqual(
        Buffer.from(expected, "utf8"),
        Buffer.from(normalized, "utf8")
      )
    ) {
      return true;
    }
  }
  return false;
}

export function buildTotpUri(input: {
  issuer: string;
  accountName: string;
  secret: string;
}): string {
  const label = `${input.issuer}:${input.accountName}`;
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

export function isOwnerOrAdminAccount(accountType: string | null | undefined): boolean {
  return accountType === "OWNER" || accountType === "ADMIN";
}
