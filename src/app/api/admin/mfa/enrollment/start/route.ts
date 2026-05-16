import { NextRequest, NextResponse } from "next/server";
import { getAdminSessionFromRequest } from "@/lib/admin-sessions";
import {
  buildTotpUri,
  encryptMfaSecret,
  generateTotpSecret,
} from "@/lib/admin-mfa";
import { prisma } from "@/lib/db";
import { requireSameOriginMutation } from "@/lib/production-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

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

  const current = await prisma.adminUser.findUnique({
    where: { id: session.userId },
    select: { mfaEnabledAt: true },
  });
  if (current?.mfaEnabledAt) {
    return NextResponse.json(
      { error: "MFA is already enabled", errorCode: "mfa_already_enabled" },
      { status: 409 }
    );
  }

  const secret = generateTotpSecret();
  await prisma.$transaction([
    prisma.adminUser.update({
      where: { id: session.userId },
      data: {
        mfaSecretCiphertext: encryptMfaSecret(secret),
        mfaEnabledAt: null,
      },
    }),
    prisma.authAuditLog.create({
      data: {
        eventType: "ADMIN_MFA_ENROLLMENT_STARTED",
        actorType: session.siteRole === "OWNER" ? "ADMIN_OWNER" : session.siteRole === "ADMIN" ? "ADMIN_ADMIN" : "ADMIN_STAFF",
        actorId: session.userId,
        actorLabel: session.email,
        targetType: "ADMIN_USER",
        targetId: session.userId,
        targetLabel: session.email,
      },
    }),
  ]);

  return NextResponse.json({
    secret,
    otpauthUri: buildTotpUri({
      issuer: "Rushbite",
      accountName: session.email,
      secret,
    }),
  });
}
