import { NextRequest, NextResponse } from "next/server";
import { getAdminSessionFromRequest } from "@/lib/admin-sessions";
import { decryptMfaSecret, verifyTotpCode } from "@/lib/admin-mfa";
import { markAdminSessionStepUpVerified } from "@/lib/admin-step-up";
import { prisma } from "@/lib/db";
import { requireSameOriginMutation } from "@/lib/production-auth";
import { effectiveAdminAccountType } from "@/lib/admin-user-management";
import {
  getLoginIpHash,
  getLoginRateLimitStatus,
  recordLoginAttempt,
} from "@/lib/login-rate-limit";

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
    select: {
      id: true,
      email: true,
      accountType: true,
      siteRole: true,
      mfaEnabledAt: true,
      mfaSecretCiphertext: true,
    },
  });
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized", errorCode: "unauthorized" },
      { status: 401 }
    );
  }

  const accountType = effectiveAdminAccountType(user.accountType, user.siteRole);
  if ((accountType === "OWNER" || accountType === "ADMIN") && !user.mfaEnabledAt) {
    return NextResponse.json(
      {
        error: "MFA enrollment is required before this sensitive action.",
        errorCode: "mfa_enrollment_required",
      },
      { status: 428 }
    );
  }

  if (!user.mfaSecretCiphertext) {
    return NextResponse.json(
      { error: "MFA is not enrolled", errorCode: "mfa_not_enrolled" },
      { status: 400 }
    );
  }

  const rateLimit = await getLoginRateLimitStatus({
    subjectType: "ADMIN_STEP_UP",
    subjectKey: user.email,
    req,
  });
  if (rateLimit.blocked) {
    await prisma.authAuditLog.create({
      data: {
        eventType: "ADMIN_STEP_UP_RATE_LIMITED",
        actorType: actorType(session.siteRole),
        actorId: session.userId,
        actorLabel: session.email,
        targetType: "ADMIN_USER",
        targetId: session.userId,
        targetLabel: session.email,
        ipHash: getLoginIpHash(req),
        metadata: {
          retryAfterSeconds: rateLimit.retryAfterSeconds,
          reason: rateLimit.reason ?? "unknown",
          policy: rateLimit.policy,
        },
      },
    });
    return NextResponse.json(
      {
        error: "Too many MFA attempts. Wait a few minutes and try again.",
        errorCode: "rate_limited",
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      },
      { status: 429 }
    );
  }

  const secret = decryptMfaSecret(user.mfaSecretCiphertext);
  if (!verifyTotpCode(secret, code)) {
    await prisma.authAuditLog.create({
      data: {
        eventType: "ADMIN_STEP_UP_FAILED",
        actorType: actorType(session.siteRole),
        actorId: session.userId,
        actorLabel: session.email,
        targetType: "ADMIN_USER",
        targetId: session.userId,
        targetLabel: session.email,
        ipHash: getLoginIpHash(req),
      },
    });
    await recordLoginAttempt({
      subjectType: "ADMIN_STEP_UP",
      subjectKey: user.email,
      req,
      succeeded: false,
      metadata: { reason: "invalid_mfa_code" },
    });
    return NextResponse.json(
      { error: "MFA code is invalid", errorCode: "invalid_mfa_code" },
      { status: 400 }
    );
  }

  await prisma.authAuditLog.create({
    data: {
      eventType: "ADMIN_STEP_UP_SUCCEEDED",
      actorType: actorType(session.siteRole),
      actorId: session.userId,
      actorLabel: session.email,
      targetType: "ADMIN_USER",
      targetId: session.userId,
      targetLabel: session.email,
      ipHash: getLoginIpHash(req),
    },
  });
  await recordLoginAttempt({
    subjectType: "ADMIN_STEP_UP",
    subjectKey: user.email,
    req,
    succeeded: true,
    metadata: { mfaVerified: true },
  });

  const response = NextResponse.json({ ok: true });
  await markAdminSessionStepUpVerified(req, response);
  return response;
}
