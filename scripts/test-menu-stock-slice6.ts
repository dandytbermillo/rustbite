/* eslint-disable no-console */
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { createRequire } from "node:module";
import { NextRequest } from "next/server";
import "dotenv/config";
import { hashAdminPassword } from "@/lib/admin-passwords";
import { prisma } from "@/lib/db";
import { DEVICE_SESSION_COOKIE, type DeviceRole } from "@/lib/device-auth";
import { DEFAULT_SITE_ID } from "@/lib/outlets";

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

const runId = `stock-slice6-${Date.now()}`;
const outletId = "cafeteria";
const categorySlug = `cat-${runId}`;
const ownerEmail = `${runId}-owner@example.test`;
let categoryId: string | null = null;
let adminUserId: string | null = null;
let adminToken: string | null = null;
const itemIds: string[] = [];
const orderIds: string[] = [];
const paymentSessionIds: string[] = [];
const stockMovementIds: string[] = [];

function deviceCookie(role: DeviceRole) {
  return `${DEVICE_SESSION_COOKIE}=legacy:${role}:local-${role}-key`;
}

function deviceRequest(
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
      referer: "http://localhost/admin/orders",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function seed() {
  await prisma.site.upsert({
    where: { id: DEFAULT_SITE_ID },
    update: {},
    create: {
      id: DEFAULT_SITE_ID,
      name: `Stock Slice 6 ${runId}`,
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
      name: "Stock Slice 6",
      icon: "S",
      isActive: true,
      sortOrder: 9999,
    },
  });
  categoryId = category.id;
}

async function createQuantityItem(name: string, stockQty: number, price = "10.00") {
  assert.ok(categoryId, "categoryId missing");
  const item = await prisma.menuItem.create({
    data: {
      categoryId,
      outletId,
      name: `${name} ${runId}`,
      description: "Temporary quantity item",
      price: new Prisma.Decimal(price),
      emoji: "S",
      bgColor: "#FFF3B0",
      isActive: true,
      isOutOfStock: false,
      stockMode: "QUANTITY",
      stockQty,
      sortOrder: itemIds.length + 1,
    },
  });
  itemIds.push(item.id);
  return item;
}

async function createAdminToken() {
  const productionAuth = await import("@/lib/production-auth");
  const adminMfa = await import("@/lib/admin-mfa");
  const owner = await prisma.adminUser.create({
    data: {
      email: ownerEmail,
      displayName: "Stock Slice 6 Owner",
      passwordHash: await hashAdminPassword("owner-password-14chars"),
      accountType: "OWNER",
      siteRole: "OWNER",
      isActive: true,
      mfaSecretCiphertext: adminMfa.encryptMfaSecret(adminMfa.generateTotpSecret()),
      mfaEnabledAt: new Date(),
    },
  });
  adminUserId = owner.id;
  const token = productionAuth.createSessionToken();
  await prisma.adminSession.create({
    data: {
      userId: owner.id,
      tokenHash: productionAuth.hashSessionToken(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      stepUpVerifiedAt: new Date(),
      stepUpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });
  return token;
}

async function getAdminToken() {
  adminToken ??= await createAdminToken();
  return adminToken;
}

async function createCashPaymentSession(
  menuItemId: string,
  qty: number,
  expectedTotal: number
) {
  const paymentSessionsRoute = await import("@/app/api/payments/sessions/route");
  const response = await paymentSessionsRoute.POST(
    deviceRequest("kiosk", "POST", "http://localhost/api/payments/sessions", {
      orderType: "TAKEOUT",
      paymentMethod: "CASH",
      expectedTotal,
      items: [{ menuItemId, qty }],
    })
  );
  const body = await json<{ id?: string; error?: string }>(response);
  assert.equal(
    response.status,
    201,
    `Expected cash payment session 201, got ${response.status}: ${body.error ?? ""}`
  );
  assert.ok(body.id, "Payment session id was not returned.");
  paymentSessionIds.push(body.id);
  return body.id;
}

async function finalizeOrder(paymentSessionId: string) {
  const ordersRoute = await import("@/app/api/orders/route");
  return ordersRoute.POST(
    deviceRequest("kiosk", "POST", "http://localhost/api/orders", {
      paymentSessionId,
    })
  );
}

async function stockQty(menuItemId: string) {
  const item = await prisma.menuItem.findUniqueOrThrow({
    where: { id: menuItemId },
    select: { stockQty: true },
  });
  return item.stockQty;
}

async function assertSimultaneousCheckoutRaceCannotOversell() {
  const item = await createQuantityItem("Race Last Item", 1);
  const firstSessionId = await createCashPaymentSession(item.id, 1, 10.5);
  const secondSessionId = await createCashPaymentSession(item.id, 1, 10.5);

  const [firstResponse, secondResponse] = await Promise.all([
    finalizeOrder(firstSessionId),
    finalizeOrder(secondSessionId),
  ]);
  const firstBody = await json<{ id?: string; errorCode?: string; error?: string }>(
    firstResponse
  );
  const secondBody = await json<{ id?: string; errorCode?: string; error?: string }>(
    secondResponse
  );
  const statuses = [firstResponse.status, secondResponse.status].sort();
  assert.deepEqual(
    statuses,
    [201, 409],
    `Expected one order success and one stale-stock rejection, got ${firstResponse.status}/${secondResponse.status}.`
  );

  const successfulOrderId = firstBody.id ?? secondBody.id;
  const failedBody = firstResponse.status === 409 ? firstBody : secondBody;
  assert.ok(successfulOrderId, "Successful order id missing.");
  orderIds.push(successfulOrderId);
  assert.equal(failedBody.errorCode, "MENU_STOCK_UNAVAILABLE");
  assert.equal(await stockQty(item.id), 0, "Race must consume the last unit once.");

  const placedMovements = await prisma.stockMovement.findMany({
    where: { menuItemId: item.id, reason: "ORDER_PLACED" },
  });
  assert.equal(
    placedMovements.length,
    1,
    "Race must create one stock decrement movement, not two."
  );
}

async function assertRefundDoesNotSilentlyRestock() {
  const token = await getAdminToken();
  const item = await createQuantityItem("Refund No Auto Restock", 3);
  const sessionId = await createCashPaymentSession(item.id, 1, 10.5);
  const orderResponse = await finalizeOrder(sessionId);
  const orderBody = await json<{ id?: string; error?: string }>(orderResponse);
  assert.equal(orderResponse.status, 201, orderBody.error ?? "");
  assert.ok(orderBody.id, "Refund test order id missing.");
  orderIds.push(orderBody.id);
  assert.equal(await stockQty(item.id), 2);

  await prisma.paymentTransaction.update({
    where: { id: sessionId },
    data: {
      status: "CAPTURED",
      completedAt: new Date(),
      lastSyncedAt: new Date(),
    },
  });
  await prisma.order.update({
    where: { id: orderBody.id },
    data: {
      status: "PAID",
      paymentStatus: "CAPTURED",
    },
  });

  const refundRoute = await import("@/app/api/admin/orders/[id]/refund/route");
  const refundResponse = await refundRoute.POST(
    adminRequest(
      token,
      "POST",
      `http://localhost/api/admin/orders/${orderBody.id}/refund`
    ),
    { params: Promise.resolve({ id: orderBody.id }) }
  );
  const refundBody = await json<{ ok?: boolean; error?: string }>(refundResponse);
  assert.equal(
    refundResponse.status,
    200,
    `Expected refund route 200, got ${refundResponse.status}: ${refundBody.error ?? ""}`
  );
  assert.equal(refundBody.ok, true);
  assert.equal(
    await stockQty(item.id),
    2,
    "Refunds must not silently restock quantity items; explicit inventory action is required."
  );

  const restockCount = await prisma.stockMovement.count({
    where: {
      orderId: orderBody.id,
      reason: { in: ["ORDER_CANCELLED_RESTOCK", "CASH_ORDER_CANCELLED_RESTOCK"] },
    },
  });
  assert.equal(restockCount, 0, "Refund must not create cancellation restock movement.");

  const returnRoute = await import("@/app/api/admin/orders/[id]/return-stock/route");
  const returnResponse = await returnRoute.POST(
    adminRequest(
      token,
      "POST",
      `http://localhost/api/admin/orders/${orderBody.id}/return-stock`
    ),
    { params: Promise.resolve({ id: orderBody.id }) }
  );
  const returnBody = await json<{
    ok?: boolean;
    changed?: boolean;
    alreadyReturned?: boolean;
    error?: string;
  }>(returnResponse);
  assert.equal(
    returnResponse.status,
    200,
    `Expected return-stock route 200, got ${returnResponse.status}: ${returnBody.error ?? ""}`
  );
  assert.equal(returnBody.ok, true);
  assert.equal(returnBody.changed, true);
  assert.equal(await stockQty(item.id), 3);

  const secondReturnResponse = await returnRoute.POST(
    adminRequest(
      token,
      "POST",
      `http://localhost/api/admin/orders/${orderBody.id}/return-stock`
    ),
    { params: Promise.resolve({ id: orderBody.id }) }
  );
  const secondReturnBody = await json<{
    ok?: boolean;
    changed?: boolean;
    alreadyReturned?: boolean;
    error?: string;
  }>(secondReturnResponse);
  assert.equal(
    secondReturnResponse.status,
    200,
    `Expected idempotent return-stock route 200, got ${secondReturnResponse.status}: ${secondReturnBody.error ?? ""}`
  );
  assert.equal(secondReturnBody.ok, true);
  assert.equal(secondReturnBody.changed, false);
  assert.equal(secondReturnBody.alreadyReturned, true);
  assert.equal(
    await stockQty(item.id),
    3,
    "Manual return stock must be idempotent and never double-increment."
  );
}

async function assertAfterProductionCancellationRequiresExplicitReturn() {
  const token = await getAdminToken();
  const item = await createQuantityItem("Post Production Cancel Return", 2);
  const sessionId = await createCashPaymentSession(item.id, 1, 10.5);
  const orderResponse = await finalizeOrder(sessionId);
  const orderBody = await json<{ id?: string; error?: string }>(orderResponse);
  assert.equal(orderResponse.status, 201, orderBody.error ?? "");
  assert.ok(orderBody.id, "Post-production cancel test order id missing.");
  orderIds.push(orderBody.id);
  assert.equal(await stockQty(item.id), 1);

  const ordersRoute = await import("@/app/api/admin/orders/[id]/route");
  const inKitchenResponse = await ordersRoute.PATCH(
    adminRequest(
      token,
      "PATCH",
      `http://localhost/api/admin/orders/${orderBody.id}`,
      { status: "IN_KITCHEN" }
    ),
    { params: Promise.resolve({ id: orderBody.id }) }
  );
  assert.equal(
    inKitchenResponse.status,
    200,
    `Expected IN_KITCHEN transition 200, got ${inKitchenResponse.status}`
  );

  const cancelResponse = await ordersRoute.PATCH(
    adminRequest(
      token,
      "PATCH",
      `http://localhost/api/admin/orders/${orderBody.id}`,
      { status: "CANCELLED" }
    ),
    { params: Promise.resolve({ id: orderBody.id }) }
  );
  assert.equal(
    cancelResponse.status,
    200,
    `Expected post-production cancel 200, got ${cancelResponse.status}`
  );
  assert.equal(
    await stockQty(item.id),
    1,
    "After-production cancellation must not auto-restock quantity items."
  );

  const returnRoute = await import("@/app/api/admin/orders/[id]/return-stock/route");
  const returnResponse = await returnRoute.POST(
    adminRequest(
      token,
      "POST",
      `http://localhost/api/admin/orders/${orderBody.id}/return-stock`
    ),
    { params: Promise.resolve({ id: orderBody.id }) }
  );
  const returnBody = await json<{ ok?: boolean; changed?: boolean; error?: string }>(
    returnResponse
  );
  assert.equal(
    returnResponse.status,
    200,
    `Expected post-production return-stock 200, got ${returnResponse.status}: ${returnBody.error ?? ""}`
  );
  assert.equal(returnBody.ok, true);
  assert.equal(returnBody.changed, true);
  assert.equal(await stockQty(item.id), 2);
}

async function assertPreProductionAutoRestockBlocksManualReturn() {
  const token = await getAdminToken();
  const item = await createQuantityItem("Pre Production Auto Restock Block", 2);
  const sessionId = await createCashPaymentSession(item.id, 1, 10.5);
  const orderResponse = await finalizeOrder(sessionId);
  const orderBody = await json<{ id?: string; error?: string }>(orderResponse);
  assert.equal(orderResponse.status, 201, orderBody.error ?? "");
  assert.ok(orderBody.id, "Pre-production cancel test order id missing.");
  orderIds.push(orderBody.id);
  assert.equal(await stockQty(item.id), 1);

  const ordersRoute = await import("@/app/api/admin/orders/[id]/route");
  const cancelResponse = await ordersRoute.PATCH(
    adminRequest(
      token,
      "PATCH",
      `http://localhost/api/admin/orders/${orderBody.id}`,
      { status: "CANCELLED" }
    ),
    { params: Promise.resolve({ id: orderBody.id }) }
  );
  assert.equal(
    cancelResponse.status,
    200,
    `Expected pre-production cancel 200, got ${cancelResponse.status}`
  );
  assert.equal(
    await stockQty(item.id),
    2,
    "Pre-production cancellation should auto-restock quantity items."
  );

  const autoRestockCount = await prisma.stockMovement.count({
    where: {
      orderId: orderBody.id,
      reason: { in: ["ORDER_CANCELLED_RESTOCK", "CASH_ORDER_CANCELLED_RESTOCK"] },
    },
  });
  assert.equal(
    autoRestockCount,
    1,
    "Pre-production cancellation should create exactly one automatic restock movement."
  );

  const returnRoute = await import("@/app/api/admin/orders/[id]/return-stock/route");
  const returnResponse = await returnRoute.POST(
    adminRequest(
      token,
      "POST",
      `http://localhost/api/admin/orders/${orderBody.id}/return-stock`
    ),
    { params: Promise.resolve({ id: orderBody.id }) }
  );
  const returnBody = await json<{ errorCode?: string; error?: string }>(
    returnResponse
  );
  assert.equal(
    returnResponse.status,
    409,
    `Expected manual return after auto-restock to be blocked, got ${returnResponse.status}: ${returnBody.error ?? ""}`
  );
  assert.equal(returnBody.errorCode, "stock_already_returned_automatically");
  assert.equal(
    await stockQty(item.id),
    2,
    "Blocked manual return must not double-increment stock."
  );

  const manualReturnCount = await prisma.stockMovement.count({
    where: {
      orderId: orderBody.id,
      reason: "ADMIN_RETURN_STOCK",
    },
  });
  assert.equal(
    manualReturnCount,
    0,
    "Blocked manual return must not write ADMIN_RETURN_STOCK movements."
  );
}

async function assertStockMovementHistorySurvivesItemRemoval() {
  const item = await createQuantityItem("Movement Delete Snapshot", 4);
  const movement = await prisma.stockMovement.create({
    data: {
      outletId,
      menuItemId: item.id,
      itemNameSnapshot: item.name,
      delta: 4,
      reason: "ADMIN_SET",
      beforeQty: null,
      afterQty: 4,
      actorType: "TEST",
      actorId: null,
      note: "Slice 6 deletion safety check.",
    },
  });
  stockMovementIds.push(movement.id);

  await prisma.menuItem.delete({ where: { id: item.id } });
  const deletedIndex = itemIds.indexOf(item.id);
  if (deletedIndex >= 0) itemIds.splice(deletedIndex, 1);

  const preserved = await prisma.stockMovement.findUniqueOrThrow({
    where: { id: movement.id },
    select: { menuItemId: true, itemNameSnapshot: true, delta: true },
  });
  assert.equal(preserved.menuItemId, null);
  assert.equal(preserved.itemNameSnapshot, item.name);
  assert.equal(preserved.delta, 4);
}

async function cleanup() {
  const movementClauses: Prisma.StockMovementWhereInput[] = [];
  if (stockMovementIds.length) movementClauses.push({ id: { in: stockMovementIds } });
  if (itemIds.length) movementClauses.push({ menuItemId: { in: itemIds } });
  if (orderIds.length) movementClauses.push({ orderId: { in: orderIds } });
  if (movementClauses.length) {
    await prisma.stockMovement.deleteMany({ where: { OR: movementClauses } });
  }
  if (paymentSessionIds.length) {
    await prisma.paymentTransaction.deleteMany({
      where: { id: { in: paymentSessionIds } },
    });
  }
  if (orderIds.length) {
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  }
  if (itemIds.length) {
    await prisma.menuItem.deleteMany({ where: { id: { in: itemIds } } });
  }
  if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
  if (adminUserId) {
    await prisma.adminSession.deleteMany({ where: { userId: adminUserId } });
    await prisma.adminUser.deleteMany({ where: { id: adminUserId } });
  }
}

async function main() {
  await seed();
  await assertSimultaneousCheckoutRaceCannotOversell();
  await assertRefundDoesNotSilentlyRestock();
  await assertAfterProductionCancellationRequiresExplicitReturn();
  await assertPreProductionAutoRestockBlocksManualReturn();
  await assertStockMovementHistorySurvivesItemRemoval();
  console.log("Menu stock Slice 6 tests passed.");
}

main()
  .catch((err) => {
    console.error("Menu stock Slice 6 tests failed.");
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((err) => {
      console.error("Menu stock Slice 6 cleanup failed.");
      console.error(err);
      process.exitCode = 1;
    });
    await prisma.$disconnect();
  });
