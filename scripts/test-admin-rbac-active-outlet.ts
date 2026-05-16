/* eslint-disable no-console */
import { createRequire } from "module";
import { NextRequest } from "next/server";
import "dotenv/config";
import { prisma } from "@/lib/db";

const require = createRequire(import.meta.url);
const runId = `rbac-active-outlet-${Date.now()}`;
const outletAId = `${runId}-a`;
const outletBId = `${runId}-b`;
const staffNoRoleEmail = `${runId}-norole@example.test`;
const staffOneRoleEmail = `${runId}-onerole@example.test`;
const staffMultiRoleEmail = `${runId}-multirole@example.test`;
const staffOperatorEmail = `${runId}-operator@example.test`;
const staffViewerEmail = `${runId}-viewer@example.test`;
const ownerEmail = `${runId}-owner@example.test`;
const targetOwnerEmail = `${runId}-target-owner@example.test`;
const adminEmail = `${runId}-admin@example.test`;
process.env.AUTH_EMAIL_DRY_RUN = "true";

type LoadedModules = {
  activeOutlet: typeof import("@/lib/admin-active-outlet");
  adminSessions: typeof import("@/lib/admin-sessions");
  adminMfa: typeof import("@/lib/admin-mfa");
  authEmailOutbox: typeof import("@/lib/auth-email-outbox");
  ownerChanges: typeof import("@/lib/admin-owner-changes");
  productionAuth: typeof import("@/lib/production-auth");
  updateUserRoute: typeof import("@/app/api/admin/users/[id]/route");
  cancelOwnerChangeRoute: typeof import("@/app/api/admin/owner-changes/[id]/cancel/route");
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

async function loadModules(): Promise<LoadedModules> {
  stubServerOnly();
  const [activeOutlet, adminSessions, productionAuth] = await Promise.all([
    import("@/lib/admin-active-outlet"),
    import("@/lib/admin-sessions"),
    import("@/lib/production-auth"),
  ]);
  const [adminMfa, authEmailOutbox, ownerChanges, updateUserRoute, cancelOwnerChangeRoute] =
    await Promise.all([
      import("@/lib/admin-mfa"),
      import("@/lib/auth-email-outbox"),
      import("@/lib/admin-owner-changes"),
      import("@/app/api/admin/users/[id]/route"),
      import("@/app/api/admin/owner-changes/[id]/cancel/route"),
    ]);
  return {
    activeOutlet,
    adminSessions,
    adminMfa,
    authEmailOutbox,
    ownerChanges,
    productionAuth,
    updateUserRoute,
    cancelOwnerChangeRoute,
  };
}

function cookieReader(value: string | null) {
  return {
    get(name: string) {
      return value && name === "rb_admin_active_outlet" ? { value } : undefined;
    },
  };
}

function actor(userId: string, accountType: "OWNER" | "ADMIN" | "STAFF") {
  return {
    sessionId: `${userId}-session`,
    userId,
    email: `${userId}@example.test`,
    displayName: userId,
    accountType,
    siteRole: accountType === "STAFF" ? null : accountType,
    mfaEnrollmentRequired: false,
  };
}

function requestWithCookies(cookies: Record<string, string>) {
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  return new NextRequest("http://localhost/api/admin/categories", {
    method: "GET",
    headers: cookie ? { cookie } : undefined,
  });
}

function jsonRequest(
  url: string,
  cookies: Record<string, string>,
  body: Record<string, unknown>
) {
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  return new NextRequest(url, {
    method: "PATCH",
    headers: {
      origin: "http://localhost",
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function ensureSiteAndOutlets() {
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

  await prisma.outlet.createMany({
    data: [
      {
        id: outletAId,
        siteId: "site",
        name: `RBAC Outlet A ${runId}`,
        slug: outletAId,
        orderPrefix: `RA${Date.now().toString().slice(-4)}`,
        isActive: true,
      },
      {
        id: outletBId,
        siteId: "site",
        name: `RBAC Outlet B ${runId}`,
        slug: outletBId,
        orderPrefix: `RB${Date.now().toString().slice(-4)}`,
        isActive: true,
      },
    ],
  });
}

async function createStaff(email: string) {
  return prisma.adminUser.create({
    data: {
      email,
      displayName: email.split("@")[0]!,
      passwordHash: "test-password-hash",
      accountType: "STAFF",
      siteRole: null,
      isActive: true,
    },
  });
}

async function createOwner(email: string, adminMfa: LoadedModules["adminMfa"]) {
  return prisma.adminUser.create({
    data: {
      email,
      displayName: "RBAC Owner",
      passwordHash: "test-password-hash",
      accountType: "OWNER",
      siteRole: "OWNER",
      mfaSecretCiphertext: adminMfa.encryptMfaSecret(adminMfa.generateTotpSecret()),
      mfaEnabledAt: new Date(),
      isActive: true,
    },
  });
}

async function createAdmin(email: string, adminMfa: LoadedModules["adminMfa"]) {
  return prisma.adminUser.create({
    data: {
      email,
      displayName: "RBAC Admin",
      passwordHash: "test-password-hash",
      accountType: "ADMIN",
      siteRole: "ADMIN",
      mfaSecretCiphertext: adminMfa.encryptMfaSecret(adminMfa.generateTotpSecret()),
      mfaEnabledAt: new Date(),
      isActive: true,
    },
  });
}

function ownerDemoteBody(
  displayName: string,
  outletRole: "MANAGER" | "OPERATOR" | "VIEWER" = "MANAGER"
) {
  return {
    displayName,
    accountType: "STAFF",
    isActive: true,
    outletRoles: [{ outletId: outletAId, role: outletRole }],
  };
}

async function createSession(
  userId: string,
  productionAuth: LoadedModules["productionAuth"],
  options: { stepUp?: boolean } = {}
) {
  const token = productionAuth.createSessionToken();
  const now = new Date();
  await prisma.adminSession.create({
    data: {
      userId,
      tokenHash: productionAuth.hashSessionToken(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      stepUpVerifiedAt: options.stepUp ? now : undefined,
      stepUpExpiresAt: options.stepUp ? new Date(Date.now() + 10 * 60 * 1000) : undefined,
    },
  });
  return token;
}

async function cleanup() {
  const users = await prisma.adminUser.findMany({
    where: {
      email: {
        in: [
          staffNoRoleEmail,
          staffOneRoleEmail,
          staffMultiRoleEmail,
          staffOperatorEmail,
          staffViewerEmail,
          ownerEmail,
          targetOwnerEmail,
          adminEmail,
        ],
      },
    },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);
  if (userIds.length > 0) {
    await prisma.authEmailOutbox.deleteMany({
      where: { recipientUserId: { in: userIds } },
    });
    await prisma.pendingOwnerChangeCancelToken.deleteMany({
      where: { ownerUserId: { in: userIds } },
    });
    await prisma.pendingOwnerChange.deleteMany({
      where: {
        OR: [{ actorId: { in: userIds } }, { targetId: { in: userIds } }],
      },
    });
  }
  await prisma.adminUser.deleteMany({
    where: {
      email: {
        in: [
          staffNoRoleEmail,
          staffOneRoleEmail,
          staffMultiRoleEmail,
          staffOperatorEmail,
          staffViewerEmail,
          ownerEmail,
          targetOwnerEmail,
          adminEmail,
        ],
      },
    },
  });
  await prisma.outlet.deleteMany({ where: { id: { in: [outletAId, outletBId] } } });
}

async function main() {
  const {
    activeOutlet,
    adminSessions,
    adminMfa,
    authEmailOutbox,
    ownerChanges,
    productionAuth,
    updateUserRoute,
    cancelOwnerChangeRoute,
  } = await loadModules();
  await cleanup();
  await ensureSiteAndOutlets();

  const ownerUser = await createOwner(ownerEmail, adminMfa);
  const targetOwner = await createOwner(targetOwnerEmail, adminMfa);
  const adminUser = await createAdmin(adminEmail, adminMfa);
  const noRoleUser = await createStaff(staffNoRoleEmail);
  const oneRoleUser = await createStaff(staffOneRoleEmail);
  const multiRoleUser = await createStaff(staffMultiRoleEmail);
  const operatorUser = await createStaff(staffOperatorEmail);
  const viewerUser = await createStaff(staffViewerEmail);

  await prisma.adminUserOutletRole.createMany({
    data: [
      { userId: oneRoleUser.id, outletId: outletAId, role: "MANAGER" },
      { userId: multiRoleUser.id, outletId: outletAId, role: "MANAGER" },
      { userId: multiRoleUser.id, outletId: outletBId, role: "VIEWER" },
      { userId: operatorUser.id, outletId: outletAId, role: "OPERATOR" },
      { userId: viewerUser.id, outletId: outletBId, role: "VIEWER" },
    ],
  });

  assertEqual(
    productionAuth.roleHasPermission("MANAGER", "admin.menu.write"),
    true,
    "Manager should be able to write menus"
  );
  assertEqual(
    productionAuth.roleHasPermission("OPERATOR", "admin.menu.write"),
    false,
    "Operator should not be able to write menus"
  );
  assertEqual(
    productionAuth.roleHasPermission("OPERATOR", "admin.menu.read"),
    false,
    "Operator should not be able to read menu admin"
  );
  assertEqual(
    productionAuth.roleHasPermission("OPERATOR", "admin.orders.updateStatus"),
    true,
    "Operator should be able to update orders"
  );
  assertEqual(
    productionAuth.roleHasPermission("VIEWER", "admin.menu.read"),
    true,
    "Viewer should be able to read menu admin"
  );
  assertEqual(
    productionAuth.roleHasPermission("VIEWER", "admin.menu.write"),
    false,
    "Viewer should not be able to write menus"
  );
  assertEqual(
    productionAuth.roleHasPermission("VIEWER", "admin.orders.updateStatus"),
    false,
    "Viewer should not be able to update orders"
  );
  assertEqual(
    productionAuth.roleHasPermission("VIEWER", "admin.settings.read"),
    true,
    "Viewer should be able to read settings"
  );
  assertEqual(
    productionAuth.roleHasPermission("VIEWER", "admin.settings.write"),
    false,
    "Viewer should not be able to write settings"
  );
  assertEqual(
    productionAuth.roleHasPermission("VIEWER", "admin.failover.read"),
    true,
    "Viewer should be able to read failover state"
  );
  assertEqual(
    productionAuth.roleHasPermission("VIEWER", "admin.failover.switch"),
    false,
    "Viewer should not be able to switch failover"
  );
  assertEqual(
    productionAuth.roleHasPermission("MANAGER", "admin.orders.refund"),
    false,
    "Manager should not be able to refund orders"
  );
  assertEqual(
    productionAuth.roleHasPermission("MANAGER", "admin.auth.users.manage"),
    false,
    "Manager should not be able to manage users"
  );
  assertEqual(
    productionAuth.roleHasPermission("MANAGER", "admin.auth.devices.manage"),
    false,
    "Manager should not be able to manage devices"
  );
  assertEqual(
    productionAuth.adminHasPermission("admin.auth.devices.manage"),
    true,
    "Admin should be able to manage devices"
  );
  assertEqual(
    productionAuth.adminHasPermission("admin.failover.switch"),
    false,
    "Admin should not be able to switch failover"
  );
  assertEqual(
    productionAuth.ownerHasPermission("admin.failover.switch"),
    true,
    "Owner should be able to switch failover"
  );
  assertEqual(
    productionAuth.roleHasPermission("STAFF", "admin.orders.updateStatus"),
    true,
    "Legacy STAFF outlet role should normalize to Operator"
  );

  const noAccess = await activeOutlet.resolveAdminActiveOutlet(actor(noRoleUser.id, "STAFF"));
  assertEqual(noAccess.status, "no_access", "Staff with zero outlet roles should have no access");

  const oneRole = await activeOutlet.resolveAdminActiveOutlet(actor(oneRoleUser.id, "STAFF"));
  assert(oneRole.status === "active", "Single-outlet Staff should resolve active outlet");
  assertEqual(oneRole.outletId, outletAId, "Single-outlet Staff should use assigned outlet");
  assertEqual(oneRole.role, "MANAGER", "Single-outlet Staff should use assigned role");

  const staleOneRole = await activeOutlet.resolveAdminActiveOutlet(
    actor(oneRoleUser.id, "STAFF"),
    cookieReader("missing-outlet")
  );
  assert(staleOneRole.status === "active", "Invalid cookie should not block single-outlet Staff");
  assertEqual(staleOneRole.staleCookie, true, "Invalid cookie should be marked stale");

  const needsPicker = await activeOutlet.resolveAdminActiveOutlet(
    actor(multiRoleUser.id, "STAFF")
  );
  assertEqual(needsPicker.status, "needs_picker", "Multi-outlet Staff should choose an outlet");

  const selectedOutlet = await activeOutlet.resolveAdminActiveOutlet(
    actor(multiRoleUser.id, "STAFF"),
    cookieReader(outletBId)
  );
  assert(selectedOutlet.status === "active", "Valid active-outlet cookie should resolve");
  assertEqual(selectedOutlet.outletId, outletBId, "Cookie should select outlet B");
  assertEqual(selectedOutlet.role, "VIEWER", "Cookie-selected role should match outlet role");

  const ownerRequestedOutlet = await activeOutlet.resolveAdminActiveOutlet(
    actor("owner-test", "OWNER"),
    undefined,
    outletBId
  );
  assert(ownerRequestedOutlet.status === "active", "Owner should be able to select any active outlet");
  assertEqual(ownerRequestedOutlet.outletId, outletBId, "Owner requested outlet should be honored");

  const multiRoleToken = await createSession(multiRoleUser.id, productionAuth);
  const noActiveOutletAuth = await adminSessions.requireAdminApiPermissionContext(
    requestWithCookies({ [productionAuth.ADMIN_SESSION_COOKIE]: multiRoleToken }),
    "admin.menu.read"
  );
  assertEqual(
    noActiveOutletAuth.ok,
    false,
    "Multi-outlet Staff API request without active outlet should be rejected"
  );
  if (!noActiveOutletAuth.ok) {
    assertEqual(noActiveOutletAuth.response.status, 409, "Missing active outlet should return 409");
  }

  const activeOutletAuth = await adminSessions.requireAdminApiPermissionContext(
    requestWithCookies({
      [productionAuth.ADMIN_SESSION_COOKIE]: multiRoleToken,
      [activeOutlet.ADMIN_ACTIVE_OUTLET_COOKIE]: outletAId,
    }),
    "admin.menu.read"
  );
  assertEqual(activeOutletAuth.ok, true, "Assigned active outlet should authorize menu read");
  if (activeOutletAuth.ok) {
    assertEqual(activeOutletAuth.context.outletId, outletAId, "API context should use active outlet");
  }

  const noRoleToken = await createSession(noRoleUser.id, productionAuth);
  const noRoleMenuRead = await adminSessions.requireAdminApiPermissionContext(
    requestWithCookies({ [productionAuth.ADMIN_SESSION_COOKIE]: noRoleToken }),
    "admin.menu.read"
  );
  assertEqual(noRoleMenuRead.ok, false, "Zero-role Staff should not authorize API access");
  if (!noRoleMenuRead.ok) {
    assertEqual(noRoleMenuRead.response.status, 403, "Zero-role Staff should return 403");
  }

  const oneRoleToken = await createSession(oneRoleUser.id, productionAuth);
  const crossOutletMenuRead = await adminSessions.requireAdminApiPermissionContext(
    requestWithCookies({ [productionAuth.ADMIN_SESSION_COOKIE]: oneRoleToken }),
    "admin.menu.read",
    outletBId
  );
  assertEqual(
    crossOutletMenuRead.ok,
    false,
    "Staff should not authorize explicit requests for an unassigned outlet"
  );
  if (!crossOutletMenuRead.ok) {
    assertEqual(
      crossOutletMenuRead.response.status,
      403,
      "Cross-outlet Staff request should return 403"
    );
  }

  const multiRoleViewerMenuWrite = await adminSessions.requireAdminApiPermissionContext(
    requestWithCookies({ [productionAuth.ADMIN_SESSION_COOKIE]: multiRoleToken }),
    "admin.menu.write",
    outletBId
  );
  assertEqual(
    multiRoleViewerMenuWrite.ok,
    false,
    "Viewer role at outlet B should not authorize menu writes"
  );
  if (!multiRoleViewerMenuWrite.ok) {
    assertEqual(
      multiRoleViewerMenuWrite.response.status,
      403,
      "Viewer menu write should return 403"
    );
  }

  const multiRoleViewerFailoverRead = await adminSessions.requireAdminApiPermissionContext(
    requestWithCookies({ [productionAuth.ADMIN_SESSION_COOKIE]: multiRoleToken }),
    "admin.failover.read",
    outletBId
  );
  assertEqual(
    multiRoleViewerFailoverRead.ok,
    true,
    "Viewer role at outlet B should authorize failover read"
  );

  const multiRoleViewerFailoverSwitch = await adminSessions.requireAdminApiPermissionContext(
    requestWithCookies({ [productionAuth.ADMIN_SESSION_COOKIE]: multiRoleToken }),
    "admin.failover.switch",
    outletBId
  );
  assertEqual(
    multiRoleViewerFailoverSwitch.ok,
    false,
    "Viewer role at outlet B should not authorize failover switch"
  );

  const viewerToken = await createSession(viewerUser.id, productionAuth);
  const viewerSettingsWrite = await adminSessions.requireAdminApiPermissionContext(
    requestWithCookies({ [productionAuth.ADMIN_SESSION_COOKIE]: viewerToken }),
    "admin.settings.write"
  );
  assertEqual(
    viewerSettingsWrite.ok,
    false,
    "Single-outlet Viewer should not authorize settings write"
  );
  if (!viewerSettingsWrite.ok) {
    assertEqual(
      viewerSettingsWrite.response.status,
      403,
      "Viewer settings write should return 403"
    );
  }

  const operatorToken = await createSession(operatorUser.id, productionAuth);
  const operatorMenuWrite = await adminSessions.requireAdminApiPermissionContext(
    requestWithCookies({
      [productionAuth.ADMIN_SESSION_COOKIE]: operatorToken,
      [activeOutlet.ADMIN_ACTIVE_OUTLET_COOKIE]: outletAId,
    }),
    "admin.menu.write"
  );
  assertEqual(operatorMenuWrite.ok, false, "Operator should not be authorized for menu write");
  if (!operatorMenuWrite.ok) {
    assertEqual(operatorMenuWrite.response.status, 403, "Operator menu write should return 403");
  }

  const operatorOrderUpdate = await adminSessions.requireAdminApiPermissionContext(
    requestWithCookies({
      [productionAuth.ADMIN_SESSION_COOKIE]: operatorToken,
      [activeOutlet.ADMIN_ACTIVE_OUTLET_COOKIE]: outletAId,
    }),
    "admin.orders.updateStatus"
  );
  assertEqual(operatorOrderUpdate.ok, true, "Operator should be authorized for order status update");

  const ownerToken = await createSession(ownerUser.id, productionAuth, { stepUp: true });
  const adminToken = await createSession(adminUser.id, productionAuth, { stepUp: true });
  const adminDevicesManage = await adminSessions.requireAdminApiPermissionContext(
    requestWithCookies({ [productionAuth.ADMIN_SESSION_COOKIE]: adminToken }),
    "admin.auth.devices.manage"
  );
  assertEqual(adminDevicesManage.ok, true, "Admin should authorize device management");
  const adminFailoverSwitch = await adminSessions.requireAdminApiPermissionContext(
    requestWithCookies({ [productionAuth.ADMIN_SESSION_COOKIE]: adminToken }),
    "admin.failover.switch"
  );
  assertEqual(adminFailoverSwitch.ok, false, "Admin should not authorize failover switch");
  if (!adminFailoverSwitch.ok) {
    assertEqual(adminFailoverSwitch.response.status, 403, "Admin failover switch should return 403");
  }
  const ownerFailoverSwitch = await adminSessions.requireAdminApiPermissionContext(
    requestWithCookies({ [productionAuth.ADMIN_SESSION_COOKIE]: ownerToken }),
    "admin.failover.switch"
  );
  assertEqual(ownerFailoverSwitch.ok, true, "Owner should authorize failover switch");
  const targetOwnerToken = await createSession(targetOwner.id, productionAuth, {
    stepUp: true,
  });
  const displayNameOnly = await updateUserRoute.PATCH(
    jsonRequest(
      `http://localhost/api/admin/users/${oneRoleUser.id}`,
      { [productionAuth.ADMIN_SESSION_COOKIE]: ownerToken },
      {
        displayName: "Renamed Staff",
        accountType: "STAFF",
        isActive: true,
        outletRoles: [{ outletId: outletAId, role: "MANAGER" }],
      }
    ),
    { params: Promise.resolve({ id: oneRoleUser.id }) }
  );
  const displayNameOnlyBody = (await displayNameOnly.json()) as {
    sessionsRevoked?: boolean;
  };
  assertEqual(displayNameOnly.status, 200, "Display-name-only update should succeed");
  assertEqual(
    displayNameOnlyBody.sessionsRevoked,
    false,
    "Display-name-only update should not revoke sessions"
  );
  const displayNameSession = await prisma.adminSession.findUniqueOrThrow({
    where: { tokenHash: productionAuth.hashSessionToken(oneRoleToken) },
    select: { revokedAt: true },
  });
  assertEqual(
    displayNameSession.revokedAt,
    null,
    "Display-name-only update should leave existing session active"
  );

  const demoteOperator = await updateUserRoute.PATCH(
    jsonRequest(
      `http://localhost/api/admin/users/${operatorUser.id}`,
      { [productionAuth.ADMIN_SESSION_COOKIE]: ownerToken },
      {
        displayName: operatorUser.displayName,
        accountType: "STAFF",
        isActive: true,
        outletRoles: [{ outletId: outletAId, role: "VIEWER" }],
      }
    ),
    { params: Promise.resolve({ id: operatorUser.id }) }
  );
  const demoteOperatorBody = (await demoteOperator.json()) as {
    sessionsRevoked?: boolean;
  };
  assertEqual(demoteOperator.status, 200, "Outlet-role update should succeed");
  assertEqual(
    demoteOperatorBody.sessionsRevoked,
    true,
    "Outlet-role update should revoke target sessions"
  );
  const revokedOperatorSession = await prisma.adminSession.findUniqueOrThrow({
    where: { tokenHash: productionAuth.hashSessionToken(operatorToken) },
    select: { revokedAt: true },
  });
  assert(
    revokedOperatorSession.revokedAt,
    "Outlet-role update should revoke the stale Operator session"
  );
  const staleOperatorOrderUpdate = await adminSessions.requireAdminApiPermissionContext(
    requestWithCookies({
      [productionAuth.ADMIN_SESSION_COOKIE]: operatorToken,
      [activeOutlet.ADMIN_ACTIVE_OUTLET_COOKIE]: outletAId,
    }),
    "admin.orders.updateStatus"
  );
  assertEqual(
    staleOperatorOrderUpdate.ok,
    false,
    "Revoked Operator session should no longer authorize API access"
  );
  if (!staleOperatorOrderUpdate.ok) {
    assertEqual(
      staleOperatorOrderUpdate.response.status,
      401,
      "Revoked Operator session should return unauthorized"
    );
  }

  const queueOwnerDemotion = await updateUserRoute.PATCH(
    jsonRequest(
      `http://localhost/api/admin/users/${targetOwner.id}`,
      { [productionAuth.ADMIN_SESSION_COOKIE]: ownerToken },
      ownerDemoteBody("Target Owner Demoted")
    ),
    { params: Promise.resolve({ id: targetOwner.id }) }
  );
  const queueOwnerDemotionBody = (await queueOwnerDemotion.json()) as {
    pendingOwnerChange?: { id: string };
    existingPendingOwnerChange?: boolean;
  };
  assertEqual(
    queueOwnerDemotion.status,
    202,
    "Demoting another Owner should create a pending owner change"
  );
  assert(
    queueOwnerDemotionBody.pendingOwnerChange?.id,
    "Pending owner change response should include its id"
  );
  const activeOwnerCount = await prisma.adminUser.count({
    where: { accountType: "OWNER", isActive: true },
  });
  const ownerNotificationRows = await prisma.authEmailOutbox.findMany({
    where: {
      eventType: "OWNER_CHANGE_REQUESTED",
      metadata: {
        path: ["pendingOwnerChangeId"],
        equals: queueOwnerDemotionBody.pendingOwnerChange.id,
      },
    },
    select: { id: true, recipientEmail: true, textBody: true, metadata: true },
  });
  assertEqual(
    ownerNotificationRows.length,
    activeOwnerCount,
    "Owner cooling-off request should enqueue one notification for each active Owner"
  );
  assert(
    ownerNotificationRows.every((row) => !row.textBody.includes("ownerChangeCancelToken=")),
    "Owner notification text should not store raw cancel tokens"
  );
  assert(
    ownerNotificationRows.every((row) => {
      const metadata = row.metadata;
      return (
        metadata &&
        typeof metadata === "object" &&
        !Array.isArray(metadata) &&
        typeof (metadata as Record<string, unknown>).encryptedCancelUrl === "string"
      );
    }),
    "Owner notification metadata should include encrypted cancel URL"
  );
  const ownerCancelTokenCount = await prisma.pendingOwnerChangeCancelToken.count({
    where: { pendingOwnerChangeId: queueOwnerDemotionBody.pendingOwnerChange.id },
  });
  assertEqual(
    ownerCancelTokenCount,
    activeOwnerCount,
    "Owner cooling-off request should create one cancel token per active Owner"
  );
  const unchangedOwner = await prisma.adminUser.findUniqueOrThrow({
    where: { id: targetOwner.id },
    select: { accountType: true, isActive: true },
  });
  assertEqual(
    unchangedOwner.accountType,
    "OWNER",
    "Pending Owner demotion should not execute immediately"
  );
  assertEqual(
    unchangedOwner.isActive,
    true,
    "Pending Owner demotion should leave target active before execution"
  );

  const duplicateOwnerDemotion = await updateUserRoute.PATCH(
    jsonRequest(
      `http://localhost/api/admin/users/${targetOwner.id}`,
      { [productionAuth.ADMIN_SESSION_COOKIE]: ownerToken },
      ownerDemoteBody("Target Owner Demoted Again")
    ),
    { params: Promise.resolve({ id: targetOwner.id }) }
  );
  const duplicateOwnerDemotionBody = (await duplicateOwnerDemotion.json()) as {
    pendingOwnerChange?: { id: string };
    existingPendingOwnerChange?: boolean;
  };
  assertEqual(
    duplicateOwnerDemotion.status,
    202,
    "Duplicate Owner destructive request should return the existing pending change"
  );
  assertEqual(
    duplicateOwnerDemotionBody.pendingOwnerChange?.id,
    queueOwnerDemotionBody.pendingOwnerChange.id,
    "Duplicate Owner destructive request should not create a second pending change"
  );
  assertEqual(
    duplicateOwnerDemotionBody.existingPendingOwnerChange,
    true,
    "Duplicate Owner destructive request should be marked as existing"
  );
  const duplicateNotificationCount = await prisma.authEmailOutbox.count({
    where: {
      eventType: "OWNER_CHANGE_REQUESTED",
      metadata: {
        path: ["pendingOwnerChangeId"],
        equals: queueOwnerDemotionBody.pendingOwnerChange.id,
      },
    },
  });
  assertEqual(
    duplicateNotificationCount,
    activeOwnerCount,
    "Duplicate Owner request should not enqueue duplicate notifications"
  );
  const ownerNotificationDelivery = await authEmailOutbox.sendPendingAuthEmails({
    batchSize: activeOwnerCount + 5,
    ids: ownerNotificationRows.map((row) => row.id),
  });
  assertEqual(
    ownerNotificationDelivery.sent,
    activeOwnerCount,
    "Owner notification sender should deliver queued notifications in dry-run mode"
  );
  assertEqual(
    ownerNotificationDelivery.failed,
    0,
    "Owner notification sender should not fail dry-run deliveries"
  );
  const sentOwnerNotificationCount = await prisma.authEmailOutbox.count({
    where: {
      eventType: "OWNER_CHANGE_REQUESTED",
      status: "SENT",
      metadata: {
        path: ["pendingOwnerChangeId"],
        equals: queueOwnerDemotionBody.pendingOwnerChange.id,
      },
    },
  });
  assertEqual(
    sentOwnerNotificationCount,
    activeOwnerCount,
    "Owner notification sender should mark delivered notifications as SENT"
  );

  const mutualOwnerChange = await updateUserRoute.PATCH(
    jsonRequest(
      `http://localhost/api/admin/users/${ownerUser.id}`,
      { [productionAuth.ADMIN_SESSION_COOKIE]: targetOwnerToken },
      ownerDemoteBody("Actor Owner Demoted")
    ),
    { params: Promise.resolve({ id: ownerUser.id }) }
  );
  assertEqual(
    mutualOwnerChange.status,
    409,
    "Mutual destructive Owner changes should be blocked"
  );

  const cancelQueuedChange = await cancelOwnerChangeRoute.POST(
    jsonRequest(
      `http://localhost/api/admin/owner-changes/${queueOwnerDemotionBody.pendingOwnerChange.id}/cancel`,
      { [productionAuth.ADMIN_SESSION_COOKIE]: ownerToken },
      {}
    ),
    { params: Promise.resolve({ id: queueOwnerDemotionBody.pendingOwnerChange.id }) }
  );
  assertEqual(cancelQueuedChange.status, 200, "Owner should be able to cancel pending change");
  const cancelledChange = await prisma.pendingOwnerChange.findUniqueOrThrow({
    where: { id: queueOwnerDemotionBody.pendingOwnerChange.id },
    select: { status: true, cancelledAt: true },
  });
  assertEqual(cancelledChange.status, "CANCELLED", "Cancel should mark pending change cancelled");
  assert(cancelledChange.cancelledAt, "Cancel should stamp cancelledAt");

  const executableOwnerDemotion = await updateUserRoute.PATCH(
    jsonRequest(
      `http://localhost/api/admin/users/${targetOwner.id}`,
      { [productionAuth.ADMIN_SESSION_COOKIE]: ownerToken },
      ownerDemoteBody("Target Owner Executed", "VIEWER")
    ),
    { params: Promise.resolve({ id: targetOwner.id }) }
  );
  const executableOwnerDemotionBody = (await executableOwnerDemotion.json()) as {
    pendingOwnerChange?: { id: string };
  };
  assertEqual(executableOwnerDemotion.status, 202, "Second Owner demotion should queue");
  await prisma.pendingOwnerChange.update({
    where: { id: executableOwnerDemotionBody.pendingOwnerChange!.id },
    data: { executesAt: new Date(Date.now() - 1000) },
  });
  const executeResult = await ownerChanges.executeDuePendingOwnerChanges();
  assertEqual(executeResult.executed, 1, "Due Owner change executor should execute one change");
  const demotedOwner = await prisma.adminUser.findUniqueOrThrow({
    where: { id: targetOwner.id },
    include: { outletRoles: true },
  });
  assertEqual(
    demotedOwner.accountType,
    "STAFF",
    "Executed Owner demotion should update account type"
  );
  assertEqual(
    demotedOwner.outletRoles[0]?.role,
    "VIEWER",
    "Executed Owner demotion should apply outlet roles"
  );
  const targetSession = await prisma.adminSession.findUniqueOrThrow({
    where: { tokenHash: productionAuth.hashSessionToken(targetOwnerToken) },
    select: { revokedAt: true },
  });
  assert(targetSession.revokedAt, "Executed Owner change should revoke target sessions");

  console.log("Admin RBAC active-outlet tests passed.");
}

main()
  .catch((error) => {
    console.error("Admin RBAC active-outlet tests failed.");
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
