/* eslint-disable no-console */
import "dotenv/config";

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { DEVICE_SESSION_COOKIE, type DeviceRole } from "@/lib/device-auth";
import { prisma } from "@/lib/db";
import { DashboardRecentOrderDetails } from "@/components/admin/RecentOrdersList";
import type { OrderDetailRow } from "@/components/admin/OrderDetailPanel";
import {
  bumpOutletOrderVersion,
  getOutletOrderVersion,
} from "@/lib/outlet-order-sync";
import { DEFAULT_SITE_ID } from "@/lib/outlets";
import { updateOrderStatus } from "@/lib/order-updates";

process.env.ALLOW_LEGACY_DEVICE_AUTH = "1";
process.env.NEXT_PUBLIC_PAYMENT_MODE = "TERMINAL";

const require = createRequire(import.meta.url);
const serverOnlyPath = require.resolve("server-only");
require.cache[serverOnlyPath] = {
  id: serverOnlyPath,
  filename: serverOnlyPath,
  loaded: true,
  exports: {},
  children: [],
  paths: [],
} as unknown as NodeJS.Module;

const runId = `dashboard-slice3-${Date.now()}`;
const outletId = "cafeteria";
const ownerUserId = `${runId}-owner`;
const categorySlug = `cat-${runId}`;
let categoryId: string | null = null;
let itemId: string | null = null;
const paymentSessionIds: string[] = [];
const orderIds: string[] = [];

type ProductionAuth = typeof import("@/lib/production-auth");

function deviceCookie(role: DeviceRole) {
  return `${DEVICE_SESSION_COOKIE}=legacy:${role}:local-${role}-key`;
}

function adminCookie(token: string, activeOutletId = outletId) {
  return `rb_admin_session=${token}; rb_admin_active_outlet=${activeOutletId}`;
}

function basicAuthHeader(password = "change-me-in-prod") {
  return `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`;
}

