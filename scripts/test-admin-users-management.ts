/* eslint-disable no-console */
import { createRequire } from "module";
import { NextRequest } from "next/server";
import "dotenv/config";
import { hashAdminPassword, verifyAdminPassword } from "@/lib/admin-passwords";
import { prisma } from "@/lib/db";

const require = createRequire(import.meta.url);
const runId = `admin-users-${Date.now()}`;
const outletId = `users-outlet-${runId}`;
const emails = {
  owner: `${runId}-owner@example.test`,
  staff: `${runId}-staff@example.test`,
  admin: `${runId}-admin@example.test`,
  ownerCreated: `${runId}-created-owner@example.test`,
};

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

function adminRequest(
  token: string,
  method: string,
  url: string,
  body?: Record<string, unknown>
) {
  return new NextRequest(url, {
    method,
    headers: {
      cookie: `rb_admin_session=${token}`,
      origin: "http://localhost",
      referer: "http://localhost/admin/users",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function ensureOutlet() {
  await prisma.site.upsert({
    where: { id: "site" },
    update: {},
    create: { id: "site", name: "Rushbite", timezone: "America/Edmonton" },
  });
  await prisma.outlet.upsert({
    where: { id: outletId },
    update: { isActive: true },
    create: {
      id: outletId,
      siteId: "site",
      name: `Users test outlet ${runId}`,
      slug: outletId,
      orderPrefix: "U",
      isActive: true,
    },
  });
}

async function cleanup() {
  const userRows = await prisma.adminUser.findMany({
    where: { email: { in: Object.values(emails) } },
    select: { id: true },
  });
  const userIds = userRows.map((user) => user.id);
  if (userIds.length > 0) {
    await prisma.pendingOwnerChangeCancelToken.deleteMany({
      where: { ownerUserId: { in: userIds } },
    });
    await prisma.pendingOwnerChange.deleteMany({
      where: { OR: [{ actorId: { in: userIds } }, { targetId: { in: userIds } }] },
    });
    await prisma.authEmailOutbox.deleteMany({
      where: { recipientEmail: { in: Object.values(emails) } },
    });
    await prisma.adminUser.deleteMany({ where: { id: { in: userIds } } });
  }
  await prisma.outlet.deleteMany({ where: { id: outletId } });
}

async function main() {
  stubServerOnly();
  const [
    productionAuth,
    adminMfa,
    usersRoute,
    userRoute,
    resetPasswordRoute,
    resetMfaRoute,
    revokeSessionsRoute,
    resetPinRoute,
    surfaceAccessRoute,
    stepUpRoute,
  ] = await Promise.all([
    import("@/lib/production-auth"),
    import("@/lib/admin-mfa"),
    import("@/app/api/admin/users/route"),
    import("@/app/api/admin/users/[id]/route"),
    import("@/app/api/admin/users/[id]/reset-password/route"),
    import("@/app/api/admin/users/[id]/reset-mfa/route"),
    import("@/app/api/admin/users/[id]/revoke-sessions/route"),
    import("@/app/api/admin/users/[id]/reset-pin/route"),
    import("@/app/api/admin/users/[id]/surface-access/route"),
    import("@/app/api/admin/auth/step-up/route"),
  ]);

  await cleanup();
  await ensureOutlet();

  const ownerSecret = adminMfa.generateTotpSecret();
  const owner = await prisma.adminUser.create({
    data: {
      email: emails.owner,
      displayName: "Users Test Owner",
      passwordHash: await hashAdminPassword("owner-password-14chars"),
      accountType: "OWNER",
      siteRole: "OWNER",
      isActive: true,
      mfaSecretCiphertext: adminMfa.encryptMfaSecret(ownerSecret),
      mfaEnabledAt: new Date(),
    },
  });
  const freshToken = productionAuth.createSessionToken();
  const staleToken = productionAuth.createSessionToken();
  await prisma.adminSession.createMany({
    data: [
      {
        userId: owner.id,
        tokenHash: productionAuth.hashSessionToken(freshToken),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        stepUpVerifiedAt: new Date(),
        stepUpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
      {
        userId: owner.id,
        tokenHash: productionAuth.hashSessionToken(staleToken),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    ],
  });

  const blankDisplayName = await usersRoute.POST(
    adminRequest(freshToken, "POST", "http://localhost/api/admin/users", {
      email: `${runId}-blank@example.test`,
      displayName: "",
      password: "staff-password-14chars",
      accountType: "STAFF",
      siteRole: null,
      outletRoles: [{ outletId, role: "OPERATOR" }],
    })
  );
  assertEqual(blankDisplayName.status, 400, "Blank display name should be rejected.");

  const invalidEmail = await usersRoute.POST(
    adminRequest(freshToken, "POST", "http://localhost/api/admin/users", {
      email: "not-an-email",
      displayName: "Invalid Email",
      password: "staff-password-14chars",
      accountType: "STAFF",
      siteRole: null,
      outletRoles: [{ outletId, role: "OPERATOR" }],
    })
  );
  assertEqual(invalidEmail.status, 400, "Invalid email should be rejected.");

  const createStaff = await usersRoute.POST(
    adminRequest(freshToken, "POST", "http://localhost/api/admin/users", {
      email: emails.staff,
      displayName: "Users Test Staff",
      password: "staff-password-14chars",
      accountType: "STAFF",
      siteRole: null,
      outletRoles: [{ outletId, role: "OPERATOR" }],
    })
  );
  assertEqual(createStaff.status, 201, "Owner should create Staff user.");
  const staff = await prisma.adminUser.findUniqueOrThrow({
    where: { email: emails.staff },
    include: { outletRoles: true },
  });
  assertEqual(staff.accountType, "STAFF", "Created user should be Staff.");
  assertEqual(staff.outletRoles[0]?.role, "OPERATOR", "Staff outlet role should persist.");

  const createAdmin = await usersRoute.POST(
    adminRequest(freshToken, "POST", "http://localhost/api/admin/users", {
      email: emails.admin,
      displayName: "Users Test Admin",
      password: "admin-password-14chars",
      accountType: "ADMIN",
      siteRole: "ADMIN",
      outletRoles: [{ outletId, role: "MANAGER" }],
    })
  );
  assertEqual(createAdmin.status, 201, "Owner should create Admin user.");
  const admin = await prisma.adminUser.findUniqueOrThrow({
    where: { email: emails.admin },
  });

  const createOwner = await usersRoute.POST(
    adminRequest(freshToken, "POST", "http://localhost/api/admin/users", {
      email: emails.ownerCreated,
      displayName: "Users Test Created Owner",
      password: "created-owner-password-14chars",
      accountType: "OWNER",
      siteRole: "OWNER",
      outletRoles: [],
    })
  );
  assertEqual(createOwner.status, 201, "Owner should create another Owner user.");

  const updateStaff = await userRoute.PATCH(
    adminRequest(freshToken, "PATCH", `http://localhost/api/admin/users/${staff.id}`, {
      displayName: "Users Test Staff Updated",
      accountType: "STAFF",
      siteRole: null,
      isActive: true,
      outletRoles: [{ outletId, role: "MANAGER" }],
    }),
    { params: Promise.resolve({ id: staff.id }) }
  );
  assertEqual(updateStaff.status, 200, "Owner should update Staff user.");
  const updatedStaffRole = await prisma.adminUserOutletRole.findUniqueOrThrow({
    where: { userId_outletId: { userId: staff.id, outletId } },
  });
  assertEqual(updatedStaffRole.role, "MANAGER", "Updated outlet role should persist.");

  await prisma.adminSession.create({
    data: {
      userId: staff.id,
      tokenHash: `staff-session-${runId}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  const resetPassword = await resetPasswordRoute.POST(
    adminRequest(
      freshToken,
      "POST",
      `http://localhost/api/admin/users/${staff.id}/reset-password`,
      { password: "new-staff-password-14chars" }
    ),
    { params: Promise.resolve({ id: staff.id }) }
  );
  assertEqual(resetPassword.status, 200, "Owner should reset Staff password.");
  const passwordStaff = await prisma.adminUser.findUniqueOrThrow({
    where: { id: staff.id },
    include: { sessions: true },
  });
  assert(
    await verifyAdminPassword(passwordStaff.passwordHash, "new-staff-password-14chars"),
    "Password reset should update Staff password hash."
  );
  assert(
    passwordStaff.sessions.every((session) => session.revokedAt),
    "Password reset should revoke Staff sessions."
  );

  const revokeSession = await prisma.adminSession.create({
    data: {
      userId: staff.id,
      tokenHash: `staff-session-revoke-${runId}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  const revokeSessions = await revokeSessionsRoute.POST(
    adminRequest(
      freshToken,
      "POST",
      `http://localhost/api/admin/users/${staff.id}/revoke-sessions`
    ),
    { params: Promise.resolve({ id: staff.id }) }
  );
  assertEqual(revokeSessions.status, 200, "Owner should revoke Staff sessions.");
  const revoked = await prisma.adminSession.findUniqueOrThrow({
    where: { id: revokeSession.id },
  });
  assert(revoked.revokedAt, "Explicit revoke sessions should mark sessions revoked.");

  const adminSecret = adminMfa.generateTotpSecret();
  await prisma.adminUser.update({
    where: { id: admin.id },
    data: {
      mfaSecretCiphertext: adminMfa.encryptMfaSecret(adminSecret),
      mfaEnabledAt: new Date(),
      sessions: {
        create: {
          tokenHash: `admin-session-${runId}`,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      },
      mfaRecoveryCodes: {
        create: { codeHash: adminMfa.hashMfaRecoveryCode("ABCD-EFGH-IJKL") },
      },
    },
  });
  const resetMfa = await resetMfaRoute.POST(
    adminRequest(freshToken, "POST", `http://localhost/api/admin/users/${admin.id}/reset-mfa`),
    { params: Promise.resolve({ id: admin.id }) }
  );
  assertEqual(resetMfa.status, 200, "Owner should reset Admin MFA.");
  const resetAdmin = await prisma.adminUser.findUniqueOrThrow({
    where: { id: admin.id },
    include: { sessions: true, mfaRecoveryCodes: true },
  });
  assertEqual(resetAdmin.mfaEnabledAt, null, "MFA reset should clear enabled timestamp.");
  assertEqual(resetAdmin.mfaSecretCiphertext, null, "MFA reset should clear secret.");
  assertEqual(resetAdmin.mfaRecoveryCodes.length, 0, "MFA reset should delete recovery codes.");
  assert(
    resetAdmin.sessions.every((session) => session.revokedAt),
    "MFA reset should revoke target sessions."
  );

  const surfaceAccess = await surfaceAccessRoute.PATCH(
    adminRequest(
      freshToken,
      "PATCH",
      `http://localhost/api/admin/users/${staff.id}/surface-access`,
      { surfaces: ["COUNTER", "KITCHEN"] }
    ),
    { params: Promise.resolve({ id: staff.id }) }
  );
  assertEqual(surfaceAccess.status, 200, "Owner should update Staff surface access.");
  const surfaceRows = await prisma.adminUserSurfaceAccess.findMany({
    where: { userId: staff.id },
  });
  assertEqual(surfaceRows.length, 2, "Surface access should persist both surfaces.");

  const staleResetPin = await resetPinRoute.POST(
    adminRequest(
      staleToken,
      "POST",
      `http://localhost/api/admin/users/${staff.id}/reset-pin`,
      { generate: true }
    ),
    { params: Promise.resolve({ id: staff.id }) }
  );
  assertEqual(staleResetPin.status, 428, "Owner PIN reset should require MFA step-up.");

  const stepUp = await stepUpRoute.POST(
    adminRequest(staleToken, "POST", "http://localhost/api/admin/auth/step-up", {
      code: adminMfa.generateTotpCode(ownerSecret),
    })
  );
  assertEqual(stepUp.status, 200, "Owner MFA step-up should verify.");
  const setCookie = stepUp.headers.get("set-cookie") ?? "";
  const rotated = setCookie.match(/rb_admin_session=([^;]+)/)?.[1];
  assert(rotated, "Step-up should rotate admin session cookie.");

  const resetPin = await resetPinRoute.POST(
    adminRequest(
      rotated,
      "POST",
      `http://localhost/api/admin/users/${staff.id}/reset-pin`,
      { generate: true }
    ),
    { params: Promise.resolve({ id: staff.id }) }
  );
  assertEqual(resetPin.status, 200, "Owner should reset Staff operational PIN after step-up.");
  const pinBody = (await resetPin.json()) as { pin?: string };
  assert(pinBody.pin, "Auto-generated PIN should be returned once.");
  const pinStaff = await prisma.adminUser.findUniqueOrThrow({ where: { id: staff.id } });
  assert(pinStaff.operationalPinHash, "Operational PIN hash should persist.");

  const auditEvents = await prisma.authAuditLog.count({
    where: {
      actorId: owner.id,
      eventType: {
        in: [
          "ADMIN_USER_CREATED",
          "ADMIN_USER_UPDATED",
          "ADMIN_USER_PASSWORD_RESET",
          "ADMIN_USER_MFA_RESET",
          "ADMIN_USER_SESSIONS_REVOKED",
          "USER_SURFACE_ACCESS_UPDATED",
          "OPERATIONAL_PIN_RESET",
        ],
      },
    },
  });
  assert(auditEvents >= 7, "User-management actions should write audit events.");

  console.log("Admin users management flow tests passed.");
}

main()
  .catch((error) => {
    console.error("Admin users management flow tests failed.");
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
