/* eslint-disable no-console */
import { createRequire } from "module";
import { NextRequest } from "next/server";
import type { AuthAuditLog, Prisma } from "@prisma/client";
import "dotenv/config";
import { hashAdminPassword } from "@/lib/admin-passwords";
import { prisma } from "@/lib/db";

const require = createRequire(import.meta.url);
const runId = `auth-audit-${Date.now()}`;
const outletId = `audit-outlet-${runId}`;
const deviceName = `Audit Counter ${runId}`;
const emails = {
  owner: `${runId}-owner@example.test`,
  staff: `${runId}-staff@example.test`,
  admin: `${runId}-admin@example.test`,
};
const secrets = {
  ownerPassword: "audit-owner-password-14chars",
  staffPassword: "audit-staff-password-14chars",
  adminPassword: "audit-admin-password-14chars",
  resetPassword: "audit-reset-password-14chars",
  recoveryCode: "AUDT-RCVR-CODE",
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

function formRequest(
  method: string,
  url: string,
  fields: Record<string, string>
) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return new NextRequest(url, {
    method,
    headers: {
      origin: "http://localhost",
      referer: "http://localhost/admin/login",
      "x-forwarded-for": "203.0.113.44",
    },
    body: formData,
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
      name: `Audit test outlet ${runId}`,
      slug: outletId,
      orderPrefix: "A",
      isActive: true,
    },
  });
}

async function cleanup() {
  const [userRows, deviceRows] = await Promise.all([
    prisma.adminUser.findMany({
      where: { email: { in: Object.values(emails) } },
      select: { id: true, email: true },
    }),
    prisma.device.findMany({
      where: {
        OR: [
          { name: { contains: runId } },
          { outletId },
          { outletAccess: { some: { outletId } } },
        ],
      },
      select: { id: true, name: true },
    }),
  ]);
  const userIds = userRows.map((user) => user.id);
  const deviceIds = deviceRows.map((device) => device.id);
  const targetIds = [...userIds, ...deviceIds];
  const labels = [...Object.values(emails), ...deviceRows.map((device) => device.name)];
  const auditDeleteClauses: Prisma.AuthAuditLogWhereInput[] = [{ outletId }];
  if (userIds.length > 0) {
    auditDeleteClauses.push({ actorId: { in: userIds } });
  }
  if (targetIds.length > 0) {
    auditDeleteClauses.push({ targetId: { in: targetIds } });
  }
  if (labels.length > 0) {
    auditDeleteClauses.push({ actorLabel: { in: labels } });
    auditDeleteClauses.push({ targetLabel: { in: labels } });
  }

  await prisma.authAuditLog.deleteMany({
    where: {
      OR: auditDeleteClauses,
    },
  });

  if (userIds.length > 0) {
    await prisma.pendingOwnerChangeCancelToken.deleteMany({
      where: { ownerUserId: { in: userIds } },
    });
    await prisma.pendingOwnerChange.deleteMany({
      where: {
        OR: [{ actorId: { in: userIds } }, { targetId: { in: userIds } }],
      },
    });
    await prisma.authEmailOutbox.deleteMany({
      where: { recipientEmail: { in: Object.values(emails) } },
    });
  }

  if (deviceIds.length > 0) {
    await prisma.device.deleteMany({ where: { id: { in: deviceIds } } });
  }
  if (userIds.length > 0) {
    await prisma.adminUser.deleteMany({ where: { id: { in: userIds } } });
  }
  await prisma.outlet.deleteMany({ where: { id: outletId } });
}

