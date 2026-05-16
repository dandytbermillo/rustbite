import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";

const PASSWORD_RESET_SECRET_ENV = "ADMIN_PASSWORD_RESET_TOKEN_SECRET";
export const ADMIN_PASSWORD_RESET_TOKEN_MS = 30 * 60 * 1000;

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

function resetTokenKey(): Buffer {
  const configured =
    process.env[PASSWORD_RESET_SECRET_ENV]?.trim() ||
    process.env.LOGIN_RATE_LIMIT_SECRET?.trim() ||
    process.env.OWNER_CHANGE_CANCEL_TOKEN_SECRET?.trim() ||
    process.env.ADMIN_MFA_SECRET_ENCRYPTION_KEY?.trim() ||
    "";
  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(`${PASSWORD_RESET_SECRET_ENV} is required in production.`);
    }
    return createHash("sha256")
      .update("rushbite-dev-admin-password-reset-token-secret", "utf8")
      .digest();
  }
  if (/^[a-f0-9]{64}$/i.test(configured)) return Buffer.from(configured, "hex");
  const decoded = Buffer.from(configured, "base64");
  if (decoded.length === 32) return decoded;
  return createHash("sha256").update(configured, "utf8").digest();
}

export function createAdminPasswordResetToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashAdminPasswordResetToken(token: string): string {
  return createHmac("sha256", resetTokenKey())
    .update("rushbite-admin-password-reset-token:v1:", "utf8")
    .update(token.trim(), "utf8")
    .digest("hex");
}

export function encryptAdminPasswordResetSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", resetTokenKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${base64Url(iv)}:${base64Url(tag)}:${base64Url(ciphertext)}`;
}

export function decryptAdminPasswordResetSecret(value: string): string {
  const [version, ivRaw, tagRaw, ciphertextRaw] = value.split(":");
  if (version !== "v1" || !ivRaw || !tagRaw || !ciphertextRaw) {
    throw new Error("Password reset secret is invalid.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    resetTokenKey(),
    fromBase64Url(ivRaw)
  );
  decipher.setAuthTag(fromBase64Url(tagRaw));
  return Buffer.concat([
    decipher.update(fromBase64Url(ciphertextRaw)),
    decipher.final(),
  ]).toString("utf8");
}

export function adminPasswordResetBaseUrl() {
  return (
    process.env.ADMIN_PUBLIC_BASE_URL?.trim().replace(/\/+$/, "") ||
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") ||
    "http://localhost:3000"
  );
}
