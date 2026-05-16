/* eslint-disable no-console */
import { createRequire } from "node:module";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import "dotenv/config";
import { prisma } from "@/lib/db";

const require = createRequire(import.meta.url);
const shortRunId = Date.now().toString(36);
const runId = `dashboard-${shortRunId}`;
const outletAId = `${runId}-a`;
const outletBId = `${runId}-b`;
const ownerEmail = `${runId}-owner@example.test`;
const managerEmail = `${runId}-manager@example.test`;
const operatorEmail = `${runId}-operator@example.test`;
const multiOutletEmail = `${runId}-multi@example.test`;
const deviceOnlineId = `${runId}-device-online`;
const deviceSharedId = `${runId}-device-shared`;

type DashboardRoute = typeof import("@/app/api/admin/dashboard/summary/route");
type ProductionAuth = typeof import("@/lib/production-auth");
type JsonObject = Record<string, unknown>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(
      `${message}. Expected ${String(expected)}, got ${String(actual)}.`,
    );
  }
}

function assertNumberClose(actual: unknown, expected: number, message: string) {
  assert(
    typeof actual === "number",
    `${message}. Expected number, got ${typeof actual}.`,
  );
  if (Math.abs(actual - expected) > 0.0001) {
    throw new Error(`${message}. Expected ${expected}, got ${actual}.`);
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

async function loadModules(): Promise<{
  dashboardRoute: DashboardRoute;
  productionAuth: ProductionAuth;
}> {
  stubServerOnly();
  const [dashboardRoute, productionAuth] = await Promise.all([
    import("@/app/api/admin/dashboard/summary/route"),
    import("@/lib/production-auth"),
  ]);
  return { dashboardRoute, productionAuth };
}

function cookieHeader(cookies: Record<string, string | null | undefined>) {
  return Object.entries(cookies)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join("; ");
}

function basicAuthHeader(password = "change-me-in-prod") {
  return `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`;
}

function dashboardRequest({
  sessionToken,
  activeOutletId,
  query = "",
  legacyBasicAuth = false,
}: {
  sessionToken?: string | null;
  activeOutletId?: string | null;
  query?: string;
  legacyBasicAuth?: boolean;
} = {}) {
  const cookie = cookieHeader({
    rb_admin_session: sessionToken,
    rb_admin_active_outlet: activeOutletId,
  });
  return new NextRequest(
    `http://localhost/api/admin/dashboard/summary${query}`,
    {
      method: "GET",
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(legacyBasicAuth ? { authorization: basicAuthHeader() } : {}),
      },
    },
  );
}

async function readJson(response: NextResponse): Promise<JsonObject> {
  const text = await response.text();
  try {
    return JSON.parse(text) as JsonObject;
  } catch {
    return { raw: text };
  }
}

async function expectError(
  response: NextResponse,
  status: number,
  errorCode: string,
  message: string,
) {
  const json = await readJson(response);
  assertEqual(response.status, status, message);
  assertEqual(String(json.errorCode ?? json.error), errorCode, message);
}

async function createSession(
  productionAuth: ProductionAuth,
  userId: string,
): Promise<string> {
  const token = productionAuth.createSessionToken();
  await prisma.adminSession.create({
    data: {
      userId,
      tokenHash: productionAuth.hashSessionToken(token),
      expiresAt: productionAuth.computeAdminSessionExpiry(),
      userAgent: "dashboard-slice1-test",
      ipHash: `${runId}-ip`,
    },
  });
  return token;
}

async function ensureBaseSite() {
  await prisma.site.upsert({
    where: { id: "site" },
    update: { timezone: "America/Edmonton" },
    create: {
      id: "site",
      name: "Rushbite",
      timezone: "America/Edmonton",
    },
  });
}

async function seedFixture() {
  await ensureBaseSite();

  const [outletA, outletB] = await Promise.all([
    prisma.outlet.create({
      data: {
        id: outletAId,
        siteId: "site",
        name: `Dashboard Outlet A ${shortRunId}`,
        slug: outletAId,
        orderPrefix: `DA${shortRunId.slice(-5).toUpperCase()}`,
        isActive: true,
      },
    }),
    prisma.outlet.create({
      data: {
        id: outletBId,
        siteId: "site",
        name: `Dashboard Outlet B ${shortRunId}`,
        slug: outletBId,
        orderPrefix: `DB${shortRunId.slice(-5).toUpperCase()}`,
        isActive: true,
      },
    }),
  ]);

  const [categoryA, categoryB] = await Promise.all([
    prisma.category.create({
      data: {
        outletId: outletAId,
        slug: `${runId}-a`,
        name: `Dashboard A ${shortRunId}`,
        icon: "A",
        sortOrder: 9990,
        isActive: true,
      },
    }),
    prisma.category.create({
      data: {
        outletId: outletB.id,
        slug: `${runId}-b`,
        name: `Dashboard B ${shortRunId}`,
        icon: "B",
        sortOrder: 9991,
        isActive: true,
      },
    }),
  ]);

  const [itemA, itemHighSales, itemB] = await Promise.all([
    prisma.menuItem.create({
      data: {
        outletId: outletAId,
        categoryId: categoryA.id,
        name: `${runId} Item A`,
        description: "Dashboard fixture",
        price: new Prisma.Decimal("5.00"),
        emoji: "A",
        bgColor: "#FFE3B3",
        isActive: true,
        sortOrder: 9990,
      },
    }),
    prisma.menuItem.create({
      data: {
        outletId: outletAId,
        categoryId: categoryA.id,
        name: `${runId} Premium`,
        description: "Dashboard premium fixture",
        price: new Prisma.Decimal("40.00"),
        emoji: "P",
        bgColor: "#FFE3B3",
        isActive: true,
        sortOrder: 9992,
      },
    }),
    prisma.menuItem.create({
      data: {
        outletId: outletB.id,
        categoryId: categoryB.id,
        name: `${runId} Item B`,
        description: "Dashboard B fixture",
        price: new Prisma.Decimal("9.00"),
        emoji: "B",
        bgColor: "#FFE3B3",
        isActive: true,
        sortOrder: 9991,
      },
    }),
  ]);

  const now = new Date();
  const minutesAgo = (minutes: number) =>
    new Date(now.getTime() - minutes * 60 * 1000);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const createOrder = async ({
    suffix,
    outletId = outletAId,
    itemId = itemA.id,
    status,
    total,
    qty,
    createdAt = now,
    updatedAt = createdAt,
  }: {
    suffix: string;
    outletId?: string;
    itemId?: string;
    status: string;
    total: string;
    qty: number;
    createdAt?: Date;
    updatedAt?: Date;
  }) =>
    prisma.order.create({
      data: {
        orderNumber: `${runId}-${suffix}`,
        outletId,
        kioskId: runId,
        orderType: "TO_GO",
        status,
        subtotal: new Prisma.Decimal(total),
        gst: new Prisma.Decimal("0.00"),
        total: new Prisma.Decimal(total),
        paymentMethod: status === "AWAITING_COUNTER_PAYMENT" ? "CASH" : "CARD",
        paymentProvider:
          status === "AWAITING_COUNTER_PAYMENT" ? "COUNTER" : "TEST",
        paymentStatus:
          status === "AWAITING_COUNTER_PAYMENT" ? "PENDING" : "PAID",
        createdAt,
        updatedAt,
        items: {
          create: {
            menuItemId: itemId,
            nameSnapshot:
              itemId === itemA.id
                ? "Dashboard Burger"
                : itemId === itemHighSales.id
                  ? "Dashboard Premium"
                  : "Other Outlet",
            qty,
            addonsJson: [
              {
                name: "Priced add-on",
                priceDelta: 1.25,
              },
            ],
            isMeal: false,
            upgradeSnapshotJson: {
              title: "Priced upgrade",
              extraCharge: 2.5,
              savingsLabel: "Save $1.00",
              includedItems: [{ name: "Linked item", price: 4.99 }],
            },
            lineTotal: new Prisma.Decimal(total),
          },
        },
      },
    });

  await Promise.all([
    createOrder({
      suffix: "paid",
      status: "PAID",
      total: "10.00",
      qty: 2,
      updatedAt: minutesAgo(6),
    }),
    createOrder({
      suffix: "kitchen",
      status: "IN_KITCHEN",
      total: "20.00",
      qty: 3,
      updatedAt: minutesAgo(12),
    }),
    createOrder({
      suffix: "cash",
      status: "AWAITING_COUNTER_PAYMENT",
      total: "7.00",
      qty: 1,
      updatedAt: minutesAgo(9),
    }),
    createOrder({
      suffix: "premium",
      itemId: itemHighSales.id,
      status: "PAID",
      total: "40.00",
      qty: 1,
    }),
    createOrder({
      suffix: "ready",
      status: "READY",
      total: "8.00",
      qty: 1,
      createdAt: yesterday,
      updatedAt: minutesAgo(4),
    }),
    createOrder({
      suffix: "completed",
      status: "COMPLETED",
      total: "15.00",
      qty: 1,
      createdAt: yesterday,
      updatedAt: minutesAgo(2),
    }),
    createOrder({
      suffix: "cancelled",
      status: "CANCELLED",
      total: "999.00",
      qty: 99,
    }),
    createOrder({
      suffix: "refunded",
      status: "REFUNDED",
      total: "888.00",
      qty: 88,
    }),
    createOrder({
      suffix: "outlet-b",
      outletId: outletB.id,
      itemId: itemB.id,
      status: "PAID",
      total: "123.00",
      qty: 12,
    }),
  ]);

  const deviceData = [
    {
      id: deviceOnlineId,
      name: `${runId} online`,
      outletId: outletAId,
      lastSeenAt: minutesAgo(1),
      isActive: true,
    },
    {
      name: `${runId} idle`,
      outletId: outletAId,
      lastSeenAt: minutesAgo(5),
      isActive: true,
    },
    {
      name: `${runId} offline`,
      outletId: outletAId,
      lastSeenAt: minutesAgo(15),
      isActive: true,
    },
    {
      name: `${runId} disabled`,
      outletId: outletAId,
      lastSeenAt: null,
      isActive: false,
    },
    {
      id: deviceSharedId,
      name: `${runId} shared`,
      outletId: outletB.id,
      lastSeenAt: minutesAgo(1),
      isActive: true,
      outletAccess: { create: { outletId: outletAId } },
    },
    {
      name: `${runId} other outlet only`,
      outletId: outletB.id,
      lastSeenAt: minutesAgo(1),
      isActive: true,
    },
  ];
  await Promise.all(
    deviceData.map((device) =>
      prisma.device.create({
        data: {
          siteId: "site",
          id: device.id,
          name: device.name,
          outletId: device.outletId,
          role: "KIOSK",
          isSharedAcrossOutlets: Boolean(device.outletAccess),
          secretHash: `${runId}-secret`,
          isActive: device.isActive,
          lastSeenAt: device.lastSeenAt,
          ...(device.outletAccess ? { outletAccess: device.outletAccess } : {}),
        },
      }),
    ),
  );

  const [owner, manager, operator, multiOutlet] = await Promise.all([
    prisma.adminUser.create({
      data: {
        email: ownerEmail,
        displayName: "Dashboard Owner",
        passwordHash: `${runId}-hash`,
        accountType: "OWNER",
        siteRole: "OWNER",
        mfaEnabledAt: new Date(),
      },
    }),
    prisma.adminUser.create({
      data: {
        email: managerEmail,
        displayName: "Dashboard Manager",
        passwordHash: `${runId}-hash`,
        accountType: "STAFF",
        siteRole: null,
        outletRoles: {
          create: { outletId: outletAId, role: "MANAGER" },
        },
      },
    }),
    prisma.adminUser.create({
      data: {
        email: operatorEmail,
        displayName: "Dashboard Operator",
        passwordHash: `${runId}-hash`,
        accountType: "STAFF",
        siteRole: null,
        outletRoles: {
          create: { outletId: outletAId, role: "OPERATOR" },
        },
      },
    }),
    prisma.adminUser.create({
      data: {
        email: multiOutletEmail,
        displayName: "Dashboard Multi",
        passwordHash: `${runId}-hash`,
        accountType: "STAFF",
        siteRole: null,
        outletRoles: {
          create: [
            { outletId: outletAId, role: "VIEWER" },
            { outletId: outletB.id, role: "VIEWER" },
          ],
        },
      },
    }),
  ]);

  await Promise.all([
    prisma.deviceSession.create({
      data: {
        deviceId: deviceOnlineId,
        tokenHash: `${runId}-device-session-online`,
        expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
        lastSeenAt: minutesAgo(1),
        activeOutletId: outletAId,
        activeStaffUserId: manager.id,
        activeStaffOutletId: outletAId,
        activeStaffRole: "MANAGER",
        activeStaffVerifiedAt: minutesAgo(9),
        activeStaffLastActionAt: minutesAgo(2),
      },
    }),
    prisma.deviceSession.create({
      data: {
        deviceId: deviceSharedId,
        tokenHash: `${runId}-device-session-shared-b`,
        expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
        lastSeenAt: minutesAgo(1),
        activeOutletId: outletB.id,
        activeStaffUserId: multiOutlet.id,
        activeStaffOutletId: outletB.id,
        activeStaffRole: "VIEWER",
        activeStaffVerifiedAt: minutesAgo(7),
        activeStaffLastActionAt: minutesAgo(1),
      },
    }),
  ]);

  return { owner, manager, operator, multiOutlet, outletA, outletB };
}

async function cleanup() {
  await prisma.adminSession.deleteMany({
    where: {
      user: {
        email: {
          in: [ownerEmail, managerEmail, operatorEmail, multiOutletEmail],
        },
      },
    },
  });
  await prisma.adminUser.deleteMany({
    where: {
      email: {
        in: [ownerEmail, managerEmail, operatorEmail, multiOutletEmail],
      },
    },
  });
  await prisma.device.deleteMany({ where: { name: { startsWith: runId } } });
  await prisma.order.deleteMany({
    where: { orderNumber: { startsWith: runId } },
  });
  await prisma.menuItem.deleteMany({ where: { name: { startsWith: runId } } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: runId } } });
  await prisma.outlet.deleteMany({
    where: { id: { in: [outletAId, outletBId] } },
  });
}

