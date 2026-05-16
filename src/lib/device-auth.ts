import type { NextRequest } from "next/server";

export type DeviceRole = "kiosk" | "kitchen" | "board" | "counter";

export const DEVICE_SESSION_COOKIE = "rb_device_session";
const DEVICE_DB_SESSION_PREFIX = "db";
const DEVICE_LEGACY_SESSION_PREFIX = "legacy";

const DEVICE_ROLE_LABELS: Record<DeviceRole, string> = {
  kiosk: "Kiosk",
  kitchen: "Kitchen Display",
  board: "Order Board",
  counter: "Counter",
};

type CookieReader = {
  get(name: string): { value: string } | undefined;
};

export function isDeviceRole(value: string | null | undefined): value is DeviceRole {
  return (
    value === "kiosk" ||
    value === "kitchen" ||
    value === "board" ||
    value === "counter"
  );
}

export function getDeviceRoleLabel(role: DeviceRole): string {
  return DEVICE_ROLE_LABELS[role];
}

export function buildDatabaseDeviceSessionValue(
  role: DeviceRole,
  token: string
): string {
  return `${DEVICE_DB_SESSION_PREFIX}:${role}:${token}`;
}

export function buildLegacyDeviceSessionValue(
  role: DeviceRole,
  secret: string
): string {
  return `${DEVICE_LEGACY_SESSION_PREFIX}:${role}:${secret}`;
}

export function getClaimedDeviceRoleFromCookieReader(
  cookieReader: CookieReader
): DeviceRole | null {
  return parseClaimedDeviceSessionRole(
    cookieReader.get(DEVICE_SESSION_COOKIE)?.value
  );
}

export function getClaimedDeviceRoleFromRequest(
  req: Pick<NextRequest, "cookies">
): DeviceRole | null {
  return getClaimedDeviceRoleFromCookieReader(req.cookies);
}

export function getDatabaseDeviceSessionToken(
  value: string | null | undefined
): { role: DeviceRole; token: string } | null {
  if (!value?.startsWith(`${DEVICE_DB_SESSION_PREFIX}:`)) return null;

  const [, rawRole, ...rest] = value.split(":");
  if (!isDeviceRole(rawRole)) return null;
  const token = rest.join(":");
  if (!token) return null;
  return { role: rawRole, token };
}

export function getLegacyDeviceSessionSecret(
  value: string | null | undefined
): { role: DeviceRole; secret: string } | null {
  if (!value) return null;

  if (value.startsWith(`${DEVICE_DB_SESSION_PREFIX}:`)) {
    return null;
  }

  if (value.startsWith(`${DEVICE_LEGACY_SESSION_PREFIX}:`)) {
    const [, rawRole, ...rest] = value.split(":");
    if (!isDeviceRole(rawRole)) return null;
    const secret = rest.join(":");
    if (!secret) return null;
    return { role: rawRole, secret };
  }

  const [rawRole, ...rest] = value.split(":");
  if (!isDeviceRole(rawRole)) return null;
  const secret = rest.join(":");
  if (!secret) return null;
  return { role: rawRole, secret };
}

export function hasAuthorizedDeviceSession(
  req: Pick<NextRequest, "cookies">,
  roles: DeviceRole[]
): boolean {
  const role = getClaimedDeviceRoleFromRequest(req);
  return role != null && roles.includes(role);
}

export function hasDeviceSessionCookie(
  req: Pick<NextRequest, "cookies">
): boolean {
  return Boolean(req.cookies.get(DEVICE_SESSION_COOKIE)?.value);
}

export function inferDeviceRoleFromPath(
  pathname: string | null | undefined
): DeviceRole | null {
  if (!pathname) return null;
  if (pathname.startsWith("/kiosk")) return "kiosk";
  if (pathname.startsWith("/kitchen")) return "kitchen";
  if (pathname.startsWith("/board")) return "board";
  if (pathname.startsWith("/counter")) return "counter";
  return null;
}

export function normalizeNextPath(
  value: string | null | undefined,
  fallback = "/"
): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }
  return value;
}

function parseClaimedDeviceSessionRole(
  value: string | null | undefined
): DeviceRole | null {
  return (
    getDatabaseDeviceSessionToken(value)?.role ??
    getLegacyDeviceSessionSecret(value)?.role ??
    null
  );
}
