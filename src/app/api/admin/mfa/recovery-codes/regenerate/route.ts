import { NextRequest, NextResponse } from "next/server";
import { getAdminSessionFromRequest } from "@/lib/admin-sessions";
import {
  generateMfaRecoveryCodes,
  hashMfaRecoveryCode,
} from "@/lib/admin-mfa";
import { requireFreshAdminStepUp } from "@/lib/admin-step-up";
import { prisma } from "@/lib/db";
import { requireSameOriginMutation } from "@/lib/production-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function actorType(siteRole: string | null): string {
  if (siteRole === "OWNER") return "ADMIN_OWNER";
  if (siteRole === "ADMIN") return "ADMIN_ADMIN";
  return "ADMIN_STAFF";
}

export async function POST(req: NextRequest) {
  const originError = requireSameOriginMutation(req);
  if (originError) return originError;

  const stepUpError = await requireFreshAdminStepUp(req);
  if (stepUpError) return stepUpError;

  const session = await getAdminSessionFromRequest(req);
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized", errorCode: "unauthorized" },
      { status: 401 }
    );
  }

  const user = await prisma.adminUser.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, mfaEnabledAt: true, mfaSecretCiphertext: true },
  });
  if (!user?.mfaEnabledAt || !user.mfaSecretCiphertext) {
    return NextResponse.json(
      { error: "MFA is not enabled", errorCode: "mfa_not_enabled" },
      { status: 400 }
    );
  }

  const recoveryCodes = generateMfaRecoveryCodes();
  await prisma.$transaction([
    prisma.adminMfaRecoveryCode.deleteMany({
      where: { userId: session.userId },
    }),
    prisma.adminMfaRecoveryCode.createMany({
      data: recoveryCodes.map((recoveryCode) => ({
        userId: session.userId,
        codeHash: hashMfaRecoveryCode(recoveryCode),
      })),
    }),
    prisma.authAuditLog.create({
      data: {
        eventType: "ADMIN_MFA_RECOVERY_CODES_REGENERATED",
        actorType: actorType(session.siteRole),
        actorId: session.userId,
        actorLabel: session.email,
        targetType: "ADMIN_USER",
        targetId: session.userId,
        targetLabel: session.email,
      },
    }),
  ]);

  return NextResponse.json({ ok: true, recoveryCodes });
}
