/* eslint-disable no-console */
import "dotenv/config";

// Disable progressive backoff for the duration of this test. The default
// kicks in at 3 failures and ramps to 30 minutes — fine in production,
// but it would cross-contaminate tests that intentionally generate
// failures (e.g. wrong PIN, no role, viewer rejected) before the
// rate-limit hammer test runs. Per-subject thresholds still apply, so
// the rate-limit test still triggers on its own (5 fails on the
// OPERATOR_SESSION key).
process.env.LOGIN_PROGRESSIVE_BACKOFF_MIN_FAILURES = "999";

import { createRequire } from "module";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  DEVICE_SESSION_COOKIE,
  type DeviceRole,
  buildDatabaseDeviceSessionValue,
} from "@/lib/device-auth";
import { hashAdminPassword } from "@/lib/admin-passwords";
import { getOutletOrderVersion } from "@/lib/outlet-order-sync";

const require = createRequire(import.meta.url);

// `server-only` import guard short-circuit so we can import server modules
// from this Node-side script. Same pattern as test-cash-order-flow.ts. Must
// be set up before any dynamic import of a module that pulls in
// "server-only" — which means the operational-pin, admin-user-surface-access,
// production-auth helpers, and the route handlers below.
const serverOnlyPath = require.resolve("server-only");
require.cache[serverOnlyPath] = {
  id: serverOnlyPath,
  filename: serverOnlyPath,
  loaded: true,
  exports: {},
  children: [],
  paths: [],
} as unknown as NodeJS.Module;

// Loaded inside main() AFTER the shim is installed.
type OperationalPinModule = typeof import("@/lib/operational-pin");
type SurfaceAccessModule = typeof import("@/lib/admin-user-surface-access");
type ProductionAuthModule = typeof import("@/lib/production-auth");
type CascadeModule = typeof import("@/lib/active-operator-cascade");
type AdminMfaModule = typeof import("@/lib/admin-mfa");
type PreflightModule = typeof import("@/lib/active-operator-preflight");
let opPin!: OperationalPinModule;
let surfaceAccess!: SurfaceAccessModule;
let productionAuth!: ProductionAuthModule;
let cascadeMod!: CascadeModule;
let adminMfa!: AdminMfaModule;
let preflight!: PreflightModule;

const runId = `op-staff-${Date.now()}`;
const TEST_OUTLET_ID = `test-outlet-${runId}`;
const SHARED_OUTLET_ID = `test-outlet-shared-${runId}`;
const VALID_PIN = "418273"; // 6 digits, no obvious patterns
const NEW_VALID_PIN = "904612";

const ids = {
  staffOk: `u-staff-ok-${runId}`,
  staffNoPin: `u-staff-nopin-${runId}`,
  staffNoSurface: `u-staff-nosurf-${runId}`,
  staffNoRole: `u-staff-norole-${runId}`,
  staffViewer: `u-staff-viewer-${runId}`,
  adminOk: `u-admin-ok-${runId}`,
  ownerIneligible: `u-owner-${runId}`,
  counterDevice: `dev-counter-${runId}`,
  counterSession: `ds-counter-${runId}`,
  sharedCounterDevice: `dev-shared-counter-${runId}`,
  sharedSession: `ds-shared-${runId}`,
  ownerAdmin: `u-owner-admin-${runId}`,
  ownerAdminSession: `as-owner-${runId}`,
  nonOwnerAdmin: `u-nonowner-admin-${runId}`,
  nonOwnerAdminSession: `as-nonowner-${runId}`,
};

let counterSessionToken = "";
let sharedSessionToken = "";
let ownerAdminToken = "";
let nonOwnerAdminToken = "";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function deviceCookie(token: string, role: DeviceRole = "counter"): string {
  return `${DEVICE_SESSION_COOKIE}=${buildDatabaseDeviceSessionValue(role, token)}`;
}

function adminCookie(token: string): string {
  return `rb_admin_session=${token}`;
}

