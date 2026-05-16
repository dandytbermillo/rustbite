import { NextRequest, NextResponse } from "next/server";
import {
  clearAdminSessionCookie,
  getAdminSessionFromRequest,
  requireAdminApiPermission,
} from "@/lib/admin-sessions";
import { requireFreshAdminStepUp } from "@/lib/admin-step-up";
import { requestPendingOwnerChange } from "@/lib/admin-owner-changes";
import { resetAdminUserMfa } from "@/lib/admin-mfa-reset";
import {
  authAuditActorFromSession,
  canManageSiteAdminAccounts,
  effectiveAdminAccountType,
  isSiteAdminAccountRole,
  writeAuthAudit,
  type AuthAuditActor,
} from "@/lib/admin-user-management";
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
    select: {
      id: true,
      email: true,
      accountType: true,
      siteRole: true,
      mfaEnabledAt: true,
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Admin user not found" }, { status: 404 });
  }

  const session = await getAdminSessionFromRequest(req);
  const targetAccountType = effectiveAdminAccountType(
    existing.accountType,
    existing.siteRole
  );
  if (
    !canManageSiteAdminAccounts(session) &&
    isSiteAdminAccountRole(targetAccountType)
  ) {
    return NextResponse.json(
      { error: "Only owners can reset owner or admin MFA" },
      { status: 403 }
    );
  }

  const stepUpError = await requireFreshAdminStepUp(req);
  if (stepUpError) return stepUpError;

  const actor = await actorFromRequest(req);
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    if (session?.userId !== id && targetAccountType === "OWNER") {
      const pending = await requestPendingOwnerChange(tx, {
        actor,
        actorId: session?.userId ?? "",
        targetId: id,
        targetLabel: existing.email,
        action: "MFA_RESET",
        reason: "Queued from admin MFA reset",
        metadata: { kind: "MFA_RESET" },
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

    await resetAdminUserMfa(tx, id);
    await tx.adminSession.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.authEmailOutbox.create({
      data: {
        eventType: "ADMIN_USER_MFA_RESET",
        recipientUserId: id,
        recipientEmail: existing.email,
        subject: "Rushbite security: MFA reset",
        textBody: [
          "MFA was reset for your Rushbite admin account.",
          "",
          "You must enroll MFA again before using admin tools.",
          "If you did not expect this change, contact an Owner immediately.",
        ].join("\n"),
        metadata: { targetUserId: id },
      },
    });
    await writeAuthAudit(tx, {
      eventType: "ADMIN_USER_MFA_RESET",
      actor,
      targetId: id,
      targetLabel: existing.email,
      metadata: {
        mfaWasEnabled: Boolean(existing.mfaEnabledAt),
        sessionsRevoked: true,
      },
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
