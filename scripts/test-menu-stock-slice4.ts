/* eslint-disable no-console */
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { createRequire } from "node:module";
import { NextRequest } from "next/server";
import "dotenv/config";
import { prisma } from "@/lib/db";
import { DEVICE_SESSION_COOKIE, type DeviceRole } from "@/lib/device-auth";
import { DEFAULT_SITE_ID } from "@/lib/outlets";
import { getOutletMenuVersion } from "@/lib/outlet-menu-sync";
import type { StockRequirementSnapshot } from "@/lib/types";

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

const runId = `stock-slice4-${Date.now()}`;
const outletId = "cafeteria";
const categorySlug = `cat-${runId}`;
let categoryId: string | null = null;
let createdDealsCategoryId: string | null = null;
let burgerId: string | null = null;
let staleItemId: string | null = null;
let guardItemId: string | null = null;
let dealId: string | null = null;
let dealBaseId: string | null = null;
let dealIncludedId: string | null = null;
let dealAlternateId: string | null = null;
const paymentSessionIds: string[] = [];
const orderIds: string[] = [];

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
      name: `Stock Slice 4 ${runId}`,
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
      name: "Stock Slice 4",
      icon: "Q",
      isActive: true,
      sortOrder: 9999,
    },
  });
  categoryId = category.id;

  const [burger, stale, guard] = await Promise.all([
    prisma.menuItem.create({
      data: {
        categoryId: category.id,
        outletId,
        name: `Quantity Burger ${runId}`,
        description: "Tracked checkout item",
        price: new Prisma.Decimal("10.00"),
        emoji: "Q",
        bgColor: "#FFF3B0",
        isActive: true,
        isOutOfStock: false,
        stockMode: "QUANTITY",
        stockQty: 3,
        sortOrder: 1,
      },
    }),
    prisma.menuItem.create({
      data: {
        categoryId: category.id,
        outletId,
        name: `Stale Quantity Burger ${runId}`,
        description: "Tracked stale checkout item",
        price: new Prisma.Decimal("5.00"),
        emoji: "S",
        bgColor: "#FFF3B0",
        isActive: true,
        isOutOfStock: false,
        stockMode: "QUANTITY",
        stockQty: 1,
        sortOrder: 2,
      },
    }),
    prisma.menuItem.create({
      data: {
        categoryId: category.id,
        outletId,
        name: `Guard Quantity Burger ${runId}`,
        description: "Tracked external payment guard item",
        price: new Prisma.Decimal("4.00"),
        emoji: "G",
        bgColor: "#FFF3B0",
        isActive: true,
        isOutOfStock: false,
        stockMode: "QUANTITY",
        stockQty: 2,
        sortOrder: 3,
      },
    }),
  ]);

  burgerId = burger.id;
  staleItemId = stale.id;
  guardItemId = guard.id;
}