function request(
  role: DeviceRole,
  method: string,
  url: string,
  body?: Record<string, unknown>
) {
  return new NextRequest(url, {
    method,
    headers: {
      cookie: deviceCookie(role),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function adminRequest(
  path: string,
  token?: string,
  options: { method?: string; basicAuth?: boolean } = {}
) {
  return new NextRequest(`http://localhost${path}`, {
    method: options.method ?? "GET",
    headers: {
      origin: "http://localhost",
      referer: "http://localhost/",
      ...(token ? { cookie: adminCookie(token) } : {}),
      ...(options.basicAuth ? { authorization: basicAuthHeader() } : {}),
    },
  });
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function readFirstSseEvent(response: Response) {
  assert.equal(response.status, 200, "SSE route should accept an admin session.");
  assert.equal(response.headers.get("Content-Type"), "text/event-stream");
  assert.equal(response.headers.get("Cache-Control"), "no-cache, no-transform");
  assert.equal(response.headers.get("X-Accel-Buffering"), "no");

  const reader = response.body?.getReader();
  assert(reader, "SSE response should include a readable body.");
  const decoder = new TextDecoder();
  let raw = "";

  try {
    while (!raw.includes("\n\n")) {
      const result = await Promise.race([
        reader.read(),
        new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
          setTimeout(() => reject(new Error("Timed out waiting for SSE event.")), 2_000);
        }),
      ]);
      if (result.done) break;
      raw += decoder.decode(result.value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  const [eventBlock] = raw.split("\n\n");
  const eventLine = eventBlock.split("\n").find((line) => line.startsWith("event: "));
  const dataLine = eventBlock.split("\n").find((line) => line.startsWith("data: "));
  assert.equal(
    eventLine,
    "event: dashboard_order_revision",
    "First SSE event should be dashboard_order_revision."
  );
  assert(dataLine, "First SSE event should include JSON data.");
  return JSON.parse(dataLine.slice("data: ".length)) as {
    outletId: string;
    revision: number;
    updatedAt: string;
  };
}

async function createAdminSession(productionAuth: ProductionAuth) {
  const token = productionAuth.createSessionToken();
  await prisma.adminUser.create({
    data: {
      id: ownerUserId,
      email: `${runId}@example.test`,
      displayName: "Dashboard Slice 3 Owner",
      passwordHash: "unused",
      accountType: "OWNER",
      siteRole: "OWNER",
      mfaEnabledAt: new Date(),
      isActive: true,
      sessions: {
        create: {
          tokenHash: productionAuth.hashSessionToken(token),
          expiresAt: productionAuth.computeAdminSessionExpiry(),
          userAgent: "dashboard-slice3-test",
          ipHash: `${runId}-ip`,
        },
      },
    },
  });
  return token;
}

function assertDashboardRecentOrderDetailsReadOnly() {
  const order: OrderDetailRow = {
    id: `${runId}-readonly-order`,
    orderNumber: "9999",
    orderType: "TAKEOUT",
    status: "COMPLETED",
    paymentMethod: "CARD",
    paymentProvider: "STRIPE",
    paymentStatus: "CAPTURED",
    paymentTransactionId: `${runId}-payment`,
    paymentReference: `${runId}-ref`,
    paymentFailureMessage: null,
    productionStartedAt: new Date().toISOString(),
    hasQuantityStockRequirements: true,
    stockReturnedAutomatically: false,
    manualStockReturnCompleted: false,
    total: 12.6,
    subtotal: 12,
    gst: 0.6,
    createdAt: new Date().toISOString(),
    items: [
      {
        id: `${runId}-readonly-item`,
        nameSnapshot: "READY Burger",
        qty: 1,
        sizeName: "Regular",
        isMeal: false,
        addonsJson: [{ name: "Extra cheese" }],
        upgradeSnapshotJson: null,
        lineTotal: 12,
      },
    ],
  };

  const html = renderToStaticMarkup(
    createElement(DashboardRecentOrderDetails, { order })
  );

  assert.equal(
    html.includes("<button"),
    false,
    "Dashboard recent-order details must not render button-role mutation controls."
  );
  assert.equal(
    html.includes('role="button"'),
    false,
    "Dashboard recent-order details must not render role=button mutation controls."
  );
  assert.equal(
    html.includes(">Actions<"),
    false,
    "Dashboard recent-order details must not render the OrderDetailPanel actions group."
  );
  assert.match(
    html,
    /Open in Orders/,
    "Dashboard recent-order details should link to the dedicated orders workflow."
  );
}

async function seed() {
  await prisma.site.upsert({
    where: { id: DEFAULT_SITE_ID },
    update: { timezone: "America/Edmonton" },
    create: {
      id: DEFAULT_SITE_ID,
      name: "Rushbite",
      timezone: "America/Edmonton",
    },
  });
  await prisma.outlet.upsert({
    where: { id: outletId },
    update: { siteId: DEFAULT_SITE_ID, isActive: true },
    create: {
      id: outletId,
      siteId: DEFAULT_SITE_ID,
      name: "Cafeteria",
      slug: "cafeteria",
      orderPrefix: "C",
      isActive: true,
    },
  });
  const category = await prisma.category.create({
    data: {
      outletId,
      slug: categorySlug,
      name: "Dashboard Slice 3",
      icon: "D",
      isActive: true,
      sortOrder: 9998,
    },
  });
  categoryId = category.id;
  const item = await prisma.menuItem.create({
    data: {
      categoryId: category.id,
      outletId,
      name: `Dashboard Slice 3 Burger ${runId}`,
      description: "Order version fixture",
      price: new Prisma.Decimal("10.00"),
      emoji: "D",
      bgColor: "#FFE3B3",
      isActive: true,
      isOutOfStock: false,
      stockMode: "MANUAL",
      sortOrder: 1,
    },
  });
  itemId = item.id;
}

async function createCashPaymentSession() {
  assert(itemId, "itemId missing");
  const paymentSessionsRoute = await import("@/app/api/payments/sessions/route");
  const response = await paymentSessionsRoute.POST(
    request("kiosk", "POST", "http://localhost/api/payments/sessions", {
      orderType: "TAKEOUT",
      paymentMethod: "CASH",
      expectedTotal: 10.5,
      items: [{ menuItemId: itemId, qty: 1 }],
    })
  );
  const body = await json<{ id?: string; error?: string; errorCode?: string }>(
    response
  );
  assert.equal(
    response.status,
    201,
    `Expected payment session 201, got ${response.status}: ${body.error ?? ""}`
  );
  assert.ok(body.id, "Payment session id missing.");
  paymentSessionIds.push(body.id);
  return body.id;
}

async function finalizeOrder(paymentSessionId: string) {
  const ordersRoute = await import("@/app/api/orders/route");
  const response = await ordersRoute.POST(
    request("kiosk", "POST", "http://localhost/api/orders", {
      paymentSessionId,
    })
  );
  const body = await json<{ id?: string; error?: string }>(response);
  assert.equal(
    response.status,
    201,
    `Expected order create 201, got ${response.status}: ${body.error ?? ""}`
  );
  assert.ok(body.id, "Order id missing.");
  orderIds.push(body.id);
  return body.id;
}

async function expectVersionRevision(expectedRevision: number, message: string) {
  const version = await getOutletOrderVersion(prisma, outletId);
  assert.equal(version.revision, expectedRevision, message);
  return version;
}

async function main() {
  assertDashboardRecentOrderDetailsReadOnly();

  const productionAuth = await import("@/lib/production-auth");
  await seed();
  await prisma.outletOrderVersion.deleteMany({ where: { outletId } });

  const missing = await getOutletOrderVersion(prisma, outletId);
  assert.equal(missing.revision, 1, "Missing order version should read as revision 1.");

  const firstBump = await prisma.$transaction((tx) =>
    bumpOutletOrderVersion(tx, outletId)
  );
  assert.equal(firstBump.revision, 2, "First bump should create revision 2.");

  await assert.rejects(
    prisma.$transaction(async (tx) => {
      await bumpOutletOrderVersion(tx, outletId);
      throw new Error("rollback");
    }),
    /rollback/
  );
  await expectVersionRevision(2, "Rolled back bump must not persist.");

  const token = await createAdminSession(productionAuth);
  const [versionRoute, eventsRoute, refundRoute] = await Promise.all([
    import("@/app/api/admin/dashboard/version/route"),
    import("@/app/api/admin/dashboard/events/route"),
    import("@/app/api/admin/orders/[id]/refund/route"),
  ]);

  const legacyResponse = await versionRoute.GET(
    adminRequest("/api/admin/dashboard/version", undefined, { basicAuth: true })
  );
  assert.equal(legacyResponse.status, 401, "Version route must reject Basic Auth.");
  const legacyBody = await json<{ errorCode?: string }>(legacyResponse);
  assert.equal(legacyBody.errorCode, "admin_session_required");

  const versionResponse = await versionRoute.GET(
    adminRequest("/api/admin/dashboard/version", token)
  );
  assert.equal(versionResponse.status, 200);
  assert.equal(versionResponse.headers.get("cache-control"), "no-store");
  const versionBody = await json<{ outletId: string; revision: number }>(
    versionResponse
  );
  assert.equal(versionBody.outletId, outletId);
  assert.equal(versionBody.revision, 2);

  const sseInitial = await readFirstSseEvent(
    await eventsRoute.GET(adminRequest("/api/admin/dashboard/events", token))
  );
  assert.equal(sseInitial.outletId, outletId);
  assert.equal(sseInitial.revision, 2);

  const beforeCreate = await getOutletOrderVersion(prisma, outletId);
  const paymentSessionId = await createCashPaymentSession();
  const orderId = await finalizeOrder(paymentSessionId);
  const afterCreate = await expectVersionRevision(
    beforeCreate.revision + 1,
    "Order creation should bump order version."
  );

  const paidOrder = await updateOrderStatus(orderId, "PAID", { outletIds: [outletId] });
  assert.ok(paidOrder, "Status update should find the order.");
  const afterStatus = await expectVersionRevision(
    afterCreate.revision + 1,
    "Order status update should bump order version."
  );

  const refundResponse = await refundRoute.POST(
    adminRequest(`/api/admin/orders/${orderId}/refund`, token, { method: "POST" }),
    { params: Promise.resolve({ id: orderId }) }
  );
  const refundBody = await json<{ ok?: boolean; error?: string }>(refundResponse);
  assert.equal(
    refundResponse.status,
    200,
    `Expected refund 200, got ${refundResponse.status}: ${refundBody.error ?? ""}`
  );
  assert.equal(refundBody.ok, true);
  await expectVersionRevision(
    afterStatus.revision + 1,
    "Refund should bump order version."
  );
}

async function cleanup() {
  await prisma.stockMovement.deleteMany({
    where: { OR: [{ orderId: { in: orderIds } }, { menuItemId: itemId ?? "" }] },
  });
  if (paymentSessionIds.length) {
    await prisma.paymentTransaction.deleteMany({
      where: { id: { in: paymentSessionIds } },
    });
  }
  if (orderIds.length) {
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  }
  if (itemId) await prisma.menuItem.deleteMany({ where: { id: itemId } });
  if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.adminSession.deleteMany({ where: { userId: ownerUserId } });
  await prisma.adminUser.deleteMany({ where: { id: ownerUserId } });
}

main()
  .then(async () => {
    await cleanup();
    console.log("Admin dashboard slice 3 tests passed.");
  })
  .catch(async (error) => {
    await cleanup().catch(() => {});
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
