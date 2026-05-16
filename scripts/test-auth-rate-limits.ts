/* eslint-disable no-console */
import { createRequire } from "module";
import { NextRequest } from "next/server";
import "dotenv/config";

const require = createRequire(import.meta.url);
const runId = `rate-limit-${Date.now()}`;
const adminEmail = `${runId}-admin@example.test`;
const mfaEmail = `${runId}-mfa@example.test`;
const resetEmail = `${runId}-reset@example.test`;

let prisma: typeof import("@/lib/db").prisma;
let hashAdminPassword: typeof import("@/lib/admin-passwords").hashAdminPassword;
let createAdminSession: typeof import("@/lib/admin-sessions").createAdminSession;
let recordLoginAttempt: typeof import("@/lib/login-rate-limit").recordLoginAttempt;

process.env.AUTH_EMAIL_DRY_RUN = "true";
process.env.LOGIN_PROGRESSIVE_BACKOFF_MIN_FAILURES = "99";
process.env.ADMIN_LOGIN_RATE_LIMIT_ACCOUNT_MAX = "2";
process.env.ADMIN_LOGIN_RATE_LIMIT_IP_MAX = "99";
process.env.ADMIN_MFA_RATE_LIMIT_ACCOUNT_MAX = "2";
process.env.ADMIN_MFA_RATE_LIMIT_IP_MAX = "99";
process.env.ADMIN_STEP_UP_RATE_LIMIT_ACCOUNT_MAX = "2";
process.env.ADMIN_STEP_UP_RATE_LIMIT_IP_MAX = "99";
process.env.ADMIN_PASSWORD_RESET_RATE_LIMIT_ACCOUNT_MAX = "2";
process.env.ADMIN_PASSWORD_RESET_RATE_LIMIT_IP_MAX = "99";
process.env.DEVICE_LOGIN_RATE_LIMIT_ACCOUNT_MAX = "2";
process.env.DEVICE_LOGIN_RATE_LIMIT_IP_MAX = "99";

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

function formRequest(
  url: string,
  body: Record<string, string>,
  input?: { cookie?: string; ip?: string }
) {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      origin: "http://localhost",
      "content-type": "application/x-www-form-urlencoded",
      "x-forwarded-for": input?.ip ?? "203.0.113.10",
      ...(input?.cookie ? { cookie: input.cookie } : {}),
    },
    body: new URLSearchParams(body).toString(),
  });
}

