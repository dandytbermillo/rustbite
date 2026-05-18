import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { syntheticExcludeWhere } from "@/lib/observability/synthetic-fixtures";
import {
  ADMIN_PASSWORD_MAX_LENGTH,
  ADMIN_PASSWORD_MIN_LENGTH,
  validateAdminPasswordPolicy,
} from "@/lib/admin-passwords";
import type { AdminSessionActor } from "@/lib/admin-sessions";
import { normalizeAdminEmail } from "@/lib/production-auth";

export const ADMIN_ACCOUNT_TYPES = ["OWNER", "ADMIN", "STAFF"] as const;
export const ADMIN_SITE_ROLES = ["OWNER", "ADMIN"] as const;
export const ADMIN_OUTLET_ROLES = ["MANAGER", "OPERATOR", "VIEWER"] as const;

export type AdminAccountTypeValue = (typeof ADMIN_ACCOUNT_TYPES)[number];
export type AdminSiteRoleValue = (typeof ADMIN_SITE_ROLES)[number];
export type AdminOutletRoleValue = (typeof ADMIN_OUTLET_ROLES)[number];

export type AdminUserRow = {
  id: string;
  email: string;
  displayName: string;
  accountType: AdminAccountTypeValue;
  siteRole: AdminSiteRoleValue | null;
  isActive: boolean;
  mfaEnabledAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  activeSessionCount: number;
  outletRoles: Array<{
    outletId: string;
    outletName: string;
    role: AdminOutletRoleValue;
  }>;
  /**
   * Counter/Kitchen Active Operator (Phase 2): which operational surfaces
   * the Owner has granted this user. Empty array for users without grants
   * (the v1 default for newly-created users).
   */
  surfaceAccess: Array<"COUNTER" | "KITCHEN">;
  /** True if `AdminUser.operationalPinHash` is non-null. The hash itself
   *  is never returned to the client. */
  operationalPinSet: boolean;
  pendingOwnerChanges: Array<{
    id: string;
    action: string;
    status: string;
    requestedAt: string;
    executesAt: string;
    actorId: string;
    targetId: string;
    reason: string | null;
  }>;
};

export type AdminOutletRow = {
  id: string;
  name: string;
  slug: string;
};

export type AuthAuditActor = {
  type: string;
  id?: string | null;
  label?: string | null;
};

export function parseAdminSiteRole(
  value: unknown
): AdminSiteRoleValue | null | undefined {
  if (value === null || value === "" || value === undefined) return null;
  return value === "OWNER" || value === "ADMIN" ? value : undefined;
}

export function accountTypeToSiteRole(
  accountType: AdminAccountTypeValue
): AdminSiteRoleValue | null {
  return accountType === "STAFF" ? null : accountType;
}

export function effectiveAdminAccountType(
  accountType: string | null | undefined,
  siteRole: string | null | undefined
): AdminAccountTypeValue {
  if (accountType === "OWNER" || accountType === "ADMIN" || accountType === "STAFF") {
    return accountType;
  }
  if (siteRole === "OWNER" || siteRole === "ADMIN") return siteRole;
  return "STAFF";
}

export function parseAdminAccountType(
  value: unknown
): AdminAccountTypeValue | undefined {
  if (value === "OWNER" || value === "ADMIN" || value === "STAFF") return value;
  const legacySiteRole = parseAdminSiteRole(value);
  if (legacySiteRole === undefined) return undefined;
  return legacySiteRole ?? "STAFF";
}

export function parseAdminOutletRole(
  value: unknown
): AdminOutletRoleValue | undefined {
  if (value === "STAFF") return "OPERATOR";
  return value === "MANAGER" || value === "OPERATOR" || value === "VIEWER"
    ? value
    : undefined;
}

export function roleLabel(role: AdminOutletRoleValue): string {
  if (role === "MANAGER") return "Manager";
  if (role === "OPERATOR") return "Operator";
  return "Viewer";
}