async function main() {
  const { dashboardRoute, productionAuth } = await loadModules();
  await cleanup();
  const fixture = await seedFixture();

  try {
    const ownerToken = await createSession(productionAuth, fixture.owner.id);
    const managerToken = await createSession(
      productionAuth,
      fixture.manager.id,
    );
    const operatorToken = await createSession(
      productionAuth,
      fixture.operator.id,
    );
    const multiOutletToken = await createSession(
      productionAuth,
      fixture.multiOutlet.id,
    );

    const legacyResponse = await dashboardRoute.GET(
      dashboardRequest({ legacyBasicAuth: true }),
    );
    await expectError(
      legacyResponse,
      401,
      "admin_session_required",
      "Legacy Basic Auth must not access dashboard summary",
    );
    assertEqual(
      legacyResponse.headers.get("cache-control"),
      "no-store",
      "Error responses must not be cached",
    );

    const ownerResponse = await dashboardRoute.GET(
      dashboardRequest({ sessionToken: ownerToken, activeOutletId: outletAId }),
    );
    assertEqual(ownerResponse.status, 200, "Owner dashboard summary succeeds");
    assertEqual(
      ownerResponse.headers.get("cache-control"),
      "no-store",
      "Dashboard summary must not be cached",
    );
    const ownerJson = await readJson(ownerResponse);
    assertEqual(
      ownerJson.outletId,
      fixture.outletA.id,
      "Owner reads requested outlet",
    );
    const ownerPermissions = ownerJson.permissions as JsonObject;
    assertEqual(
      ownerPermissions.canReadRevenue,
      true,
      "Owner can read revenue",
    );
    assertEqual(
      ownerPermissions.canReadDevices,
      true,
      "Owner can read devices",
    );
    const ownerKpis = ownerJson.kpis as JsonObject;
    assertNumberClose(
      ownerKpis.netSales,
      70,
      "Net sales excludes cash due/cancelled/refunded",
    );
    assertEqual(
      ownerKpis.orderCount,
      4,
      "Order count includes accepted cash orders",
    );
    assertNumberClose(
      ownerKpis.averageTicket,
      70 / 3,
      "Average ticket uses paid sales orders",
    );
    assertNumberClose(
      ownerKpis.itemsPerOrder,
      2,
      "Items per order excludes cash/cancelled/refunded",
    );
    assertNumberClose(
      ownerKpis.cashDue,
      7,
      "Cash due is separate from net sales",
    );
    const operations = ownerJson.operations as JsonObject;
    assertEqual(
      operations.awaitingCounterPayment,
      1,
      "Operation strip counts awaiting payment",
    );
    assertEqual(
      operations.inKitchen,
      1,
      "Operation strip counts kitchen orders",
    );
    assertEqual(operations.paid, 2, "Operation strip counts paid orders");
    assertEqual(operations.ready, 1, "Operation strip counts ready orders");
    const ownerOperationsPreview = ownerJson.operationsPreview as JsonObject;
    const cashBucket =
      ownerOperationsPreview.awaitingCounterPayment as JsonObject;
    assertEqual(
      cashBucket.count,
      1,
      "Operations preview counts awaiting payment orders",
    );
    assertEqual(
      cashBucket.lateCount,
      1,
      "Operations preview counts late awaiting payment orders",
    );
    assert(
      Number(cashBucket.oldestAgeMinutes) >= 8,
      "Operations preview exposes oldest awaiting payment age",
    );
    const cashPreviewOrders = cashBucket.previewOrders as JsonObject[];
    assertEqual(
      cashPreviewOrders[0]?.orderNumber,
      `${runId}-cash`,
      "Operations preview includes the oldest awaiting payment order",
    );
    assertNumberClose(
      cashPreviewOrders[0]?.total,
      7,
      "Revenue actors receive operation preview totals",
    );
    const cashPreviewItems = cashPreviewOrders[0]?.items as JsonObject[];
    assertNumberClose(
      cashPreviewItems[0]?.lineTotal,
      7,
      "Revenue actors receive operation preview line totals",
    );
    const kitchenBucket = ownerOperationsPreview.inKitchen as JsonObject;
    assertEqual(
      kitchenBucket.lateCount,
      1,
      "Operations preview applies kitchen aging threshold",
    );
    const readyBucket = ownerOperationsPreview.ready as JsonObject;
    assertEqual(readyBucket.count, 1, "Operations preview counts ready orders");
    assertEqual(
      readyBucket.lateCount,
      1,
      "Operations preview applies ready aging threshold",
    );
    const completedTodayBucket =
      ownerOperationsPreview.completedToday as JsonObject;
    assertEqual(
      completedTodayBucket.count,
      1,
      "Operations preview counts orders completed today by updated status time",
    );
    assertEqual(
      completedTodayBucket.lateCount,
      0,
      "Completed-today bucket does not apply a late threshold",
    );
    assertEqual(
      completedTodayBucket.oldestAgeMinutes,
      null,
      "Completed-today bucket does not expose active-order aging",
    );
    const deviceHealth = ownerJson.deviceHealth as JsonObject;
    assertEqual(
      deviceHealth.online,
      2,
      "Device health counts direct and shared online devices",
    );
    assertEqual(deviceHealth.idle, 1, "Device health counts idle devices");
    assertEqual(
      deviceHealth.offline,
      1,
      "Device health counts offline active devices",
    );
    assertEqual(
      deviceHealth.disabled,
      1,
      "Disabled devices are not counted offline",
    );
    const ownerDeviceFleet = ownerJson.deviceFleet as JsonObject;
    const ownerDeviceFleetCounts = ownerDeviceFleet.counts as JsonObject;
    assertEqual(
      ownerDeviceFleetCounts.online,
      2,
      "Device fleet uses the same direct/shared online count",
    );
    assertEqual(
      ownerDeviceFleet.manageHref,
      "/admin/devices",
      "Owner device fleet includes the permitted management href",
    );
    const ownerFleetDevices = ownerDeviceFleet.devices as JsonObject[];
    const ownerFleetDeviceNames = ownerFleetDevices.map((device) =>
      String(device.name),
    );
    assert(
      ownerFleetDeviceNames.includes(`${runId} online`),
      "Device fleet includes direct outlet devices",
    );
    assert(
      ownerFleetDeviceNames.includes(`${runId} shared`),
      "Device fleet includes devices shared with the active outlet",
    );
    assert(
      !ownerFleetDeviceNames.includes(`${runId} other outlet only`),
      "Device fleet excludes devices scoped only to other outlets",
    );
    const ownerOnlineDevice = ownerFleetDevices.find(
      (device) => device.name === `${runId} online`,
    ) as JsonObject | undefined;
    assertEqual(
      ownerOnlineDevice?.roleLabel,
      "Kiosk",
      "Device fleet normalizes device role labels",
    );
    assertEqual(
      ownerOnlineDevice?.screen,
      "Kiosk ordering",
      "Device fleet exposes real screen/surface metadata",
    );
    const ownerOnlineOperator =
      ownerOnlineDevice?.activeOperator as JsonObject | null | undefined;
    assertEqual(
      ownerOnlineOperator?.displayName,
      "Dashboard Manager",
      "Device fleet exposes active staff operator when scoped to the active outlet",
    );
    assertEqual(
      ownerOnlineOperator?.roleLabel,
      "Manager",
      "Device fleet exposes a readable active operator role",
    );
    const ownerSharedDevice = ownerFleetDevices.find(
      (device) => device.name === `${runId} shared`,
    ) as JsonObject | undefined;
    assertEqual(
      (ownerSharedDevice?.activeOperator as unknown) ?? null,
      null,
      "Shared device active operators from another outlet are not leaked",
    );
    assertEqual(
      ownerSharedDevice?.activeSessionCount,
      0,
      "Shared device active sessions from another outlet are not counted",
    );
    assertEqual(
      ownerSharedDevice?.session,
      "No active session",
      "Shared device session label does not reveal another outlet's active session",
    );
    assertEqual(
      ownerJson.deviceHealthHref,
      "/admin/devices",
      "Owners get the device-management click-through",
    );
    const topSellers = ownerJson.topSellers as JsonObject[];
    assertEqual(
      topSellers[0]?.name,
      "Dashboard Burger",
      "Top sellers use item snapshots",
    );
    assertEqual(
      topSellers[0]?.qty,
      5,
      "Top sellers aggregate paid item quantities",
    );
    assertNumberClose(
      topSellers[0]?.sales,
      30,
      "Top sellers aggregate paid line totals",
    );
    const topSellersBySales = ownerJson.topSellersBySales as JsonObject[];
    assertEqual(
      topSellersBySales[0]?.name,
      "Dashboard Premium",
      "Top by sales is ranked separately from quantity",
    );
    assertNumberClose(
      topSellersBySales[0]?.sales,
      40,
      "Top by sales aggregates paid line totals",
    );

    const staleCookieResponse = await dashboardRoute.GET(
      dashboardRequest({
        sessionToken: operatorToken,
        activeOutletId: fixture.outletB.id,
      }),
    );
    assertEqual(
      staleCookieResponse.status,
      200,
      "Single-outlet staff with stale cookie resolves to allowed outlet",
    );
    const staleCookieJson = await readJson(staleCookieResponse);
    assertEqual(
      staleCookieJson.outletId,
      fixture.outletA.id,
      "Dashboard uses resolved outlet, not stale cookie outlet",
    );

    const operatorJson = staleCookieJson;
    const operatorPermissions = operatorJson.permissions as JsonObject;
    assertEqual(
      operatorPermissions.canReadRevenue,
      false,
      "Operator cannot read revenue",
    );
    assertEqual(
      operatorPermissions.canReadDevices,
      false,
      "Operator cannot read device health",
    );
    const operatorKpis = operatorJson.kpis as JsonObject;
    assertEqual(
      operatorKpis.netSales,
      null,
      "Revenue fields are omitted for non-revenue roles",
    );
    assertEqual(
      (operatorJson.deviceHealth as unknown) ?? null,
      null,
      "Device health is omitted without device permission",
    );
    assertEqual(
      (operatorJson.deviceFleet as unknown) ?? null,
      null,
      "Device fleet is omitted without device permission",
    );
    const operatorOperationsPreview =
      operatorJson.operationsPreview as JsonObject;
    const operatorCashBucket =
      operatorOperationsPreview.awaitingCounterPayment as JsonObject;
    const operatorCashPreviewOrders =
      operatorCashBucket.previewOrders as JsonObject[];
    assertEqual(
      operatorCashPreviewOrders[0]?.total,
      null,
      "Non-revenue operation previews redact totals",
    );
    assertEqual(
      operatorCashPreviewOrders[0]?.subtotal,
      null,
      "Non-revenue operation previews redact subtotals",
    );
    const operatorCashPreviewItems =
      operatorCashPreviewOrders[0]?.items as JsonObject[];
    assertEqual(
      operatorCashPreviewItems[0]?.lineTotal,
      null,
      "Non-revenue operation previews redact line totals",
    );
    assertEqual(
      (operatorJson.deviceHealthHref as unknown) ?? null,
      null,
      "Device health click-through is omitted without device permission",
    );
    const operatorTopSellers = operatorJson.topSellers as JsonObject[];
    assertEqual(
      operatorTopSellers[0]?.sales,
      null,
      "Top-seller sales are redacted for non-revenue roles",
    );
    assertEqual(
      (operatorJson.topSellersBySales as unknown) ?? null,
      null,
      "Top-by-sales list is omitted for non-revenue roles",
    );
    const operatorRecentOrders = operatorJson.recentOrders as JsonObject[];
    assert(
      Array.isArray(operatorRecentOrders) && operatorRecentOrders.length > 0,
      "Non-revenue order readers still receive recent operational orders",
    );
    assertEqual(
      operatorRecentOrders[0]?.total,
      null,
      "Recent order totals are redacted for non-revenue roles",
    );
    assertEqual(
      operatorRecentOrders[0]?.subtotal,
      null,
      "Recent order subtotals are redacted for non-revenue roles",
    );
    assertEqual(
      operatorRecentOrders[0]?.gst,
      null,
      "Recent order tax is redacted for non-revenue roles",
    );
    const operatorRecentItems = operatorRecentOrders[0]?.items as
      | JsonObject[]
      | undefined;
    assertEqual(
      operatorRecentItems?.[0]?.lineTotal ?? null,
      null,
      "Recent order item line totals are redacted for non-revenue roles",
    );
    assertEqual(
      operatorRecentItems?.[0]?.addonsJson ?? null,
      null,
      "Recent order add-on snapshots are redacted for non-revenue roles",
    );
    assertEqual(
      operatorRecentItems?.[0]?.upgradeSnapshotJson ?? null,
      null,
      "Recent order upgrade snapshots are redacted for non-revenue roles",
    );
    const operatorPayload = JSON.stringify(operatorJson);
    assert(
      !operatorPayload.includes("priceDelta") &&
        !operatorPayload.includes("extraCharge") &&
        !operatorPayload.includes("savingsLabel"),
      "Non-revenue dashboard payload must not include nested snapshot pricing fields",
    );
    assert(
      !operatorPayload.includes("Other Outlet"),
      "Operations preview must not leak stale-cookie or other-outlet orders",
    );

    const multiOutletResponse = await dashboardRoute.GET(
      dashboardRequest({ sessionToken: multiOutletToken }),
    );
    await expectError(
      multiOutletResponse,
      409,
      "active_outlet_required",
      "Multi-outlet staff must choose an outlet",
    );

    const managerResponseBefore = await dashboardRoute.GET(
      dashboardRequest({
        sessionToken: managerToken,
        activeOutletId: outletAId,
      }),
    );
    const managerBeforeJson = await readJson(managerResponseBefore);
    const managerBeforePermissions =
      managerBeforeJson.permissions as JsonObject;
    assertEqual(
      managerBeforePermissions.canReadRevenue,
      true,
      "Manager can read revenue before role downgrade",
    );
    assertEqual(
      managerBeforePermissions.canReadDevices,
      true,
      "Manager can read device health before role downgrade",
    );
    assertEqual(
      managerBeforeJson.deviceHealthHref,
      null,
      "Managers see device health without a forbidden devices-page click-through",
    );
    const managerDeviceFleet = managerBeforeJson.deviceFleet as JsonObject;
    assertEqual(
      managerDeviceFleet.manageHref,
      null,
      "Managers see read-only device fleet data without a management href",
    );
    await prisma.adminUserOutletRole.update({
      where: {
        userId_outletId: {
          userId: fixture.manager.id,
          outletId: outletAId,
        },
      },
      data: { role: "OPERATOR" },
    });
    const managerResponseAfter = await dashboardRoute.GET(
      dashboardRequest({
        sessionToken: managerToken,
        activeOutletId: outletAId,
      }),
    );
    const managerAfterJson = await readJson(managerResponseAfter);
    assertEqual(
      (managerAfterJson.permissions as JsonObject).canReadRevenue,
      false,
      "Permission changes are evaluated on the next request",
    );
    assertEqual(
      (managerAfterJson.kpis as JsonObject).netSales,
      null,
      "Revenue values disappear after role downgrade",
    );

    const invalidFutureResponse = await dashboardRoute.GET(
      dashboardRequest({
        sessionToken: ownerToken,
        activeOutletId: outletAId,
        query: "?range=custom&from=2030-01-01&to=2030-01-02",
      }),
    );
    const invalidFutureJson = await readJson(invalidFutureResponse);
    assertEqual(
      invalidFutureResponse.status,
      400,
      "Future from date is rejected",
    );
    assertEqual(
      invalidFutureJson.error,
      "invalid_range",
      "Invalid range error is structured",
    );

    const clampedToResponse = await dashboardRoute.GET(
      dashboardRequest({
        sessionToken: ownerToken,
        activeOutletId: outletAId,
        query: "?range=custom&from=2026-01-01&to=2030-01-02",
      }),
    );
    const clampedToJson = await readJson(clampedToResponse);
    assertEqual(
      clampedToResponse.status,
      400,
      "Overlong clamped range is still rejected",
    );
    assertEqual(
      clampedToJson.error,
      "invalid_range",
      "Overlong range error is structured",
    );

    console.log("Admin dashboard Slice 1 route/helper checks passed.");
  } finally {
    await cleanup();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
