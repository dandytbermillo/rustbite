import { NextRequest, NextResponse } from "next/server";
import {
  clearAdminSessionCookie,
  getAdminSessionFromRequest,
  requireAdminApiPermission,
} from "@/lib/admin-sessions";
import { requireFreshAdminStepUp } from "@/lib/admin-step-up";
import {
  assertKnownOutletRoles,
  authAuditActorFromSession,
  accountTypeToSiteRole,
  canManageSiteAdminAccounts,
  effectiveAdminAccountType,
  isSiteAdminAccountRole,
  parseAdminAccountType,
  parseDisplayName,
  parseOutletRoles,
  wouldRemoveLastActiveOwner,
  writeAuthAudit,
  type AuthAuditActor,
} from "@/lib/admin-user-management";
import { requestPendingOwnerChange } from "@/lib/admin-owner-changes";
import {
  cascadeClearActiveOperator,
  type ActiveOperatorInvalidateReason,
} from "@/lib/active-operator-cascade";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function actorFromRequest(req: NextRequest): Promise<AuthAuditActor> {
  return authAuditActorFromSession(await getAdminSessionFromRequest(req));
}

function outletRoleSignature(
  roles: Array<{ outletId: string; role: string }>
): string {
  return roles
    .map((role) => `${role.outletId}:${role.role === "STAFF" ? "OPERATOR" : role.role}`)
    .sort()
    .join("|");
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAdminApiPermission(
    req,
    "admin.auth.users.manage"
  );
  if (authError) return authError;

  const { id } = await params;
  const existing = await prisma.adminUser.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      accountType: true,
      siteRole: true,
      isActive: true,
      outletRoles: { select: { outletId: true, role: true } },
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Admin user not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const raw = body as Record<string, unknown>;

  const displayName = parseDisplayName(raw.displayName);
  if (!displayName.ok) {
    return NextResponse.json({ error: displayName.error }, { status: 400 });
  }

  const accountType = parseAdminAccountType(raw.accountType ?? raw.siteRole);
  if (accountType === undefined) {
    return NextResponse.json({ error: "Account type is invalid" }, { status: 400 });
  }
  const siteRole = accountTypeToSiteRole(accountType);

  if (typeof raw.isActive !== "boolean") {
    return NextResponse.json({ error: "Active state is required" }, { status: 400 });
  }
  const isActive = raw.isActive;

  const outletRoles = parseOutletRoles(raw.outletRoles);
  if (!outletRoles.ok) {
    return NextResponse.json({ error: outletRoles.error }, { status: 400 });
  }

  const roleCheck = await assertKnownOutletRoles(outletRoles.value);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: roleCheck.error }, { status: 400 });
  }

  const session = await getAdminSessionFromRequest(req);
  if (
    !canManageSiteAdminAccounts(session) &&
    (isSiteAdminAccountRole(
      effectiveAdminAccountType(existing.accountType, existing.siteRole)
    ) ||
      isSiteAdminAccountRole(accountType))
  ) {
    return NextResponse.json(
      { error: "Only owners can manage owner or admin accounts" },
      { status: 403 }
    );
  }

  if (accountType === "STAFF" && isActive && outletRoles.value.length === 0) {
    return NextResponse.json(
      { error: "Active staff users need at least one outlet role" },
      { status: 400 }
    );
  }

  const stepUpError = await requireFreshAdminStepUp(req);
  if (stepUpError) return stepUpError;

  const actor = await actorFromRequest(req);
  const existingAccountType = effectiveAdminAccountType(
    existing.accountType,
    existing.siteRole
  );
  const shouldRevokeTargetSessions =
    existingAccountType !== accountType ||
    existing.siteRole !== siteRole ||
    existing.isActive !== isActive ||
    outletRoleSignature(existing.outletRoles) !== outletRoleSignature(outletRoles.value);
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    if (
      session?.userId !== id &&
      existingAccountType === "OWNER" &&
      (accountType !== "OWNER" || !isActive)
    ) {
      const pending = await requestPendingOwnerChange(tx, {
        actor,
        actorId: session?.userId ?? "",
        targetId: id,
        targetLabel: existing.email,
        action: !isActive ? "DEACTIVATE" : "DEMOTE",
        reason: "Queued from admin user edit",
        metadata: {
          kind: "USER_UPDATE",
          displayName: displayName.value,
          accountType,
          siteRole,
          isActive,
          outletRoles: outletRoles.value,
        },
      });
      if (!pending.ok) {
        return {
          ok: false as const,
          status: pending.status,
          error: pending.error,
        };
      }
      return {
        ok: true as const,
        pendingOwnerChange: pending.pending,
        existingPendingOwnerChange: Boolean(pending.existing),
      };
    }

    if (await wouldRemoveLastActiveOwner(id, { accountType, isActive }, tx)) {
      return {
        ok: false as const,
        status: 400,
        error: "Cannot remove, demote, or disable the last active owner",
      };
    }

    await tx.adminUser.update({
      where: { id },
      data: {
        displayName: displayName.value,
        accountType,
        siteRole,
        isActive,
      },
    });

    await tx.adminUserOutletRole.deleteMany({ where: { userId: id } });
    if (outletRoles.value.length > 0) {
      await tx.adminUserOutletRole.createMany({
        data: outletRoles.value.map((role) => ({
          userId: id,
          outletId: role.outletId,
          role: role.role,
        })),
      });
    }

    if (shouldRevokeTargetSessions) {
      await tx.adminSession.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: now },
      });
    }

    // Cascade active-operator state on counter/kitchen device sessions.
    // Plan §647-661: same transaction, no exceptions.
    let cascadeClearedSessionCount = 0;
    const cascadeReasons: ActiveOperatorInvalidateReason[] = [];

    const becameInactive = existing.isActive && !isActive;
    const accountTypeBecameIneligible =
      (existingAccountType === "STAFF" || existingAccountType === "ADMIN") &&
      accountType !== "STAFF" &&
      accountType !== "ADMIN";

    if (becameInactive) {
      const cascade = await cascadeClearActiveOperator(tx, {
        filter: { kind: "user", userId: id },
        reason: "ACCOUNT_DEACTIVATED",
        actor,
      });
      cascadeClearedSessionCount += cascade.clearedSessionIds.length;
      if (cascade.clearedSessionIds.length > 0) cascadeReasons.push("ACCOUNT_DEACTIVATED");
    } else if (accountTypeBecameIneligible) {
      const cascade = await cascadeClearActiveOperator(tx, {
        filter: { kind: "user", userId: id },
        reason: "ACCOUNT_TYPE_CHANGED",
        actor,
        extraMetadata: { previousAccountType: existingAccountType, nextAccountType: accountType },
      });
      cascadeClearedSessionCount += cascade.clearedSessionIds.length;
      if (cascade.clearedSessionIds.length > 0) cascadeReasons.push("ACCOUNT_TYPE_CHANGED");
    } else {
      // Outlet roles changed in a way that may revoke MANAGER/OPERATOR at
      // an outlet where the user is currently active. For each outlet the
      // user previously held MANAGER/OPERATOR at but no longer does (or
      // downgraded to VIEWER), clear active-operator sessions targeting
      // that outlet.
      const previousOperationalOutlets = new Set(
        existing.outletRoles
          .filter((row) => row.role === "MANAGER" || row.role === "OPERATOR")
          .map((row) => row.outletId)
      );
      const nextOperationalOutlets = new Set(
        outletRoles.value
          .filter((row) => row.role === "MANAGER" || row.role === "OPERATOR")
          .map((row) => row.outletId)
      );
      const removedOutlets = [...previousOperationalOutlets].filter(
        (outletId) => !nextOperationalOutlets.has(outletId)
      );
      for (const outletId of removedOutlets) {
        const cascade = await cascadeClearActiveOperator(tx, {
          filter: { kind: "user-outlet", userId: id, outletId },
          reason: "ROLE_REVOKED",
          actor,
          extraMetadata: { affectedOutletId: outletId },
        });
        cascadeClearedSessionCount += cascade.clearedSessionIds.length;
        if (cascade.clearedSessionIds.length > 0 && !cascadeReasons.includes("ROLE_REVOKED")) {
          cascadeReasons.push("ROLE_REVOKED");
        }
      }
    }

    await writeAuthAudit(tx, {
      eventType: "ADMIN_USER_UPDATED",
      actor,
      targetId: id,
      targetLabel: existing.email,
      metadata: {
        siteRole,
        accountType,
        isActive,
        outletRoles: outletRoles.value,
        sessionsRevoked: shouldRevokeTargetSessions,
        cascadeClearedSessionCount,
        cascadeReasons,
      },
    });

    return {
      ok: true as const,
      cascadeClearedSessionCount,
      cascadeReasons,
    };
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status }
    );
  }

  if ("pendingOwnerChange" in result) {
    return NextResponse.json(
      {
        ok: true,
        pendingOwnerChange: result.pendingOwnerChange,
        existingPendingOwnerChange: result.existingPendingOwnerChange,
      },
      { status: 202 }
    );
  }

  const response = NextResponse.json({
    ok: true,
    sessionsRevoked: shouldRevokeTargetSessions,
    cascadeClearedSessionCount: result.cascadeClearedSessionCount ?? 0,
    cascadeReasons: result.cascadeReasons ?? [],
  });
  if (shouldRevokeTargetSessions && session?.userId === id) {
    clearAdminSessionCookie(response);
  }
  return response;
}
