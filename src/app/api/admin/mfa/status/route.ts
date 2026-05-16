import { NextRequest, NextResponse } from "next/server";
import { getAdminSessionFromRequest } from "@/lib/admin-sessions";
import { prisma } from "@/lib/db";
import { effectiveAdminAccountType } from "@/lib/admin-user-management";
import { isOwnerOrAdminAccount } from "@/lib/admin-mfa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const session = await getAdminSessionFromRequest(req);
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized", errorCode: "unauthorized" },
      { status: 401 }
    );
  }

  const row = await prisma.adminSession.findUnique({
    where: { id: session.sessionId },
    select: {
      stepUpExpiresAt: true,
      user: {
        select: {
          accountType: true,
          siteRole: true,
          mfaEnabledAt: true,
        },
      },
    },
  });
  if (!row) {
    return NextResponse.json(
      { error: "Unauthorized", errorCode: "unauthorized" },
      { status: 401 }
    );
  }

  const accountType = effectiveAdminAccountType(
    row.user.accountType,
    row.user.siteRole
  );
  const recoveryCodesRemaining = row.user.mfaEnabledAt
    ? await prisma.adminMfaRecoveryCode.count({
        where: { userId: session.userId, usedAt: null },
      })
    : 0;

  return NextResponse.json({
    accountType,
    mfaRequired: isOwnerOrAdminAccount(accountType),
    mfaEnabled: Boolean(row.user.mfaEnabledAt),
    mfaEnabledAt: row.user.mfaEnabledAt?.toISOString() ?? null,
    recoveryCodesRemaining,
    stepUpExpiresAt: row.stepUpExpiresAt?.toISOString() ?? null,
    serverNow: new Date().toISOString(),
  });
}
