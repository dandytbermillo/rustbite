import { NextRequest, NextResponse } from "next/server";
import {
  createAdminSession,
  setAdminSessionCookie,
} from "@/lib/admin-sessions";
import {
  ADMIN_MFA_LOGIN_MAX_ATTEMPTS,
  clearAdminMfaLoginCookie,
  getAdminMfaLoginChallenge,
} from "@/lib/admin-login-mfa";
import {
  decryptMfaSecret,
  hashMfaRecoveryCode,
  verifyTotpCode,
} from "@/lib/admin-mfa";
import {
  accountTypeToSiteRole,
  effectiveAdminAccountType,
} from "@/lib/admin-user-management";
import { prisma } from "@/lib/db";
import {
  normalizeAdminEmail,
  requireSameOriginMutation,
} from "@/lib/production-auth";
import {
  getLoginIpHash,
  getLoginRateLimitStatus,
  recordLoginAttempt,
} from "@/lib/login-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function redirectToLogin(req: NextRequest, error?: string) {
  const url = new URL("/admin/login", req.url);
  if (error) url.searchParams.set("error", error);
  return NextResponse.redirect(url);
}

function redirectToMfa(req: NextRequest, error?: string) {
  const url = new URL("/admin/login/mfa", req.url);
  if (error) url.searchParams.set("error", error);
  return NextResponse.redirect(url);
}

function adminLoginActorType(siteRole: string | null): string {
  if (siteRole === "OWNER") return "ADMIN_OWNER";
  if (siteRole === "ADMIN") return "ADMIN_ADMIN";
  return "ADMIN_OUTLET_USER";
}

export async function POST(req: NextRequest) {
  const originError = requireSameOriginMutation(req);
  if (originError) return originError;

  const challenge = await getAdminMfaLoginChallenge(req);
  if (
    !challenge ||
    challenge.consumedAt ||
    challenge.expiresAt <= new Date() ||
    challenge.attempts >= ADMIN_MFA_LOGIN_MAX_ATTEMPTS ||
    !challenge.user.isActive ||
    !challenge.user.mfaEnabledAt ||
    !challenge.user.mfaSecretCiphertext
  ) {
    const response = redirectToLogin(req, "mfa_expired");
    clearAdminMfaLoginCookie(response);
    return response;
  }

  const formData = await req.formData();
  const code = formData.get("code")?.toString() ?? "";
  const accountType = effectiveAdminAccountType(
    challenge.user.accountType,
    challenge.user.siteRole
  );
  const siteRole = accountTypeToSiteRole(accountType);
  const subjectKey = normalizeAdminEmail(challenge.user.email);
  const rateLimit = await getLoginRateLimitStatus({
    subjectType: "ADMIN_MFA",
    subjectKey,
    req,
  });
  if (rateLimit.blocked) {
    await prisma.authAuditLog.create({
      data: {
        eventType: "ADMIN_LOGIN_MFA_RATE_LIMITED",
        actorType: adminLoginActorType(siteRole),
        actorId: challenge.user.id,
        actorLabel: challenge.user.email,
        targetType: "ADMIN_USER",
        targetId: challenge.user.id,
        targetLabel: challenge.user.email,
        ipHash: getLoginIpHash(req),
        metadata: {
          retryAfterSeconds: rateLimit.retryAfterSeconds,
          reason: rateLimit.reason ?? "unknown",
          policy: rateLimit.policy,
        },
      },
    });
    return redirectToMfa(req, "locked");
  }

  const secret = decryptMfaSecret(challenge.user.mfaSecretCiphertext);
  let mfaMethod = "totp";
  let mfaAccepted = verifyTotpCode(secret, code);

  if (!mfaAccepted) {
    const recoveryCodeHash = hashMfaRecoveryCode(code);
    const recoveryCode = recoveryCodeHash
      ? await prisma.adminMfaRecoveryCode.findUnique({
          where: { codeHash: recoveryCodeHash },
          select: { id: true, userId: true, usedAt: true },
        })
      : null;

    if (
      recoveryCode &&
      recoveryCode.userId === challenge.user.id &&
      !recoveryCode.usedAt
    ) {
      const consumed = await prisma.adminMfaRecoveryCode.updateMany({
        where: { id: recoveryCode.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      mfaAccepted = consumed.count === 1;
      if (mfaAccepted) mfaMethod = "recovery_code";
    }
  }

  if (!mfaAccepted) {
    await prisma.$transaction([
      prisma.adminMfaLoginChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      }),
      prisma.authAuditLog.create({
        data: {
          eventType: "ADMIN_LOGIN_MFA_FAILED",
          actorType: adminLoginActorType(siteRole),
          actorId: challenge.user.id,
          actorLabel: challenge.user.email,
          targetType: "ADMIN_USER",
          targetId: challenge.user.id,
          targetLabel: challenge.user.email,
          ipHash: getLoginIpHash(req),
        },
      }),
    ]);
    await recordLoginAttempt({
      subjectType: "ADMIN_MFA",
      subjectKey,
      req,
      succeeded: false,
      metadata: { reason: "invalid_mfa_code" },
    });
    return redirectToMfa(req, "invalid");
  }

  const { token, expiresAt } = await createAdminSession(challenge.user.id, req);
  await prisma.$transaction([
    prisma.adminMfaLoginChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    }),
    prisma.adminUser.update({
      where: { id: challenge.user.id },
      data: { lastLoginAt: new Date() },
    }),
    prisma.authAuditLog.create({
      data: {
        eventType: "ADMIN_LOGIN_SUCCEEDED",
        actorType: adminLoginActorType(siteRole),
        actorId: challenge.user.id,
        actorLabel: challenge.user.email,
        targetType: "ADMIN_USER",
        targetId: challenge.user.id,
        targetLabel: challenge.user.email,
        ipHash: getLoginIpHash(req),
        metadata: { mfaVerified: true, method: mfaMethod },
      },
    }),
  ]);
  await recordLoginAttempt({
    subjectType: "ADMIN_MFA",
    subjectKey,
    req,
    succeeded: true,
    metadata: { mfaVerified: true, method: mfaMethod },
  });

  const response = NextResponse.redirect(new URL("/admin", req.url));
  clearAdminMfaLoginCookie(response);
  setAdminSessionCookie(response, token, expiresAt);
  return response;
}