async function latestAudit(eventType: string, targetId?: string) {
  const row = await prisma.authAuditLog.findFirst({
    where: {
      eventType,
      ...(targetId ? { targetId } : {}),
      OR: [
        { actorLabel: { in: Object.values(emails) } },
        { targetLabel: { in: [...Object.values(emails), deviceName] } },
        { outletId },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
  assert(row, `Expected audit event ${eventType}${targetId ? ` for ${targetId}` : ""}.`);
  return row;
}

function metadataObject(row: AuthAuditLog): Record<string, unknown> {
  if (!row.metadata || Array.isArray(row.metadata) || typeof row.metadata !== "object") {
    return {};
  }
  return row.metadata as Record<string, unknown>;
}

function assertActorAndTarget(
  row: AuthAuditLog,
  input: {
    eventType: string;
    actorId: string;
    actorLabel: string;
    actorType: string;
    targetType: string;
    targetId: string;
    targetLabel: string;
    outletId?: string | null;
  }
) {
  assertEqual(row.eventType, input.eventType, `${input.eventType} event type`);
  assertEqual(row.actorId, input.actorId, `${input.eventType} actor id`);
  assertEqual(row.actorLabel, input.actorLabel, `${input.eventType} actor label`);
  assertEqual(row.actorType, input.actorType, `${input.eventType} actor type`);
  assertEqual(row.targetType, input.targetType, `${input.eventType} target type`);
  assertEqual(row.targetId, input.targetId, `${input.eventType} target id`);
  assertEqual(row.targetLabel, input.targetLabel, `${input.eventType} target label`);
  if (input.outletId !== undefined) {
    assertEqual(row.outletId, input.outletId, `${input.eventType} outlet id`);
  }
}

function assertNoSensitiveMetadata(
  row: AuthAuditLog,
  label: string,
  rawForbiddenValues: Array<string | undefined | null>
) {
  const metadata = row.metadata ?? {};
  const serialized = JSON.stringify(metadata);
  const forbiddenKeys = new Set([
    "accessCode",
    "codeHash",
    "mfaSecret",
    "mfaSecretCiphertext",
    "operationalPin",
    "operationalPinHash",
    "password",
    "passwordHash",
    "recoveryCode",
    "secretHash",
    "token",
    "tokenHash",
  ]);

  function walk(value: unknown, path: string[] = []) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, [...path, String(index)]));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      assert(
        !forbiddenKeys.has(key),
        `${label} audit metadata must not include sensitive key ${[...path, key].join(".")}.`
      );
      walk(child, [...path, key]);
    }
  }

  walk(metadata);
  for (const raw of rawForbiddenValues) {
    if (!raw) continue;
    assert(
      !serialized.includes(raw),
      `${label} audit metadata must not include raw secret value ${raw}.`
    );
  }
}

async function expectOk(response: Response, label: string, expectedStatus = 200) {
  if (response.status !== expectedStatus) {
    const text = await response.text().catch(() => "");
    throw new Error(`${label} failed. Expected ${expectedStatus}, got ${response.status}: ${text}`);
  }
}