export function parseDisplayName(value: unknown):
  | { ok: true; value: string }
  | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: false, error: "Display name must be a string" };
  }
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, error: "Display name is required" };
  if (trimmed.length > 120) {
    return { ok: false, error: "Display name must be 120 characters or fewer" };
  }
  return { ok: true, value: trimmed };
}

export function parsePassword(value: unknown):
  | { ok: true; value: string }
  | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: false, error: "Password is required" };
  }
  const policy = validateAdminPasswordPolicy(value);
  if (!policy.ok) return { ok: false, error: policy.error };
  return { ok: true, value };
}

export function parseEmail(value: unknown):
  | { ok: true; value: string }
  | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: false, error: "Email must be a string" };
  }
  const email = normalizeAdminEmail(value);
  if (!email) return { ok: false, error: "Email is required" };
  if (email.length > 254) {
    return { ok: false, error: "Email must be 254 characters or fewer" };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Email is invalid" };
  }
  return { ok: true, value: email };
}

export function passwordPolicyText() {
  return `${ADMIN_PASSWORD_MIN_LENGTH}-${ADMIN_PASSWORD_MAX_LENGTH} characters`;
}

export async function listAdminOutlets(): Promise<AdminOutletRow[]> {
  return prisma.outlet.findMany({
    where: { isActive: true, ...syntheticExcludeWhere() },
    orderBy: [{ name: "asc" }],
    select: { id: true, name: true, slug: true },
  });
}

export async function listAdminUsers(): Promise<AdminUserRow[]> {
  const [users, pendingOwnerChanges] = await Promise.all([
    prisma.adminUser.findMany({
    orderBy: [{ createdAt: "asc" }],
    include: {
      outletRoles: {
        orderBy: { outlet: { name: "asc" } },
        include: { outlet: { select: { id: true, name: true } } },
      },
      sessions: {
        where: {
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      },
      surfaceAccess: {
        select: { surface: true },
      },
    },
    }),
    prisma.pendingOwnerChange.findMany({
      where: { status: "PENDING" },
      orderBy: { requestedAt: "desc" },
      select: {
        id: true,
        action: true,
        status: true,
        requestedAt: true,
        executesAt: true,
        actorId: true,
        targetId: true,
        reason: true,
      },
    }),
  ]);
  const pendingByTarget = new Map<string, typeof pendingOwnerChanges>();
  for (const pending of pendingOwnerChanges) {
    const current = pendingByTarget.get(pending.targetId) ?? [];
    current.push(pending);
    pendingByTarget.set(pending.targetId, current);
  }

  return users.map((user) => {
    const accountType = effectiveAdminAccountType(user.accountType, user.siteRole);
    const surfaceAccess = user.surfaceAccess
      .map((row) => row.surface)
      .filter((surface): surface is "COUNTER" | "KITCHEN" =>
        surface === "COUNTER" || surface === "KITCHEN"
      );
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      accountType,
      siteRole: accountTypeToSiteRole(accountType),
      isActive: user.isActive,
      mfaEnabledAt: user.mfaEnabledAt?.toISOString() ?? null,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      activeSessionCount: user.sessions.length,
      outletRoles: user.outletRoles.map((row) => ({
        outletId: row.outletId,
        outletName: row.outlet.name,
        role: parseAdminOutletRole(row.role) ?? "VIEWER",
      })),
      surfaceAccess,
      operationalPinSet: user.operationalPinHash !== null,
      pendingOwnerChanges: (pendingByTarget.get(user.id) ?? []).map((pending) => ({
        id: pending.id,
        action: pending.action,
        status: pending.status,
        requestedAt: pending.requestedAt.toISOString(),
        executesAt: pending.executesAt.toISOString(),
        actorId: pending.actorId,
        targetId: pending.targetId,
        reason: pending.reason,
      })),
    };
  });
}

