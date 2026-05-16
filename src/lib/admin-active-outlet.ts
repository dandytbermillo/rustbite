import "server-only";
import { prisma } from "@/lib/db";
import type { AdminSessionActor } from "@/lib/admin-sessions";
import { DEFAULT_OUTLET_ID } from "@/lib/outlets";

export const ADMIN_ACTIVE_OUTLET_COOKIE = "rb_admin_active_outlet";

type CookieReader = {
  get(name: string): { value: string } | undefined;
};

export type AdminActiveOutletResolution =
  | {
      status: "active";
      outletId: string;
      outletName: string;
      role: "OWNER" | "ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER";
      staleCookie?: boolean;
    }
  | {
      status: "needs_picker";
      outlets: Array<{ id: string; name: string; role: "MANAGER" | "OPERATOR" | "VIEWER" }>;
      staleCookie?: boolean;
    }
  | { status: "no_access"; staleCookie?: boolean };

function normalizeOutletRole(
  role: string | null | undefined
): "MANAGER" | "OPERATOR" | "VIEWER" | null {
  if (role === "STAFF") return "OPERATOR";
  if (role === "MANAGER" || role === "OPERATOR" || role === "VIEWER") return role;
  return null;
}

export function displayActiveRole(role: string): string {
  if (role === "OWNER") return "Owner";
  if (role === "ADMIN") return "Admin";
  if (role === "MANAGER") return "Manager";
  if (role === "OPERATOR") return "Operator";
  if (role === "VIEWER") return "Viewer";
  return role;
}

async function findActiveOutlet(outletId: string) {
  return prisma.outlet.findFirst({
    where: { id: outletId, isActive: true },
    select: { id: true, name: true },
  });
}

export async function resolveAdminActiveOutlet(
  actor: AdminSessionActor | null,
  cookies?: CookieReader,
  requestedOutletId?: string | null
): Promise<AdminActiveOutletResolution> {
  if (!actor) return { status: "active", outletId: DEFAULT_OUTLET_ID, outletName: "Cafeteria", role: "OWNER" };

  const cookieOutletId = cookies?.get(ADMIN_ACTIVE_OUTLET_COOKIE)?.value || null;
  const hasRequestedOutlet = Boolean(requestedOutletId);
  const preferredOutletId = requestedOutletId || cookieOutletId;

  if (actor.siteRole === "OWNER" || actor.siteRole === "ADMIN") {
    if (preferredOutletId) {
      const outlet = await findActiveOutlet(preferredOutletId);
      if (outlet) {
        return {
          status: "active",
          outletId: outlet.id,
          outletName: outlet.name,
          role: actor.siteRole,
        };
      }
      return {
        status: "active",
        outletId: DEFAULT_OUTLET_ID,
        outletName: "All outlets",
        role: actor.siteRole,
        staleCookie: Boolean(cookieOutletId),
      };
    }

    const outlet = await findActiveOutlet(DEFAULT_OUTLET_ID);
    return {
      status: "active",
      outletId: outlet?.id ?? DEFAULT_OUTLET_ID,
      outletName: outlet?.name ?? "All outlets",
      role: actor.siteRole,
    };
  }

  const roles = await prisma.adminUserOutletRole.findMany({
    where: {
      userId: actor.userId,
      outlet: { isActive: true },
    },
    orderBy: { outlet: { name: "asc" } },
    select: {
      outletId: true,
      role: true,
      outlet: { select: { id: true, name: true } },
    },
  });

  const normalizedRoles = roles
    .map((row) => {
      const role = normalizeOutletRole(row.role);
      return role
        ? { id: row.outlet.id, name: row.outlet.name, role }
        : null;
    })
    .filter((row): row is { id: string; name: string; role: "MANAGER" | "OPERATOR" | "VIEWER" } =>
      Boolean(row)
    );

  if (normalizedRoles.length === 0) {
    return { status: "no_access", staleCookie: Boolean(cookieOutletId) };
  }

  if (preferredOutletId) {
    const match = normalizedRoles.find((row) => row.id === preferredOutletId);
    if (match) {
      return {
        status: "active",
        outletId: match.id,
        outletName: match.name,
        role: match.role,
      };
    }

    if (hasRequestedOutlet) {
      return { status: "no_access", staleCookie: Boolean(cookieOutletId) };
    }
  }

  if (normalizedRoles.length === 1) {
    const only = normalizedRoles[0]!;
    return {
      status: "active",
      outletId: only.id,
      outletName: only.name,
      role: only.role,
      staleCookie: Boolean(cookieOutletId && cookieOutletId !== only.id),
    };
  }

  return {
    status: "needs_picker",
    outlets: normalizedRoles,
    staleCookie: Boolean(cookieOutletId),
  };
}
