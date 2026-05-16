import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  adminPasswordResetBaseUrl,
  ADMIN_PASSWORD_RESET_TOKEN_MS,
  createAdminPasswordResetToken,
  encryptAdminPasswordResetSecret,
  hashAdminPasswordResetToken,
} from "@/lib/admin-password-reset";
import { normalizeAdminEmail, requireSameOriginMutation } from "@/lib/production-auth";
import {
  authEmailImmediateDeliveryReady,
  sendPendingAuthEmails,
} from "@/lib/auth-email-outbox";
import {
  getLoginIpHash,
  getLoginRateLimitStatus,
  recordLoginAttempt,
} from "@/lib/login-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function doneRedirect(req: NextRequest) {
  return NextResponse.redirect(new URL("/admin/forgot-password?sent=1", req.url));
}

export async function POST(req: NextRequest) {
  const originError = requireSameOriginMutation(req);
  if (originError) return originError;

  const formData = await req.formData();
  const email = normalizeAdminEmail(formData.get("email")?.toString() ?? "");
  const subjectKey = email || "(blank)";
  const rateLimit = await getLoginRateLimitStatus({
    subjectType: "ADMIN_PASSWORD_RESET",
    subjectKey,
    req,
  });

  if (rateLimit.blocked) {
    await prisma.authAuditLog.create({
      data: {
        eventType: "ADMIN_PASSWORD_RESET_RATE_LIMITED",
        actorType: "SYSTEM",
        targetType: "ADMIN_PASSWORD_RESET",
        targetLabel: email || null,
        ipHash: getLoginIpHash(req),
        metadata: {
          retryAfterSeconds: rateLimit.retryAfterSeconds,
          reason: rateLimit.reason ?? "unknown",
          policy: rateLimit.policy,
        },
      },
    });
    return doneRedirect(req);
  }

  const user = email
    ? await prisma.adminUser.findUnique({
        where: { email },
        select: { id: true, email: true, isActive: true },
      })
    : null;

  let outboxId: string | null = null;

  if (user?.isActive) {
    const token = createAdminPasswordResetToken();
    const expiresAt = new Date(Date.now() + ADMIN_PASSWORD_RESET_TOKEN_MS);
    const resetUrl = `${adminPasswordResetBaseUrl()}/admin/reset-password?token=${encodeURIComponent(token)}`;
    const outboxRow = await prisma.$transaction(async (tx) => {
      await tx.adminPasswordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.adminPasswordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashAdminPasswordResetToken(token),
          expiresAt,
          requestedIpHash: getLoginIpHash(req),
          userAgent: req.headers.get("user-agent"),
        },
      });
      const emailRow = await tx.authEmailOutbox.create({
        data: {
          eventType: "ADMIN_PASSWORD_RESET_REQUESTED",
          recipientUserId: user.id,
          recipientEmail: user.email,
          subject: "Rushbite security: reset your password",
          textBody: [
            "A password reset was requested for your Rushbite admin account.",
            "",
            "The secure link expires in 30 minutes and can be used once.",
          ].join("\n"),
          metadata: {
            encryptedActionUrl: encryptAdminPasswordResetSecret(resetUrl),
          },
        },
        select: { id: true },
      });
      await tx.authAuditLog.create({
        data: {
          eventType: "ADMIN_PASSWORD_RESET_REQUESTED",
          actorType: "SYSTEM",
          targetType: "ADMIN_USER",
          targetId: user.id,
          targetLabel: user.email,
          ipHash: getLoginIpHash(req),
        },
      });
      return emailRow;
    });
    outboxId = outboxRow.id;
  }

  await recordLoginAttempt({
    subjectType: "ADMIN_PASSWORD_RESET",
    subjectKey,
    req,
    succeeded: false,
    metadata: { reason: "password_reset_requested" },
  });

  if (outboxId && authEmailImmediateDeliveryReady()) {
    try {
      await sendPendingAuthEmails({ ids: [outboxId] });
    } catch (error) {
      console.error("Immediate password-reset email delivery failed.", error);
    }
  }

  return doneRedirect(req);
}
