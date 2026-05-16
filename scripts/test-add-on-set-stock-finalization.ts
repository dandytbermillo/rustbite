/* eslint-disable no-console */
import "dotenv/config";

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { DEVICE_SESSION_COOKIE, type DeviceRole } from "@/lib/device-auth";
import { prisma } from "@/lib/db";
import { DEFAULT_SITE_ID } from "@/lib/outlets";
import { GST_RATE, round2 } from "@/lib/pricing";
import { updateOrderStatus } from "@/lib/order-updates";
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

const runId = `addon-set-stock-${Date.now()}`;
const outletId = "cafeteria";
const categorySlug = `cat-${runId}`;
const ownerUserId = `${runId}-owner`;
const itemName = `Add-on Set Stock Burger ${runId}`;
const sharedOptionName = `Tracked sauce ${runId}`;
const zeroOptionName = `Zero sauce ${runId}`;
const localAddonName = `Local tracked extra ${runId}`;
let categoryId: string | null = null;
let itemId: string | null = null;
let localAddonId: string | null = null;
let groupId: string | null = null;
let linkId: string | null = null;
let sharedOptionId: string | null = null;
let zeroOptionId: string | null = null;
let adminToken: string | null = null;
const paymentSessionIds: string[] = [];
const orderIds: string[] = [];

type JsonBody = Record<string, unknown>;
type PaymentSessionBody = { id?: string; error?: string; errorCode?: string };
type OrderBody = { id?: string; error?: string; errorCode?: string; items?: StockErrorItem[] };
type StockErrorItem = {
  targetType?: string;
  targetId?: string;
  targetNameSnapshot?: string;
  requestedQty?: number;
  availableQty?: number;
};

function deviceCookie(role: DeviceRole) {
  return `${DEVICE_SESSION_COOKIE}=legacy:${role}:local-${role}-key`;
}

function adminCookie(token: string, activeOutletId = outletId) {
  return `rb_admin_session=${token}; rb_admin_active_outlet=${activeOutletId}`;
}

function request(
  role: DeviceRole,
  method: string,
  url: string,
  body?: JsonBody
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

function adminRequest(path: string, token: string, method = "POST") {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: {
      origin: "http://localhost",
      referer: "http://localhost/",
      cookie: adminCookie(token),
    },
  });
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function expectedTotal(qty: number, optionPrice = 1.25) {
  const subtotal = round2((10 + optionPrice) * qty);
  return round2(subtotal + round2(subtotal * GST_RATE));
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
      name: "Add-on Set Stock",
      icon: "A",
      isActive: true,
      sortOrder: 9997,
    },
  });
  categoryId = category.id;

  const item = await prisma.menuItem.create({
    data: {
      categoryId: category.id,
      outletId,
      name: itemName,
      description: "Quantity-tracked shared add-on set stock fixture",
      price: new Prisma.Decimal("10.00"),
      emoji: "A",
      bgColor: "#FFF3B0",
      isActive: true,
      isOutOfStock: false,
      stockMode: "QUANTITY",
      stockQty: 20,
      sortOrder: 1,
    },
  });
  itemId = item.id;

  const localAddon = await prisma.addonOption.create({
    data: {
      itemId: item.id,
      name: localAddonName,
      priceDelta: new Prisma.Decimal("0.50"),
      stockMode: "QUANTITY",
      stockQty: 20,
      sortOrder: 0,
    },
  });
  localAddonId = localAddon.id;

  const group = await prisma.sharedModifierGroup.create({
    data: {
      outletId,
      name: `Stock add-ons ${runId}`,
      selectionMode: "OPTIONAL_MULTI",
      minSelect: 0,
      maxSelect: 2,
      sortOrder: 0,
      options: {
        create: [
          {
            name: sharedOptionName,
            priceDelta: new Prisma.Decimal("1.25"),
            stockMode: "QUANTITY",
            stockQty: 20,
            lowStockThreshold: 2,
            sortOrder: 0,
          },
          {
            name: zeroOptionName,
            priceDelta: new Prisma.Decimal("0.75"),
            stockMode: "QUANTITY",
            stockQty: 0,
            lowStockThreshold: 2,
            sortOrder: 1,
          },
        ],
      },
    },
    include: { options: true },
  });
  groupId = group.id;
  sharedOptionId = group.options.find((option) => option.name === sharedOptionName)?.id ?? null;
  zeroOptionId = group.options.find((option) => option.name === zeroOptionName)?.id ?? null;
  assert(sharedOptionId, "Tracked shared option was not created.");
  assert(zeroOptionId, "Zero-stock shared option was not created.");

  const link = await prisma.menuItemModifierGroup.create({
    data: {
      outletId,
      menuItemId: item.id,
      modifierGroupId: group.id,
      sortOrder: 0,
    },
  });
  linkId = link.id;

  const productionAuth = await import("@/lib/production-auth");
  const token = productionAuth.createSessionToken();
  await prisma.adminUser.create({
    data: {
      id: ownerUserId,
      email: `${runId}@example.test`,
      displayName: "Add-on Set Stock Owner",
      passwordHash: "unused",
      accountType: "OWNER",
      siteRole: "OWNER",
      mfaEnabledAt: new Date(),
      isActive: true,
      sessions: {
        create: {
          tokenHash: productionAuth.hashSessionToken(token),
          expiresAt: productionAuth.computeAdminSessionExpiry(),
          userAgent: "add-on-set-stock-test",
          ipHash: `${runId}-ip`,
        },
      },
    },
  });
  adminToken = token;
}

