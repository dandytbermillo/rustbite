import argon2 from "argon2";

export const ADMIN_PASSWORD_MIN_LENGTH = 14;
export const ADMIN_PASSWORD_MAX_LENGTH = 128;

const SENTINEL_PASSWORD = "rushbite-sentinel-password-not-used-for-login";
let sentinelHashPromise: Promise<string> | null = null;

export function validateAdminPasswordPolicy(password: string):
  | { ok: true }
  | { ok: false; error: string } {
  if (password.length < ADMIN_PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      error: `Password must be at least ${ADMIN_PASSWORD_MIN_LENGTH} characters.`,
    };
  }
  if (password.length > ADMIN_PASSWORD_MAX_LENGTH) {
    return {
      ok: false,
      error: `Password must be ${ADMIN_PASSWORD_MAX_LENGTH} characters or fewer.`,
    };
  }
  return { ok: true };
}

export async function hashAdminPassword(password: string): Promise<string> {
  const policy = validateAdminPasswordPolicy(password);
  if (!policy.ok) throw new Error(policy.error);

  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyAdminPassword(
  passwordHash: string,
  password: string
): Promise<boolean> {
  try {
    return await argon2.verify(passwordHash, password);
  } catch {
    return false;
  }
}

export async function verifySentinelAdminPassword(password: string): Promise<void> {
  sentinelHashPromise ??= hashAdminPassword(SENTINEL_PASSWORD);
  await verifyAdminPassword(await sentinelHashPromise, password);
}
