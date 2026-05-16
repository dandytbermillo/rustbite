/* eslint-disable no-console */
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { createRequire } from "node:module";
import { NextRequest } from "next/server";
import "dotenv/config";
import { prisma } from "@/lib/db";
import { DEVICE_SESSION_COOKIE, type DeviceRole } from "@/lib/device-auth";
import { updateOrderStatus } from "@/lib/order-updates";
import { DEFAULT_SITE_ID } from "@/lib/outlets";
import { getOutletMenuVersion } from "@/lib/outlet-menu-sync";

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

const runId = `stock-slice5-${Date.now()}`;
const outletId = "cafeteria";
const categorySlug = `cat-${runId}`;
let categoryId: string | null = null;
let dealsCategoryId: string | null = null;
const itemIds: string[] = [];
const orderIds: string[] = [];
const paymentSessionIds: string[] = [];

function deviceCookie(role: DeviceRole) {
  return `${DEVICE_SESSION_COOKIE}=legacy:${role}:local-${role}-key`;
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

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function seed() {
  await prisma.site.upsert({
    where: { id: DEFAULT_SITE_ID },
    update: {},
    create: {
      id: DEFAULT_SITE_ID,
      name: `Stock Slice 5 ${runId}`,
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
      name: "Stock Slice 5",
      icon: "R",
      isActive: true,
      sortOrder: 9999,
    },
  });
  categoryId = category.id;
}

async function ensureDealsCategory() {
  let deals = await prisma.category.findUnique({
    where: { outletId_slug: { outletId, slug: "deals" } },
  });
  if (!deals) {
    deals = await prisma.category.create({
      data: {
        outletId,
        slug: "deals",
        name: "Deals",
        icon: "D",
        isActive: true,
        sortOrder: 0,
      },
    });
    dealsCategoryId = deals.id;
  }
  return deals;
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
      emoji: "R",
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

async function createCashPaymentSessionForItems(
  items: Array<{
    menuItemId: string;
    qty: number;
    selectedUpgradeOptionId?: string | null;
  }>,
  expectedTotal: number
) {
  const paymentSessionsRoute = await import("@/app/api/payments/sessions/route");
  const response = await paymentSessionsRoute.POST(
    request("kiosk", "POST", "http://localhost/api/payments/sessions", {
      orderType: "TAKEOUT",
      paymentMethod: "CASH",
      expectedTotal,
      items,
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
  const response = await ordersRoute.POST(
    request("kiosk", "POST", "http://localhost/api/orders", {
      paymentSessionId,
    })
  );
  const body = await json<{ id?: string; error?: string; status?: string }>(
    response
  );
  assert.ok(
    [200, 201].includes(response.status),
    `Expected order 200/201, got ${response.status}: ${body.error ?? ""}`
  );
  assert.ok(body.id, "Order id was not returned.");
  orderIds.push(body.id);
  return body.id;
}

async function finalizeOrderExpectStockUnavailable(paymentSessionId: string) {
  const ordersRoute = await import("@/app/api/orders/route");
  const response = await ordersRoute.POST(
    request("kiosk", "POST", "http://localhost/api/orders", {
      paymentSessionId,
    })
  );
  const body = await json<{
    error?: string;
    errorCode?: string;
    items?: Array<{ targetId: string; availableQty: number }>;
  }>(response);
  assert.equal(
    response.status,
    409,
    `Expected paused stock finalization to fail with 409, got ${response.status}: ${body.error ?? ""}`
  );
  assert.equal(body.errorCode, "MENU_STOCK_UNAVAILABLE");
  return body;
}

async function stockQty(menuItemId: string) {
  const item = await prisma.menuItem.findUniqueOrThrow({
    where: { id: menuItemId },
    select: { stockQty: true },
  });
  return item.stockQty;
}

async function assertPausedQuantityItemCannotFinalize() {
  const item = await createQuantityItem("Paused Before Finalization", 5);
  const sessionId = await createCashPaymentSessionForItems(
    [{ menuItemId: item.id, qty: 2 }],
    21
  );

  await prisma.menuItem.update({
    where: { id: item.id },
    data: { isOutOfStock: true },
  });

  const body = await finalizeOrderExpectStockUnavailable(sessionId);
  assert.equal(
    body.items?.[0]?.targetId,
    item.id,
    "Paused menu item should be reported as the unavailable target."
  );
  assert.equal(
    body.items?.[0]?.availableQty,
    0,
    "Paused quantity item should not be reported as orderable available stock."
  );
  assert.equal(
    await stockQty(item.id),
    5,
    "Failed finalization must preserve quantity for a paused item."
  );
}

async function assertAwaitingCounterCancellationRestocksOnce() {
  const item = await createQuantityItem("Counter Cancel Restock", 5);
  const sessionId = await createCashPaymentSessionForItems(
    [{ menuItemId: item.id, qty: 2 }],
    21
  );
  const orderId = await finalizeOrder(sessionId);
  assert.equal(await stockQty(item.id), 3, "Order should decrement stock first.");

  const beforeVersion = await getOutletMenuVersion(prisma, outletId);
  await updateOrderStatus(orderId, "CANCELLED", { outletIds: [outletId] });
  assert.equal(
    await stockQty(item.id),
    5,
    "Cancelling an unpaid counter order should return quantity stock."
  );

  await updateOrderStatus(orderId, "CANCELLED", { outletIds: [outletId] });
  assert.equal(
    await stockQty(item.id),
    5,
    "Repeated cancellation must not restock the same order twice."
  );

  const movements = await prisma.stockMovement.findMany({
    where: { orderId, reason: "CASH_ORDER_CANCELLED_RESTOCK" },
  });
  assert.equal(movements.length, 1, "Expected one cash cancellation restock.");
  assert.equal(movements[0]?.delta, 2);
  assert.equal(
    movements[0]?.idempotencyKey,
    `order:${orderId}:cancel-restock:MENU_ITEM:${item.id}`
  );

  const afterVersion = await getOutletMenuVersion(prisma, outletId);
  assert.equal(
    afterVersion.revision,
    beforeVersion.revision + 1,
    "Cancellation restock should bump menu version once."
  );
}

async function assertPaidBeforeKitchenCancellationRestocks() {
  const item = await createQuantityItem("Paid Cancel Restock", 4);
  const sessionId = await createCashPaymentSessionForItems(
    [{ menuItemId: item.id, qty: 1 }],
    10.5
  );
  const orderId = await finalizeOrder(sessionId);
  await updateOrderStatus(orderId, "PAID", { outletIds: [outletId] });
  assert.equal(await stockQty(item.id), 3);

  await updateOrderStatus(orderId, "CANCELLED", { outletIds: [outletId] });
  assert.equal(
    await stockQty(item.id),
    4,
    "Cancelling a paid order before kitchen start should return quantity stock."
  );

  const movement = await prisma.stockMovement.findFirst({
    where: { orderId, reason: "ORDER_CANCELLED_RESTOCK" },
  });
  assert.ok(movement, "Expected paid-before-kitchen cancellation restock.");
  assert.equal(movement.delta, 1);
}

async function assertInKitchenCancellationDoesNotRestock() {
  const item = await createQuantityItem("Kitchen Cancel No Restock", 3);
  const sessionId = await createCashPaymentSessionForItems(
    [{ menuItemId: item.id, qty: 1 }],
    10.5
  );
  const orderId = await finalizeOrder(sessionId);
  await updateOrderStatus(orderId, "PAID", { outletIds: [outletId] });
  await updateOrderStatus(orderId, "IN_KITCHEN", { outletIds: [outletId] });
  assert.equal(await stockQty(item.id), 2);

  await updateOrderStatus(orderId, "CANCELLED", { outletIds: [outletId] });
  assert.equal(
    await stockQty(item.id),
    2,
    "Cancelling after kitchen start should not automatically return stock."
  );

  const count = await prisma.stockMovement.count({
    where: {
      orderId,
      reason: { in: ["CASH_ORDER_CANCELLED_RESTOCK", "ORDER_CANCELLED_RESTOCK"] },
    },
  });
  assert.equal(count, 0, "Kitchen cancellation must not create restock movement.");
}

async function assertProductionStartedRewriteDoesNotRestock() {
  const item = await createQuantityItem("Admin Rewrite No Restock", 3);
  const sessionId = await createCashPaymentSessionForItems(
    [{ menuItemId: item.id, qty: 1 }],
    10.5
  );
  const orderId = await finalizeOrder(sessionId);
  await updateOrderStatus(orderId, "PAID", { outletIds: [outletId] });
  await updateOrderStatus(orderId, "IN_KITCHEN", { outletIds: [outletId] });
  assert.equal(await stockQty(item.id), 2);

  const kitchenStarted = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { productionStartedAt: true },
  });
  assert.ok(
    kitchenStarted.productionStartedAt,
    "Moving into kitchen should persist productionStartedAt."
  );

  await updateOrderStatus(orderId, "PAID", { outletIds: [outletId] });
  await updateOrderStatus(orderId, "CANCELLED", { outletIds: [outletId] });
  assert.equal(
    await stockQty(item.id),
    2,
    "Admin/legacy rewrite after kitchen start must not make cancellation restock."
  );

  const count = await prisma.stockMovement.count({
    where: {
      orderId,
      reason: { in: ["CASH_ORDER_CANCELLED_RESTOCK", "ORDER_CANCELLED_RESTOCK"] },
    },
  });
  assert.equal(
    count,
    0,
    "Production-started rewrite must not create restock movement."
  );
}

async function assertDealCancellationRestocksFrozenComponents() {
  const dealsCategory = await ensureDealsCategory();
  const base = await createQuantityItem("Deal Base Restock", 6, "6.00");
  const included = await createQuantityItem("Deal Included Restock", 7, "2.00");
  const alternate = await createQuantityItem("Deal Alternate No Restock", 9, "9.00");

  const deal = await prisma.menuItem.create({
    data: {
      categoryId: dealsCategory.id,
      outletId,
      name: `Deal Restock ${runId}`,
      description: "Temporary deal for cancellation restock testing",
      price: new Prisma.Decimal("6.00"),
      emoji: "D",
      bgColor: "#FFF3B0",
      badge: "DEAL",
      dealBaseMenuItemId: base.id,
      dealExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      isActive: true,
      isOutOfStock: false,
      stockMode: "MANUAL",
      stockQty: null,
      sortOrder: 100,
    },
  });
  itemIds.push(deal.id);

  const option = await prisma.upgradeOption.create({
    data: {
      itemId: deal.id,
      customTitle: "Add included quantity item",
      extraCharge: new Prisma.Decimal("2.00"),
      savingsLabel: null,
      discountPct: null,
      sortOrder: 1,
    },
  });
  const link = await prisma.upgradeItemLink.create({
    data: {
      upgradeOptionId: option.id,
      linkedMenuItemId: included.id,
      linkedSizeId: null,
      itemNameSnapshot: included.name,
      sizeNameSnapshot: null,
      sortOrder: 1,
    },
  });

  const sessionId = await createCashPaymentSessionForItems(
    [
      {
        menuItemId: deal.id,
        qty: 2,
        selectedUpgradeOptionId: option.id,
      },
    ],
    16.8
  );
  const orderId = await finalizeOrder(sessionId);
  assert.equal(await stockQty(base.id), 4);
  assert.equal(await stockQty(included.id), 5);

  await prisma.menuItem.update({
    where: { id: deal.id },
    data: { dealBaseMenuItemId: alternate.id },
  });
  await prisma.upgradeItemLink.update({
    where: { id: link.id },
    data: {
      linkedMenuItemId: alternate.id,
      itemNameSnapshot: alternate.name,
    },
  });

  await updateOrderStatus(orderId, "CANCELLED", { outletIds: [outletId] });
  assert.equal(await stockQty(base.id), 6, "Frozen deal base should restock.");
  assert.equal(
    await stockQty(included.id),
    7,
    "Frozen deal included item should restock."
  );
  assert.equal(
    await stockQty(alternate.id),
    9,
    "Post-payment deal edits must not change restock targets."
  );
  assert.equal(
    await stockQty(deal.id),
    null,
    "Deal shell should not be quantity-restocked."
  );

  const movements = await prisma.stockMovement.findMany({
    where: { orderId, reason: "CASH_ORDER_CANCELLED_RESTOCK" },
  });
  assert.equal(movements.length, 2, "Expected deal base and included restocks.");
}

async function cleanup() {
  const movementClauses: Prisma.StockMovementWhereInput[] = [];
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
  if (dealsCategoryId) {
    await prisma.category.deleteMany({ where: { id: dealsCategoryId } });
  }
}

async function main() {
  await seed();
  await assertPausedQuantityItemCannotFinalize();
  await assertAwaitingCounterCancellationRestocksOnce();
  await assertPaidBeforeKitchenCancellationRestocks();
  await assertInKitchenCancellationDoesNotRestock();
  await assertProductionStartedRewriteDoesNotRestock();
  await assertDealCancellationRestocksFrozenComponents();
  console.log("Menu stock Slice 5 tests passed.");
}

main()
  .catch((err) => {
    console.error("Menu stock Slice 5 tests failed.");
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((err) => {
      console.error("Menu stock Slice 5 cleanup failed.");
      console.error(err);
      process.exitCode = 1;
    });
    await prisma.$disconnect();
  });
