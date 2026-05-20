import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  isSyntheticRow,
  syntheticExcludeWhere,
} from "@/lib/observability/synthetic-fixtures";
import {
  buildDatabaseDeviceSessionValue,
  buildLegacyDeviceSessionValue,
  DEVICE_SESSION_COOKIE,
  getDatabaseDeviceSessionToken,
  getLegacyDeviceSessionSecret,
  getDeviceRoleLabel,
  isDeviceRole,
  type DeviceRole,
} from "@/lib/device-auth";
import {
  getLoginIpHash,
} from "@/lib/login-rate-limit";
import {
  cookieMaxAgeSeconds,
  computeDeviceSessionExpiry,
  createSessionToken,
  hashSessionToken,
  shouldTouchLastSeen,
} from "@/lib/production-auth";
import { DEFAULT_OUTLET_ID } from "@/lib/outlets";
import {
  verifyAdminPassword,
  verifySentinelAdminPassword,
} from "@/lib/admin-passwords";
import { compareSecretText } from "@/lib/secret-compare";

const DEV_DEFAULT_KEYS: Record<DeviceRole, string> =
  process.env.NODE_ENV === "production"
    ? { kiosk: "", kitchen: "", board: "", counter: "" }
    : {
        kiosk: "local-kiosk-key",
        kitchen: "local-kitchen-key",
        board: "local-board-key",
        counter: "local-counter-key",
      };

type CookieReader = {
  get(name: string): { value: string } | undefined;
};

type DeviceSessionResolveOptions = {
  touchLastSeen?: boolean;
};

export type DeviceSessionActor = {
  sessionId: string | null;
  deviceId: string | null;
  name: string;
  role: DeviceRole;
  outletId: string | null;
  isSharedAcrossOutlets: boolean;
  allowedOutletIds: string[];
  isLegacy: boolean;
  // Phase 1 (counter/kitchen active operator): all nullable until an
  // operator is signed in via /api/device-session/staff/switch.
  activeOutletId: string | null;
  activeStaffUserId: string | null;
  activeStaffDisplayName: string | null;
  activeStaffAccountType: string | null;
  activeStaffOutletId: string | null;
  activeStaffRole: string | null;
  activeStaffVerifiedAt: Date | null;
  activeStaffLastActionAt: Date | null;
};

export function isLegacyDeviceAuthEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.ALLOW_LEGACY_DEVICE_AUTH === "1"
  );
}

export function setDeviceSessionCookie(
  response: NextResponse,
  role: DeviceRole,
  token: string,
  expiresAt: Date
) {
  response.cookies.set({
    name: DEVICE_SESSION_COOKIE,
    value: buildDatabaseDeviceSessionValue(role, token),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: cookieMaxAgeSeconds(expiresAt),
  });
}

