import { NextRequest, NextResponse } from "next/server";
import { getAdminSessionFromRequest } from "@/lib/admin-sessions";
import {
  decryptMfaSecret,
  generateMfaRecoveryCodes,
  hashMfaRecoveryCode,
  verifyTotpCode,
} from "@/lib/admin-mfa";
import { prisma } from "@/lib/db";
import { requireSameOriginMutation } from "@/lib/production-auth";
import { markAdminSessionStepUpVerified } from "@/lib/admin-step-up";

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

  const session = await getAdminSessionFromRequest(req);
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized", errorCode: "unauthorized" },
      { status: 401 }
    );
  }

  const body = await req.json().catch(() => null);
  const code =
    body && typeof body === "object" && typeof (body as Record<string, unknown>).code === "string"
      ? (body as Record<string, string>).code
      : "";

  const user = await prisma.adminUser.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, mfaSecretCiphertext: true },
  });
  if (!user?.mfaSecretCiphertext) {
    return NextResponse.json(
      { error: "Start MFA enrollment first", errorCode: "mfa_enrollment_not_started" },
      { status: 400 }
    );
  }

  const secret = decryptMfaSecret(user.mfaSecretCiphertext);
  if (!verifyTotpCode(secret, code)) {
    await prisma.authAuditLog.create({
      data: {
        eventType: "ADMIN_MFA_ENROLLMENT_FAILED",
        actorType: actorType(session.siteRole),
        actorId: session.userId,
        actorLabel: session.email,
        targetType: "ADMIN_USER",
        targetId: session.userId,
        targetLabel: session.email,
      },
    });
    return NextResponse.json(
      { error: "MFA code is invalid", errorCode: "invalid_mfa_code" },
      { status: 400 }
    );
  }

  const recoveryCodes = generateMfaRecoveryCodes();
  const now = new Date();

  await prisma.$transaction([
    prisma.adminUser.update({
      where: { id: session.userId },
      data: { mfaEnabledAt: now },
    }),
    prisma.adminMfaRecoveryCode.deleteMany({
      where: { userId: session.userId },
    }),
    prisma.adminMfaRecoveryCode.createMany({
      data: recoveryCodes.map((recoveryCode) => ({
        userId: session.userId,
        codeHash: hashMfaRecoveryCode(recoveryCode),
      })),
    }),
    prisma.adminSession.updateMany({
      where: {
        userId: session.userId,
        id: { not: session.sessionId },
        revokedAt: null,
      },
      data: { revokedAt: now },
    }),
    prisma.authAuditLog.create({
      data: {
        eventType: "ADMIN_MFA_ENROLLED",
        actorType: actorType(session.siteRole),
        actorId: session.userId,
        actorLabel: session.email,
        targetType: "ADMIN_USER",
        targetId: session.userId,
        targetLabel: session.email,
      },
    }),
  ]);

  const response = NextResponse.json({ ok: true, recoveryCodes });
  await markAdminSessionStepUpVerified(req, response);
  return response;
}
