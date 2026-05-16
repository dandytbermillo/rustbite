import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const ADMIN_SESSION_COOKIE = "rb_admin_session";
export const ADMIN_SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;
export const ADMIN_MFA_ENROLLMENT_SESSION_MS = 60 * 60 * 1000;
export const ADMIN_SESSION_IDLE_MS = 30 * 60 * 1000;
export const DEVICE_SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE_SAFETY_MARGIN_SECONDS = 60;
export const LAST_SEEN_THROTTLE_MS = 30 * 1000;
const ADMIN_ALLOWED_ORIGINS_ENV = "ADMIN_ALLOWED_ORIGINS";

export type AdminSiteRole = "OWNER" | "ADMIN";
export type AdminAccountType = "OWNER" | "ADMIN" | "STAFF";
export type AdminOutletRole = "MANAGER" | "OPERATOR" | "VIEWER";
export type AdminPermission =
  | "admin.dashboard.read"
  | "admin.dashboard.revenue.read"
  | "admin.devices.read"
  | "admin.menu.read"
  | "admin.menu.write"
  | "admin.menu.restore"
  | "admin.dealHistory.read"
  | "admin.orders.read"
  | "admin.orders.updateStatus"
  | "admin.orders.refund"
  | "admin.settings.read"
  | "admin.settings.write"
  | "admin.failover.read"
  | "admin.failover.switch"
  | "admin.auth.users.manage"
  | "admin.auth.devices.manage";

const OWNER_PERMISSIONS: ReadonlySet<AdminPermission> = new Set([
  "admin.dashboard.read",
  "admin.dashboard.revenue.read",
  "admin.devices.read",
  "admin.menu.read",
  "admin.menu.write",
  "admin.menu.restore",
  "admin.dealHistory.read",
  "admin.orders.read",
  "admin.orders.updateStatus",
  "admin.orders.refund",
  "admin.settings.read",
  "admin.settings.write",
  "admin.failover.read",
  "admin.failover.switch",
  "admin.auth.users.manage",
  "admin.auth.devices.manage",
]);

const ADMIN_PERMISSIONS: ReadonlySet<AdminPermission> = new Set([
  "admin.dashboard.read",
  "admin.dashboard.revenue.read",
  "admin.devices.read",
  "admin.menu.read",
  "admin.menu.write",
  "admin.menu.restore",
  "admin.dealHistory.read",
  "admin.orders.read",
  "admin.orders.updateStatus",
  "admin.orders.refund",
  "admin.settings.read",
  "admin.settings.write",
  "admin.failover.read",
  "admin.auth.users.manage",
  "admin.auth.devices.manage",
]);

const OUTLET_ROLE_PERMISSIONS: Record<
  AdminOutletRole,
  ReadonlySet<AdminPermission>
> = {
  MANAGER: new Set([
    "admin.dashboard.read",
    "admin.dashboard.revenue.read",
    "admin.devices.read",
    "admin.menu.read",
    "admin.menu.write",
    "admin.menu.restore",
    "admin.dealHistory.read",
    "admin.orders.read",
    "admin.orders.updateStatus",
    "admin.settings.read",
    "admin.settings.write",
  ]),
  OPERATOR: new Set([
    "admin.dashboard.read",
    "admin.orders.read",
    "admin.orders.updateStatus",
  ]),
  VIEWER: new Set([
    "admin.dashboard.read",
    "admin.menu.read",
    "admin.dealHistory.read",
    "admin.orders.read",
    "admin.settings.read",
    "admin.failover.read",
  ]),
};

export function normalizeAdminEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function constantTimeEqualText(a: string, b: string): boolean {
  const aBytes = Buffer.from(a);
  const bBytes = Buffer.from(b);
  if (aBytes.length !== bBytes.length) return false;
  return timingSafeEqual(aBytes, bBytes);
}

export function shouldTouchLastSeen(
  previous: Date | null | undefined,
  now = new Date()
): boolean {
  if (!previous) return true;
  return now.getTime() - previous.getTime() > LAST_SEEN_THROTTLE_MS;
}

export function computeAdminSessionExpiry(now = new Date()): Date {
  return new Date(now.getTime() + ADMIN_SESSION_ABSOLUTE_MS);
}

export function computeAdminMfaEnrollmentSessionExpiry(now = new Date()): Date {
  return new Date(now.getTime() + ADMIN_MFA_ENROLLMENT_SESSION_MS);
}

export function computeDeviceSessionExpiry(now = new Date()): Date {
  return new Date(now.getTime() + DEVICE_SESSION_ABSOLUTE_MS);
}

export function cookieMaxAgeSeconds(expiresAt: Date, now = new Date()): number {
  const rawSeconds = Math.floor((expiresAt.getTime() - now.getTime()) / 1000);
  return Math.max(0, rawSeconds - SESSION_COOKIE_SAFETY_MARGIN_SECONDS);
}

export function isSiteOwner(siteRole: string | null | undefined): boolean {
  return siteRole === "OWNER";
}

export function isSiteAdmin(siteRole: string | null | undefined): boolean {
  return siteRole === "ADMIN";
}

export function roleHasPermission(
  role: AdminOutletRole | string | null | undefined,
  permission: AdminPermission
): boolean {
  const normalizedRole = role === "STAFF" ? "OPERATOR" : role;
  if (
    normalizedRole !== "MANAGER" &&
    normalizedRole !== "OPERATOR" &&
    normalizedRole !== "VIEWER"
  ) {
    return false;
  }
  return OUTLET_ROLE_PERMISSIONS[normalizedRole].has(permission);
}

export function ownerHasPermission(permission: AdminPermission): boolean {
  return OWNER_PERMISSIONS.has(permission);
}

export function adminHasPermission(permission: AdminPermission): boolean {
  return ADMIN_PERMISSIONS.has(permission);
}

export function requireSameOriginMutation(req: NextRequest): NextResponse | null {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return null;
  }

  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  const allowedOrigins = getAllowedAdminOrigins(req);
  const actualOrigin = origin ?? (referer ? safeOriginFromUrl(referer) : null);

  if (actualOrigin && allowedOrigins.has(actualOrigin)) return null;

  return NextResponse.json(
    { error: "Invalid request origin", errorCode: "invalid_origin" },
    { status: 403 }
  );
}

export function getAllowedAdminOrigins(req: NextRequest): ReadonlySet<string> {
  const configuredOrigins = parseAllowedOrigins(
    process.env[ADMIN_ALLOWED_ORIGINS_ENV]
  );
  if (configuredOrigins.size > 0) return configuredOrigins;

  // Development fallback. Production should set ADMIN_ALLOWED_ORIGINS so proxy
  // and public-host mismatches cannot accidentally trust a spoofed Host header.
  const requestUrl = new URL(req.url);
  const origins = new Set([requestUrl.origin]);
  const port = requestUrl.port ? `:${requestUrl.port}` : "";
  if (requestUrl.hostname === "localhost") {
    origins.add(`${requestUrl.protocol}//127.0.0.1${port}`);
  } else if (requestUrl.hostname === "127.0.0.1") {
    origins.add(`${requestUrl.protocol}//localhost${port}`);
  }
  return origins;
}

function parseAllowedOrigins(value: string | null | undefined): Set<string> {
  const origins = new Set<string>();
  for (const rawOrigin of value?.split(",") ?? []) {
    const origin = normalizeOrigin(rawOrigin);
    if (origin) origins.add(origin);
  }
  return origins;
}

function normalizeOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

function safeOriginFromUrl(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}
