import "server-only";
import { prisma } from "@/lib/db";
import type { DeviceRole } from "@/lib/device-auth";

// AdminUserSurfaceAccess — Owner-controlled grant of operational pages a
// human user may operate on counter/kitchen devices. Decoupled from outlet
// role so an Owner can revoke a user's COUNTER access without disturbing
// their outlet roles. Outlet role still controls what they can DO inside
// the outlet; surface access controls what page they can OPEN.
//
// v1 only persists "COUNTER" and "KITCHEN". "ADMIN", "BOARD", "KIOSK"
// are deferred and explicitly rejected at the API boundary.

export const EDITABLE_SURFACES = ["COUNTER", "KITCHEN"] as const;
export type EditableSurface = (typeof EDITABLE_SURFACES)[number];

const EDITABLE_SURFACE_SET: ReadonlySet<string> = new Set(EDITABLE_SURFACES);

export const DEVICE_ROLE_TO_REQUIRED_SURFACE: Partial<
  Record<DeviceRole, EditableSurface>
> = {
  counter: "COUNTER",
  kitchen: "KITCHEN",
};

export const ELIGIBLE_OPERATOR_ACCOUNT_TYPES = ["STAFF", "ADMIN"] as const;
export type EligibleOperatorAccountType =
  (typeof ELIGIBLE_OPERATOR_ACCOUNT_TYPES)[number];

export const ELIGIBLE_OPERATOR_OUTLET_ROLES = ["MANAGER", "OPERATOR"] as const;
export type EligibleOperatorOutletRole =
  (typeof ELIGIBLE_OPERATOR_OUTLET_ROLES)[number];

const ELIGIBLE_ACCOUNT_TYPE_SET: ReadonlySet<string> = new Set(
  ELIGIBLE_OPERATOR_ACCOUNT_TYPES
);
const ELIGIBLE_ROLE_SET: ReadonlySet<string> = new Set(
  ELIGIBLE_OPERATOR_OUTLET_ROLES
);

export function parseEditableSurface(input: unknown): EditableSurface | null {
  if (typeof input !== "string") return null;
  const normalized = input.toUpperCase();
  return EDITABLE_SURFACE_SET.has(normalized) ? (normalized as EditableSurface) : null;
}

export function isEligibleOperatorAccountType(
  value: string | null | undefined
): value is EligibleOperatorAccountType {
  return typeof value === "string" && ELIGIBLE_ACCOUNT_TYPE_SET.has(value);
}

export function isEligibleOperatorOutletRole(
  value: string | null | undefined
): value is EligibleOperatorOutletRole {
  return typeof value === "string" && ELIGIBLE_ROLE_SET.has(value);
}

export function getRequiredSurfaceForDeviceRole(
  role: DeviceRole
): EditableSurface | null {
  return DEVICE_ROLE_TO_REQUIRED_SURFACE[role] ?? null;
}

export async function listSurfacesForUser(
  userId: string
): Promise<EditableSurface[]> {
  const rows = await prisma.adminUserSurfaceAccess.findMany({
    where: { userId },
    select: { surface: true },
  });
  return rows
    .map((row) => row.surface)
    .filter((surface): surface is EditableSurface =>
      EDITABLE_SURFACE_SET.has(surface)
    );
}

export async function userHasSurface(
  userId: string,
  surface: EditableSurface
): Promise<boolean> {
  const found = await prisma.adminUserSurfaceAccess.findUnique({
    where: { userId_surface: { userId, surface } },
    select: { id: true },
  });
  return found !== null;
}

export type EligibleOperator = {
  id: string;
  displayName: string;
  accountType: EligibleOperatorAccountType;
  outletRole: EligibleOperatorOutletRole;
  surface: EditableSurface;
  pinSetState: "SET" | "NOT_SET";
};

/**
 * Look up users eligible to be selected as the active operator on a
 * counter/kitchen device for a specific outlet.
 *
 * Eligibility = STAFF or ADMIN account type, isActive, has the required
 * surface grant for the device's role, and has MANAGER or OPERATOR outlet
 * role at the chosen outlet.
 *
 * Response shape is strictly limited to the fields below — no email, no
 * phone, no last-login, no cross-outlet metadata. A stolen counter device
 * cookie must not become a directory of the entire staff table.
 */
export async function listEligibleOperatorsForDevice(args: {
  deviceRole: DeviceRole;
  outletId: string;
}): Promise<EligibleOperator[]> {
  const surface = getRequiredSurfaceForDeviceRole(args.deviceRole);
  if (!surface) return [];

  const users = await prisma.adminUser.findMany({
    where: {
      isActive: true,
      accountType: { in: [...ELIGIBLE_OPERATOR_ACCOUNT_TYPES] },
      surfaceAccess: { some: { surface } },
      outletRoles: {
        some: {
          outletId: args.outletId,
          role: { in: [...ELIGIBLE_OPERATOR_OUTLET_ROLES] },
        },
      },
    },
    select: {
      id: true,
      displayName: true,
      accountType: true,
      operationalPinHash: true,
      outletRoles: {
        where: { outletId: args.outletId },
        select: { role: true },
      },
    },
    orderBy: { displayName: "asc" },
  });

  return users
    .map((user): EligibleOperator | null => {
      const outletRole = user.outletRoles[0]?.role;
      if (!isEligibleOperatorAccountType(user.accountType)) return null;
      if (!isEligibleOperatorOutletRole(outletRole)) return null;
      return {
        id: user.id,
        displayName: user.displayName,
        accountType: user.accountType,
        outletRole,
        surface,
        pinSetState: user.operationalPinHash ? "SET" : "NOT_SET",
      };
    })
    .filter((row): row is EligibleOperator => row !== null);
}
