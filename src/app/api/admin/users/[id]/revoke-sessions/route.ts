import { NextRequest, NextResponse } from "next/server";
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
      { error: "Only owners can revoke owner or admin sessions" },
      { status: 403 }
    );
  }

  const stepUpError = await requireFreshAdminStepUp(req);
  if (stepUpError) return stepUpError;

  const actor = await actorFromRequest(req);
  const result = await prisma.$transaction(async (tx) => {
    const revoked = await tx.adminSession.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await writeAuthAudit(tx, {
      eventType: "ADMIN_USER_SESSIONS_REVOKED",
      actor,
      targetId: id,
      targetLabel: existing.email,
      metadata: { revokedCount: revoked.count },
    });
    return revoked;
  });

  const response = NextResponse.json({ ok: true, revokedCount: result.count });
  if (session?.userId === id) {
    clearAdminSessionCookie(response);
  }
  return response;
}