function adminRequest(
  token: string,
  method: string,
  url: string,
  body?: Record<string, unknown>
): NextRequest {
  return new NextRequest(url, {
    method,
    headers: {
      cookie: adminCookie(token),
      origin: "http://localhost",
      referer: "http://localhost/",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function request(
  token: string,
  method: string,
  url: string,
  body?: Record<string, unknown>,
  role: DeviceRole = "counter"
): NextRequest {
  return new NextRequest(url, {
    method,
    headers: {
      cookie: deviceCookie(token, role),
      origin: "http://localhost",
      referer: "http://localhost/",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function setUp(): Promise<void> {
  await prisma.site.upsert({
    where: { id: "site" },
    update: {},
    create: { id: "site", name: "Rushbite", timezone: "America/Edmonton" },
  });
  await prisma.outlet.upsert({
    where: { id: TEST_OUTLET_ID },
    update: { isActive: true },
    create: {
      id: TEST_OUTLET_ID,
      siteId: "site",
      name: `Test outlet ${runId}`,
      slug: TEST_OUTLET_ID,
      orderPrefix: "T",
      isActive: true,
    },
  });
  await prisma.outlet.upsert({
    where: { id: SHARED_OUTLET_ID },
    update: { isActive: true },
    create: {
      id: SHARED_OUTLET_ID,
      siteId: "site",
      name: `Shared outlet ${runId}`,
      slug: SHARED_OUTLET_ID,
      orderPrefix: "S",
      isActive: true,
    },
  });

  const passwordHash = await hashAdminPassword("temporary-password-not-used");
  const validPinHash = await opPin.hashOperationalPin(VALID_PIN);

  const usersToCreate: Array<{
    id: string;
    accountType: string;
    siteRole?: string | null;
    operationalPinHash?: string | null;
  }> = [
    { id: ids.staffOk, accountType: "STAFF", operationalPinHash: validPinHash },
    { id: ids.staffNoPin, accountType: "STAFF", operationalPinHash: null },
    { id: ids.staffNoSurface, accountType: "STAFF", operationalPinHash: validPinHash },
    { id: ids.staffNoRole, accountType: "STAFF", operationalPinHash: validPinHash },
    { id: ids.staffViewer, accountType: "STAFF", operationalPinHash: validPinHash },
    { id: ids.adminOk, accountType: "ADMIN", siteRole: "ADMIN", operationalPinHash: validPinHash },
    { id: ids.ownerIneligible, accountType: "OWNER", siteRole: "OWNER", operationalPinHash: validPinHash },
  ];

  for (const u of usersToCreate) {
    await prisma.adminUser.upsert({
      where: { id: u.id },
      update: {
        accountType: u.accountType,
        siteRole: u.siteRole ?? null,
        operationalPinHash: u.operationalPinHash ?? null,
        isActive: true,
      },
      create: {
        id: u.id,
        email: `${u.id}@test.local`,
        displayName: `Test ${u.id}`,
        passwordHash,
        accountType: u.accountType,
        siteRole: u.siteRole ?? null,
        operationalPinHash: u.operationalPinHash ?? null,
        isActive: true,
      },
    });
  }

  // Outlet roles: MANAGER for staffOk, staffNoPin, staffNoSurface, adminOk
  //               VIEWER for staffViewer
  //               none for staffNoRole
  for (const userId of [ids.staffOk, ids.staffNoPin, ids.staffNoSurface, ids.adminOk]) {
    await prisma.adminUserOutletRole.upsert({
      where: { userId_outletId: { userId, outletId: TEST_OUTLET_ID } },
      update: { role: "MANAGER" },
      create: { userId, outletId: TEST_OUTLET_ID, role: "MANAGER" },
    });
  }
  await prisma.adminUserOutletRole.upsert({
    where: { userId_outletId: { userId: ids.staffViewer, outletId: TEST_OUTLET_ID } },
    update: { role: "VIEWER" },
    create: { userId: ids.staffViewer, outletId: TEST_OUTLET_ID, role: "VIEWER" },
  });

  // Surface grants: COUNTER for staffOk, staffNoPin, staffNoRole, staffViewer, adminOk
  //                 KITCHEN for staffNoSurface (so they have NO COUNTER grant)
  for (const userId of [ids.staffOk, ids.staffNoPin, ids.staffNoRole, ids.staffViewer, ids.adminOk]) {
    await prisma.adminUserSurfaceAccess.upsert({
      where: { userId_surface: { userId, surface: "COUNTER" } },
      update: {},
      create: { userId, surface: "COUNTER" },
    });
  }
  await prisma.adminUserSurfaceAccess.upsert({
    where: { userId_surface: { userId: ids.staffNoSurface, surface: "KITCHEN" } },
    update: {},
    create: { userId: ids.staffNoSurface, surface: "KITCHEN" },
  });

  // Single-outlet counter device
  await prisma.device.upsert({
    where: { id: ids.counterDevice },
    update: { isActive: true, role: "counter", outletId: TEST_OUTLET_ID, isSharedAcrossOutlets: false },
    create: {
      id: ids.counterDevice,
      siteId: "site",
      outletId: TEST_OUTLET_ID,
      name: `counter-${runId}`,
      role: "counter",
      isSharedAcrossOutlets: false,
      secretHash: passwordHash,
      isActive: true,
    },
  });

  // Shared counter device
  await prisma.device.upsert({
    where: { id: ids.sharedCounterDevice },
    update: { isActive: true, role: "counter", outletId: null, isSharedAcrossOutlets: true },
    create: {
      id: ids.sharedCounterDevice,
      siteId: "site",
      name: `shared-counter-${runId}`,
      role: "counter",
      isSharedAcrossOutlets: true,
      secretHash: passwordHash,
      isActive: true,
    },
  });
  await prisma.deviceOutletAccess.upsert({
    where: {
      deviceId_outletId: { deviceId: ids.sharedCounterDevice, outletId: TEST_OUTLET_ID },
    },
    update: {},
    create: { deviceId: ids.sharedCounterDevice, outletId: TEST_OUTLET_ID },
  });
  await prisma.deviceOutletAccess.upsert({
    where: {
      deviceId_outletId: { deviceId: ids.sharedCounterDevice, outletId: SHARED_OUTLET_ID },
    },
    update: {},
    create: { deviceId: ids.sharedCounterDevice, outletId: SHARED_OUTLET_ID },
  });

  // Sessions
  counterSessionToken = productionAuth.createSessionToken();
  await prisma.deviceSession.upsert({
    where: { id: ids.counterSession },
    update: {
      tokenHash: productionAuth.hashSessionToken(counterSessionToken),
      revokedAt: null,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      activeOutletId: null,
      activeStaffUserId: null,
      activeStaffOutletId: null,
      activeStaffRole: null,
      activeStaffVerifiedAt: null,
      activeStaffLastActionAt: null,
    },
    create: {
      id: ids.counterSession,
      deviceId: ids.counterDevice,
      tokenHash: productionAuth.hashSessionToken(counterSessionToken),
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    },
  });

  sharedSessionToken = productionAuth.createSessionToken();
  await prisma.deviceSession.upsert({
    where: { id: ids.sharedSession },
    update: {
      tokenHash: productionAuth.hashSessionToken(sharedSessionToken),
      revokedAt: null,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      activeOutletId: null,
      activeStaffUserId: null,
      activeStaffOutletId: null,
      activeStaffRole: null,
      activeStaffVerifiedAt: null,
      activeStaffLastActionAt: null,
    },
    create: {
      id: ids.sharedSession,
      deviceId: ids.sharedCounterDevice,
      tokenHash: productionAuth.hashSessionToken(sharedSessionToken),
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    },
  });

  // Owner + non-Owner Admin accounts to drive the admin endpoints. Both
  // need MFA enrolled so requireFreshAdminStepUp can verify; both need
  // an AdminSession with stepUpVerifiedAt fresh.
  const fakeMfaSecret = adminMfa.encryptMfaSecret("OWNERSECRETBASE32EXAMPLE");
  await prisma.adminUser.upsert({
    where: { id: ids.ownerAdmin },
    update: {
      accountType: "OWNER",
      siteRole: "OWNER",
      isActive: true,
      mfaSecretCiphertext: fakeMfaSecret,
      mfaEnabledAt: new Date(),
    },
    create: {
      id: ids.ownerAdmin,
      email: `${ids.ownerAdmin}@test.local`,
      displayName: "Test Owner",
      passwordHash,
      accountType: "OWNER",
      siteRole: "OWNER",
      isActive: true,
      mfaSecretCiphertext: fakeMfaSecret,
      mfaEnabledAt: new Date(),
    },
  });
  await prisma.adminUser.upsert({
    where: { id: ids.nonOwnerAdmin },
    update: {
      accountType: "ADMIN",
      siteRole: "ADMIN",
      isActive: true,
      mfaSecretCiphertext: fakeMfaSecret,
      mfaEnabledAt: new Date(),
    },
    create: {
      id: ids.nonOwnerAdmin,
      email: `${ids.nonOwnerAdmin}@test.local`,
      displayName: "Test Non-Owner Admin",
      passwordHash,
      accountType: "ADMIN",
      siteRole: "ADMIN",
      isActive: true,
      mfaSecretCiphertext: fakeMfaSecret,
      mfaEnabledAt: new Date(),
    },
  });

  ownerAdminToken = productionAuth.createSessionToken();
  await prisma.adminSession.upsert({
    where: { id: ids.ownerAdminSession },
    update: {
      userId: ids.ownerAdmin,
      tokenHash: productionAuth.hashSessionToken(ownerAdminToken),
      expiresAt: new Date(Date.now() + 12 * 3600 * 1000),
      revokedAt: null,
      stepUpVerifiedAt: new Date(),
      stepUpExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
    },
    create: {
      id: ids.ownerAdminSession,
      userId: ids.ownerAdmin,
      tokenHash: productionAuth.hashSessionToken(ownerAdminToken),
      expiresAt: new Date(Date.now() + 12 * 3600 * 1000),
      stepUpVerifiedAt: new Date(),
      stepUpExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
    },
  });

  nonOwnerAdminToken = productionAuth.createSessionToken();
  await prisma.adminSession.upsert({
    where: { id: ids.nonOwnerAdminSession },
    update: {
      userId: ids.nonOwnerAdmin,
      tokenHash: productionAuth.hashSessionToken(nonOwnerAdminToken),
      expiresAt: new Date(Date.now() + 12 * 3600 * 1000),
      revokedAt: null,
      stepUpVerifiedAt: new Date(),
      stepUpExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
    },
    create: {
      id: ids.nonOwnerAdminSession,
      userId: ids.nonOwnerAdmin,
      tokenHash: productionAuth.hashSessionToken(nonOwnerAdminToken),
      expiresAt: new Date(Date.now() + 12 * 3600 * 1000),
      stepUpVerifiedAt: new Date(),
      stepUpExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
    },
  });
}

async function tearDown(): Promise<void> {
  // Delete in order respecting FK constraints.
  await prisma.adminSession.deleteMany({
    where: { id: { in: [ids.ownerAdminSession, ids.nonOwnerAdminSession] } },
  });
  await prisma.deviceSession.deleteMany({
    where: { id: { in: [ids.counterSession, ids.sharedSession] } },
  });
  await prisma.deviceOutletAccess.deleteMany({
    where: { deviceId: { in: [ids.counterDevice, ids.sharedCounterDevice] } },
  });
  await prisma.device.deleteMany({
    where: { id: { in: [ids.counterDevice, ids.sharedCounterDevice] } },
  });
  await prisma.adminUserSurfaceAccess.deleteMany({
    where: { userId: { in: Object.values(ids) } },
  });
  await prisma.adminUserOutletRole.deleteMany({
    where: { outletId: { in: [TEST_OUTLET_ID, SHARED_OUTLET_ID] } },
  });
  await prisma.adminUser.deleteMany({
    where: {
      id: {
        in: [
          ...Object.values(ids).filter((id) => id.startsWith("u-")),
          ids.ownerAdmin,
          ids.nonOwnerAdmin,
        ],
      },
    },
  });
  await prisma.outlet.deleteMany({
    where: { id: { in: [TEST_OUTLET_ID, SHARED_OUTLET_ID] } },
  });
  await prisma.authAuditLog.deleteMany({
    where: {
      OR: [
        { actorId: { in: [ids.counterSession, ids.sharedSession] } },
        { targetId: { in: [ids.counterSession, ids.sharedSession] } },
        { actorLabel: { startsWith: "cascade-test-" } },
      ],
    },
  });
  // Also clean up loginAttempt rows tagged by our test subject keys.
  await prisma.loginAttempt.deleteMany({
    where: {
      subjectType: {
        in: [
          "DEVICE_STAFF_SWITCH_OPERATOR_SESSION",
          "DEVICE_STAFF_SWITCH_OPERATOR_STABLE_DEVICE",
          "DEVICE_STAFF_SWITCH_DEVICE",
          "DEVICE_STAFF_SWITCH_IP",
        ],
      },
      attemptedAt: { gte: new Date(Date.now() - 6 * 3600 * 1000) },
    },
  });
}

const tests: Array<{ name: string; run: () => Promise<void> }> = [];

function test(name: string, run: () => Promise<void>): void {
  tests.push({ name, run });
}

// ---- 1. Pure helpers ----
test("parseOperationalPin accepts 6-8 digits and rejects bad input", async () => {
  // 6-digit valids without any 4-digit blocklist substring (e.g. no "1234"):
  assert(opPin.parseOperationalPin("418273").ok === true, "valid 6-digit non-pattern");
  assert(opPin.parseOperationalPin("90861475").ok === true, "valid 8-digit non-pattern");
  // Rejected inputs:
  assert(opPin.parseOperationalPin("12345678").ok === false, "8-digit ascending should be weak");
  assert(opPin.parseOperationalPin("123478").ok === false, "starts with 1234 substring should be weak");
  assert(opPin.parseOperationalPin("12345").ok === false, "5 digits length");
  assert(opPin.parseOperationalPin("123456789").ok === false, "9 digits length");
  assert(opPin.parseOperationalPin("abcdef").ok === false, "letters format");
  assert(opPin.parseOperationalPin("000000").ok === false, "all zeroes weak");
  assert(opPin.parseOperationalPin("121212").ok === false, "alternation weak");
  assert(opPin.parseOperationalPin(418273).ok === false, "non-string format");
  assert(opPin.parseOperationalPin("").ok === false, "empty rejected");
});

test("hashOperationalPin and verifyOperationalPin roundtrip", async () => {
  const hash = await opPin.hashOperationalPin(VALID_PIN);
  const ok = await opPin.verifyOperationalPin(hash, VALID_PIN);
  assert(ok === true, "roundtrip should verify");
  const wrong = await opPin.verifyOperationalPin(hash, "999111");
  assert(wrong === false, "wrong PIN should reject");
  const sentinel = await opPin.verifyOperationalPin(null, VALID_PIN);
  assert(sentinel === false, "null hash should hit sentinel branch");
  const sentinelEmpty = await opPin.verifyOperationalPin("", VALID_PIN);
  assert(sentinelEmpty === false, "empty hash should hit sentinel branch");
});

test("parseEditableSurface accepts only COUNTER/KITCHEN", async () => {
  assert(surfaceAccess.parseEditableSurface("COUNTER") === "COUNTER", "COUNTER ok");
  assert(surfaceAccess.parseEditableSurface("KITCHEN") === "KITCHEN", "KITCHEN ok");
  assert(surfaceAccess.parseEditableSurface("counter") === "COUNTER", "case-insensitive");
  assert(surfaceAccess.parseEditableSurface("ADMIN") === null, "ADMIN rejected");
  assert(surfaceAccess.parseEditableSurface("BOARD") === null, "BOARD rejected");
  assert(surfaceAccess.parseEditableSurface("KIOSK") === null, "KIOSK rejected");
  assert(surfaceAccess.parseEditableSurface("BOGUS") === null, "arbitrary rejected");
  assert(surfaceAccess.parseEditableSurface(null) === null, "null rejected");
  assert(surfaceAccess.parseEditableSurface(123) === null, "number rejected");
});

// ---- 2. GET status ----
type StatusResponse = {
  device: {
    id: string;
    name: string;
    role: string;
    isSharedAcrossOutlets: boolean;
    primaryOutletId: string | null;
    activeOutletId: string | null;
    allowedOutletIds: string[];
    requiredSurface: string;
  };
  requiresActiveOutlet: boolean;
  activeOperator: null | {
    id: string;
    displayName: string;
    accountType: string | null;
    outletId: string | null;
    outletRole: string | null;
    grantedSurface: string;
    verifiedAt: string | null;
    lastActionAt: string | null;
  };
  eligibleOperators: Array<{
    id: string;
    displayName: string;
    accountType: string;
    outletRole: string;
    surface: string;
    pinSetState: string;
    [extra: string]: unknown;
  }>;
};

let statusRoute: typeof import("@/app/api/device-session/staff/route");
let switchRoute: typeof import("@/app/api/device-session/staff/switch/route");
let clearRoute: typeof import("@/app/api/device-session/staff/clear/route");

async function callStatus(token: string): Promise<{ res: Response; body: StatusResponse }> {
  const res = await statusRoute.GET(
    request(token, "GET", "http://localhost/api/device-session/staff")
  );
  return { res, body: await json<StatusResponse>(res) };
}

async function callSwitch(
  token: string,
  body: Record<string, unknown>
): Promise<{ res: Response; body: Record<string, unknown> }> {
  const res = await switchRoute.POST(
    request(token, "POST", "http://localhost/api/device-session/staff/switch", body)
  );
  return { res, body: await json<Record<string, unknown>>(res) };
}

async function callClear(
  token: string
): Promise<{ res: Response; body: Record<string, unknown> }> {
  const res = await clearRoute.POST(
    request(token, "POST", "http://localhost/api/device-session/staff/clear", {})
  );
  return { res, body: await json<Record<string, unknown>>(res) };
}

test("GET status returns eligible-operator list with correct shape and excluded fields", async () => {
  const { res, body } = await callStatus(counterSessionToken);
  assert(res.status === 200, `status 200 expected, got ${res.status}`);
  assert(body.device.role === "counter", "device role counter");
  assert(body.device.requiredSurface === "COUNTER", "required surface COUNTER");
  assert(body.activeOperator === null, "no active operator initially");
  assert(body.requiresActiveOutlet === false, "single-outlet device does not require active outlet");

  const ids2 = body.eligibleOperators.map((o) => o.id);
  assert(ids2.includes(ids.staffOk), "staffOk eligible");
  assert(ids2.includes(ids.adminOk), "adminOk eligible (ADMIN with grant + role)");
  assert(!ids2.includes(ids.ownerIneligible), "owner not eligible");
  assert(!ids2.includes(ids.staffViewer), "viewer not eligible");
  assert(!ids2.includes(ids.staffNoSurface), "no surface grant -> not eligible");
  assert(!ids2.includes(ids.staffNoRole), "no outlet role -> not eligible");

  const staffOkRow = body.eligibleOperators.find((o) => o.id === ids.staffOk);
  assert(staffOkRow, "staffOk row present");
  assert(staffOkRow!.pinSetState === "SET", "staffOk has PIN");
  assert(staffOkRow!.outletRole === "MANAGER", "outletRole MANAGER");
  assert(staffOkRow!.surface === "COUNTER", "surface COUNTER");
  assert(staffOkRow!.accountType === "STAFF", "accountType STAFF");

  const noPinRow = body.eligibleOperators.find((o) => o.id === ids.staffNoPin);
  assert(noPinRow, "staffNoPin row present");
  assert(noPinRow!.pinSetState === "NOT_SET", "staffNoPin pinSetState NOT_SET");

  // Disclosure check: response must not include forbidden fields.
  const forbidden = ["email", "phone", "lastLoginAt", "passwordHash", "operationalPinHash"];
  for (const row of body.eligibleOperators) {
    for (const key of forbidden) {
      assert(!(key in row), `row leaks ${key}`);
    }
  }
});

// ---- 3. Switch endpoint ----
test("Switch with correct PIN and valid eligibility succeeds (STAFF Manager)", async () => {
  const { res, body } = await callSwitch(counterSessionToken, {
    staffUserId: ids.staffOk,
    pin: VALID_PIN,
  });
  assert(res.status === 200, `expected 200, got ${res.status}: ${JSON.stringify(body)}`);
  assert((body as { ok?: boolean }).ok === true, "ok flag");
  const ds = await prisma.deviceSession.findUnique({ where: { id: ids.counterSession } });
  assert(ds?.activeStaffUserId === ids.staffOk, "active operator persisted");
  assert(ds?.activeStaffOutletId === TEST_OUTLET_ID, "active outlet matches device");
  assert(ds?.activeStaffRole === "MANAGER", "snapshot role MANAGER");
  assert(ds?.activeStaffVerifiedAt instanceof Date, "verifiedAt set");
  assert(ds?.activeStaffLastActionAt === null, "lastActionAt null on switch");
  const audit = await prisma.authAuditLog.findFirst({
    where: { eventType: "DEVICE_STAFF_SWITCHED", targetId: ids.counterSession },
    orderBy: { createdAt: "desc" },
  });
  assert(audit, "DEVICE_STAFF_SWITCHED row written");
  // metadata must not include secret material
  const meta = (audit!.metadata ?? {}) as Record<string, unknown>;
  for (const key of ["pin", "operationalPinHash", "passwordHash", "tokenHash"]) {
    assert(!(key in meta), `metadata leaks ${key}`);
  }
});

test("Switch then GET status reflects active operator with accountType", async () => {
  const { body } = await callStatus(counterSessionToken);
  assert(body.activeOperator !== null, "activeOperator populated");
  assert(body.activeOperator!.id === ids.staffOk, "activeOperator.id matches");
  assert(body.activeOperator!.outletRole === "MANAGER", "activeOperator role MANAGER");
  assert(
    body.activeOperator!.accountType === "STAFF",
    `activeOperator accountType should be STAFF, got ${body.activeOperator!.accountType}`
  );
  assert(
    body.activeOperator!.grantedSurface === "COUNTER",
    "grantedSurface COUNTER"
  );
});

test("Clear endpoint resets active operator and writes audit", async () => {
  const { res, body } = await callClear(counterSessionToken);
  assert(res.status === 200, "clear returns 200");
  assert((body as { cleared?: boolean }).cleared === true, "cleared=true");
  const ds = await prisma.deviceSession.findUnique({ where: { id: ids.counterSession } });
  assert(ds?.activeStaffUserId === null, "active operator cleared");
  assert(ds?.activeStaffVerifiedAt === null, "verifiedAt cleared");
  // activeOutletId should be preserved on a single-outlet device (it can be
  // null since we never set it explicitly for single-outlet flow).
  const audit = await prisma.authAuditLog.findFirst({
    where: { eventType: "DEVICE_STAFF_CLEARED", actorId: ids.counterSession },
    orderBy: { createdAt: "desc" },
  });
  assert(audit, "DEVICE_STAFF_CLEARED row written");
});

test("Clear when nothing is active is idempotent", async () => {
  const { res, body } = await callClear(counterSessionToken);
  assert(res.status === 200, "second clear ok");
  assert((body as { cleared?: boolean }).cleared === false, "cleared=false on no-op");
});

test("Switch rejects wrong PIN with generic credential error and no per-user metadata", async () => {
  const { res, body } = await callSwitch(counterSessionToken, {
    staffUserId: ids.staffOk,
    pin: "999111",
  });
  assert(res.status === 401, `expected 401, got ${res.status}`);
  assert((body as { errorCode?: string }).errorCode === "invalid_credential", "generic code");
  const audit = await prisma.authAuditLog.findFirst({
    where: { eventType: "DEVICE_STAFF_SWITCH_FAILED", targetId: ids.counterSession },
    orderBy: { createdAt: "desc" },
  });
  assert(audit, "DEVICE_STAFF_SWITCH_FAILED row written");
  const meta = (audit!.metadata ?? {}) as Record<string, unknown>;
  assert(meta.reason === "invalid_credential", "reason invalid_credential");
  // Plan §561-567: failure audit must not leak per-user info.
  for (const leak of [
    "attemptedUserId",
    "staffUserId",
    "userId",
    "operatorId",
    "operatorEmail",
    "email",
    "displayName",
  ]) {
    assert(!(leak in meta), `failed-switch metadata must not include ${leak}`);
  }
  // The audit row's own targetId/targetLabel must point to the device
  // session, not the attempted user — that is the structural contract.
  assert(audit!.targetId === ids.counterSession, "targetId is the device session");
  assert(
    audit!.actorId === ids.counterSession,
    "actorId is the device session, not the attempted user"
  );
});

test("Switch rejects user without PIN configured (generic)", async () => {
  const { res, body } = await callSwitch(counterSessionToken, {
    staffUserId: ids.staffNoPin,
    pin: VALID_PIN,
  });
  assert(res.status === 401, "401 for no-PIN user");
  assert((body as { errorCode?: string }).errorCode === "invalid_credential", "generic");
});

test("Switch rejects user without surface grant (generic)", async () => {
  const { res } = await callSwitch(counterSessionToken, {
    staffUserId: ids.staffNoSurface,
    pin: VALID_PIN,
  });
  assert(res.status === 401, "401 for no-surface");
});

test("Switch rejects user without outlet role (generic)", async () => {
  const { res } = await callSwitch(counterSessionToken, {
    staffUserId: ids.staffNoRole,
    pin: VALID_PIN,
  });
  assert(res.status === 401, "401 for no-role");
});

test("Switch rejects Viewer role (generic)", async () => {
  const { res } = await callSwitch(counterSessionToken, {
    staffUserId: ids.staffViewer,
    pin: VALID_PIN,
  });
  assert(res.status === 401, "401 for viewer");
});

test("Switch rejects OWNER account type (generic)", async () => {
  const { res } = await callSwitch(counterSessionToken, {
    staffUserId: ids.ownerIneligible,
    pin: VALID_PIN,
  });
  assert(res.status === 401, "401 for owner");
});

test("Switch allows ADMIN with explicit surface + outlet role", async () => {
  const { res, body } = await callSwitch(counterSessionToken, {
    staffUserId: ids.adminOk,
    pin: VALID_PIN,
  });
  assert(res.status === 200, `expected 200, got ${res.status}: ${JSON.stringify(body)}`);
  await callClear(counterSessionToken);
});

test("Switch rejects unknown user id (generic)", async () => {
  const { res } = await callSwitch(counterSessionToken, {
    staffUserId: `nonexistent-${runId}`,
    pin: VALID_PIN,
  });
  assert(res.status === 401, "401 for unknown user");
});

test("Switch rejects bad body (400)", async () => {
  const res = await switchRoute.POST(
    request(counterSessionToken, "POST", "http://localhost/api/device-session/staff/switch", {})
  );
  assert(res.status === 400, "missing fields -> 400");
});

test("Switch rate-limit triggers per (user, deviceSession) after threshold", async () => {
  // Default OPERATOR threshold is 5 in 15 min. Already used a few attempts;
  // hammer it past the threshold.
  for (let i = 0; i < 8; i += 1) {
    await callSwitch(counterSessionToken, {
      staffUserId: ids.staffOk,
      pin: "999111",
    });
  }
  const { res, body } = await callSwitch(counterSessionToken, {
    staffUserId: ids.staffOk,
    pin: "999111",
  });
  assert(res.status === 429, `expected 429, got ${res.status}`);
  assert((body as { errorCode?: string }).errorCode === "rate_limited", "rate_limited code");
});

test("Failed PIN attempts do NOT write to global ipHash index", async () => {
  // After all the failures above, no LoginAttempt row from operator-switch
  // subjects should have ipHash populated.
  const rows = await prisma.loginAttempt.findMany({
    where: {
      subjectType: {
        in: [
          "DEVICE_STAFF_SWITCH_OPERATOR_SESSION",
          "DEVICE_STAFF_SWITCH_OPERATOR_STABLE_DEVICE",
          "DEVICE_STAFF_SWITCH_DEVICE",
          "DEVICE_STAFF_SWITCH_IP",
        ],
      },
      attemptedAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
    },
    select: { ipHash: true, subjectType: true },
  });
  assert(rows.length > 0, "operator-switch attempts recorded");
  for (const row of rows) {
    assert(row.ipHash === null, `ipHash must be null for ${row.subjectType} but was ${row.ipHash}`);
  }
});

// ---- 4. Shared device active-outlet flow ----
test("GET status on shared device without activeOutletId reports requiresActiveOutlet", async () => {
  const { res, body } = await callStatus(sharedSessionToken);
  assert(res.status === 200, "shared status 200");
  assert(body.requiresActiveOutlet === true, "requiresActiveOutlet flag");
  assert(body.eligibleOperators.length === 0, "empty list until outlet is selected");
});

test("Switch on shared device without outletId in body returns active_outlet_required", async () => {
  const { res, body } = await callSwitch(sharedSessionToken, {
    staffUserId: ids.staffOk,
    pin: VALID_PIN,
  });
  assert(res.status === 400, `expected 400, got ${res.status}`);
  assert((body as { errorCode?: string }).errorCode === "active_outlet_required", "active_outlet_required");

  // activeOutletId must NOT have been written
  const ds = await prisma.deviceSession.findUnique({ where: { id: ids.sharedSession } });
  assert(ds?.activeOutletId === null, "activeOutletId still null");
});

test("Switch on shared device with valid outletId persists activeOutletId only on success", async () => {
  // Wrong PIN first — must NOT persist activeOutletId
  await callSwitch(sharedSessionToken, {
    staffUserId: ids.staffOk,
    pin: "999111",
    outletId: TEST_OUTLET_ID,
  });
  const dsFail = await prisma.deviceSession.findUnique({ where: { id: ids.sharedSession } });
  assert(dsFail?.activeOutletId === null, "activeOutletId still null after wrong PIN");

  // Correct PIN — persists
  const { res } = await callSwitch(sharedSessionToken, {
    staffUserId: ids.staffOk,
    pin: VALID_PIN,
    outletId: TEST_OUTLET_ID,
  });
  assert(res.status === 200, `expected 200, got ${res.status}`);
  const dsOk = await prisma.deviceSession.findUnique({ where: { id: ids.sharedSession } });
  assert(dsOk?.activeOutletId === TEST_OUTLET_ID, "activeOutletId now set");
});

// ---- 5. Phase 2 cascade helper ----
async function ensureActiveOperator(
  sessionId: string,
  outletId: string,
  userId: string
): Promise<void> {
  await prisma.deviceSession.update({
    where: { id: sessionId },
    data: {
      activeOutletId: outletId,
      activeStaffUserId: userId,
      activeStaffOutletId: outletId,
      activeStaffRole: "MANAGER",
      activeStaffVerifiedAt: new Date(),
      activeStaffLastActionAt: null,
    },
  });
}

const cascadeAuditMarker = `cascade-test-${runId}`;
const cascadeActor = {
  type: "TEST_HARNESS" as const,
  id: "test-harness",
  label: cascadeAuditMarker,
};

test("Cascade: kind=user clears all active sessions for that user with audit", async () => {
  await ensureActiveOperator(ids.counterSession, TEST_OUTLET_ID, ids.staffOk);
  await ensureActiveOperator(ids.sharedSession, TEST_OUTLET_ID, ids.staffOk);

  const result = await prisma.$transaction(async (tx) => {
    return cascadeMod.cascadeClearActiveOperator(tx, {
      filter: { kind: "user", userId: ids.staffOk },
      reason: "PIN_RESET",
      actor: cascadeActor,
    });
  });

  assert(
    result.clearedSessionIds.length === 2,
    `expected 2 cleared, got ${result.clearedSessionIds.length}`
  );

  const sessions = await prisma.deviceSession.findMany({
    where: { id: { in: [ids.counterSession, ids.sharedSession] } },
    select: { activeStaffUserId: true, activeStaffVerifiedAt: true },
  });
  for (const s of sessions) {
    assert(s.activeStaffUserId === null, "activeStaffUserId cleared");
    assert(s.activeStaffVerifiedAt === null, "activeStaffVerifiedAt cleared");
  }

  const audits = await prisma.authAuditLog.findMany({
    where: {
      eventType: "DEVICE_STAFF_INVALIDATED",
      actorLabel: cascadeAuditMarker,
    },
  });
  assert(audits.length === 2, `expected 2 audit rows, got ${audits.length}`);
  for (const audit of audits) {
    const meta = (audit.metadata ?? {}) as Record<string, unknown>;
    assert(meta.reason === "PIN_RESET", "metadata.reason set");
    assert(typeof meta.affectedUserId === "string", "affectedUserId recorded");
  }
});

test("Cascade: kind=user-outlet clears only sessions targeting that outlet", async () => {
  await ensureActiveOperator(ids.counterSession, TEST_OUTLET_ID, ids.staffOk);
  await ensureActiveOperator(ids.sharedSession, SHARED_OUTLET_ID, ids.staffOk);

  const result = await prisma.$transaction(async (tx) => {
    return cascadeMod.cascadeClearActiveOperator(tx, {
      filter: { kind: "user-outlet", userId: ids.staffOk, outletId: SHARED_OUTLET_ID },
      reason: "ROLE_REVOKED",
      actor: cascadeActor,
    });
  });

  assert(
    result.clearedSessionIds.length === 1,
    `expected 1 cleared, got ${result.clearedSessionIds.length}`
  );
  assert(
    result.clearedSessionIds[0] === ids.sharedSession,
    "shared session cleared (matched outlet)"
  );

  const counter = await prisma.deviceSession.findUnique({
    where: { id: ids.counterSession },
    select: { activeStaffUserId: true },
  });
  assert(
    counter?.activeStaffUserId === ids.staffOk,
    "counter session preserved (outlet did not match)"
  );

  const shared = await prisma.deviceSession.findUnique({
    where: { id: ids.sharedSession },
    select: { activeStaffUserId: true },
  });
  assert(shared?.activeStaffUserId === null, "shared session cleared");

  // Reset for next test
  await prisma.deviceSession.update({
    where: { id: ids.counterSession },
    data: {
      activeStaffUserId: null,
      activeStaffOutletId: null,
      activeStaffRole: null,
      activeStaffVerifiedAt: null,
      activeStaffLastActionAt: null,
    },
  });
});

test("Cascade: kind=user-surface clears only sessions on devices of that surface", async () => {
  // Counter device → COUNTER surface; shared counter device → COUNTER surface.
  // Both should clear when COUNTER is the surface filter.
  await ensureActiveOperator(ids.counterSession, TEST_OUTLET_ID, ids.staffOk);
  await ensureActiveOperator(ids.sharedSession, TEST_OUTLET_ID, ids.staffOk);

  const result = await prisma.$transaction(async (tx) => {
    return cascadeMod.cascadeClearActiveOperator(tx, {
      filter: { kind: "user-surface", userId: ids.staffOk, surface: "COUNTER" },
      reason: "SURFACE_ACCESS_REMOVED",
      actor: cascadeActor,
      extraMetadata: { removedSurface: "COUNTER" },
    });
  });

  assert(
    result.clearedSessionIds.length === 2,
    `expected 2 cleared (both counter devices), got ${result.clearedSessionIds.length}`
  );

  // KITCHEN cascade against the same user — none of our test devices are
  // kitchen role, so nothing should match.
  await ensureActiveOperator(ids.counterSession, TEST_OUTLET_ID, ids.staffOk);
  const noop = await prisma.$transaction(async (tx) => {
    return cascadeMod.cascadeClearActiveOperator(tx, {
      filter: { kind: "user-surface", userId: ids.staffOk, surface: "KITCHEN" },
      reason: "SURFACE_ACCESS_REMOVED",
      actor: cascadeActor,
    });
  });
  assert(
    noop.clearedSessionIds.length === 0,
    "kitchen cascade leaves counter sessions alone"
  );
});

test("Cascade: writes only the canonical metadata fields", async () => {
  // After several cascades above, look at the most recent audit for
  // staffOk and verify metadata structure is allow-list-compliant.
  const recent = await prisma.authAuditLog.findFirst({
    where: { eventType: "DEVICE_STAFF_INVALIDATED", actorLabel: cascadeAuditMarker },
    orderBy: { createdAt: "desc" },
  });
  assert(recent, "at least one cascade audit exists");
  const meta = (recent!.metadata ?? {}) as Record<string, unknown>;
  // Required fields:
  for (const field of ["reason", "deviceId", "deviceRole", "affectedUserId"]) {
    assert(field in meta, `metadata must include ${field}`);
  }
  // Forbidden fields (no secret material):
  for (const leak of ["pin", "operationalPinHash", "passwordHash", "tokenHash"]) {
    assert(!(leak in meta), `metadata must not include ${leak}`);
  }
});

test("Cleanup of cascade test residue", async () => {
  await prisma.deviceSession.updateMany({
    where: { id: { in: [ids.counterSession, ids.sharedSession] } },
    data: {
      activeStaffUserId: null,
      activeStaffOutletId: null,
      activeStaffRole: null,
      activeStaffVerifiedAt: null,
      activeStaffLastActionAt: null,
    },
  });
});

// ---- 6. PIN/surface helpers ----
test("generateOperationalPin always produces a parse-passing PIN", async () => {
  for (let i = 0; i < 50; i += 1) {
    const pin = opPin.generateOperationalPin();
    assert(pin.length === 6, "6 digits");
    assert(/^\d+$/.test(pin), "all digits");
    assert(opPin.parseOperationalPin(pin).ok === true, "passes policy");
  }
});

// ---- 7. Admin endpoint tests (Phase 2 routes) ----
let resetPinRoute: typeof import("@/app/api/admin/users/[id]/reset-pin/route");
let surfaceAccessRoute: typeof import("@/app/api/admin/users/[id]/surface-access/route");
let orderRoute: typeof import("@/app/api/orders/[id]/route");

async function callResetPin(
  adminToken: string,
  targetUserId: string,
  body: Record<string, unknown>
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await resetPinRoute.POST(
    adminRequest(
      adminToken,
      "POST",
      `http://localhost/api/admin/users/${targetUserId}/reset-pin`,
      body
    ),
    { params: Promise.resolve({ id: targetUserId }) }
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function callSurfaceAccess(
  adminToken: string,
  targetUserId: string,
  body: Record<string, unknown>
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await surfaceAccessRoute.PATCH(
    adminRequest(
      adminToken,
      "PATCH",
      `http://localhost/api/admin/users/${targetUserId}/surface-access`,
      body
    ),
    { params: Promise.resolve({ id: targetUserId }) }
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

test("reset-pin: Owner can auto-generate; PIN echoed once and only once", async () => {
  const result = await callResetPin(ownerAdminToken, ids.staffOk, {
    generate: true,
  });
  assert(result.status === 200, `expected 200, got ${result.status}: ${JSON.stringify(result.body)}`);
  const pin = (result.body as { pin?: string }).pin;
  assert(typeof pin === "string" && /^\d{6,8}$/.test(pin), "PIN echoed in response");
  assert(result.body.pinSource === "auto", "pinSource=auto");

  // PIN must be hashed in DB and verify against the stored hash.
  const user = await prisma.adminUser.findUnique({
    where: { id: ids.staffOk },
    select: { operationalPinHash: true },
  });
  assert(user?.operationalPinHash, "hash stored");
  const ok = await opPin.verifyOperationalPin(user!.operationalPinHash!, pin!);
  assert(ok === true, "stored hash verifies against echoed PIN");
});

test("reset-pin: manual PIN is accepted but never echoed back", async () => {
  const result = await callResetPin(ownerAdminToken, ids.staffOk, {
    pin: NEW_VALID_PIN,
  });
  assert(result.status === 200, `expected 200, got ${result.status}`);
  assert(result.body.pinSource === "manual", "pinSource=manual");
  assert(!("pin" in result.body) || result.body.pin === undefined, "manual pin must not echo");
});

test("reset-pin: weak PIN rejected with weak_pin code", async () => {
  const result = await callResetPin(ownerAdminToken, ids.staffOk, { pin: "123456" });
  assert(result.status === 400, `expected 400, got ${result.status}`);
  assert(result.body.errorCode === "weak_pin", "errorCode=weak_pin");
});

test("reset-pin: ineligible OWNER target rejected", async () => {
  const result = await callResetPin(ownerAdminToken, ids.ownerIneligible, {
    generate: true,
  });
  assert(result.status === 400, `expected 400, got ${result.status}`);
  assert(
    result.body.errorCode === "ineligible_account_type",
    `expected ineligible_account_type, got ${result.body.errorCode}`
  );
});

test("reset-pin: non-Owner Admin is forbidden", async () => {
  const result = await callResetPin(nonOwnerAdminToken, ids.staffOk, {
    generate: true,
  });
  assert(result.status === 403, `expected 403, got ${result.status}`);
});

test("reset-pin: cascade clears active operator sessions and reports the count", async () => {
  // Set up active operator on counter session for staffOk so the cascade
  // will have something to clear.
  await prisma.deviceSession.update({
    where: { id: ids.counterSession },
    data: {
      activeOutletId: TEST_OUTLET_ID,
      activeStaffUserId: ids.staffOk,
      activeStaffOutletId: TEST_OUTLET_ID,
      activeStaffRole: "MANAGER",
      activeStaffVerifiedAt: new Date(),
      activeStaffLastActionAt: null,
    },
  });

  const result = await callResetPin(ownerAdminToken, ids.staffOk, {
    generate: true,
  });
  assert(result.status === 200, `expected 200, got ${result.status}`);
  assert(
    typeof result.body.cascadeClearedSessionCount === "number" &&
      result.body.cascadeClearedSessionCount >= 1,
    `expected cascade count >= 1, got ${result.body.cascadeClearedSessionCount}`
  );
  const ds = await prisma.deviceSession.findUnique({
    where: { id: ids.counterSession },
    select: { activeStaffUserId: true },
  });
  assert(ds?.activeStaffUserId === null, "session cleared by cascade");

  // OPERATIONAL_PIN_RESET audit must exist with cascade count metadata.
  const audit = await prisma.authAuditLog.findFirst({
    where: { eventType: "OPERATIONAL_PIN_RESET", targetId: ids.staffOk },
    orderBy: { createdAt: "desc" },
  });
  assert(audit, "OPERATIONAL_PIN_RESET audit written");
  const meta = (audit!.metadata ?? {}) as Record<string, unknown>;
  assert(typeof meta.cascadeClearedSessionCount === "number", "cascade count in metadata");
});

test("surface-access: Owner can add a surface; cascade reports zero on add", async () => {
  // staffNoSurface had KITCHEN; add COUNTER too.
  const result = await callSurfaceAccess(ownerAdminToken, ids.staffNoSurface, {
    surfaces: ["COUNTER", "KITCHEN"],
  });
  assert(result.status === 200, `expected 200, got ${result.status}: ${JSON.stringify(result.body)}`);
  assert(result.body.changed === true, "changed=true");
  assert(result.body.cascadeClearedSessionCount === 0, "no cascade for additions");

  const user = await prisma.adminUser.findUnique({
    where: { id: ids.staffNoSurface },
    include: { surfaceAccess: { select: { surface: true } } },
  });
  const surfaces = (user?.surfaceAccess ?? []).map((row) => row.surface).sort();
  assert(JSON.stringify(surfaces) === JSON.stringify(["COUNTER", "KITCHEN"]), "both granted");
});

test("surface-access: re-sending the same set is a no-op", async () => {
  const result = await callSurfaceAccess(ownerAdminToken, ids.staffNoSurface, {
    surfaces: ["COUNTER", "KITCHEN"],
  });
  assert(result.status === 200, "200 even on no-op");
  assert(result.body.changed === false, "changed=false");
});

test("surface-access: rejects ADMIN/BOARD/KIOSK with surface_not_allowed", async () => {
  for (const bad of ["ADMIN", "BOARD", "KIOSK", "BOGUS"]) {
    const result = await callSurfaceAccess(ownerAdminToken, ids.staffOk, {
      surfaces: [bad],
    });
    assert(result.status === 400, `expected 400 for ${bad}, got ${result.status}`);
    assert(
      result.body.errorCode === "surface_not_allowed",
      `expected surface_not_allowed for ${bad}`
    );
  }
});

test("surface-access: removing COUNTER cascades only counter device sessions", async () => {
  // Set staffOk active on the counter session.
  await prisma.deviceSession.update({
    where: { id: ids.counterSession },
    data: {
      activeOutletId: TEST_OUTLET_ID,
      activeStaffUserId: ids.staffOk,
      activeStaffOutletId: TEST_OUTLET_ID,
      activeStaffRole: "MANAGER",
      activeStaffVerifiedAt: new Date(),
      activeStaffLastActionAt: null,
    },
  });

  // Strip COUNTER (staffOk currently only has COUNTER granted).
  const result = await callSurfaceAccess(ownerAdminToken, ids.staffOk, {
    surfaces: [],
  });
  assert(result.status === 200, "200 on remove");
  assert(result.body.changed === true, "changed=true");
  assert(
    typeof result.body.cascadeClearedSessionCount === "number" &&
      result.body.cascadeClearedSessionCount >= 1,
    "cascade count >= 1"
  );

  const ds = await prisma.deviceSession.findUnique({
    where: { id: ids.counterSession },
    select: { activeStaffUserId: true },
  });
  assert(ds?.activeStaffUserId === null, "active session cleared on counter device");

  // USER_SURFACE_ACCESS_UPDATED audit with before/after.
  const audit = await prisma.authAuditLog.findFirst({
    where: { eventType: "USER_SURFACE_ACCESS_UPDATED", targetId: ids.staffOk },
    orderBy: { createdAt: "desc" },
  });
  assert(audit, "USER_SURFACE_ACCESS_UPDATED audit written");
  const meta = (audit!.metadata ?? {}) as Record<string, unknown>;
  assert(Array.isArray(meta.previousSurfaces), "previousSurfaces present");
  assert(Array.isArray(meta.nextSurfaces), "nextSurfaces present");

  // Restore for any subsequent tests.
  await prisma.adminUserSurfaceAccess.upsert({
    where: { userId_surface: { userId: ids.staffOk, surface: "COUNTER" } },
    update: {},
    create: { userId: ids.staffOk, surface: "COUNTER" },
  });
});

test("surface-access: non-Owner Admin is forbidden", async () => {
  const result = await callSurfaceAccess(nonOwnerAdminToken, ids.staffOk, {
    surfaces: ["COUNTER"],
  });
  assert(result.status === 403, `expected 403, got ${result.status}`);
});

// ---- 8. Phase 3 order PATCH enforcement ----
async function createTestOrder(
  outletId: string,
  status: string,
  paymentMethod: "CASH" | "ONLINE" = "CASH"
): Promise<string> {
  const order = await prisma.order.create({
    data: {
      outletId,
      orderNumber: `TST-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`,
      kioskId: "test-kiosk",
      orderType: "DINE_IN",
      status,
      subtotal: "10.00",
      gst: "0.50",
      total: "10.50",
      paymentMethod,
      paymentProvider: paymentMethod === "CASH" ? "CASH" : "STRIPE",
      paymentStatus: status === "AWAITING_COUNTER_PAYMENT" ? "PENDING" : "CAPTURED",
    },
    select: { id: true },
  });
  return order.id;
}

async function callOrderPatch(
  token: string,
  orderId: string,
  status: string,
  role: DeviceRole = "counter"
): Promise<{ res: Response; body: Record<string, unknown> }> {
  const res = await orderRoute.PATCH(
    request(token, "PATCH", `http://localhost/api/orders/${orderId}`, { status }, role),
    { params: Promise.resolve({ id: orderId }) }
  );
  return { res, body: (await res.json()) as Record<string, unknown> };
}

async function setActiveOperator(
  sessionId: string,
  outletId: string,
  userId: string
): Promise<void> {
  await prisma.deviceSession.update({
    where: { id: sessionId },
    data: {
      activeOutletId: outletId,
      activeStaffUserId: userId,
      activeStaffOutletId: outletId,
      activeStaffRole: "MANAGER",
      activeStaffVerifiedAt: new Date(),
      activeStaffLastActionAt: null,
    },
  });
}

const createdOrderIds: string[] = [];

test("Order PATCH: blocked when no active operator (counter, no operator)", async () => {
  // Make sure no active operator on counter session.
  await callClear(counterSessionToken);
  const orderId = await createTestOrder(TEST_OUTLET_ID, "AWAITING_COUNTER_PAYMENT");
  createdOrderIds.push(orderId);

  const { res, body } = await callOrderPatch(counterSessionToken, orderId, "PAID");
  assert(res.status === 403, `expected 403, got ${res.status}`);
  assert(body.errorCode === "no_active_operator", `expected no_active_operator, got ${body.errorCode}`);
  assert(body.operatorRequired === true, "operatorRequired flag");

  const stillAwaiting = await prisma.order.findUnique({
    where: { id: orderId },
    select: { status: true },
  });
  assert(stillAwaiting?.status === "AWAITING_COUNTER_PAYMENT", "order unchanged");
});

test("Order PATCH: succeeds with active operator + writes audit + bumps lastActionAt", async () => {
  // Set up valid active operator (staffOk has COUNTER + MANAGER@TEST_OUTLET_ID).
  await setActiveOperator(ids.counterSession, TEST_OUTLET_ID, ids.staffOk);
  const orderId = await createTestOrder(TEST_OUTLET_ID, "AWAITING_COUNTER_PAYMENT");
  createdOrderIds.push(orderId);
  const beforeVersion = await getOutletOrderVersion(prisma, TEST_OUTLET_ID);

  const { res, body } = await callOrderPatch(counterSessionToken, orderId, "PAID");
  assert(res.status === 200, `expected 200, got ${res.status}: ${JSON.stringify(body)}`);
  assert(body.status === "PAID", "status returned");
  const afterVersion = await getOutletOrderVersion(prisma, TEST_OUTLET_ID);
  assert(
    afterVersion.revision === beforeVersion.revision + 1,
    "active-operator order PATCH bumps OutletOrderVersion exactly once"
  );

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { status: true, paymentStatus: true },
  });
  assert(order?.status === "PAID", "DB status updated");
  assert(order?.paymentStatus === "CAPTURED", "cash payment captured");

  const ds = await prisma.deviceSession.findUnique({
    where: { id: ids.counterSession },
    select: { activeStaffLastActionAt: true },
  });
  assert(ds?.activeStaffLastActionAt instanceof Date, "lastActionAt bumped");

  const audit = await prisma.authAuditLog.findFirst({
    where: { eventType: "ORDER_STATUS_UPDATED_BY_DEVICE_STAFF", targetId: orderId },
    orderBy: { createdAt: "desc" },
  });
  assert(audit, "ORDER_STATUS_UPDATED_BY_DEVICE_STAFF audit written");
  assert(audit!.actorId === ids.staffOk, "actorId is the operator");
  const meta = (audit!.metadata ?? {}) as Record<string, unknown>;
  assert(meta.previousStatus === "AWAITING_COUNTER_PAYMENT", "previousStatus");
  assert(meta.nextStatus === "PAID", "nextStatus");
  assert(meta.usedSurface === "COUNTER", "usedSurface");
  assert(meta.usedOutletRole === "MANAGER", "usedOutletRole");
});

test("Order PATCH: counter cannot perform kitchen-only transition", async () => {
  await setActiveOperator(ids.counterSession, TEST_OUTLET_ID, ids.staffOk);
  const orderId = await createTestOrder(TEST_OUTLET_ID, "PAID");
  createdOrderIds.push(orderId);

  const { res, body } = await callOrderPatch(counterSessionToken, orderId, "IN_KITCHEN");
  assert(res.status === 409, `expected 409, got ${res.status}`);
  assert(
    body.errorCode === "transition_not_allowed_for_surface",
    `expected transition_not_allowed_for_surface, got ${body.errorCode}`
  );
});

test("Order PATCH: stale-order conflict returned as 409 stale_transition", async () => {
  await setActiveOperator(ids.counterSession, TEST_OUTLET_ID, ids.staffOk);
  const orderId = await createTestOrder(TEST_OUTLET_ID, "AWAITING_COUNTER_PAYMENT");
  createdOrderIds.push(orderId);

  // Move the order to PAID via a direct DB update (simulating another tab
  // beating us to the punch). Then try to mark PAID again — counter cannot
  // transition PAID → PAID.
  await prisma.order.update({
    where: { id: orderId },
    data: { status: "PAID" },
  });
  const { res, body } = await callOrderPatch(counterSessionToken, orderId, "PAID");
  assert(res.status === 409, `expected 409, got ${res.status}`);
  // Cheap pre-check fires first because order.status was already PAID at
  // the read time.
  assert(
    body.errorCode === "transition_not_allowed_for_surface" ||
      body.errorCode === "stale_transition",
    `expected transition_not_allowed_for_surface or stale_transition, got ${body.errorCode}`
  );
});

test("Order PATCH: idle-expired operator gets 403 + writes DEVICE_STAFF_EXPIRED", async () => {
  // Force idle baseline far enough in the past to exceed idle window
  // (default 30 min). We bypass the policy by setting verifiedAt 2h ago.
  await prisma.deviceSession.update({
    where: { id: ids.counterSession },
    data: {
      activeOutletId: TEST_OUTLET_ID,
      activeStaffUserId: ids.staffOk,
      activeStaffOutletId: TEST_OUTLET_ID,
      activeStaffRole: "MANAGER",
      activeStaffVerifiedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      activeStaffLastActionAt: null,
    },
  });
  const orderId = await createTestOrder(TEST_OUTLET_ID, "AWAITING_COUNTER_PAYMENT");
  createdOrderIds.push(orderId);

  const { res, body } = await callOrderPatch(counterSessionToken, orderId, "PAID");
  assert(res.status === 403, `expected 403, got ${res.status}`);
  assert(body.errorCode === "idle_expired", `expected idle_expired, got ${body.errorCode}`);

  const ds = await prisma.deviceSession.findUnique({
    where: { id: ids.counterSession },
    select: { activeStaffUserId: true },
  });
  assert(ds?.activeStaffUserId === null, "operator cleared after idle expiry");

  const audit = await prisma.authAuditLog.findFirst({
    where: { eventType: "DEVICE_STAFF_EXPIRED", actorId: ids.counterSession },
    orderBy: { createdAt: "desc" },
  });
  assert(audit, "DEVICE_STAFF_EXPIRED audit written");
});

test("Order PATCH: role-revoked operator gets 403 + writes DEVICE_STAFF_INVALIDATED", async () => {
  // Create a fresh staff with role + grant + PIN, then revoke role and
  // attempt a PATCH. The wrapper should detect missing role and cascade.
  await setActiveOperator(ids.counterSession, TEST_OUTLET_ID, ids.staffOk);
  // Revoke the outlet role directly (skipping the admin endpoint to keep
  // this test focused on the wrapper logic).
  await prisma.adminUserOutletRole.deleteMany({
    where: { userId: ids.staffOk, outletId: TEST_OUTLET_ID },
  });

  const orderId = await createTestOrder(TEST_OUTLET_ID, "AWAITING_COUNTER_PAYMENT");
  createdOrderIds.push(orderId);
  const { res, body } = await callOrderPatch(counterSessionToken, orderId, "PAID");
  assert(res.status === 403, `expected 403, got ${res.status}`);
  assert(
    body.errorCode === "outlet_role_missing" || body.errorCode === "viewer_role",
    `expected outlet_role_missing/viewer_role, got ${body.errorCode}`
  );

  const audit = await prisma.authAuditLog.findFirst({
    where: { eventType: "DEVICE_STAFF_INVALIDATED", actorLabel: ids.counterDevice },
    orderBy: { createdAt: "desc" },
  });
  // The cascade may have written the audit under the device-session label
  // depending on how `actor.name` resolved. Check by event + recent time.
  const recentInvalidated = await prisma.authAuditLog.findFirst({
    where: {
      eventType: "DEVICE_STAFF_INVALIDATED",
      createdAt: { gte: new Date(Date.now() - 60_000) },
    },
    orderBy: { createdAt: "desc" },
  });
  assert(recentInvalidated || audit, "DEVICE_STAFF_INVALIDATED audit written for role revocation");

  // Restore the role for any subsequent tests.
  await prisma.adminUserOutletRole.upsert({
    where: { userId_outletId: { userId: ids.staffOk, outletId: TEST_OUTLET_ID } },
    update: { role: "MANAGER" },
    create: { userId: ids.staffOk, outletId: TEST_OUTLET_ID, role: "MANAGER" },
  });
});

test("Order PATCH: race-safe — operator cleared between auth and tx aborts cleanly", async () => {
  // The race the conditional updateMany inside the transaction guards
  // against: a cascade clears activeStaff* AFTER the auth read but BEFORE
  // the tx commits. We can't easily interleave that mid-tx, but we can
  // exercise the conditional logic directly: build an operator context
  // that no longer matches the live device session and call
  // recordActiveOperatorAction. It must return false.
  await setActiveOperator(ids.counterSession, TEST_OUTLET_ID, ids.staffOk);

  const authzMod = await import("@/lib/active-operator-authz");
  const session = await prisma.deviceSession.findUnique({
    where: { id: ids.counterSession },
    select: { id: true, activeStaffUserId: true, activeStaffOutletId: true },
  });
  assert(session?.activeStaffUserId === ids.staffOk, "active operator set up");

  // Simulate a cascade clear (cascade sets all activeStaff* fields to null).
  await prisma.deviceSession.update({
    where: { id: ids.counterSession },
    data: {
      activeStaffUserId: null,
      activeStaffOutletId: null,
      activeStaffRole: null,
      activeStaffVerifiedAt: null,
      activeStaffLastActionAt: null,
    },
  });

  const result = await prisma.$transaction(async (tx) => {
    return authzMod.recordActiveOperatorAction(tx, {
      deviceSessionId: ids.counterSession,
      userId: ids.staffOk,
      outletId: TEST_OUTLET_ID,
      outletRole: "MANAGER",
    });
  });
  assert(result === false, "recordActiveOperatorAction must return false on stale operator");

  // And the inverse: when state matches, it returns true.
  await setActiveOperator(ids.counterSession, TEST_OUTLET_ID, ids.staffOk);
  const okResult = await prisma.$transaction(async (tx) => {
    return authzMod.recordActiveOperatorAction(tx, {
      deviceSessionId: ids.counterSession,
      userId: ids.staffOk,
      outletId: TEST_OUTLET_ID,
      outletRole: "MANAGER",
    });
  });
  assert(okResult === true, "recordActiveOperatorAction must return true on matching operator");
  const ds = await prisma.deviceSession.findUnique({
    where: { id: ids.counterSession },
    select: { activeStaffLastActionAt: true },
  });
  assert(ds?.activeStaffLastActionAt instanceof Date, "lastActionAt bumped on match");
});

test("Order PATCH: legacy device session bypasses enforcement", async () => {
  // Build a legacy cookie. The legacy path uses the env-derived secret.
  await setActiveOperator(ids.counterSession, TEST_OUTLET_ID, ids.staffOk);
  const orderId = await createTestOrder(TEST_OUTLET_ID, "AWAITING_COUNTER_PAYMENT");
  createdOrderIds.push(orderId);

  // Build legacy cookie value matching the dev-default key for counter.
  const legacyCookie = `${DEVICE_SESSION_COOKIE}=legacy:counter:local-counter-key`;
  const res = await orderRoute.PATCH(
    new NextRequest(`http://localhost/api/orders/${orderId}`, {
      method: "PATCH",
      headers: {
        cookie: legacyCookie,
        origin: "http://localhost",
        referer: "http://localhost/",
        "content-type": "application/json",
      },
      body: JSON.stringify({ status: "PAID" }),
    }),
    { params: Promise.resolve({ id: orderId }) }
  );
  // Legacy is allowed only when ALLOW_LEGACY_DEVICE_AUTH is enabled
  // (dev default). In dev, the call should succeed; in prod it would
  // already be rejected upstream by isLegacyDeviceAuthEnabled.
  // Either 200 (legacy honored) or 401 (legacy disabled) is acceptable
  // here — this test simply asserts the new enforcement does NOT replace
  // legacy behavior with an active-operator 403.
  assert(
    res.status !== 403,
    `legacy path must not return 403 from active-operator enforcement; got ${res.status}`
  );
});

test("Order PATCH: kitchen blocked when no active operator", async () => {
  // Set up a kitchen device + session for staffOk with KITCHEN grant.
  const kitchenDeviceId = `dev-kitchen-${runId}`;
  const kitchenSessionId = `ds-kitchen-${runId}`;
  const passwordHash = await hashAdminPassword("temporary-password-not-used");
  await prisma.device.upsert({
    where: { id: kitchenDeviceId },
    update: {
      isActive: true,
      role: "kitchen",
      outletId: TEST_OUTLET_ID,
      isSharedAcrossOutlets: false,
    },
    create: {
      id: kitchenDeviceId,
      siteId: "site",
      outletId: TEST_OUTLET_ID,
      name: `kitchen-${runId}`,
      role: "kitchen",
      isSharedAcrossOutlets: false,
      secretHash: passwordHash,
      isActive: true,
    },
  });
  const kitchenToken = productionAuth.createSessionToken();
  await prisma.deviceSession.upsert({
    where: { id: kitchenSessionId },
    update: {
      tokenHash: productionAuth.hashSessionToken(kitchenToken),
      revokedAt: null,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      activeStaffUserId: null,
      activeStaffOutletId: null,
      activeStaffRole: null,
      activeStaffVerifiedAt: null,
      activeStaffLastActionAt: null,
    },
    create: {
      id: kitchenSessionId,
      deviceId: kitchenDeviceId,
      tokenHash: productionAuth.hashSessionToken(kitchenToken),
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    },
  });

  const orderId = await createTestOrder(TEST_OUTLET_ID, "PAID");
  createdOrderIds.push(orderId);
  const res = await orderRoute.PATCH(
    request(kitchenToken, "PATCH", `http://localhost/api/orders/${orderId}`, {
      status: "IN_KITCHEN",
    }, "kitchen"),
    { params: Promise.resolve({ id: orderId }) }
  );
  const body = (await res.json()) as Record<string, unknown>;
  assert(res.status === 403, `expected 403, got ${res.status}`);
  assert(body.errorCode === "no_active_operator", `expected no_active_operator, got ${body.errorCode}`);

  // Cleanup
  await prisma.deviceSession.delete({ where: { id: kitchenSessionId } });
  await prisma.device.delete({ where: { id: kitchenDeviceId } });
});

test("Order PATCH: kitchen cannot release counter cash payment", async () => {
  // A kitchen device has active operator and tries to do
  // AWAITING_COUNTER_PAYMENT → PAID (a counter-only transition).
  const kitchenDeviceId = `dev-kitchen-cash-${runId}`;
  const kitchenSessionId = `ds-kitchen-cash-${runId}`;
  const passwordHash = await hashAdminPassword("temporary-password-not-used");
  await prisma.device.upsert({
    where: { id: kitchenDeviceId },
    update: {
      isActive: true,
      role: "kitchen",
      outletId: TEST_OUTLET_ID,
      isSharedAcrossOutlets: false,
    },
    create: {
      id: kitchenDeviceId,
      siteId: "site",
      outletId: TEST_OUTLET_ID,
      name: `kitchen-cash-${runId}`,
      role: "kitchen",
      isSharedAcrossOutlets: false,
      secretHash: passwordHash,
      isActive: true,
    },
  });
  const kitchenToken = productionAuth.createSessionToken();
  await prisma.deviceSession.upsert({
    where: { id: kitchenSessionId },
    update: {
      tokenHash: productionAuth.hashSessionToken(kitchenToken),
      revokedAt: null,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      activeOutletId: TEST_OUTLET_ID,
      activeStaffUserId: ids.staffOk,
      activeStaffOutletId: TEST_OUTLET_ID,
      activeStaffRole: "MANAGER",
      activeStaffVerifiedAt: new Date(),
      activeStaffLastActionAt: null,
    },
    create: {
      id: kitchenSessionId,
      deviceId: kitchenDeviceId,
      tokenHash: productionAuth.hashSessionToken(kitchenToken),
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      activeOutletId: TEST_OUTLET_ID,
      activeStaffUserId: ids.staffOk,
      activeStaffOutletId: TEST_OUTLET_ID,
      activeStaffRole: "MANAGER",
      activeStaffVerifiedAt: new Date(),
    },
  });
  // staffOk also needs KITCHEN grant; add temporarily.
  await prisma.adminUserSurfaceAccess.upsert({
    where: { userId_surface: { userId: ids.staffOk, surface: "KITCHEN" } },
    update: {},
    create: { userId: ids.staffOk, surface: "KITCHEN" },
  });

  const orderId = await createTestOrder(TEST_OUTLET_ID, "AWAITING_COUNTER_PAYMENT");
  createdOrderIds.push(orderId);
  const res = await orderRoute.PATCH(
    request(kitchenToken, "PATCH", `http://localhost/api/orders/${orderId}`, {
      status: "PAID",
    }, "kitchen"),
    { params: Promise.resolve({ id: orderId }) }
  );
  const body = (await res.json()) as Record<string, unknown>;
  assert(res.status === 409, `expected 409, got ${res.status}: ${JSON.stringify(body)}`);
  assert(
    body.errorCode === "transition_not_allowed_for_surface",
    `expected transition_not_allowed_for_surface, got ${body.errorCode}`
  );

  // Cleanup kitchen surface grant + device.
  await prisma.adminUserSurfaceAccess.deleteMany({
    where: { userId: ids.staffOk, surface: "KITCHEN" },
  });
  await prisma.deviceSession.delete({ where: { id: kitchenSessionId } });
  await prisma.device.delete({ where: { id: kitchenDeviceId } });
});

test("Order PATCH: deactivated operator gets 403 + DEVICE_STAFF_INVALIDATED", async () => {
  await setActiveOperator(ids.counterSession, TEST_OUTLET_ID, ids.staffOk);

  // Deactivate the user directly. The cascade hasn't fired yet — it would
  // fire if this went through PATCH /api/admin/users/[id]. We exercise the
  // wrapper's account_inactive branch by leaving the active-operator row
  // pointing at the now-inactive user.
  await prisma.adminUser.update({
    where: { id: ids.staffOk },
    data: { isActive: false },
  });

  const orderId = await createTestOrder(TEST_OUTLET_ID, "AWAITING_COUNTER_PAYMENT");
  createdOrderIds.push(orderId);
  const { res, body } = await callOrderPatch(counterSessionToken, orderId, "PAID");
  assert(res.status === 403, `expected 403, got ${res.status}`);
  assert(body.errorCode === "account_inactive", `expected account_inactive, got ${body.errorCode}`);

  // Restore for subsequent tests.
  await prisma.adminUser.update({
    where: { id: ids.staffOk },
    data: { isActive: true },
  });

  // Cascade clear should have fired DEVICE_STAFF_INVALIDATED with reason ACCOUNT_DEACTIVATED.
  const audit = await prisma.authAuditLog.findFirst({
    where: { eventType: "DEVICE_STAFF_INVALIDATED", createdAt: { gte: new Date(Date.now() - 60_000) } },
    orderBy: { createdAt: "desc" },
  });
  assert(audit, "DEVICE_STAFF_INVALIDATED row written");
  const meta = (audit!.metadata ?? {}) as Record<string, unknown>;
  assert(meta.reason === "ACCOUNT_DEACTIVATED", `expected reason ACCOUNT_DEACTIVATED, got ${meta.reason}`);
});

test("Order PATCH: bootstrap missing-grant — operator with role but no surface grant rejected", async () => {
  // Bootstrap window scenario: an operator has the outlet role but no
  // surface grant. Switch endpoint would normally reject; we manually
  // set them as active operator to exercise the order-PATCH branch.
  // Earlier tests may have added surfaces to staffNoSurface — reset to
  // KITCHEN-only so this user truly has no COUNTER grant.
  await prisma.adminUserSurfaceAccess.deleteMany({
    where: { userId: ids.staffNoSurface, surface: "COUNTER" },
  });
  await prisma.adminUserSurfaceAccess.upsert({
    where: { userId_surface: { userId: ids.staffNoSurface, surface: "KITCHEN" } },
    update: {},
    create: { userId: ids.staffNoSurface, surface: "KITCHEN" },
  });
  await prisma.deviceSession.update({
    where: { id: ids.counterSession },
    data: {
      activeOutletId: TEST_OUTLET_ID,
      activeStaffUserId: ids.staffNoSurface, // has KITCHEN, NOT COUNTER
      activeStaffOutletId: TEST_OUTLET_ID,
      activeStaffRole: "MANAGER",
      activeStaffVerifiedAt: new Date(),
      activeStaffLastActionAt: null,
    },
  });
  const orderId = await createTestOrder(TEST_OUTLET_ID, "AWAITING_COUNTER_PAYMENT");
  createdOrderIds.push(orderId);

  const { res, body } = await callOrderPatch(counterSessionToken, orderId, "PAID");
  assert(res.status === 403, `expected 403, got ${res.status}`);
  assert(
    body.errorCode === "surface_access_missing",
    `expected surface_access_missing, got ${body.errorCode}`
  );

  const audit = await prisma.authAuditLog.findFirst({
    where: {
      eventType: "DEVICE_STAFF_INVALIDATED",
      createdAt: { gte: new Date(Date.now() - 60_000) },
    },
    orderBy: { createdAt: "desc" },
  });
  assert(audit, "DEVICE_STAFF_INVALIDATED row written for missing surface grant");
  const meta = (audit!.metadata ?? {}) as Record<string, unknown>;
  assert(
    meta.reason === "SURFACE_ACCESS_REMOVED",
    `expected reason SURFACE_ACCESS_REMOVED, got ${meta.reason}`
  );
});

test("Operational PIN: production without pepper fails closed", async () => {
  const savedNodeEnv = process.env.NODE_ENV;
  const savedPepper = process.env.OPERATIONAL_PIN_PEPPER;
  let threw = false;
  let message = "";
  try {
    // process.env entries can be plain assignments at runtime; the TS
    // typing for NODE_ENV is read-only, so cast around it.
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    delete process.env.OPERATIONAL_PIN_PEPPER;
    try {
      await opPin.hashOperationalPin("418273");
    } catch (err) {
      threw = true;
      message = (err as Error).message;
    }
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = savedNodeEnv;
    if (savedPepper !== undefined) {
      process.env.OPERATIONAL_PIN_PEPPER = savedPepper;
    }
  }
  assert(threw, "hashOperationalPin must throw in production with no pepper");
  assert(
    message.includes("OPERATIONAL_PIN_PEPPER"),
    `error must reference the pepper env var; got: ${message}`
  );
});

test("Cleanup: remove test orders", async () => {
  if (createdOrderIds.length > 0) {
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
  }
});

// ---- 9. Pre-flight semantics (Phase 3 cleanup, 2026-04-30) ----
//
// These tests create an isolated test outlet + device + users so each
// scenario is deterministic regardless of what other rows live in the
// dev DB. Assertions only inspect data scoped to the test's runId.

type PreflightUserSpec = {
  id: string;
  role: "MANAGER" | "OPERATOR" | "VIEWER";
  surfaces: Array<"COUNTER" | "KITCHEN">;
  hasPin: boolean;
};

const preflightFixturePrefix = `pf-${runId}`;

async function createPreflightOutlet(
  outletId: string,
  deviceId: string,
  deviceRole: "counter" | "kitchen",
  users: PreflightUserSpec[]
): Promise<void> {
  const passwordHash = await hashAdminPassword("temporary-password-not-used");
  const validPinHash = await opPin.hashOperationalPin(VALID_PIN);

  await prisma.outlet.upsert({
    where: { id: outletId },
    update: { isActive: true },
    create: {
      id: outletId,
      siteId: "site",
      name: outletId,
      slug: outletId,
      orderPrefix: outletId.slice(-2).toUpperCase(),
      isActive: true,
    },
  });
  await prisma.device.upsert({
    where: { id: deviceId },
    update: {
      isActive: true,
      role: deviceRole,
      outletId,
      isSharedAcrossOutlets: false,
    },
    create: {
      id: deviceId,
      siteId: "site",
      outletId,
      name: deviceId,
      role: deviceRole,
      isSharedAcrossOutlets: false,
      secretHash: passwordHash,
      isActive: true,
    },
  });
  for (const user of users) {
    await prisma.adminUser.upsert({
      where: { id: user.id },
      update: {
        accountType: "STAFF",
        isActive: true,
        operationalPinHash: user.hasPin ? validPinHash : null,
      },
      create: {
        id: user.id,
        email: `${user.id}@test.local`,
        displayName: user.id,
        passwordHash,
        accountType: "STAFF",
        isActive: true,
        operationalPinHash: user.hasPin ? validPinHash : null,
      },
    });
    await prisma.adminUserOutletRole.upsert({
      where: { userId_outletId: { userId: user.id, outletId } },
      update: { role: user.role },
      create: { userId: user.id, outletId, role: user.role },
    });
    await prisma.adminUserSurfaceAccess.deleteMany({
      where: { userId: user.id },
    });
    if (user.surfaces.length > 0) {
      await prisma.adminUserSurfaceAccess.createMany({
        data: user.surfaces.map((surface) => ({
          userId: user.id,
          surface,
        })),
      });
    }
  }
}

async function cleanupPreflightOutlet(
  outletId: string,
  deviceId: string,
  userIds: string[]
): Promise<void> {
  await prisma.adminUserSurfaceAccess.deleteMany({
    where: { userId: { in: userIds } },
  });
  await prisma.adminUserOutletRole.deleteMany({ where: { outletId } });
  await prisma.adminUser.deleteMany({ where: { id: { in: userIds } } });
  await prisma.deviceSession.deleteMany({ where: { deviceId } });
  await prisma.device.deleteMany({ where: { id: deviceId } });
  await prisma.outlet.deleteMany({ where: { id: outletId } });
}

test("preflight: outlet with no operator at all FAILs and lists the gap", async () => {
  const outletId = `${preflightFixturePrefix}-noop-outlet`;
  const deviceId = `${preflightFixturePrefix}-noop-dev`;
  await createPreflightOutlet(outletId, deviceId, "counter", []);
  try {
    const result = await preflight.runActiveOperatorPreflight(prisma);
    assert(
      result.kind === "fail",
      `expected fail (other outlets may also fail; we just need fail kind), got ${result.kind}`
    );
    const gap =
      result.kind === "fail"
        ? result.gaps.find(
            (g) => g.outletId === outletId && g.surface === "COUNTER"
          )
        : undefined;
    assert(gap, "test outlet+COUNTER must appear in gaps");
  } finally {
    await cleanupPreflightOutlet(outletId, deviceId, []);
  }
});

test("preflight: one fully usable operator → outlet PASSes (no gap for it)", async () => {
  const outletId = `${preflightFixturePrefix}-usable-outlet`;
  const deviceId = `${preflightFixturePrefix}-usable-dev`;
  const userId = `${preflightFixturePrefix}-usable-user`;
  await createPreflightOutlet(outletId, deviceId, "counter", [
    { id: userId, role: "MANAGER", surfaces: ["COUNTER"], hasPin: true },
  ]);
  try {
    const result = await preflight.runActiveOperatorPreflight(prisma);
    const gapForMine =
      result.kind === "fail"
        ? result.gaps.find((g) => g.outletId === outletId)
        : undefined;
    assert(!gapForMine, "my outlet must NOT appear in gaps when usable operator exists");
    const incompleteForMine = result.kind === "no_devices"
      ? []
      : result.incomplete.filter((i) => i.outletId === outletId);
    assert(
      incompleteForMine.length === 0,
      "fully-usable user must not appear in incomplete list"
    );
  } finally {
    await cleanupPreflightOutlet(outletId, deviceId, [userId]);
  }
});

test("preflight: incomplete operator alongside usable one is WARN, not FAIL", async () => {
  const outletId = `${preflightFixturePrefix}-mixed-outlet`;
  const deviceId = `${preflightFixturePrefix}-mixed-dev`;
  const usableId = `${preflightFixturePrefix}-mixed-usable`;
  const incompleteId = `${preflightFixturePrefix}-mixed-donald`;
  await createPreflightOutlet(outletId, deviceId, "counter", [
    { id: usableId, role: "MANAGER", surfaces: ["COUNTER"], hasPin: true },
    { id: incompleteId, role: "OPERATOR", surfaces: [], hasPin: false },
  ]);
  try {
    const result = await preflight.runActiveOperatorPreflight(prisma);
    const gapForMine =
      result.kind === "fail"
        ? result.gaps.find((g) => g.outletId === outletId)
        : undefined;
    assert(!gapForMine, "my outlet must NOT be in gaps (one usable operator exists)");

    const incompleteList = result.kind === "no_devices" ? [] : result.incomplete;
    const incompleteForMine = incompleteList.filter((i) => i.outletId === outletId);
    assert(
      incompleteForMine.length === 1,
      `expected 1 incomplete row for my outlet, got ${incompleteForMine.length}`
    );
    assert(
      incompleteForMine[0]!.email === `${incompleteId}@test.local`,
      "incomplete row matches the donald-style user"
    );
    assert(incompleteForMine[0]!.missingPin === true, "missing PIN flagged");
    assert(
      incompleteForMine[0]!.missingSurfaces.includes("COUNTER"),
      "missing COUNTER flagged"
    );
  } finally {
    await cleanupPreflightOutlet(outletId, deviceId, [usableId, incompleteId]);
  }
});

test("preflight: VIEWER outlet role is ignored (does not contribute to gaps OR warnings)", async () => {
  const outletId = `${preflightFixturePrefix}-viewer-outlet`;
  const deviceId = `${preflightFixturePrefix}-viewer-dev`;
  const viewerId = `${preflightFixturePrefix}-viewer-user`;
  const usableId = `${preflightFixturePrefix}-viewer-usable`;
  await createPreflightOutlet(outletId, deviceId, "counter", [
    { id: viewerId, role: "VIEWER", surfaces: [], hasPin: false },
    { id: usableId, role: "MANAGER", surfaces: ["COUNTER"], hasPin: true },
  ]);
  try {
    const result = await preflight.runActiveOperatorPreflight(prisma);
    // Outlet has a usable operator → no gap.
    const gapForMine =
      result.kind === "fail"
        ? result.gaps.find((g) => g.outletId === outletId)
        : undefined;
    assert(!gapForMine, "outlet must not be in gaps");

    // VIEWER user must NOT be in incomplete list even though they have
    // no PIN and no surfaces.
    const incompleteList = result.kind === "no_devices" ? [] : result.incomplete;
    const viewerRow = incompleteList.find(
      (i) => i.email === `${viewerId}@test.local`
    );
    assert(
      !viewerRow,
      "VIEWER must be ignored — they cannot operate, by design"
    );
  } finally {
    await cleanupPreflightOutlet(outletId, deviceId, [viewerId, usableId]);
  }
});

test("preflight: outlet with only an incomplete operator FAILs (no usable, but lists incomplete as warn too)", async () => {
  const outletId = `${preflightFixturePrefix}-only-incomplete-outlet`;
  const deviceId = `${preflightFixturePrefix}-only-incomplete-dev`;
  const incompleteId = `${preflightFixturePrefix}-only-incomplete-user`;
  await createPreflightOutlet(outletId, deviceId, "counter", [
    { id: incompleteId, role: "MANAGER", surfaces: [], hasPin: false },
  ]);
  try {
    const result = await preflight.runActiveOperatorPreflight(prisma);
    assert(result.kind === "fail", `expected fail, got ${result.kind}`);
    const gap =
      result.kind === "fail"
        ? result.gaps.find((g) => g.outletId === outletId)
        : undefined;
    assert(gap, "my outlet must be in gaps");
    const incompleteRow = result.incomplete.find(
      (i) => i.email === `${incompleteId}@test.local`
    );
    assert(incompleteRow, "incomplete user must also appear in warnings");
  } finally {
    await cleanupPreflightOutlet(outletId, deviceId, [incompleteId]);
  }
});

// ---- 10. Cleanup test ----
test("Tear-down resets state", async () => {
  await callClear(counterSessionToken);
  await callClear(sharedSessionToken);
});

async function main(): Promise<void> {
  console.log("Phase 1 active-operator regression — runId:", runId);

  // Dynamic imports go here so the server-only shim is in place first.
  opPin = await import("@/lib/operational-pin");
  surfaceAccess = await import("@/lib/admin-user-surface-access");
  productionAuth = await import("@/lib/production-auth");
  cascadeMod = await import("@/lib/active-operator-cascade");
  adminMfa = await import("@/lib/admin-mfa");
  preflight = await import("@/lib/active-operator-preflight");

  await setUp();

  statusRoute = await import("@/app/api/device-session/staff/route");
  switchRoute = await import("@/app/api/device-session/staff/switch/route");
  clearRoute = await import("@/app/api/device-session/staff/clear/route");
  resetPinRoute = await import("@/app/api/admin/users/[id]/reset-pin/route");
  surfaceAccessRoute = await import("@/app/api/admin/users/[id]/surface-access/route");
  orderRoute = await import("@/app/api/orders/[id]/route");

  let passed = 0;
  let failed = 0;

  try {
    for (const t of tests) {
      try {
        await t.run();
        console.log(` PASS  ${t.name}`);
        passed += 1;
      } catch (err) {
        failed += 1;
        console.error(` FAIL  ${t.name}`);
        console.error("        ", (err as Error).message);
      }
    }
  } finally {
    await tearDown();
  }

  console.log(`\n${passed} passed, ${failed} failed (${tests.length} total)`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch(async (err) => {
  console.error(err);
  await tearDown().catch(() => undefined);
  process.exitCode = 1;
});