async function cleanup() {
  const itemIds = [
    burgerId,
    staleItemId,
    guardItemId,
    dealId,
    dealBaseId,
    dealIncludedId,
    dealAlternateId,
  ].filter(
    (id): id is string => typeof id === "string"
  );
  const movementClauses: Prisma.StockMovementWhereInput[] = [];
  if (itemIds.length) movementClauses.push({ menuItemId: { in: itemIds } });
  if (orderIds.length) movementClauses.push({ orderId: { in: orderIds } });
  if (movementClauses.length) {
    await prisma.stockMovement.deleteMany({
      where: { OR: movementClauses },
    });
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
  if (createdDealsCategoryId) {
    await prisma.category.deleteMany({ where: { id: createdDealsCategoryId } });
  }
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
  const body = await json<{ id?: string; error?: string; errorCode?: string }>(
    response
  );
  assert.equal(
    response.status,
    201,
    `Expected cash payment session 201, got ${response.status}: ${body.error ?? ""}`
  );
  assert.ok(body.id, "Payment session id was not returned.");
  paymentSessionIds.push(body.id);
  return body.id;
}

async function createCashPaymentSession(
  itemId: string,
  qty: number,
  expectedTotal: number
) {
  return createCashPaymentSessionForItems([{ menuItemId: itemId, qty }], expectedTotal);
}

async function finalizeOrder(paymentSessionId: string) {
  const ordersRoute = await import("@/app/api/orders/route");
  return ordersRoute.POST(
    request("kiosk", "POST", "http://localhost/api/orders", {
      paymentSessionId,
    })
  );
}

async function assertSuccessfulDecrement() {
  assert.ok(burgerId, "burgerId missing");
  const beforeVersion = await getOutletMenuVersion(prisma, outletId);
  const sessionId = await createCashPaymentSession(burgerId, 2, 21);

  const transaction = await prisma.paymentTransaction.findUniqueOrThrow({
    where: { id: sessionId },
    select: { stockRequirementsJson: true },
  });
  const requirements =
    transaction.stockRequirementsJson as unknown as StockRequirementSnapshot[];
  assert.equal(requirements.length, 1, "Expected one stock requirement.");
  assert.equal(requirements[0]?.menuItemId, burgerId);
  assert.equal(requirements[0]?.qty, 2);
  assert.equal(requirements[0]?.source, "NORMAL_ITEM");

  const [first, second] = await Promise.all([
    finalizeOrder(sessionId),
    finalizeOrder(sessionId),
  ]);
  const firstBody = await json<{ id?: string; error?: string }>(first);
  const secondBody = await json<{ id?: string; error?: string }>(second);
  assert.ok([200, 201].includes(first.status), `First order failed: ${firstBody.error ?? ""}`);
  assert.ok([200, 201].includes(second.status), `Second order failed: ${secondBody.error ?? ""}`);
  assert.ok(firstBody.id, "First order id missing.");
  orderIds.push(firstBody.id);
  assert.equal(firstBody.id, secondBody.id, "Retry must return the same order.");

  const item = await prisma.menuItem.findUniqueOrThrow({
    where: { id: burgerId },
    select: { stockQty: true },
  });
  assert.equal(item.stockQty, 1, "Stock should decrement once from 3 to 1.");

  const movements = await prisma.stockMovement.findMany({
    where: { orderId: firstBody.id },
    orderBy: { createdAt: "asc" },
  });
  assert.equal(movements.length, 1, "Expected one order stock movement.");
  assert.equal(movements[0]?.delta, -2);
  assert.equal(movements[0]?.reason, "ORDER_PLACED");
  assert.equal(
    movements[0]?.idempotencyKey,
    `order:${firstBody.id}:placed:MENU_ITEM:${burgerId}`
  );

  const afterVersion = await getOutletMenuVersion(prisma, outletId);
  assert.equal(
    afterVersion.revision,
    beforeVersion.revision + 1,
    "Accepted stock decrement should bump menu version once."
  );
}

async function assertStaleStockRejectsOrder() {
  assert.ok(staleItemId, "staleItemId missing");
  const sessionId = await createCashPaymentSession(staleItemId, 1, 5.25);
  await prisma.menuItem.update({
    where: { id: staleItemId },
    data: { stockQty: 0 },
  });

  const response = await finalizeOrder(sessionId);
  const body = await json<{
    error?: string;
    errorCode?: string;
    items?: Array<{ menuItemId: string; requestedQty: number; availableQty: number }>;
  }>(response);
  assert.equal(response.status, 409);
  assert.equal(body.errorCode, "MENU_STOCK_UNAVAILABLE");
  assert.equal(body.items?.[0]?.menuItemId, staleItemId);
  assert.equal(body.items?.[0]?.requestedQty, 1);
  assert.equal(body.items?.[0]?.availableQty, 0);

  const transaction = await prisma.paymentTransaction.findUniqueOrThrow({
    where: { id: sessionId },
    select: { orderId: true, finalizedOrderId: true },
  });
  assert.equal(transaction.orderId, null);
  assert.equal(transaction.finalizedOrderId, null);
  const movements = await prisma.stockMovement.count({
    where: { menuItemId: staleItemId, reason: "ORDER_PLACED" },
  });
  assert.equal(movements, 0, "Rejected stale order must not write stock movement.");
}

async function assertExternalPaymentGuard() {
  assert.ok(guardItemId, "guardItemId missing");
  const paymentSessionsRoute = await import("@/app/api/payments/sessions/route");
  const response = await paymentSessionsRoute.POST(
    request("kiosk", "POST", "http://localhost/api/payments/sessions", {
      orderType: "TAKEOUT",
      paymentMethod: "CARD",
      expectedTotal: 4.2,
      items: [{ menuItemId: guardItemId, qty: 1 }],
    })
  );
  const body = await json<{ error?: string; errorCode?: string }>(response);
  assert.equal(response.status, 409);
  assert.equal(body.errorCode, "MENU_STOCK_EXTERNAL_PAYMENT_UNSUPPORTED");
  assert.match(body.error ?? "", /pay at counter/i);
}

async function assertDealStockRequirementsAndDecrement() {
  assert.ok(categoryId, "categoryId missing");

  let dealsCategory = await prisma.category.findUnique({
    where: { outletId_slug: { outletId, slug: "deals" } },
  });
  if (!dealsCategory) {
    dealsCategory = await prisma.category.create({
      data: {
        outletId,
        slug: "deals",
        name: "Deals",
        icon: "D",
        isActive: true,
        sortOrder: 0,
      },
    });
    createdDealsCategoryId = dealsCategory.id;
  }

  const [base, included] = await Promise.all([
    prisma.menuItem.create({
      data: {
        categoryId,
        outletId,
        name: `Deal Base Quantity ${runId}`,
        description: "Tracked deal base item",
        price: new Prisma.Decimal("6.00"),
        emoji: "B",
        bgColor: "#FFF3B0",
        isActive: true,
        isOutOfStock: false,
        stockMode: "QUANTITY",
        stockQty: 4,
        sortOrder: 10,
      },
    }),
    prisma.menuItem.create({
      data: {
        categoryId,
        outletId,
        name: `Deal Included Quantity ${runId}`,
        description: "Tracked deal included item",
        price: new Prisma.Decimal("2.00"),
        emoji: "I",
        bgColor: "#FFF3B0",
        isActive: true,
        isOutOfStock: false,
        stockMode: "QUANTITY",
        stockQty: 5,
        sortOrder: 11,
      },
    }),
  ]);
  dealBaseId = base.id;
  dealIncludedId = included.id;

  const deal = await prisma.menuItem.create({
    data: {
      categoryId: dealsCategory.id,
      outletId,
      name: `Quantity Deal ${runId}`,
      description: "Tracked deal checkout item",
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
      sortOrder: 12,
    },
  });
  dealId = deal.id;

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

  const beforeVersion = await getOutletMenuVersion(prisma, outletId);
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

  const transaction = await prisma.paymentTransaction.findUniqueOrThrow({
    where: { id: sessionId },
    select: { stockRequirementsJson: true },
  });
  const requirements =
    transaction.stockRequirementsJson as unknown as StockRequirementSnapshot[];
  assert.deepEqual(
    requirements
      .map((requirement) => ({
        menuItemId: requirement.menuItemId,
        qty: requirement.qty,
        source: requirement.source,
        orderLineMenuItemId: requirement.orderLineMenuItemId,
        upgradeOptionId: requirement.upgradeOptionId ?? null,
        upgradeItemLinkId: requirement.upgradeItemLinkId ?? null,
      }))
      .sort((a, b) => a.source.localeCompare(b.source)),
    [
      {
        menuItemId: base.id,
        qty: 2,
        source: "DEAL_BASE_ITEM",
        orderLineMenuItemId: deal.id,
        upgradeOptionId: option.id,
        upgradeItemLinkId: null,
      },
      {
        menuItemId: included.id,
        qty: 2,
        source: "DEAL_INCLUDED_ITEM",
        orderLineMenuItemId: deal.id,
        upgradeOptionId: option.id,
        upgradeItemLinkId: link.id,
      },
    ],
    "Expected deal base and included item stock requirements."
  );

  const alternate = await prisma.menuItem.create({
    data: {
      categoryId,
      outletId,
      name: `Deal Alternate Quantity ${runId}`,
      description: "Tracked item added after payment session creation",
      price: new Prisma.Decimal("9.00"),
      emoji: "A",
      bgColor: "#FFF3B0",
      isActive: true,
      isOutOfStock: false,
      stockMode: "QUANTITY",
      stockQty: 9,
      sortOrder: 13,
    },
  });
  dealAlternateId = alternate.id;

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

  const response = await finalizeOrder(sessionId);
  const body = await json<{ id?: string; error?: string }>(response);
  assert.equal(response.status, 201, `Deal order failed: ${body.error ?? ""}`);
  assert.ok(body.id, "Deal order id missing.");
  orderIds.push(body.id);

  const [baseAfter, includedAfter, alternateAfter, dealAfter] = await Promise.all([
    prisma.menuItem.findUniqueOrThrow({
      where: { id: base.id },
      select: { stockQty: true },
    }),
    prisma.menuItem.findUniqueOrThrow({
      where: { id: included.id },
      select: { stockQty: true },
    }),
    prisma.menuItem.findUniqueOrThrow({
      where: { id: alternate.id },
      select: { stockQty: true },
    }),
    prisma.menuItem.findUniqueOrThrow({
      where: { id: deal.id },
      select: { stockMode: true, stockQty: true },
    }),
  ]);
  assert.equal(baseAfter.stockQty, 2, "Deal base stock should decrement by qty.");
  assert.equal(
    includedAfter.stockQty,
    3,
    "Deal included item stock should decrement by qty."
  );
  assert.equal(
    alternateAfter.stockQty,
    9,
    "Admin edits after payment session creation must not change decrement targets."
  );
  assert.equal(dealAfter.stockMode, "MANUAL");
  assert.equal(dealAfter.stockQty, null, "Deal shell stock should not be decremented.");

  const movementByItem = new Map(
    (
      await prisma.stockMovement.findMany({
        where: { orderId: body.id },
      })
    ).map((movement) => [movement.menuItemId, movement])
  );
  assert.equal(movementByItem.size, 2, "Expected two deal order stock movements.");
  for (const menuItemId of [base.id, included.id]) {
    const movement = movementByItem.get(menuItemId);
    assert.ok(movement, `Missing stock movement for ${menuItemId}.`);
    assert.equal(movement.delta, -2);
    assert.equal(movement.reason, "ORDER_PLACED");
    assert.equal(
      movement.idempotencyKey,
      `order:${body.id}:placed:MENU_ITEM:${menuItemId}`
    );
  }

  const afterVersion = await getOutletMenuVersion(prisma, outletId);
  assert.equal(
    afterVersion.revision,
    beforeVersion.revision + 1,
    "Accepted deal stock decrement should bump menu version once."
  );
}

async function main() {
  await seed();
  await assertSuccessfulDecrement();
  await assertStaleStockRejectsOrder();
  await assertExternalPaymentGuard();
  await assertDealStockRequirementsAndDecrement();
  console.log("Menu stock Slice 4 tests passed.");
}

main()
  .catch((err) => {
    console.error("Menu stock Slice 4 tests failed.");
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((err) => {
      console.error("Menu stock Slice 4 cleanup failed.");
      console.error(err);
      process.exitCode = 1;
    });
    await prisma.$disconnect();
  });
