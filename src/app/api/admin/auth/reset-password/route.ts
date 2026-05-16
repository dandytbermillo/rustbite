import { NextRequest, NextResponse } from "next/server";
import { hashAdminPassword } from "@/lib/admin-passwords";
import { hashAdminPasswordResetToken } from "@/lib/admin-password-reset";
import { prisma } from "@/lib/db";
import { requireSameOriginMutation } from "@/lib/production-auth";
import { parsePassword } from "@/lib/admin-user-management";
import { getLoginIpHash } from "@/lib/login-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function resetRedirect(
  req: NextRequest,
  result: "done" | "invalid" | "mismatch",
  token?: string
) {
  const url = new URL("/admin/reset-password", req.url);
  url.searchParams.set(result, "1");
  if (token) url.searchParams.set("token", token);
  return NextResponse.redirect(url);
}

export async function POST(req: NextRequest) {
  const originError = requireSameOriginMutation(req);
  if (originError) return originError;

  const formData = await req.formData();
  const token = formData.get("token")?.toString() ?? "";
  const password = formData.get("password")?.toString() ?? "";
  const confirmPassword = formData.get("confirmPassword")?.toString() ?? "";
  if (!token) return resetRedirect(req, "invalid");
  if (password !== confirmPassword) return resetRedirect(req, "mismatch", token);

  const parsedPassword = parsePassword(password);
  if (!parsedPassword.ok) return resetRedirect(req, "invalid", token);

  const tokenHash = hashAdminPasswordResetToken(token);
  const resetToken = await prisma.adminPasswordResetToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, email: true, isActive: true } } },
  });

  if (
    !resetToken ||
    resetToken.usedAt ||
    resetToken.expiresAt <= new Date() ||
    !resetToken.user.isActive
  ) {
    return resetRedirect(req, "invalid");
  }

  const passwordHash = await hashAdminPassword(parsedPassword.value);
  const now = new Date();
  const consumed = await prisma.$transaction(async (tx) => {
    const claimed = await tx.adminPasswordResetToken.updateMany({
      where: { id: resetToken.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) return false;

    await tx.adminUser.update({
      where: { id: resetToken.userId },
      data: { passwordHash, passwordChangedAt: now },
    });
    await Promise.all([
      tx.adminSession.updateMany({
        where: { userId: resetToken.userId, revokedAt: null },
        data: { revokedAt: now },
      }),
      tx.adminMfaLoginChallenge.deleteMany({
        where: { userId: resetToken.userId },
      }),
      tx.authEmailOutbox.create({
        data: {
          eventType: "ADMIN_PASSWORD_RESET_COMPLETED",
          recipientUserId: resetToken.userId,
          recipientEmail: resetToken.user.email,
          subject: "Rushbite security: password changed",
          textBody: [
            "Your Rushbite admin password was changed.",
            "",
            "If this was not you, contact an Owner immediately.",
          ].join("\n"),
          metadata: { targetUserId: resetToken.userId },
        },
      }),
      tx.authAuditLog.create({
        data: {
          eventType: "ADMIN_PASSWORD_RESET_COMPLETED",
          actorType: "ADMIN_USER",
          actorId: resetToken.userId,
          actorLabel: resetToken.user.email,
          targetType: "ADMIN_USER",
          targetId: resetToken.userId,
          targetLabel: resetToken.user.email,
          ipHash: getLoginIpHash(req),
          metadata: { selfService: true, sessionsRevoked: true },
        },
      }),
    ]);
    return true;
  });

  return consumed ? resetRedirect(req, "done") : resetRedirect(req, "invalid");
}