async function main() {
  stubServerOnly();
  const [
    productionAuth,
    adminMfa,
    loginRoute,
    usersRoute,
    userRoute,
    resetPasswordRoute,
    resetMfaRoute,
    revokeSessionsRoute,
    resetPinRoute,
    surfaceAccessRoute,
    devicesRoute,
    deviceRoute,
    rotateDeviceRoute,
  ] = await Promise.all([
    import("@/lib/production-auth"),
    import("@/lib/admin-mfa"),
    import("@/app/api/admin/auth/login/route"),
    import("@/app/api/admin/users/route"),
    import("@/app/api/admin/users/[id]/route"),
    import("@/app/api/admin/users/[id]/reset-password/route"),
    import("@/app/api/admin/users/[id]/reset-mfa/route"),
    import("@/app/api/admin/users/[id]/revoke-sessions/route"),
    import("@/app/api/admin/users/[id]/reset-pin/route"),
    import("@/app/api/admin/users/[id]/surface-access/route"),
    import("@/app/api/admin/devices/route"),
    import("@/app/api/admin/devices/[id]/route"),
    import("@/app/api/admin/devices/[id]/rotate/route"),
  ]);

  await cleanup();
  await ensureOutlet();

  const ownerSecret = adminMfa.generateTotpSecret();
  const owner = await prisma.adminUser.create({
    data: {
      email: emails.owner,
      displayName: "Audit Test Owner",
      passwordHash: await hashAdminPassword(secrets.ownerPassword),
      accountType: "OWNER",
      siteRole: "OWNER",
      isActive: true,
      mfaSecretCiphertext: adminMfa.encryptMfaSecret(ownerSecret),
      mfaEnabledAt: new Date(),
    },
  });
  const ownerToken = productionAuth.createSessionToken();
  await prisma.adminSession.create({
    data: {
      userId: owner.id,
      tokenHash: productionAuth.hashSessionToken(ownerToken),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      stepUpVerifiedAt: new Date(),
      stepUpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  const createStaffResponse = await usersRoute.POST(
    adminRequest(ownerToken, "POST", "http://localhost/api/admin/users", {
      email: emails.staff,
      displayName: "Audit Test Staff",
      password: secrets.staffPassword,
      accountType: "STAFF",
      siteRole: null,
      outletRoles: [{ outletId, role: "OPERATOR" }],
    })
  );
  await expectOk(createStaffResponse, "Create staff user", 201);
  const staff = await prisma.adminUser.findUniqueOrThrow({ where: { email: emails.staff } });

  const staffCreateAudit = await latestAudit("ADMIN_USER_CREATED", staff.id);
  assertActorAndTarget(staffCreateAudit, {
    eventType: "ADMIN_USER_CREATED",
    actorType: "ADMIN_OWNER",
    actorId: owner.id,
    actorLabel: emails.owner,
    targetType: "ADMIN_USER",
    targetId: staff.id,
    targetLabel: emails.staff,
  });
  const staffCreateMetadata = metadataObject(staffCreateAudit);
  assertEqual(staffCreateMetadata.accountType, "STAFF", "Create audit account type");
  assert(Array.isArray(staffCreateMetadata.outletRoles), "Create audit should include outlet roles.");
  assertNoSensitiveMetadata(staffCreateAudit, "Create staff", Object.values(secrets));

  const loginResponse = await loginRoute.POST(
    formRequest("POST", "http://localhost/api/admin/auth/login", {
      email: emails.staff,
      password: secrets.staffPassword,
    })
  );
  assert(loginResponse.status >= 300 && loginResponse.status < 400, "Staff login should redirect.");
  const loginAudit = await latestAudit("ADMIN_LOGIN_SUCCEEDED", staff.id);
  assertActorAndTarget(loginAudit, {
    eventType: "ADMIN_LOGIN_SUCCEEDED",
    actorType: "ADMIN_OUTLET_USER",
    actorId: staff.id,
    actorLabel: emails.staff,
    targetType: "ADMIN_USER",
    targetId: staff.id,
    targetLabel: emails.staff,
  });
  assert(loginAudit.ipHash, "Login audit should include an IP hash.");
  assertNoSensitiveMetadata(loginAudit, "Staff login", Object.values(secrets));

  const createAdminResponse = await usersRoute.POST(
    adminRequest(ownerToken, "POST", "http://localhost/api/admin/users", {
      email: emails.admin,
      displayName: "Audit Test Admin",
      password: secrets.adminPassword,
      accountType: "ADMIN",
      siteRole: "ADMIN",
      outletRoles: [{ outletId, role: "MANAGER" }],
    })
  );
  await expectOk(createAdminResponse, "Create admin user", 201);
  const admin = await prisma.adminUser.findUniqueOrThrow({ where: { email: emails.admin } });

  await userRoute.PATCH(
    adminRequest(ownerToken, "PATCH", `http://localhost/api/admin/users/${staff.id}`, {
      displayName: "Audit Test Staff Updated",
      accountType: "STAFF",
      siteRole: null,
      isActive: true,
      outletRoles: [{ outletId, role: "MANAGER" }],
    }),
    { params: Promise.resolve({ id: staff.id }) }
  ).then((response) => expectOk(response, "Update staff user"));
  const updateAudit = await latestAudit("ADMIN_USER_UPDATED", staff.id);
  assertActorAndTarget(updateAudit, {
    eventType: "ADMIN_USER_UPDATED",
    actorType: "ADMIN_OWNER",
    actorId: owner.id,
    actorLabel: emails.owner,
    targetType: "ADMIN_USER",
    targetId: staff.id,
    targetLabel: emails.staff,
  });
  const updateMetadata = metadataObject(updateAudit);
  assertEqual(updateMetadata.accountType, "STAFF", "Update audit account type");
  assertEqual(updateMetadata.isActive, true, "Update audit active state");
  assertNoSensitiveMetadata(updateAudit, "Update staff", Object.values(secrets));

  await resetPasswordRoute.POST(
    adminRequest(
      ownerToken,
      "POST",
      `http://localhost/api/admin/users/${staff.id}/reset-password`,
      { password: secrets.resetPassword }
    ),
    { params: Promise.resolve({ id: staff.id }) }
  ).then((response) => expectOk(response, "Reset staff password"));
  const resetPasswordAudit = await latestAudit("ADMIN_USER_PASSWORD_RESET", staff.id);
  assertActorAndTarget(resetPasswordAudit, {
    eventType: "ADMIN_USER_PASSWORD_RESET",
    actorType: "ADMIN_OWNER",
    actorId: owner.id,
    actorLabel: emails.owner,
    targetType: "ADMIN_USER",
    targetId: staff.id,
    targetLabel: emails.staff,
  });
  assertNoSensitiveMetadata(resetPasswordAudit, "Reset staff password", Object.values(secrets));

  await prisma.adminSession.create({
    data: {
      userId: staff.id,
      tokenHash: `audit-staff-revoke-${runId}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  await revokeSessionsRoute.POST(
    adminRequest(
      ownerToken,
      "POST",
      `http://localhost/api/admin/users/${staff.id}/revoke-sessions`
    ),
    { params: Promise.resolve({ id: staff.id }) }
  ).then((response) => expectOk(response, "Revoke staff sessions"));
  const revokeAudit = await latestAudit("ADMIN_USER_SESSIONS_REVOKED", staff.id);
  const revokeMetadata = metadataObject(revokeAudit);
  assert(Number(revokeMetadata.revokedCount) >= 1, "Revoke audit should include revoked count.");
  assertNoSensitiveMetadata(revokeAudit, "Revoke staff sessions", Object.values(secrets));

  const adminSecret = adminMfa.generateTotpSecret();
  await prisma.adminUser.update({
    where: { id: admin.id },
    data: {
      mfaSecretCiphertext: adminMfa.encryptMfaSecret(adminSecret),
      mfaEnabledAt: new Date(),
      sessions: {
        create: {
          tokenHash: `audit-admin-session-${runId}`,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      },
      mfaRecoveryCodes: {
        create: { codeHash: adminMfa.hashMfaRecoveryCode(secrets.recoveryCode) },
      },
    },
  });
  await resetMfaRoute.POST(
    adminRequest(ownerToken, "POST", `http://localhost/api/admin/users/${admin.id}/reset-mfa`),
    { params: Promise.resolve({ id: admin.id }) }
  ).then((response) => expectOk(response, "Reset admin MFA"));
  const resetMfaAudit = await latestAudit("ADMIN_USER_MFA_RESET", admin.id);
  assertActorAndTarget(resetMfaAudit, {
    eventType: "ADMIN_USER_MFA_RESET",
    actorType: "ADMIN_OWNER",
    actorId: owner.id,
    actorLabel: emails.owner,
    targetType: "ADMIN_USER",
    targetId: admin.id,
    targetLabel: emails.admin,
  });
  const resetMfaMetadata = metadataObject(resetMfaAudit);
  assertEqual(resetMfaMetadata.mfaWasEnabled, true, "MFA reset audit should note previous MFA.");
  assertNoSensitiveMetadata(resetMfaAudit, "Reset admin MFA", [
    ...Object.values(secrets),
    ownerSecret,
    adminSecret,
  ]);

  await surfaceAccessRoute.PATCH(
    adminRequest(
      ownerToken,
      "PATCH",
      `http://localhost/api/admin/users/${staff.id}/surface-access`,
      { surfaces: ["COUNTER", "KITCHEN"] }
    ),
    { params: Promise.resolve({ id: staff.id }) }
  ).then((response) => expectOk(response, "Update staff surface access"));
  const surfaceAudit = await latestAudit("USER_SURFACE_ACCESS_UPDATED", staff.id);
  const surfaceMetadata = metadataObject(surfaceAudit);
  assert(
    Array.isArray(surfaceMetadata.nextSurfaces) &&
      surfaceMetadata.nextSurfaces.includes("COUNTER") &&
      surfaceMetadata.nextSurfaces.includes("KITCHEN"),
    "Surface audit should include next surfaces."
  );
  assertNoSensitiveMetadata(surfaceAudit, "Update staff surface access", Object.values(secrets));

  const resetPinResponse = await resetPinRoute.POST(
    adminRequest(
      ownerToken,
      "POST",
      `http://localhost/api/admin/users/${staff.id}/reset-pin`,
      { generate: true }
    ),
    { params: Promise.resolve({ id: staff.id }) }
  );
  await expectOk(resetPinResponse, "Reset staff operational PIN");
  const pinBody = (await resetPinResponse.json()) as { pin?: string };
  assert(pinBody.pin, "Auto-generated operational PIN should be returned by route.");
  const pinAudit = await latestAudit("OPERATIONAL_PIN_RESET", staff.id);
  const pinMetadata = metadataObject(pinAudit);
  assertEqual(pinMetadata.pinSource, "auto", "PIN reset audit should store source only.");
  assertNoSensitiveMetadata(pinAudit, "Reset operational PIN", [
    ...Object.values(secrets),
    pinBody.pin,
  ]);

  const createDeviceResponse = await devicesRoute.POST(
    adminRequest(ownerToken, "POST", "http://localhost/api/admin/devices", {
      name: deviceName,
      physicalLocation: "front counter audit station",
      role: "counter",
      isSharedAcrossOutlets: false,
      outletId,
      sharedOutletIds: [],
    })
  );
  await expectOk(createDeviceResponse, "Create device", 201);
  const createDeviceBody = (await createDeviceResponse.json()) as { accessCode?: string };
  const device = await prisma.device.findFirstOrThrow({ where: { name: deviceName } });
  assert(createDeviceBody.accessCode, "Device create should return an access code once.");
  const deviceCreateAudit = await latestAudit("DEVICE_ENROLLED", device.id);
  assertActorAndTarget(deviceCreateAudit, {
    eventType: "DEVICE_ENROLLED",
    actorType: "ADMIN_OWNER",
    actorId: owner.id,
    actorLabel: emails.owner,
    targetType: "DEVICE",
    targetId: device.id,
    targetLabel: deviceName,
    outletId,
  });
  const deviceCreateMetadata = metadataObject(deviceCreateAudit);
  assertEqual(deviceCreateMetadata.role, "counter", "Device create audit role");
  assertNoSensitiveMetadata(deviceCreateAudit, "Create device", [
    ...Object.values(secrets),
    createDeviceBody.accessCode,
  ]);

  await deviceRoute.PATCH(
    adminRequest(ownerToken, "PATCH", `http://localhost/api/admin/devices/${device.id}`, {
      name: `${deviceName} Updated`,
      physicalLocation: "updated audit station",
      isActive: false,
      isSharedAcrossOutlets: false,
      outletId,
      sharedOutletIds: [],
    }),
    { params: Promise.resolve({ id: device.id }) }
  ).then((response) => expectOk(response, "Update device"));
  const deviceUpdateAudit = await latestAudit("DEVICE_UPDATED", device.id);
  assertActorAndTarget(deviceUpdateAudit, {
    eventType: "DEVICE_UPDATED",
    actorType: "ADMIN_OWNER",
    actorId: owner.id,
    actorLabel: emails.owner,
    targetType: "DEVICE",
    targetId: device.id,
    targetLabel: deviceName,
    outletId,
  });
  const deviceUpdateMetadata = metadataObject(deviceUpdateAudit);
  assertEqual(deviceUpdateMetadata.isActive, false, "Device update audit active state");
  assertNoSensitiveMetadata(deviceUpdateAudit, "Update device", [
    ...Object.values(secrets),
    createDeviceBody.accessCode,
  ]);

  const rotateResponse = await rotateDeviceRoute.POST(
    adminRequest(ownerToken, "POST", `http://localhost/api/admin/devices/${device.id}/rotate`),
    { params: Promise.resolve({ id: device.id }) }
  );
  await expectOk(rotateResponse, "Rotate device secret");
  const rotateBody = (await rotateResponse.json()) as { accessCode?: string };
  assert(rotateBody.accessCode, "Device rotate should return an access code once.");
  const rotateAudit = await latestAudit("DEVICE_SECRET_ROTATED", device.id);
  assertActorAndTarget(rotateAudit, {
    eventType: "DEVICE_SECRET_ROTATED",
    actorType: "ADMIN_OWNER",
    actorId: owner.id,
    actorLabel: emails.owner,
    targetType: "DEVICE",
    targetId: device.id,
    targetLabel: `${deviceName} Updated`,
    outletId,
  });
  assertNoSensitiveMetadata(rotateAudit, "Rotate device secret", [
    ...Object.values(secrets),
    createDeviceBody.accessCode,
    rotateBody.accessCode,
  ]);

  console.log("Auth audit event tests passed.");
}

main()
  .catch((error) => {
    console.error("Auth audit event tests failed.");
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
