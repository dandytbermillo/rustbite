import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  verifyAdminPassword,
  verifySentinelAdminPassword,
} from "@/lib/admin-passwords";
import {
  createAdminSession,
  setAdminSessionCookie,
} from "@/lib/admin-sessions";
import {
  createAdminMfaLoginChallenge,
  setAdminMfaLoginCookie,
} from "@/lib/admin-login-mfa";
import {
  normalizeAdminEmail,
  requireSameOriginMutation,
} from "@/lib/production-auth";
import {
  effectiveAdminAccountType,
  accountTypeToSiteRole,
} from "@/lib/admin-user-management";
import { isOwnerOrAdminAccount } from "@/lib/admin-mfa";
import {
  getLoginIpHash,
  getLoginRateLimitStatus,
  recordLoginAttempt,
} from "@/lib/login-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function loginRedirect(req: NextRequest, error?: string) {
  const url = new URL("/admin/login", req.url);
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

  const formData = await req.formData();
  const email = normalizeAdminEmail(formData.get("email")?.toString() ?? "");
  const password = formData.get("password")?.toString() ?? "";
  const subjectKey = email || "(blank)";

  const rateLimit = await getLoginRateLimitStatus({
    subjectType: "ADMIN",
    subjectKey,
    req,
  });
  if (rateLimit.blocked) {
    await prisma.authAuditLog.create({
      data: {
        eventType: "ADMIN_LOGIN_RATE_LIMITED",
        actorType: "SYSTEM",
        targetType: "ADMIN_LOGIN",
        targetLabel: email || null,
        ipHash: getLoginIpHash(req),
        metadata: {
          retryAfterSeconds: rateLimit.retryAfterSeconds,
          reason: rateLimit.reason ?? "unknown",
          policy: rateLimit.policy,
        },
      },
    });
    return loginRedirect(req, "locked");
  }

  const user = email
    ? await prisma.adminUser.findUnique({ where: { email } })
    : null;

  if (!user) {
    await verifySentinelAdminPassword(password);
    await recordLoginAttempt({
      subjectType: "ADMIN",
      subjectKey,
      req,
      succeeded: false,
      metadata: { reason: "invalid_credentials" },
    });
    return loginRedirect(req, "invalid");
  }

  const passwordOk = await verifyAdminPassword(user.passwordHash, password);
  if (!passwordOk || !user.isActive) {
    await recordLoginAttempt({
      subjectType: "ADMIN",
      subjectKey,
      req,
      succeeded: false,
      metadata: { reason: "invalid_credentials" },
    });
    return loginRedirect(req, "invalid");
  }

  const accountType = effectiveAdminAccountType(user.accountType, user.siteRole);
  const siteRole = accountTypeToSiteRole(accountType);

  if (isOwnerOrAdminAccount(accountType) && user.mfaEnabledAt && user.mfaSecretCiphertext) {
    const { token, expiresAt } = await createAdminMfaLoginChallenge(user.id, req);
    await prisma.authAuditLog.create({
      data: {
        eventType: "ADMIN_LOGIN_MFA_REQUIRED",
        actorType: adminLoginActorType(siteRole),
        actorId: user.id,
        actorLabel: user.email,
        targetType: "ADMIN_USER",
        targetId: user.id,
        targetLabel: user.email,
        ipHash: getLoginIpHash(req),
      },
    });

    await recordLoginAttempt({
      subjectType: "ADMIN",
      subjectKey,
      req,
      succeeded: true,
      metadata: { mfaRequired: true },
    });

    const response = NextResponse.redirect(new URL("/admin/login/mfa", req.url));
    setAdminMfaLoginCookie(response, token, expiresAt);
    return response;
  }

  const requiresMfaEnrollment = isOwnerOrAdminAccount(accountType) && !user.mfaEnabledAt;
  const { token, expiresAt } = await createAdminSession(user.id, req, {
    mfaEnrollmentOnly: requiresMfaEnrollment,
  });
  await prisma.$transaction([
    prisma.adminUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    }),
    prisma.authAuditLog.create({
      data: {
        eventType: "ADMIN_LOGIN_SUCCEEDED",
        actorType: adminLoginActorType(siteRole),
        actorId: user.id,
        actorLabel: user.email,
        targetType: "ADMIN_USER",
        targetId: user.id,
        targetLabel: user.email,
        ipHash: getLoginIpHash(req),
        metadata: requiresMfaEnrollment ? { mfaEnrollmentRequired: true } : undefined,
      },
    }),
  ]);

  await recordLoginAttempt({
    subjectType: "ADMIN",
    subjectKey,
    req,
    succeeded: true,
  });

  const response = NextResponse.redirect(
    new URL(requiresMfaEnrollment ? "/admin/security/mfa" : "/admin", req.url)
  );
  setAdminSessionCookie(response, token, expiresAt);
  return response;
}
