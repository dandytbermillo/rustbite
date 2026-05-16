import { NextRequest, NextResponse } from "next/server";
import { hashAdminPassword } from "@/lib/admin-passwords";
import {
  clearAdminSessionCookie,
  getAdminSessionFromRequest,
  requireAdminApiPermission,
} from "@/lib/admin-sessions";
import { requireFreshAdminStepUp } from "@/lib/admin-step-up";
import {
  authAuditActorFromSession,
  canManageSiteAdminAccounts,
  effectiveAdminAccountType,
  isSiteAdminAccountRole,
  parsePassword,
  writeAuthAudit,
  type AuthAuditActor,
} from "@/lib/admin-user-management";
import { requestPendingOwnerChange } from "@/lib/admin-owner-changes";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function actorFromRequest(req: NextRequest): Promise<AuthAuditActor> {
  return authAuditActorFromSession(await getAdminSessionFromRequest(req));
}

export async function POST(
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
    select: { id: true, email: true, accountType: true, siteRole: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Admin user not found" }, { status: 404 });
  }
  const session = await getAdminSessionFromRequest(req);
  if (
    !canManageSiteAdminAccounts(session) &&
    isSiteAdminAccountRole(
      effectiveAdminAccountType(existing.accountType, existing.siteRole)
    )
  ) {
    return NextResponse.json(
      { error: "Only owners can reset owner or admin passwords" },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const password = parsePassword(
    body && typeof body === "object"
      ? (body as Record<string, unknown>).password
      : undefined
  );
  if (!password.ok) {
    return NextResponse.json({ error: password.error }, { status: 400 });
  }

  const stepUpError = await requireFreshAdminStepUp(req);
  if (stepUpError) return stepUpError;

  const passwordHash = await hashAdminPassword(password.value);
  const actor = await actorFromRequest(req);

  const result = await prisma.$transaction(async (tx) => {
    if (
      session?.userId !== id &&
      effectiveAdminAccountType(existing.accountType, existing.siteRole) === "OWNER"
    ) {
      const pending = await requestPendingOwnerChange(tx, {
        actor,
        actorId: session?.userId ?? "",
        targetId: id,
        targetLabel: existing.email,
        action: "PASSWORD_RESET",
        reason: "Queued from admin password reset",
        metadata: {
          kind: "PASSWORD_RESET",
          passwordHash,
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

    await tx.adminUser.update({
      where: { id },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
      },
    });
    await tx.adminSession.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await writeAuthAudit(tx, {
      eventType: "ADMIN_USER_PASSWORD_RESET",
      actor,
      targetId: id,
      targetLabel: existing.email,
    });
    return { ok: true as const };
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
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

  const response = NextResponse.json({ ok: true });
  if (session?.userId === id) {
    clearAdminSessionCookie(response);
  }
  return response;
}
