import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  hashAdminPassword,
  verifyAdminPassword,
} from "@/lib/admin-passwords";
import { isDeviceRole, type DeviceRole } from "@/lib/device-auth";

export type DeviceRoleValue = DeviceRole;

export type DeviceRow = {
  id: string;
  name: string;
  physicalLocation: string | null;
  role: DeviceRoleValue;
  isActive: boolean;
  isSharedAcrossOutlets: boolean;
  outletId: string | null;
  outletName: string | null;
  sharedOutlets: Array<{
    outletId: string;
    outletName: string;
  }>;
  lastSeenAt: string | null;
  rotatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  activeSessionCount: number;
};

export function parseDeviceName(
  value: unknown
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: false, error: "Device name must be a string" };
  }
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, error: "Device name is required" };
  if (trimmed.length > 80) {
    return { ok: false, error: "Device name must be 80 characters or fewer" };
  }
  return { ok: true, value: trimmed };
}

export function parseDevicePhysicalLocation(
  value: unknown
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value == null) return { ok: true, value: null };
  if (typeof value !== "string") {
    return { ok: false, error: "Physical location must be a string" };
  }
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > 120) {
    return {
      ok: false,
      error: "Physical location must be 120 characters or fewer",
    };
  }
  return { ok: true, value: trimmed };
}

export function parseDeviceRole(
  value: unknown
): DeviceRoleValue | undefined {
  return typeof value === "string" && isDeviceRole(value) ? value : undefined;
}

export function parseSharedAcrossOutlets(value: unknown): boolean {
  return value === true;
}

export function parseOutletId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseSharedOutletIds(value: unknown): string[] | undefined {
  if (value == null) return [];
  if (!Array.isArray(value)) return undefined;

  const ids = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return [...new Set(ids)];
}

export async function validateDeviceAssignment(input: {
  role: DeviceRoleValue;
  isSharedAcrossOutlets: boolean;
  outletId: string | null;
  sharedOutletIds: string[];
}): Promise<
  | {
      ok: true;
      value: {
        isSharedAcrossOutlets: boolean;
        outletId: string | null;
        sharedOutletIds: string[];
      };
    }
  | { ok: false; error: string }
> {
  if (input.role === "kiosk" && input.isSharedAcrossOutlets) {
    return { ok: false, error: "Kiosk devices must belong to one outlet" };
  }

  if (input.isSharedAcrossOutlets) {
    if (input.sharedOutletIds.length === 0) {
      return {
        ok: false,
        error: "Shared devices need at least one outlet access assignment",
      };
    }

    const count = await prisma.outlet.count({
      where: {
        id: { in: input.sharedOutletIds },
        isActive: true,
      },
    });
    if (count !== input.sharedOutletIds.length) {
      return { ok: false, error: "One or more shared outlets are invalid" };
    }

    return {
      ok: true,
      value: {
        isSharedAcrossOutlets: true,
        outletId: null,
        sharedOutletIds: input.sharedOutletIds,
      },
    };
  }

  if (!input.outletId) {
    return { ok: false, error: "Choose an outlet for this device" };
  }

  const outlet = await prisma.outlet.findFirst({
    where: {
      id: input.outletId,
      isActive: true,
    },
    select: { id: true },
  });
  if (!outlet) {
    return { ok: false, error: "Selected outlet is invalid" };
  }

  return {
    ok: true,
    value: {
      isSharedAcrossOutlets: false,
      outletId: input.outletId,
      sharedOutletIds: [],
    },
  };
}

export async function listDevices(): Promise<DeviceRow[]> {
  const devices = await prisma.device.findMany({
    orderBy: [{ createdAt: "asc" }],
    include: {
      outlet: {
        select: {
          id: true,
          name: true,
        },
      },
      outletAccess: {
        orderBy: { outlet: { name: "asc" } },
        include: {
          outlet: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      sessions: {
        where: {
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      },
    },
  });

  const rows: DeviceRow[] = [];
  for (const device of devices) {
    if (!isDeviceRole(device.role)) continue;
    rows.push({
      id: device.id,
      name: device.name,
      physicalLocation: device.physicalLocation,
      role: device.role,
      isActive: device.isActive,
      isSharedAcrossOutlets: device.isSharedAcrossOutlets,
      outletId: device.outletId,
      outletName: device.outlet?.name ?? null,
      sharedOutlets: device.outletAccess.map((row) => ({
        outletId: row.outletId,
        outletName: row.outlet.name,
      })),
      lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
      rotatedAt: device.rotatedAt?.toISOString() ?? null,
      createdAt: device.createdAt.toISOString(),
      updatedAt: device.updatedAt.toISOString(),
      activeSessionCount: device.sessions.length,
    });
  }
  return rows;
}

export function generateDeviceAccessCode(): string {
  return randomBytes(12).toString("base64url");
}

export async function hashDeviceAccessCode(code: string): Promise<string> {
  return hashAdminPassword(code);
}

export async function verifyDeviceAccessCode(
  passwordHash: string,
  password: string
): Promise<boolean> {
  return verifyAdminPassword(passwordHash, password);
}
