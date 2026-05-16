/* eslint-disable no-console */
import { createRequire } from "module";
import { NextRequest } from "next/server";
import "dotenv/config";
import { hashAdminPassword } from "@/lib/admin-passwords";
import { prisma } from "@/lib/db";

const require = createRequire(import.meta.url);
const runId = `mfa-step-up-${Date.now()}`;
const ownerEmail = `${runId}@example.test`;
const adminEmail = `${runId}-admin@example.test`;
const targetOwnerEmail = `${runId}-target-owner@example.test`;
const deviceName = `${runId} device`;

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

function request(
  method: string,
  url: string,
  cookies: Record<string, string>,
  body?: Record<string, unknown>
) {
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  return new NextRequest(url, {
    method,
    headers: {
      origin: "http://localhost",
      ...(cookie ? { cookie } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function formRequest(
  method: string,
  url: string,
  cookies: Record<string, string>,
  body: Record<string, string>
) {
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  return new NextRequest(url, {
    method,
    headers: {
      origin: "http://localhost",
      ...(cookie ? { cookie } : {}),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
}

async function cleanup() {
  const emails = [ownerEmail, adminEmail, targetOwnerEmail];
  const users = await prisma.adminUser.findMany({
    where: { email: { in: emails } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);
  await prisma.device.deleteMany({ where: { name: deviceName } });
  await prisma.authEmailOutbox.deleteMany({
    where: { recipientEmail: { in: emails } },
  });
  if (userIds.length > 0) {
    await prisma.pendingOwnerChangeCancelToken.deleteMany({
      where: { ownerUserId: { in: userIds } },
    });
    await prisma.pendingOwnerChange.deleteMany({
      where: { OR: [{ actorId: { in: userIds } }, { targetId: { in: userIds } }] },
    });
  }
  await prisma.adminUser.deleteMany({ where: { email: { in: emails } } });
}

async function ensureCafeteriaOutlet() {
  await prisma.site.upsert({
    where: { id: "site" },
    update: {},
    create: {
      id: "site",
      name: "Rushbite",
      timezone: "America/Edmonton",
    },
  });
  await prisma.outlet.upsert({
    where: { id: "cafeteria" },
    update: { isActive: true },
    create: {
      id: "cafeteria",
      siteId: "site",
      name: "Cafeteria",
      slug: "cafeteria",
      orderPrefix: "C",
      isActive: true,
    },
  });
}

function sessionTokenFromSetCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/rb_admin_session=([^;]+)/);
  assert(match?.[1], "Step-up response should rotate the admin session cookie.");
  return match[1];
}

function mfaLoginTokenFromSetCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/rb_admin_mfa_login=([^;]+)/);
  assert(match?.[1], "Password login should set the pending MFA cookie.");
  return match[1];
}

async function main() {
  stubServerOnly();
  const [
    productionAuth,
    adminMfa,
    adminStepUp,
    stepUpRoute,
    devicesRoute,
    resetMfaRoute,
    ownerChanges,
    loginRoute,
    loginMfaRoute,
  ] = await Promise.all([
    import("@/lib/production-auth"),
    import("@/lib/admin-mfa"),
    import("@/lib/admin-step-up"),
    import("@/app/api/admin/auth/step-up/route"),
    import("@/app/api/admin/devices/route"),
    import("@/app/api/admin/users/[id]/reset-mfa/route"),
    import("@/lib/admin-owner-changes"),
    import("@/app/api/admin/auth/login/route"),
    import("@/app/api/admin/auth/login/mfa/route"),
  ]);

  await cleanup();
  await ensureCafeteriaOutlet();
  const owner = await prisma.adminUser.create({
    data: {
      email: ownerEmail,
      displayName: "MFA Test Owner",
      passwordHash: await hashAdminPassword("test-password-14chars"),
      accountType: "OWNER",
      siteRole: "OWNER",
      isActive: true,
    },
  });

  const token = productionAuth.createSessionToken();
  const initialTokenHash = productionAuth.hashSessionToken(token);
  await prisma.adminSession.create({
    data: {
      userId: owner.id,
      tokenHash: initialTokenHash,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  const enrollmentLogin = await loginRoute.POST(
    formRequest("POST", "http://localhost/api/admin/auth/login", {}, {
      email: ownerEmail,
      password: "test-password-14chars",
    })
  );
  assertEqual(
    enrollmentLogin.status,
    307,
    "Owner without MFA should receive a limited enrollment session."
  );
  assert(
    enrollmentLogin.headers.get("location")?.endsWith("/admin/security/mfa"),
    "Owner without MFA should be sent directly to MFA setup."
  );
  const enrollmentToken = sessionTokenFromSetCookie(enrollmentLogin);
  const enrollmentSession = await prisma.adminSession.findUniqueOrThrow({
    where: { tokenHash: productionAuth.hashSessionToken(enrollmentToken) },
    select: { expiresAt: true },
  });
  assert(
    enrollmentSession.expiresAt.getTime() - Date.now() <= 61 * 60 * 1000,
    "Limited MFA-enrollment session should expire after about 1 hour."
  );
  const enrollmentBlockedDevice = await devicesRoute.POST(
    request(
      "POST",
      "http://localhost/api/admin/devices",
      { [productionAuth.ADMIN_SESSION_COOKIE]: enrollmentToken },
      {
        name: deviceName,
        role: "kiosk",
        isSharedAcrossOutlets: false,
        outletId: "cafeteria",
        physicalLocation: "test counter",
        sharedOutletIds: [],
      }
    )
  );
  assertEqual(
    enrollmentBlockedDevice.status,
    428,
    "Limited MFA-enrollment session should not access admin APIs."
  );
  const enrollmentBlockedBody = (await enrollmentBlockedDevice.json()) as {
    errorCode?: string;
  };
  assertEqual(
    enrollmentBlockedBody.errorCode,
    "mfa_enrollment_required",
    "Limited MFA-enrollment API block should use enrollment error code."
  );

  const missingMfa = await adminStepUp.requireFreshAdminStepUp(
    request("POST", "http://localhost/api/admin/users", {
      [productionAuth.ADMIN_SESSION_COOKIE]: token,
    })
  );
  assert(missingMfa, "Owner without MFA should require enrollment.");
  assertEqual(missingMfa.status, 428, "Missing MFA should return 428.");
  const missingBody = (await missingMfa.json()) as { errorCode?: string };
  assertEqual(
    missingBody.errorCode,
    "mfa_enrollment_required",
    "Missing MFA should use enrollment error code"
  );

  const secret = adminMfa.generateTotpSecret();
  await prisma.adminUser.update({
    where: { id: owner.id },
    data: {
      mfaSecretCiphertext: adminMfa.encryptMfaSecret(secret),
      mfaEnabledAt: new Date(),
    },
  });

  const passwordLogin = await loginRoute.POST(
    formRequest("POST", "http://localhost/api/admin/auth/login", {}, {
      email: ownerEmail,
      password: "test-password-14chars",
    })
  );
  assertEqual(passwordLogin.status, 307, "Password login should redirect to MFA.");
  assert(
    passwordLogin.headers.get("location")?.endsWith("/admin/login/mfa"),
    "Password login should redirect to MFA page."
  );
  assert(
    !passwordLogin.headers.get("set-cookie")?.includes("rb_admin_session="),
    "Password login must not issue a full admin session before MFA."
  );
  const pendingMfaToken = mfaLoginTokenFromSetCookie(passwordLogin);

  const badLoginMfa = await loginMfaRoute.POST(
    formRequest(
      "POST",
      "http://localhost/api/admin/auth/login/mfa",
      { rb_admin_mfa_login: pendingMfaToken },
      { code: "000000" }
    )
  );
  assertEqual(badLoginMfa.status, 307, "Invalid login MFA should redirect.");
  assert(
    badLoginMfa.headers.get("location")?.endsWith("/admin/login/mfa?error=invalid"),
    "Invalid login MFA should return to the MFA page with an error."
  );

  const goodLoginMfa = await loginMfaRoute.POST(
    formRequest(
      "POST",
      "http://localhost/api/admin/auth/login/mfa",
      { rb_admin_mfa_login: pendingMfaToken },
      { code: adminMfa.generateTotpCode(secret) }
    )
  );
  assertEqual(goodLoginMfa.status, 307, "Valid login MFA should redirect.");
  assert(
    goodLoginMfa.headers.get("location")?.endsWith("/admin"),
    "Valid login MFA should redirect to admin."
  );
  const loginSessionToken = sessionTokenFromSetCookie(goodLoginMfa);
  assert(loginSessionToken, "Valid login MFA should issue an admin session.");

  const consumedChallenge = await prisma.adminMfaLoginChallenge.findFirstOrThrow({
    where: { userId: owner.id },
    orderBy: { createdAt: "desc" },
    select: { consumedAt: true, attempts: true },
  });
  assert(consumedChallenge.consumedAt, "Login MFA challenge should be consumed.");
  assertEqual(consumedChallenge.attempts, 1, "Invalid login MFA attempt should be counted.");

  const [recoveryCode] = adminMfa.generateMfaRecoveryCodes(1);
  assert(recoveryCode, "Recovery code helper should generate a code.");
  await prisma.adminMfaRecoveryCode.create({
    data: {
      userId: owner.id,
      codeHash: adminMfa.hashMfaRecoveryCode(recoveryCode),
    },
  });

  const recoveryPasswordLogin = await loginRoute.POST(
    formRequest("POST", "http://localhost/api/admin/auth/login", {}, {
      email: ownerEmail,
      password: "test-password-14chars",
    })
  );
  const recoveryPendingToken = mfaLoginTokenFromSetCookie(recoveryPasswordLogin);
  const recoveryLogin = await loginMfaRoute.POST(
    formRequest(
      "POST",
      "http://localhost/api/admin/auth/login/mfa",
      { rb_admin_mfa_login: recoveryPendingToken },
      { code: recoveryCode }
    )
  );
  assertEqual(recoveryLogin.status, 307, "Recovery-code login should redirect.");
  assert(
    recoveryLogin.headers.get("location")?.endsWith("/admin"),
    "Recovery-code login should complete admin sign-in."
  );
  assert(
    sessionTokenFromSetCookie(recoveryLogin),
    "Recovery-code login should issue an admin session."
  );
  const usedRecoveryCode = await prisma.adminMfaRecoveryCode.findUniqueOrThrow({
    where: { codeHash: adminMfa.hashMfaRecoveryCode(recoveryCode) },
    select: { usedAt: true },
  });
  assert(usedRecoveryCode.usedAt, "Recovery code should be marked used.");

  const reusedPasswordLogin = await loginRoute.POST(
    formRequest("POST", "http://localhost/api/admin/auth/login", {}, {
      email: ownerEmail,
      password: "test-password-14chars",
    })
  );
  const reusedPendingToken = mfaLoginTokenFromSetCookie(reusedPasswordLogin);
  const reusedRecoveryLogin = await loginMfaRoute.POST(
    formRequest(
      "POST",
      "http://localhost/api/admin/auth/login/mfa",
      { rb_admin_mfa_login: reusedPendingToken },
      { code: recoveryCode }
    )
  );
  assertEqual(reusedRecoveryLogin.status, 307, "Used recovery code should redirect.");
  assert(
    reusedRecoveryLogin.headers.get("location")?.endsWith("/admin/login/mfa?error=invalid"),
    "Used recovery code should be rejected."
  );
  assert(
    !reusedRecoveryLogin.headers.get("set-cookie")?.includes("rb_admin_session="),
    "Used recovery code must not issue an admin session."
  );

  const staleStepUp = await adminStepUp.requireFreshAdminStepUp(
    request("POST", "http://localhost/api/admin/users", {
      [productionAuth.ADMIN_SESSION_COOKIE]: token,
    })
  );
  assert(staleStepUp, "Owner with MFA but no step-up should require code.");
  assertEqual(staleStepUp.status, 428, "Missing step-up should return 428.");
  const staleBody = (await staleStepUp.json()) as { errorCode?: string };
  assertEqual(
    staleBody.errorCode,
    "step_up_required",
    "Missing step-up should use step-up error code"
  );

  const deviceWithoutStepUp = await devicesRoute.POST(
    request(
      "POST",
      "http://localhost/api/admin/devices",
      { [productionAuth.ADMIN_SESSION_COOKIE]: token },
      {
        name: deviceName,
        role: "kiosk",
        isSharedAcrossOutlets: false,
        outletId: "cafeteria",
        physicalLocation: "test counter",
        sharedOutletIds: [],
      }
    )
  );
  assertEqual(
    deviceWithoutStepUp.status,
    428,
    "Dangerous device create should require step-up."
  );

  const badCode = await stepUpRoute.POST(
    request(
      "POST",
      "http://localhost/api/admin/auth/step-up",
      { [productionAuth.ADMIN_SESSION_COOKIE]: token },
      { code: "000000" }
    )
  );
  assertEqual(badCode.status, 400, "Invalid MFA code should be rejected.");

  const goodCode = adminMfa.generateTotpCode(secret);
  const verified = await stepUpRoute.POST(
    request(
      "POST",
      "http://localhost/api/admin/auth/step-up",
      { [productionAuth.ADMIN_SESSION_COOKIE]: token },
      { code: goodCode }
    )
  );
  assertEqual(verified.status, 200, "Valid MFA code should verify step-up.");
  const rotatedToken = sessionTokenFromSetCookie(verified);

  const updatedSession = await prisma.adminSession.findUniqueOrThrow({
    where: { tokenHash: productionAuth.hashSessionToken(rotatedToken) },
    select: {
      tokenHash: true,
      stepUpVerifiedAt: true,
      stepUpExpiresAt: true,
    },
  });
  assert(updatedSession.stepUpVerifiedAt, "Step-up verified timestamp should be set.");
  assert(updatedSession.stepUpExpiresAt, "Step-up expiry should be set.");
  assert(
    updatedSession.stepUpExpiresAt > new Date(),
    "Step-up expiry should be in the future."
  );
  assert(
    updatedSession.tokenHash !== initialTokenHash,
    "Session token hash should rotate after step-up."
  );

  const deviceWithStepUp = await devicesRoute.POST(
    request(
      "POST",
      "http://localhost/api/admin/devices",
      { [productionAuth.ADMIN_SESSION_COOKIE]: rotatedToken },
      {
        name: deviceName,
        role: "kiosk",
        isSharedAcrossOutlets: false,
        outletId: "cafeteria",
        physicalLocation: "test counter",
        sharedOutletIds: [],
      }
    )
  );
  const deviceJson = (await deviceWithStepUp.json()) as { accessCode?: string; error?: string };
  assertEqual(
    deviceWithStepUp.status,
    201,
    `Device create should succeed after step-up: ${deviceJson.error ?? ""}`
  );
  assert(deviceJson.accessCode, "Device create should return an access code after step-up.");

  const adminSecret = adminMfa.generateTotpSecret();
  const adminRecoveryCode = adminMfa.generateMfaRecoveryCodes(1)[0]!;
  const adminUser = await prisma.adminUser.create({
    data: {
      email: adminEmail,
      displayName: "MFA Test Admin",
      passwordHash: await hashAdminPassword("admin-password-14chars"),
      accountType: "ADMIN",
      siteRole: "ADMIN",
      isActive: true,
      mfaSecretCiphertext: adminMfa.encryptMfaSecret(adminSecret),
      mfaEnabledAt: new Date(),
      mfaRecoveryCodes: {
        create: { codeHash: adminMfa.hashMfaRecoveryCode(adminRecoveryCode) },
      },
      sessions: {
        create: {
          tokenHash: productionAuth.hashSessionToken(productionAuth.createSessionToken()),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      },
    },
  });

  const resetAdminMfa = await resetMfaRoute.POST(
    request(
      "POST",
      `http://localhost/api/admin/users/${adminUser.id}/reset-mfa`,
      { [productionAuth.ADMIN_SESSION_COOKIE]: rotatedToken }
    ),
    { params: Promise.resolve({ id: adminUser.id }) }
  );
  assertEqual(resetAdminMfa.status, 200, "Owner should reset Admin MFA immediately.");
  const resetAdmin = await prisma.adminUser.findUniqueOrThrow({
    where: { id: adminUser.id },
    select: {
      mfaEnabledAt: true,
      mfaSecretCiphertext: true,
      mfaRecoveryCodes: true,
      sessions: { select: { revokedAt: true } },
    },
  });
  assertEqual(resetAdmin.mfaEnabledAt, null, "MFA reset should clear enabled timestamp.");
  assertEqual(resetAdmin.mfaSecretCiphertext, null, "MFA reset should clear secret.");
  assertEqual(resetAdmin.mfaRecoveryCodes.length, 0, "MFA reset should delete recovery codes.");
  assert(
    resetAdmin.sessions.every((session) => session.revokedAt),
    "MFA reset should revoke target sessions."
  );
  const adminResetEmail = await prisma.authEmailOutbox.count({
    where: { eventType: "ADMIN_USER_MFA_RESET", recipientEmail: adminEmail },
  });
  assertEqual(adminResetEmail, 1, "MFA reset should enqueue a target security email.");

  const adminLoginAfterReset = await loginRoute.POST(
    formRequest("POST", "http://localhost/api/admin/auth/login", {}, {
      email: adminEmail,
      password: "admin-password-14chars",
    })
  );
  assertEqual(
    adminLoginAfterReset.status,
    307,
    "Admin login after MFA reset should redirect."
  );
  assert(
    adminLoginAfterReset.headers.get("location")?.endsWith("/admin/security/mfa"),
    "Admin login after MFA reset should force MFA enrollment."
  );

  const targetOwnerSecret = adminMfa.generateTotpSecret();
  const targetOwner = await prisma.adminUser.create({
    data: {
      email: targetOwnerEmail,
      displayName: "MFA Target Owner",
      passwordHash: await hashAdminPassword("target-owner-password-14chars"),
      accountType: "OWNER",
      siteRole: "OWNER",
      isActive: true,
      mfaSecretCiphertext: adminMfa.encryptMfaSecret(targetOwnerSecret),
      mfaEnabledAt: new Date(),
      sessions: {
        create: {
          tokenHash: productionAuth.hashSessionToken(productionAuth.createSessionToken()),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      },
    },
  });

  const queueOwnerMfaReset = await resetMfaRoute.POST(
    request(
      "POST",
      `http://localhost/api/admin/users/${targetOwner.id}/reset-mfa`,
      { [productionAuth.ADMIN_SESSION_COOKIE]: rotatedToken }
    ),
    { params: Promise.resolve({ id: targetOwner.id }) }
  );
  assertEqual(
    queueOwnerMfaReset.status,
    202,
    "Resetting another Owner's MFA should queue cooling-off."
  );
  const queueOwnerMfaResetBody = (await queueOwnerMfaReset.json()) as {
    pendingOwnerChange?: { id: string };
  };
  assert(queueOwnerMfaResetBody.pendingOwnerChange?.id, "Queued MFA reset should return id.");
  const unchangedTargetOwner = await prisma.adminUser.findUniqueOrThrow({
    where: { id: targetOwner.id },
    select: { mfaEnabledAt: true, mfaSecretCiphertext: true },
  });
  assert(
    unchangedTargetOwner.mfaEnabledAt && unchangedTargetOwner.mfaSecretCiphertext,
    "Queued Owner MFA reset should not execute immediately."
  );
  await prisma.pendingOwnerChange.update({
    where: { id: queueOwnerMfaResetBody.pendingOwnerChange.id },
    data: { executesAt: new Date(Date.now() - 1000) },
  });
  const ownerMfaResetExecution = await ownerChanges.executeDuePendingOwnerChanges();
  assertEqual(ownerMfaResetExecution.executed, 1, "Due Owner MFA reset should execute.");
  const resetTargetOwner = await prisma.adminUser.findUniqueOrThrow({
    where: { id: targetOwner.id },
    select: {
      mfaEnabledAt: true,
      mfaSecretCiphertext: true,
      sessions: { select: { revokedAt: true } },
    },
  });
  assertEqual(
    resetTargetOwner.mfaEnabledAt,
    null,
    "Executed Owner MFA reset should clear enabled timestamp."
  );
  assertEqual(
    resetTargetOwner.mfaSecretCiphertext,
    null,
    "Executed Owner MFA reset should clear secret."
  );
  assert(
    resetTargetOwner.sessions.every((session) => session.revokedAt),
    "Executed Owner MFA reset should revoke target Owner sessions."
  );

  console.log("Admin MFA step-up tests passed.");
}

main()
  .catch((error) => {
    console.error("Admin MFA step-up tests failed.");
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