export async function assertKnownOutletRoles(
  roles: Array<{ outletId: string; role: AdminOutletRoleValue }>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const outletIds = [...new Set(roles.map((role) => role.outletId))];
  if (outletIds.length !== roles.length) {
    return { ok: false, error: "Each outlet can only have one role" };
  }
  if (outletIds.length === 0) return { ok: true };

  const count = await prisma.outlet.count({
    where: { id: { in: outletIds }, isActive: true, ...syntheticExcludeWhere() },
  });
  if (count !== outletIds.length) {
    return { ok: false, error: "One or more outlets are invalid" };
  }
  return { ok: true };
}

export function parseOutletRoles(value: unknown):
  | { ok: true; value: Array<{ outletId: string; role: AdminOutletRoleValue }> }
  | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) {
    return { ok: false, error: "Outlet roles must be an array" };
  }

  const roles: Array<{ outletId: string; role: AdminOutletRoleValue }> = [];
  for (const row of value) {
    if (!row || typeof row !== "object") {
      return { ok: false, error: "Outlet role row is invalid" };
    }
    const raw = row as Record<string, unknown>;
    const outletId = typeof raw.outletId === "string" ? raw.outletId.trim() : "";
    const role = parseAdminOutletRole(raw.role);
    if (!outletId || !role) {
      return { ok: false, error: "Outlet role row is invalid" };
    }
    roles.push({ outletId, role });
  }
  return { ok: true, value: roles };
}

export async function wouldRemoveLastActiveOwner(
  userId: string,
  next: { accountType: AdminAccountTypeValue; isActive: boolean },
  tx: Prisma.TransactionClient = prisma
): Promise<boolean> {
  const current = await tx.adminUser.findUnique({
    where: { id: userId },
    select: { id: true, accountType: true, siteRole: true, isActive: true },
  });
  if (
    !current ||
    effectiveAdminAccountType(current.accountType, current.siteRole) !== "OWNER" ||
    !current.isActive
  ) {
    return false;
  }
  if (next.accountType === "OWNER" && next.isActive) return false;

  const activeOwnerCount = await tx.adminUser.count({
    where: {
      isActive: true,
      accountType: "OWNER",
    },
  });
  return activeOwnerCount <= 1;
}

export function canManageSiteAdminAccounts(
  actor: AdminSessionActor | null
): boolean {
  // Legacy Basic Auth is treated as owner-equivalent during the migration
  // window so existing local/dev flows are not locked out.
  return !actor || actor.siteRole === "OWNER";
}

export function isSiteAdminAccountRole(
  siteRole: AdminSiteRoleValue | AdminAccountTypeValue | string | null | undefined
): boolean {
  return siteRole === "OWNER" || siteRole === "ADMIN";
}

export function authAuditActorFromSession(
  session: AdminSessionActor | null
): AuthAuditActor {
  if (!session) return { type: "LEGACY_ADMIN", label: "Legacy admin auth" };
  const actorType =
    session.siteRole === "OWNER"
      ? "ADMIN_OWNER"
      : session.siteRole === "ADMIN"
        ? "ADMIN_ADMIN"
        : "ADMIN_OUTLET_USER";
  return { type: actorType, id: session.userId, label: session.email };
}

export async function writeAuthAudit(
  tx: Prisma.TransactionClient,
  input: {
    eventType: string;
    actor: AuthAuditActor;
    targetType?: string | null;
    targetId?: string | null;
    targetLabel?: string | null;
    outletId?: string | null;
    metadata?: Prisma.InputJsonValue;
  }
) {
  await tx.authAuditLog.create({
    data: {
      eventType: input.eventType,
      actorType: input.actor.type,
      actorId: input.actor.id ?? null,
      actorLabel: input.actor.label ?? null,
      targetType: input.targetType ?? "ADMIN_USER",
      targetId: input.targetId ?? null,
      targetLabel: input.targetLabel ?? null,
      outletId: input.outletId ?? null,
      metadata: input.metadata ?? Prisma.JsonNull,
    },
  });
}