export function setLegacyDeviceSessionCookie(
  response: NextResponse,
  role: DeviceRole
) {
  response.cookies.set({
    name: DEVICE_SESSION_COOKIE,
    value: buildLegacyDeviceSessionValue(role, getLegacyDeviceAccessKey(role)),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

export function clearDeviceSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: DEVICE_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}

export async function revokeDeviceSessionToken(
  rawCookieValue: string | null | undefined
) {
  const token = getDatabaseDeviceSessionToken(rawCookieValue)?.token;
  if (!token) return;
  await prisma.deviceSession.updateMany({
    where: {
      tokenHash: hashSessionToken(token),
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
}

export async function createDeviceSession(
  deviceId: string,
  req: NextRequest
): Promise<{ token: string; expiresAt: Date }> {
  const token = createSessionToken();
  const expiresAt = computeDeviceSessionExpiry();
  const now = new Date();

  await prisma.$transaction([
    prisma.deviceSession.create({
      data: {
        deviceId,
        tokenHash: hashSessionToken(token),
        expiresAt,
        userAgent: req.headers.get("user-agent") ?? null,
        ipHash: getLoginIpHash(req),
      },
    }),
    prisma.device.update({
      where: { id: deviceId },
      data: {
        lastSeenAt: now,
        lastUserAgent: req.headers.get("user-agent") ?? null,
        lastIpHash: getLoginIpHash(req),
      },
    }),
  ]);

  return { token, expiresAt };
}

export async function getDeviceSessionFromCookieReader(
  cookieReader: CookieReader,
  req?: NextRequest,
  options: DeviceSessionResolveOptions = {},
): Promise<DeviceSessionActor | null> {
  const raw = cookieReader.get(DEVICE_SESSION_COOKIE)?.value;
  if (!raw) return null;

  const dbToken = getDatabaseDeviceSessionToken(raw);
  if (dbToken) {
    return getDatabaseDeviceSessionActor(dbToken.token, req, options);
  }

  if (!isLegacyDeviceAuthEnabled()) return null;

  const legacy = getLegacyDeviceSessionSecret(raw);
  if (!legacy) return null;

  const expected = getLegacyDeviceAccessKey(legacy.role);
  if (!expected) return null;
  const isValid = await compareSecretText(legacy.secret, expected);
  if (!isValid) return null;

  return {
    sessionId: null,
    deviceId: null,
    name: `Legacy ${getDeviceRoleLabel(legacy.role)}`,
    role: legacy.role,
    outletId: DEFAULT_OUTLET_ID,
    isSharedAcrossOutlets: false,
    allowedOutletIds: [DEFAULT_OUTLET_ID],
    isLegacy: true,
    activeOutletId: null,
    activeStaffUserId: null,
    activeStaffDisplayName: null,
    activeStaffAccountType: null,
    activeStaffOutletId: null,
    activeStaffRole: null,
    activeStaffVerifiedAt: null,
    activeStaffLastActionAt: null,
  };
}

export async function getDeviceSessionFromRequest(
  req: NextRequest,
  options: DeviceSessionResolveOptions = {},
): Promise<DeviceSessionActor | null> {
  return getDeviceSessionFromCookieReader(req.cookies, req, options);
}

export async function authenticateDatabaseDevice(
  role: DeviceRole,
  password: string | null | undefined
): Promise<
  | {
      id: string;
      name: string;
      role: DeviceRole;
    }
  | null
> {
  const normalized = password?.trim() ?? "";
  if (!normalized) {
    await verifySentinelAdminPassword(normalized);
    return null;
  }

  const devices = await prisma.device.findMany({
    where: {
      role,
      isActive: true,
      ...syntheticExcludeWhere(),
    },
    select: {
      id: true,
      name: true,
      role: true,
      outletId: true,
      isSharedAcrossOutlets: true,
      outletAccess: {
        select: { outletId: true },
      },
      secretHash: true,
    },
    orderBy: [{ createdAt: "asc" }],
  });

  for (const device of devices) {
    if (!(isDeviceRole(device.role) && (await verifyAdminPassword(device.secretHash, normalized)))) {
      continue;
    }
    if (device.role === "kiosk" && device.isSharedAcrossOutlets) {
      continue;
    }
    if (!device.isSharedAcrossOutlets && !device.outletId) {
      continue;
    }
    if (device.isSharedAcrossOutlets && device.outletAccess.length === 0) {
      continue;
    }

    return {
      id: device.id,
      name: device.name,
      role: device.role,
    };
  }

  await verifySentinelAdminPassword(normalized);
  return null;
}

export async function isValidLegacyDevicePassword(
  role: DeviceRole,
  password: string | null | undefined
): Promise<boolean> {
  if (!isLegacyDeviceAuthEnabled()) return false;
  const normalized = password?.trim() ?? "";
  const expected = getLegacyDeviceAccessKey(role);
  if (!normalized || !expected) return false;
  return compareSecretText(normalized, expected);
}

async function getDatabaseDeviceSessionActor(
  token: string,
  req?: NextRequest,
  options: DeviceSessionResolveOptions = {},
): Promise<DeviceSessionActor | null> {
  const now = new Date();
  const session = await prisma.deviceSession.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: {
      device: {
        include: {
          outlet: {
            select: {
              id: true,
              isActive: true,
            },
          },
          outletAccess: {
            include: {
              outlet: {
                select: {
                  id: true,
                  isActive: true,
                },
              },
            },
          },
        },
      },
      activeStaffUser: {
        select: {
          id: true,
          displayName: true,
          accountType: true,
        },
      },
    },
  });

  if (!session || session.revokedAt || session.expiresAt <= now) return null;
  if (!session.device.isActive || !isDeviceRole(session.device.role)) return null;
  // Fail-closed: synthetic devices must never authorize via normal device
  // auth — covers EXISTING sessions, not just new logins (before lastSeenAt
  // is touched). The future authenticated synthetic kiosk-menu check must
  // use a separate read-only mechanism; do NOT re-enable synthetic here.
  if (isSyntheticRow(session.device)) return null;

  const allowedOutletIds = session.device.isSharedAcrossOutlets
    ? session.device.outletAccess
        .filter((row) => row.outlet.isActive)
        .map((row) => row.outletId)
    : session.device.outlet && session.device.outlet.isActive
      ? [session.device.outlet.id]
      : [];

  if (allowedOutletIds.length === 0) return null;
  if (session.device.role === "kiosk" && session.device.isSharedAcrossOutlets) {
    return null;
  }

  const primaryOutletId = session.device.isSharedAcrossOutlets
    ? null
    : session.device.outlet?.id ?? null;

  if (options.touchLastSeen !== false && shouldTouchLastSeen(session.lastSeenAt, now)) {
    await prisma.$transaction([
      prisma.deviceSession.update({
        where: { id: session.id },
        data: { lastSeenAt: now },
      }),
      prisma.device.update({
        where: { id: session.deviceId },
        data: {
          lastSeenAt: now,
          lastIpHash: req ? getLoginIpHash(req) : session.device.lastIpHash,
          lastUserAgent:
            req?.headers.get("user-agent") ?? session.device.lastUserAgent,
        },
      }),
    ]);
  }

  return {
    sessionId: session.id,
    deviceId: session.deviceId,
    name: session.device.name,
    role: session.device.role,
    outletId: primaryOutletId,
    isSharedAcrossOutlets: session.device.isSharedAcrossOutlets,
    allowedOutletIds,
    isLegacy: false,
    activeOutletId: session.activeOutletId ?? null,
    activeStaffUserId: session.activeStaffUserId ?? null,
    activeStaffDisplayName: session.activeStaffUser?.displayName ?? null,
    activeStaffAccountType: session.activeStaffUser?.accountType ?? null,
    activeStaffOutletId: session.activeStaffOutletId ?? null,
    activeStaffRole: session.activeStaffRole ?? null,
    activeStaffVerifiedAt: session.activeStaffVerifiedAt ?? null,
    activeStaffLastActionAt: session.activeStaffLastActionAt ?? null,
  };
}

function getLegacyDeviceAccessKey(role: DeviceRole): string {
  const envKey =
    role === "kiosk"
      ? process.env.KIOSK_DEVICE_KEY
      : role === "kitchen"
        ? process.env.KITCHEN_DEVICE_KEY
        : role === "board"
          ? process.env.BOARD_DEVICE_KEY
          : process.env.COUNTER_DEVICE_KEY;

  if (envKey === undefined) return DEV_DEFAULT_KEYS[role];
  if (envKey.trim().length === 0) return "";
  return envKey;
}
