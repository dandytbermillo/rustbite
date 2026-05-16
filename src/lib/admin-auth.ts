import {
  compareSecretBytes,
  decodeBasicAuthPasswordBytes,
} from "./secret-compare";

type HeaderSource = {
  headers: {
    get(name: string): string | null;
  };
};

const DEV_ADMIN_PASSWORD = "change-me-in-prod";

function getConfiguredAdminPassword(): string | null {
  if (process.env.ADMIN_PASSWORD !== undefined) {
    return process.env.ADMIN_PASSWORD;
  }

  return process.env.NODE_ENV === "production" ? null : DEV_ADMIN_PASSWORD;
}

function isRejectedProductionAdminPassword(password: string | null): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  const normalized = (password ?? "").trim().toLowerCase();
  return normalized.length === 0 || normalized === DEV_ADMIN_PASSWORD;
}

export async function isValidAdminAuthorizationHeader(
  header: string | null | undefined
): Promise<boolean> {
  const expected = getConfiguredAdminPassword();
  if (isRejectedProductionAdminPassword(expected)) return false;
  if (!expected || expected.length === 0) return false;

  const providedPasswordBytes = decodeBasicAuthPasswordBytes(header);
  if (!providedPasswordBytes) return false;

  return compareSecretBytes(providedPasswordBytes, expected);
}

export async function hasValidAdminAuth(req: HeaderSource): Promise<boolean> {
  return isValidAdminAuthorizationHeader(req.headers.get("authorization"));
}