async function cleanup() {
  await prisma.stockMovement.deleteMany({
    where: {
      OR: [
        { orderId: { in: orderIds } },
        ...(itemId ? [{ menuItemId: itemId }] : []),
        ...(localAddonId ? [{ addonOptionId: localAddonId }] : []),
        ...(sharedOptionId ? [{ sharedModifierOptionId: sharedOptionId }] : []),
        ...(zeroOptionId ? [{ sharedModifierOptionId: zeroOptionId }] : []),
      ],
    },
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
  if (groupId) await prisma.sharedModifierGroup.deleteMany({ where: { id: groupId } });
  if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.adminSession.deleteMany({ where: { userId: ownerUserId } });
  await prisma.adminUser.deleteMany({ where: { id: ownerUserId } });
}

async function setCoreStock(qty: number) {
  assert(itemId && sharedOptionId && localAddonId, "Fixture ids missing.");
  await Promise.all([
    prisma.menuItem.update({
      where: { id: itemId },
      data: { stockMode: "QUANTITY", stockQty: qty },
    }),
    prisma.sharedModifierOption.update({
      where: { id: sharedOptionId },
      data: { stockMode: "QUANTITY", stockQty: qty },
    }),
    prisma.addonOption.update({
      where: { id: localAddonId },
      data: { stockMode: "QUANTITY", stockQty: qty },
    }),
  ]);
}

async function stockState() {
  assert(itemId && sharedOptionId && localAddonId, "Fixture ids missing.");
  const [item, sharedOption, localAddon] = await Promise.all([
    prisma.menuItem.findUniqueOrThrow({
      where: { id: itemId },
      select: { stockQty: true },
    }),
    prisma.sharedModifierOption.findUniqueOrThrow({
      where: { id: sharedOptionId },
      select: { stockQty: true },
    }),
    prisma.addonOption.findUniqueOrThrow({
      where: { id: localAddonId },
      select: { stockQty: true },
    }),
  ]);
  return {
    item: item.stockQty,
    shared: sharedOption.stockQty,
    localAddon: localAddon.stockQty,
  };
}

async function createPaymentSession(qty: number, optionId = sharedOptionId!, optionPrice = 1.25) {
  assert(itemId && linkId, "Fixture ids missing.");
  const paymentSessionsRoute = await import("@/app/api/payments/sessions/route");
  const response = await paymentSessionsRoute.POST(
    request("kiosk", "POST", "http://localhost/api/payments/sessions", {
      orderType: "TAKEOUT",
      paymentMethod: "CASH",
      expectedTotal: expectedTotal(qty, optionPrice),
      items: [
        {
          menuItemId: itemId,
          qty,
          addOnSetSelections: [
            {
              itemLinkId: linkId,
              optionIds: [optionId],
            },
          ],
        },
      ],
    })
  );
  return { response, body: await json<PaymentSessionBody>(response) };
}

async function createSuccessfulPaymentSession(qty: number) {
  const { response, body } = await createPaymentSession(qty);
  assert.equal(
    response.status,
    201,
    `Expected payment session 201, got ${response.status}: ${body.error ?? ""}`
  );
  assert(body.id, "Payment session id missing.");
  paymentSessionIds.push(body.id);
  return body.id;
}

async function finalizeOrder(paymentSessionId: string) {
  const ordersRoute = await import("@/app/api/orders/route");
  const response = await ordersRoute.POST(
    request("kiosk", "POST", "http://localhost/api/orders", { paymentSessionId })
  );
  return { response, body: await json<OrderBody>(response) };
}

async function finalizeSuccessfulOrder(paymentSessionId: string) {
  const { response, body } = await finalizeOrder(paymentSessionId);
  assert(
    [200, 201].includes(response.status),
    `Expected order finalization 200/201, got ${response.status}: ${body.error ?? ""}`
  );
  assert(body.id, "Order id missing.");
  if (!orderIds.includes(body.id)) orderIds.push(body.id);
  return body.id;
}

function assertFrozenRequirements(
  requirements: StockRequirementSnapshot[],
  qty: number
) {
  assert(itemId && sharedOptionId, "Fixture ids missing.");
  assert.deepEqual(
    requirements
      .map((requirement) => ({
        targetType: requirement.targetType,
        targetId: requirement.targetId,
        qty: requirement.qty,
        source: requirement.source,
        menuItemId: requirement.menuItemId ?? null,
        sharedModifierOptionId: requirement.sharedModifierOptionId ?? null,
        addonOptionId: requirement.addonOptionId ?? null,
      }))
      .sort((a, b) => a.targetType.localeCompare(b.targetType)),
    [
      {
        targetType: "MENU_ITEM",
        targetId: itemId,
        qty,
        source: "NORMAL_ITEM",
        menuItemId: itemId,
        sharedModifierOptionId: null,
        addonOptionId: null,
      },
      {
        targetType: "SHARED_MODIFIER_OPTION",
        targetId: sharedOptionId,
        qty,
        source: "SHARED_MODIFIER_OPTION",
        menuItemId: null,
        sharedModifierOptionId: sharedOptionId,
        addonOptionId: null,
      },
    ],
    "Expected item and shared add-on-set stock requirements to stay distinct."
  );
}

async function loadFrozenRequirements(paymentSessionId: string) {
  const transaction = await prisma.paymentTransaction.findUniqueOrThrow({
    where: { id: paymentSessionId },
    select: { stockRequirementsJson: true },
  });
  assert(Array.isArray(transaction.stockRequirementsJson));
  return transaction.stockRequirementsJson as unknown as StockRequirementSnapshot[];
}

async function assertOrderMovements(orderId: string, qty: number, reason: string) {
  assert(itemId && sharedOptionId && localAddonId, "Fixture ids missing.");
  const movements = await prisma.stockMovement.findMany({
    where: { orderId, reason },
  });
  assert.equal(movements.length, 2, `Expected exactly two ${reason} stock movements.`);
  const byTarget = new Map(
    movements.map((movement) => [`${movement.targetType}:${movement.targetIdSnapshot}`, movement])
  );
  assert.equal(byTarget.size, 2, `Expected two ${reason} stock movements.`);

  const itemMovement = byTarget.get(`MENU_ITEM:${itemId}`);
  assert(itemMovement, "Missing menu item movement.");
  assert.equal(itemMovement.delta, qty);
  assert.equal(itemMovement.menuItemId, itemId);
  assert.equal(itemMovement.addonOptionId, null);
  assert.equal(itemMovement.sharedModifierOptionId, null);

  const sharedMovement = byTarget.get(`SHARED_MODIFIER_OPTION:${sharedOptionId}`);
  assert(sharedMovement, "Missing shared modifier option movement.");
  assert.equal(sharedMovement.delta, qty);
  assert.equal(sharedMovement.menuItemId, null);
  assert.equal(sharedMovement.addonOptionId, null);
  assert.equal(sharedMovement.sharedModifierOptionId, sharedOptionId);

  assert.equal(
    movements.some((movement) => movement.targetType === "ITEM_LOCAL_ADDON"),
    false,
    "Add-on-set stock movement should not be recorded as an item-local add-on movement."
  );
}

async function assertSuccessfulFinalizeAndCancelRestock() {
  await setCoreStock(20);
  const paymentSessionId = await createSuccessfulPaymentSession(2);
  assertFrozenRequirements(await loadFrozenRequirements(paymentSessionId), 2);

  const [first, second] = await Promise.all([
    finalizeOrder(paymentSessionId),
    finalizeOrder(paymentSessionId),
  ]);
  assert(
    [200, 201].includes(first.response.status),
    `First order finalization failed: ${first.body.error ?? ""}`
  );
  assert(
    [200, 201].includes(second.response.status),
    `Second order finalization failed: ${second.body.error ?? ""}`
  );
  assert(first.body.id && second.body.id, "Finalized order ids missing.");
  assert.equal(first.body.id, second.body.id, "Finalization retry must be idempotent.");
  const orderId = first.body.id;
  orderIds.push(orderId);

  assert.deepEqual(await stockState(), {
    item: 18,
    shared: 18,
    localAddon: 20,
  });
  await assertOrderMovements(orderId, -2, "ORDER_PLACED");

  const cancelled = await updateOrderStatus(orderId, "CANCELLED", {
    outletIds: [outletId],
  });
  assert(cancelled, "Cancel status update should find the order.");
  assert.deepEqual(await stockState(), {
    item: 20,
    shared: 20,
    localAddon: 20,
  });
  await assertOrderMovements(orderId, 2, "CASH_ORDER_CANCELLED_RESTOCK");

  const restockCount = await prisma.stockMovement.count({
    where: { orderId, reason: "CASH_ORDER_CANCELLED_RESTOCK" },
  });
  await updateOrderStatus(orderId, "CANCELLED", { outletIds: [outletId] });
  assert.equal(
    await prisma.stockMovement.count({
      where: { orderId, reason: "CASH_ORDER_CANCELLED_RESTOCK" },
    }),
    restockCount,
    "Repeated cancellation must not double-return shared add-on-set stock."
  );
  assert.deepEqual(await stockState(), {
    item: 20,
    shared: 20,
    localAddon: 20,
  });
}

async function assertStaleSharedOptionRejectsFinalization() {
  assert(sharedOptionId, "sharedOptionId missing.");
  await setCoreStock(20);
  const paymentSessionId = await createSuccessfulPaymentSession(2);
  const movementCountBefore = await prisma.stockMovement.count({
    where: { targetIdSnapshot: sharedOptionId },
  });

  await prisma.sharedModifierOption.update({
    where: { id: sharedOptionId },
    data: { stockQty: 1 },
  });

  const { response, body } = await finalizeOrder(paymentSessionId);
  assert.equal(response.status, 409);
  assert.equal(body.errorCode, "MENU_STOCK_UNAVAILABLE");
  assert.equal(body.items?.[0]?.targetType, "SHARED_MODIFIER_OPTION");
  assert.equal(body.items?.[0]?.targetId, sharedOptionId);
  assert.equal(body.items?.[0]?.requestedQty, 2);
  assert.equal(body.items?.[0]?.availableQty, 1);

  const transaction = await prisma.paymentTransaction.findUniqueOrThrow({
    where: { id: paymentSessionId },
    select: { orderId: true, finalizedOrderId: true },
  });
  assert.equal(transaction.orderId, null);
  assert.equal(transaction.finalizedOrderId, null);
  assert.deepEqual(await stockState(), {
    item: 20,
    shared: 1,
    localAddon: 20,
  });
  assert.equal(
    await prisma.stockMovement.count({ where: { targetIdSnapshot: sharedOptionId } }),
    movementCountBefore,
    "Rejected stale finalization must not create shared add-on-set stock movements."
  );
}

async function assertZeroSharedOptionRejectsCheckout() {
  assert(zeroOptionId, "zeroOptionId missing.");
  const { response, body } = await createPaymentSession(1, zeroOptionId, 0.75);
  assert.equal(response.status, 409);
  assert.equal(body.errorCode, "MENU_STOCK_UNAVAILABLE");
  assert.match(body.error ?? "", /size or add-on/i);
}

async function assertRefundReturnStockRestoresSharedOption() {
  assert(adminToken, "admin token missing.");
  await setCoreStock(20);
  const paymentSessionId = await createSuccessfulPaymentSession(3);
  const orderId = await finalizeSuccessfulOrder(paymentSessionId);
  assert.deepEqual(await stockState(), {
    item: 17,
    shared: 17,
    localAddon: 20,
  });

  const paid = await updateOrderStatus(orderId, "PAID", { outletIds: [outletId] });
  assert(paid, "Paid status update should find the order.");

  const refundRoute = await import("@/app/api/admin/orders/[id]/refund/route");
  const refundResponse = await refundRoute.POST(
    adminRequest(`/api/admin/orders/${orderId}/refund`, adminToken),
    { params: Promise.resolve({ id: orderId }) }
  );
  const refundBody = await json<{ ok?: boolean; error?: string }>(refundResponse);
  assert.equal(
    refundResponse.status,
    200,
    `Expected refund 200, got ${refundResponse.status}: ${refundBody.error ?? ""}`
  );
  assert.equal(refundBody.ok, true);
  assert.deepEqual(
    await stockState(),
    { item: 17, shared: 17, localAddon: 20 },
    "Refund itself should not return quantity stock."
  );

  const returnRoute = await import("@/app/api/admin/orders/[id]/return-stock/route");
  const returnResponse = await returnRoute.POST(
    adminRequest(`/api/admin/orders/${orderId}/return-stock`, adminToken),
    { params: Promise.resolve({ id: orderId }) }
  );
  const returnBody = await json<{
    ok?: boolean;
    changed?: boolean;
    returnedItems?: Array<{ targetType: string; targetId: string; qty: number }>;
    alreadyReturned?: boolean;
    error?: string;
  }>(returnResponse);
  assert.equal(
    returnResponse.status,
    200,
    `Expected return-stock 200, got ${returnResponse.status}: ${returnBody.error ?? ""}`
  );
  assert.equal(returnBody.ok, true);
  assert.equal(returnBody.changed, true);
  assert.deepEqual(
    returnBody.returnedItems
      ?.map((item) => ({ targetType: item.targetType, targetId: item.targetId, qty: item.qty }))
      .sort((a, b) => a.targetType.localeCompare(b.targetType)),
    [
      { targetType: "MENU_ITEM", targetId: itemId!, qty: 3 },
      { targetType: "SHARED_MODIFIER_OPTION", targetId: sharedOptionId!, qty: 3 },
    ]
  );
  assert.deepEqual(await stockState(), {
    item: 20,
    shared: 20,
    localAddon: 20,
  });

  const secondReturnResponse = await returnRoute.POST(
    adminRequest(`/api/admin/orders/${orderId}/return-stock`, adminToken),
    { params: Promise.resolve({ id: orderId }) }
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
    `Expected second return-stock 200, got ${secondReturnResponse.status}: ${secondReturnBody.error ?? ""}`
  );
  assert.equal(secondReturnBody.ok, true);
  assert.equal(secondReturnBody.changed, false);
  assert.equal(secondReturnBody.alreadyReturned, true);
  assert.deepEqual(
    await stockState(),
    { item: 20, shared: 20, localAddon: 20 },
    "Repeated return-stock must not double-return shared add-on-set stock."
  );
}

async function main() {
  await cleanup();
  await seed();
  await assertSuccessfulFinalizeAndCancelRestock();
  await assertStaleSharedOptionRejectsFinalization();
  await assertZeroSharedOptionRejectsCheckout();
  await assertRefundReturnStockRestoresSharedOption();
  console.log("Add-on set stock finalization tests passed.");
}

main()
  .then(async () => {
    await cleanup();
  })
  .catch(async (err) => {
    await cleanup().catch(() => {});
    console.error("Add-on set stock finalization tests failed.");
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