function jsonRequest(
  url: string,
  body: Record<string, string>,
  input?: { cookie?: string; ip?: string }
) {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      origin: "http://localhost",
      "content-type": "application/json",
      "x-forwarded-for": input?.ip ?? "203.0.113.20",
      ...(input?.cookie ? { cookie: input.cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function cleanup() {
  await prisma.authEmailOutbox.deleteMany({
    where: { recipientEmail: { in: [adminEmail, mfaEmail, resetEmail] } },
  });
  await prisma.adminUser.deleteMany({
    where: { email: { in: [adminEmail, mfaEmail, resetEmail] } },
  });
  await prisma.loginAttempt.deleteMany({
    where: {
      subjectType: {
        in: ["ADMIN", "ADMIN_MFA", "ADMIN_STEP_UP", "ADMIN_PASSWORD_RESET", "DEVICE"],
      },
    },
  });
  await prisma.authAuditLog.deleteMany({
    where: {
      OR: [
        { targetLabel: { in: [adminEmail, mfaEmail, resetEmail] } },
        { eventType: { in: ["DEVICE_LOGIN_RATE_LIMITED"] } },
      ],
    },
  });
}

async function createAdminUser(email: string) {
  return prisma.adminUser.create({
    data: {
      email,
      displayName: email,
      passwordHash: await hashAdminPassword("valid-password-14chars"),
      accountType: "ADMIN",
      siteRole: "ADMIN",
      isActive: true,
    },
  });
}

async function main() {
  stubServerOnly();
  const [
    adminMfa,
    adminPasswords,
    adminSessions,
    adminLoginRoute,
    adminMfaRoute,
    stepUpRoute,
    forgotPasswordRoute,
    deviceSessionRoute,
    adminLoginMfa,
    db,
    loginRateLimit,
    productionAuth,
  ] = await Promise.all([
    import("@/lib/admin-mfa"),
    import("@/lib/admin-passwords"),
    import("@/lib/admin-sessions"),
    import("@/app/api/admin/auth/login/route"),
    import("@/app/api/admin/auth/login/mfa/route"),
    import("@/app/api/admin/auth/step-up/route"),
    import("@/app/api/admin/auth/forgot-password/route"),
    import("@/app/api/device-session/route"),
    import("@/lib/admin-login-mfa"),
    import("@/lib/db"),
    import("@/lib/login-rate-limit"),
    import("@/lib/production-auth"),
  ]);
  prisma = db.prisma;
  hashAdminPassword = adminPasswords.hashAdminPassword;
  createAdminSession = adminSessions.createAdminSession;
  recordLoginAttempt = loginRateLimit.recordLoginAttempt;

  await cleanup();

  const admin = await createAdminUser(adminEmail);
  const preservedSession = await prisma.adminSession.create({
    data: {
      userId: admin.id,
      tokenHash: `preserved-session-${runId}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  for (let index = 0; index < 2; index += 1) {
    const failedLogin = await adminLoginRoute.POST(
      formRequest("http://localhost/api/admin/auth/login", {
        email: adminEmail,
        password: "wrong-password-14chars",
      })
    );
    assert(
      failedLogin.headers.get("location")?.includes("error=invalid"),
      "Failed admin login should redirect with invalid credentials."
    );
  }

  const lockedLogin = await adminLoginRoute.POST(
    formRequest("http://localhost/api/admin/auth/login", {
      email: adminEmail,
      password: "valid-password-14chars",
    })
  );
  assert(
    lockedLogin.headers.get("location")?.includes("error=locked"),
    "Admin login should be rate-limited after configured failures."
  );
  const stillActiveSession = await prisma.adminSession.findUniqueOrThrow({
    where: { id: preservedSession.id },
    select: { revokedAt: true },
  });
  assertEqual(
    stillActiveSession.revokedAt,
    null,
    "Rate limiting must not revoke existing valid sessions."
  );

  const mfaSecret = adminMfa.generateTotpSecret();
  const mfaUser = await prisma.adminUser.create({
    data: {
      email: mfaEmail,
      displayName: "MFA Rate Limit",
      passwordHash: await hashAdminPassword("valid-password-14chars"),
      accountType: "ADMIN",
      siteRole: "ADMIN",
      isActive: true,
      mfaSecretCiphertext: adminMfa.encryptMfaSecret(mfaSecret),
      mfaEnabledAt: new Date(),
    },
  });
  const mfaChallenge = await adminLoginMfa.createAdminMfaLoginChallenge(
    mfaUser.id,
    formRequest("http://localhost/api/admin/auth/login", {
      email: mfaEmail,
      password: "valid-password-14chars",
    })
  );
  for (let index = 0; index < 2; index += 1) {
    await recordLoginAttempt({
      subjectType: "ADMIN_MFA",
      subjectKey: mfaEmail,
      req: formRequest("http://localhost/api/admin/auth/login/mfa", {
        code: "000000",
      }),
      succeeded: false,
      metadata: { reason: "test_preload" },
    });
  }
  const lockedMfa = await adminMfaRoute.POST(
    formRequest(
      "http://localhost/api/admin/auth/login/mfa",
      { code: "000000" },
      { cookie: `${adminLoginMfa.ADMIN_MFA_LOGIN_COOKIE}=${mfaChallenge.token}` }
    )
  );
  assert(
    lockedMfa.headers.get("location")?.includes("error=locked"),
    "MFA login should be rate-limited separately from password login."
  );

  const stepUpSession = await createAdminSession(mfaUser.id, jsonRequest("http://localhost/x", {}));
  for (let index = 0; index < 2; index += 1) {
    await recordLoginAttempt({
      subjectType: "ADMIN_STEP_UP",
      subjectKey: mfaEmail,
      req: jsonRequest("http://localhost/api/admin/auth/step-up", {
        code: "000000",
      }),
      succeeded: false,
      metadata: { reason: "test_preload" },
    });
  }
  const lockedStepUp = await stepUpRoute.POST(
    jsonRequest(
      "http://localhost/api/admin/auth/step-up",
      { code: "000000" },
      { cookie: `${productionAuth.ADMIN_SESSION_COOKIE}=${stepUpSession.token}` }
    )
  );
  assertEqual(lockedStepUp.status, 429, "Step-up MFA should return 429 when limited.");
  const stepUpBody = (await lockedStepUp.json()) as { errorCode?: string };
  assertEqual(stepUpBody.errorCode, "rate_limited", "Step-up rate limit should be structured.");

  await createAdminUser(resetEmail);
  for (let index = 0; index < 2; index += 1) {
    const reset = await forgotPasswordRoute.POST(
      formRequest("http://localhost/api/admin/auth/forgot-password", {
        email: resetEmail,
      })
    );
    assertEqual(reset.status, 307, "Password reset request should redirect neutrally.");
  }
  const outboxBeforeLimit = await prisma.authEmailOutbox.count({
    where: {
      eventType: "ADMIN_PASSWORD_RESET_REQUESTED",
      recipientEmail: resetEmail,
    },
  });
  const limitedReset = await forgotPasswordRoute.POST(
    formRequest("http://localhost/api/admin/auth/forgot-password", {
      email: resetEmail,
    })
  );
  assertEqual(limitedReset.status, 307, "Limited reset request should still redirect neutrally.");
  const outboxAfterLimit = await prisma.authEmailOutbox.count({
    where: {
      eventType: "ADMIN_PASSWORD_RESET_REQUESTED",
      recipientEmail: resetEmail,
    },
  });
  assertEqual(
    outboxAfterLimit,
    outboxBeforeLimit,
    "Rate-limited reset requests must not enqueue another email."
  );

  for (let index = 0; index < 2; index += 1) {
    const badDevice = await deviceSessionRoute.POST(
      formRequest("http://localhost/api/device-session", {
        role: "kiosk",
        next: "/kiosk",
        password: "wrong-device-code",
      })
    );
    assert(
      badDevice.headers.get("location")?.includes("error=invalid"),
      "Failed device login should redirect with invalid credentials."
    );
  }
  const lockedDevice = await deviceSessionRoute.POST(
    formRequest("http://localhost/api/device-session", {
      role: "kiosk",
      next: "/kiosk",
      password: "wrong-device-code",
    })
  );
  assert(
    lockedDevice.headers.get("location")?.includes("error=locked"),
    "Device login should be rate-limited."
  );

  console.log("Auth rate-limit tests passed.");
}

main()
  .catch((error) => {
    console.error("Auth rate-limit tests failed.");
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
