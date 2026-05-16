/* eslint-disable no-console */
import { createRequire } from "module";
import { NextRequest } from "next/server";
import "dotenv/config";
import { hashAdminPassword, verifyAdminPassword } from "@/lib/admin-passwords";
import { prisma } from "@/lib/db";

const require = createRequire(import.meta.url);
const runId = `password-reset-${Date.now()}`;
const adminEmail = `${runId}@example.test`;
const unknownEmail = `${runId}-missing@example.test`;
process.env.AUTH_EMAIL_DRY_RUN = "true";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${String(expected)}, got ${String(actual)}.`);
  }
}

function stubServerOnly() {
  const serverOnlyPath = require.resolve("server-only");
  require.cache[serverOnlyPath] = {
    id: serverOnlyPath,
    filename: serverOnlyPath,
    loaded: true,
    exports: {},
    children: [],
    paths: [],
  } as unknown as NodeJS.Module;
}

function formRequest(url: string, body: Record<string, string>) {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      origin: "http://localhost",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
}

function extractResetToken(text: string): string {
  const match = text.match(/\/admin\/reset-password\?token=([^\s]+)/);
  assert(match?.[1], "Delivered email should include reset token URL.");
  return decodeURIComponent(match[1]);
}

async function cleanup() {
  const users = await prisma.adminUser.findMany({
    where: { email: { in: [adminEmail, unknownEmail] } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);
  await prisma.authEmailOutbox.deleteMany({
    where: { recipientEmail: { in: [adminEmail, unknownEmail] } },
  });
  if (userIds.length > 0) {
    await prisma.adminPasswordResetToken.deleteMany({
      where: { userId: { in: userIds } },
    });
  }
  await prisma.loginAttempt.deleteMany({
    where: { subjectType: "ADMIN_PASSWORD_RESET" },
  });
  await prisma.adminUser.deleteMany({
    where: { email: { in: [adminEmail, unknownEmail] } },
  });
}

async function main() {
  stubServerOnly();
  const [
    adminMfa,
    forgotPasswordRoute,
    resetPasswordRoute,
    loginRoute,
    authEmailOutbox,
  ] = await Promise.all([
    import("@/lib/admin-mfa"),
    import("@/app/api/admin/auth/forgot-password/route"),
    import("@/app/api/admin/auth/reset-password/route"),
    import("@/app/api/admin/auth/login/route"),
    import("@/lib/auth-email-outbox"),
  ]);

  await cleanup();

  const mfaSecret = adminMfa.generateTotpSecret();
  const admin = await prisma.adminUser.create({
    data: {
      email: adminEmail,
      displayName: "Password Reset Admin",
      passwordHash: await hashAdminPassword("old-password-14chars"),
      accountType: "ADMIN",
      siteRole: "ADMIN",
      isActive: true,
      mfaSecretCiphertext: adminMfa.encryptMfaSecret(mfaSecret),
      mfaEnabledAt: new Date(),
      sessions: {
        create: {
          tokenHash: `session-${runId}`,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      },
      mfaLoginChallenges: {
        create: {
          tokenHash: `challenge-${runId}`,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      },
    },
  });

  const unknownRequest = await forgotPasswordRoute.POST(
    formRequest("http://localhost/api/admin/auth/forgot-password", {
      email: unknownEmail,
    })
  );
  assertEqual(unknownRequest.status, 307, "Unknown reset request should redirect neutrally.");
  const unknownOutbox = await prisma.authEmailOutbox.count({
    where: { recipientEmail: unknownEmail },
  });
  assertEqual(unknownOutbox, 0, "Unknown reset request should not enqueue email.");

  const resetRequest = await forgotPasswordRoute.POST(
    formRequest("http://localhost/api/admin/auth/forgot-password", {
      email: adminEmail,
    })
  );
  assertEqual(resetRequest.status, 307, "Known reset request should redirect neutrally.");
  const outboxRows = await prisma.authEmailOutbox.findMany({
    where: {
      eventType: "ADMIN_PASSWORD_RESET_REQUESTED",
      recipientEmail: adminEmail,
    },
  });
  assertEqual(outboxRows.length, 1, "Known reset request should enqueue one email.");
  assert(
    !outboxRows[0]!.textBody.includes("token="),
    "Visible reset email body should not store raw reset token."
  );

  const delivery = await authEmailOutbox.sendPendingAuthEmails({
    ids: outboxRows.map((row) => row.id),
  });
  assertEqual(delivery.sent, 1, "Password reset email should deliver in dry-run.");
  const sentRow = await prisma.authEmailOutbox.findUniqueOrThrow({
    where: { id: outboxRows[0]!.id },
  });
  const resetToken = extractResetToken(authEmailOutbox.buildAuthEmailText(sentRow));

  const mismatch = await resetPasswordRoute.POST(
    formRequest("http://localhost/api/admin/auth/reset-password", {
      token: resetToken,
      password: "new-password-14chars",
      confirmPassword: "not-the-same-14chars",
    })
  );
  assertEqual(mismatch.status, 307, "Password mismatch should redirect.");
  assert(
    mismatch.headers.get("location")?.includes("mismatch=1"),
    "Password mismatch redirect should explain mismatch."
  );
  const stillUnused = await prisma.adminPasswordResetToken.findFirstOrThrow({
    where: { userId: admin.id },
    select: { usedAt: true },
  });
  assertEqual(stillUnused.usedAt, null, "Mismatch should not consume token.");

  const completed = await resetPasswordRoute.POST(
    formRequest("http://localhost/api/admin/auth/reset-password", {
      token: resetToken,
      password: "new-password-14chars",
      confirmPassword: "new-password-14chars",
    })
  );
  assertEqual(completed.status, 307, "Valid reset should redirect.");
  assert(
    completed.headers.get("location")?.includes("done=1"),
    "Valid reset redirect should confirm completion."
  );
  const changedAdmin = await prisma.adminUser.findUniqueOrThrow({
    where: { id: admin.id },
    include: {
      sessions: true,
      mfaLoginChallenges: true,
      passwordResetTokens: true,
    },
  });
  assert(
    await verifyAdminPassword(changedAdmin.passwordHash, "new-password-14chars"),
    "Password reset should update password hash."
  );
  assert(
    changedAdmin.sessions.every((session) => session.revokedAt),
    "Password reset should revoke active sessions."
  );
  assertEqual(
    changedAdmin.mfaLoginChallenges.length,
    0,
    "Password reset should remove pending MFA login challenges."
  );
  assert(
    changedAdmin.passwordResetTokens.every((token) => token.usedAt),
    "Password reset token should be one-time use."
  );

  const reused = await resetPasswordRoute.POST(
    formRequest("http://localhost/api/admin/auth/reset-password", {
      token: resetToken,
      password: "another-password-14chars",
      confirmPassword: "another-password-14chars",
    })
  );
  assertEqual(reused.status, 307, "Used reset token should redirect.");
  assert(
    reused.headers.get("location")?.includes("invalid=1"),
    "Used reset token should be rejected as invalid."
  );

  const loginAfterReset = await loginRoute.POST(
    formRequest("http://localhost/api/admin/auth/login", {
      email: adminEmail,
      password: "new-password-14chars",
    })
  );
  assertEqual(loginAfterReset.status, 307, "Login after reset should redirect.");
  assert(
    loginAfterReset.headers.get("location")?.endsWith("/admin/login/mfa"),
    "Password reset must not bypass existing MFA."
  );

  console.log("Admin password reset tests passed.");
}

main()
  .catch((error) => {
    console.error("Admin password reset tests failed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((error) => {
      console.error("Cleanup failed.");
      console.error(error);
      process.exitCode = 1;
    });
    await prisma.$disconnect();
  });
