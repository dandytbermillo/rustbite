/* eslint-disable no-console */
import "dotenv/config";

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import {
  DEAL_LIMIT_TARGET_TYPE,
  DealLimitUnavailableError,
  checkoutSnapshotHasDealLines,
  dealLimitLinesFromCheckoutSnapshot,
  decrementOrderDealLimits,
  restockCancelledOrderDealLimits,
  returnOrderDealLimits,
} from "@/lib/deal-selling-limits";
import { prisma } from "@/lib/db";

const nodeRequire = createRequire(import.meta.url);
const runId = `deal-limit-${Date.now()}`;
const siteId = `${runId}-site`;
const outletId = `${runId}-outlet`;
const dealsSlug = "deals";
const adminEmail = `${runId}-admin@example.test`;
let dealsCategoryId: string | null = null;
let normalCategoryId: string | null = null;
let limitedDealId: string | null = null;
let unlimitedDealId: string | null = null;
let normalItemId: string | null = null;
const orderIds: string[] = [];

type EditorContextRouteModules = {
  editorContextRoute: typeof import("@/app/api/admin/workspace/menu/editor-context/route");
  productionAuth: typeof import("@/lib/production-auth");
};

type JsonObject = Record<string, unknown>;

function stubServerOnly() {
  const serverOnlyPath = nodeRequire.resolve("server-only");
  nodeRequire.cache[serverOnlyPath] = {
    id: serverOnlyPath,
    filename: serverOnlyPath,
    loaded: true,
    exports: {},
    children: [],
    paths: [],
  } as unknown as NodeJS.Module;
}

async function loadEditorContextRouteModules(): Promise<EditorContextRouteModules> {
  stubServerOnly();
  const [editorContextRoute, productionAuth] = await Promise.all([
    import("@/app/api/admin/workspace/menu/editor-context/route"),
    import("@/lib/production-auth"),
  ]);

  return { editorContextRoute, productionAuth };
}

function cookieHeader(cookies: Record<string, string | null | undefined>) {
  return Object.entries(cookies)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join("; ");
}

function routeRequest({
  path,
  sessionToken,
  activeOutletId,
}: {
  path: string;
  sessionToken: string;
  activeOutletId: string;
}) {
  return new NextRequest(`http://localhost${path}`, {
    method: "GET",
    headers: {
      cookie: cookieHeader({
        rb_admin_session: sessionToken,
        rb_admin_active_outlet: activeOutletId,
      }),
    },
  });
}

async function readJsonResponse(response: Response): Promise<JsonObject> {
  const text = await response.text();
  return JSON.parse(text) as JsonObject;
}

function dealSnapshot(
  dealId: string,
  qty: number,
  selectedUpgradeOptionId = `${runId}-upgrade`,
) {
  return {
    items: [
      {
        lineKind: "DEAL",
        menuItemId: dealId,
        qty,
        selectedUpgradeOptionId,
      },
    ],
  };
}

async function createOrder(status = "PAID") {
  const order = await prisma.order.create({
    data: {
      orderNumber: `${runId}-${orderIds.length + 1}`,
      outletId,
      kioskId: "kiosk-test",
      orderType: "TAKEOUT",
      status,
      subtotal: new Prisma.Decimal("0.00"),
      gst: new Prisma.Decimal("0.00"),
      total: new Prisma.Decimal("0.00"),
      paymentMethod: "CASH",
      paymentProvider: "COUNTER",
      paymentStatus: status === "PAID" ? "CAPTURED" : "PENDING_COUNTER_PAYMENT",
    },
  });
  orderIds.push(order.id);
  return order;
}

async function seed() {
  await prisma.site.create({
    data: {
      id: siteId,
      name: "Deal Limit Test",
      timezone: "America/Edmonton",
    },
  });
  await prisma.outlet.create({
    data: {
      id: outletId,
      siteId,
      name: "Deal Limit Test Outlet",
      slug: outletId,
      orderPrefix: `DL${Date.now().toString().slice(-4)}`,
      isActive: true,
    },
  });
  const [dealsCategory, normalCategory] = await Promise.all([
    prisma.category.create({
      data: {
        outletId,
        slug: dealsSlug,
        name: "Deals",
        icon: "D",
        sortOrder: 0,
        isActive: true,
      },
    }),
    prisma.category.create({
      data: {
        outletId,
        slug: `items-${runId}`,
        name: "Items",
        icon: "I",
        sortOrder: 1,
        isActive: true,
      },
    }),
  ]);
  dealsCategoryId = dealsCategory.id;
  normalCategoryId = normalCategory.id;

  const [limitedDeal, unlimitedDeal, normalItem] = await Promise.all([
    prisma.menuItem.create({
      data: {
        outletId,
        categoryId: dealsCategory.id,
        name: `Limited Deal ${runId}`,
        description: "Limited deal fixture",
        price: new Prisma.Decimal("8.99"),
        emoji: "D",
        bgColor: "#fff5cc",
        isActive: true,
        isOutOfStock: false,
        stockMode: "MANUAL",
        dealLimitMode: "LIMITED",
        dealLimitQty: 10,
        dealLimitLowThreshold: 2,
        sortOrder: 0,
      },
    }),
    prisma.menuItem.create({
      data: {
        outletId,
        categoryId: dealsCategory.id,
        name: `Unlimited Deal ${runId}`,
        description: "Unlimited deal fixture",
        price: new Prisma.Decimal("7.99"),
        emoji: "U",
        bgColor: "#fff5cc",
        isActive: true,
        isOutOfStock: false,
        stockMode: "MANUAL",
        dealLimitMode: "UNLIMITED",
        dealLimitQty: 20,
        dealLimitLowThreshold: 3,
        sortOrder: 1,
      },
    }),
    prisma.menuItem.create({
      data: {
        outletId,
        categoryId: normalCategory.id,
        name: `Normal Item ${runId}`,
        description: "Normal item fixture",
        price: new Prisma.Decimal("5.00"),
        emoji: "N",
        bgColor: "#ffffff",
        isActive: true,
        isOutOfStock: false,
        stockMode: "MANUAL",
        sortOrder: 0,
      },
    }),
  ]);
  limitedDealId = limitedDeal.id;
  unlimitedDealId = unlimitedDeal.id;
  normalItemId = normalItem.id;
}

async function createAdminSessionForEditorContext(
  productionAuth: EditorContextRouteModules["productionAuth"],
) {
  const adminUser = await prisma.adminUser.create({
    data: {
      email: adminEmail,
      displayName: "Deal Limit Editor Context Admin",
      passwordHash: "test-password-hash",
      accountType: "STAFF",
      siteRole: null,
      isActive: true,
      outletRoles: {
        create: {
          outletId,
          role: "MANAGER",
        },
      },
    },
  });

  const token = productionAuth.createSessionToken();
  await prisma.adminSession.create({
    data: {
      userId: adminUser.id,
      tokenHash: productionAuth.hashSessionToken(token),
      expiresAt: productionAuth.computeAdminSessionExpiry(),
      userAgent: "deal-limit-editor-context-test",
      ipHash: `${runId}-ip`,
    },
  });

  return token;
}

async function cleanup() {
  await prisma.adminSession.deleteMany({
    where: { user: { email: adminEmail } },
  });
  await prisma.adminUser.deleteMany({
    where: { email: adminEmail },
  });
  await prisma.stockMovement.deleteMany({
    where: {
      OR: [
        { outletId },
        { orderId: { in: orderIds } },
        ...(limitedDealId ? [{ menuItemId: limitedDealId }] : []),
        ...(unlimitedDealId ? [{ menuItemId: unlimitedDealId }] : []),
      ],
    },
  });
  if (orderIds.length) {
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  }
  if (limitedDealId || unlimitedDealId || normalItemId) {
    await prisma.menuItem.deleteMany({
      where: {
        id: {
          in: [limitedDealId, unlimitedDealId, normalItemId].filter(
            (id): id is string => Boolean(id),
          ),
        },
      },
    });
  }
  if (dealsCategoryId || normalCategoryId) {
    await prisma.category.deleteMany({
      where: {
        id: {
          in: [dealsCategoryId, normalCategoryId].filter(
            (id): id is string => Boolean(id),
          ),
        },
      },
    });
  }
  await prisma.outletMenuVersion.deleteMany({ where: { outletId } });
  await prisma.outlet.deleteMany({ where: { id: outletId } });
  await prisma.site.deleteMany({ where: { id: siteId } });
}

async function assertHelpers() {
  assert.equal(
    checkoutSnapshotHasDealLines({
      items: [{ lineKind: "ITEM", menuItemId: "item-1", qty: 1 }],
    }),
    false,
  );
  assert.equal(
    checkoutSnapshotHasDealLines({
      items: [{ selectedUpgradeOptionId: "legacy-upgrade" }],
    }),
    true,
    "External payment guard must still detect old deal cart snapshots.",
  );
  assert.deepEqual(
    dealLimitLinesFromCheckoutSnapshot({
      items: [
        { lineKind: "DEAL", menuItemId: "deal-1", qty: 2 },
        { lineKind: "ITEM", menuItemId: "item-1", qty: 99 },
        { lineKind: "DEAL", menuItemId: "deal-1", qty: 3 },
      ],
    }),
    [{ menuItemId: "deal-1", qty: 5 }],
    "Current deal snapshots should aggregate line quantities by deal id.",
  );
  assert.deepEqual(
    dealLimitLinesFromCheckoutSnapshot({
      items: [{ selectedUpgradeOptionId: "legacy-upgrade", qty: 2 }],
    }),
    [],
    "Old deal snapshots are blocked from external payment but not decremented without lineKind.",
  );
  assert.throws(
    () =>
      dealLimitLinesFromCheckoutSnapshot({
        items: [{ lineKind: "DEAL", qty: 1 }],
      }),
    DealLimitUnavailableError,
  );
}

async function assertEditorContextIncludesDealLimitFields() {
  assert(limitedDealId, "limitedDealId missing.");
  assert(unlimitedDealId, "unlimitedDealId missing.");
  const modules = await loadEditorContextRouteModules();
  const sessionToken = await createAdminSessionForEditorContext(
    modules.productionAuth,
  );

  const response = await modules.editorContextRoute.GET(
    routeRequest({
      path: "/api/admin/workspace/menu/editor-context",
      sessionToken,
      activeOutletId: outletId,
    }),
  );
  assert.equal(response.status, 200, "Editor context route should succeed.");
  const json = await readJsonResponse(response);
  const items = json.items as Array<JsonObject>;
  const limitedDeal = items.find((item) => item.id === limitedDealId);
  assert(limitedDeal, "Editor context should include the limited deal.");
  assert.equal(
    limitedDeal.dealLimitMode,
    "LIMITED",
    "Editor context must preserve limited deal mode for the deal editor.",
  );
  assert.equal(
    limitedDeal.dealLimitQty,
    10,
    "Editor context must preserve limited deal remaining quantity.",
  );
  assert.equal(
    limitedDeal.dealLimitLowThreshold,
    2,
    "Editor context must preserve limited deal low-alert threshold.",
  );
  assert(
    Object.prototype.hasOwnProperty.call(limitedDeal, "dealLimitUpdatedAt"),
    "Editor context must expose dealLimitUpdatedAt, even when null.",
  );
  assert(
    Object.prototype.hasOwnProperty.call(limitedDeal, "dealLimitUpdatedById"),
    "Editor context must expose dealLimitUpdatedById, even when null.",
  );

  const unlimitedDeal = items.find((item) => item.id === unlimitedDealId);
  assert(unlimitedDeal, "Editor context should include the unlimited deal.");
  assert.equal(
    unlimitedDeal.dealLimitMode,
    "UNLIMITED",
    "Editor context must preserve unlimited deal mode.",
  );
  assert.equal(
    unlimitedDeal.dealLimitQty,
    20,
    "Editor context should expose stored unlimited quantity without enabling limits.",
  );
}

async function assertLimitedDealDecrementAndManualReturn() {
  assert(limitedDealId, "limitedDealId missing.");
  const order = await createOrder("PAID");
  await prisma.$transaction((tx) =>
    decrementOrderDealLimits(tx, {
      outletId,
      orderId: order.id,
      snapshot: {
        items: [
          { lineKind: "DEAL", menuItemId: limitedDealId, qty: 2 },
          { lineKind: "DEAL", menuItemId: limitedDealId, qty: 3 },
        ],
      },
    }),
  );

  const afterPlaced = await prisma.menuItem.findUniqueOrThrow({
    where: { id: limitedDealId },
    select: { dealLimitQty: true, lockVersion: true },
  });
  assert.equal(afterPlaced.dealLimitQty, 5);
  assert.equal(afterPlaced.lockVersion, 1);

  const placedMovements = await prisma.stockMovement.findMany({
    where: {
      orderId: order.id,
      targetType: DEAL_LIMIT_TARGET_TYPE,
      reason: "ORDER_PLACED",
    },
  });
  assert.equal(placedMovements.length, 1);
  assert.equal(placedMovements[0]?.delta, -5);
  assert.equal(placedMovements[0]?.beforeQty, 10);
  assert.equal(placedMovements[0]?.afterQty, 5);
  assert.equal(placedMovements[0]?.menuItemId, limitedDealId);

  const returned = await prisma.$transaction((tx) =>
    returnOrderDealLimits(tx, {
      outletId,
      orderId: order.id,
      actor: { actorType: "ADMIN_USER", actorId: "deal-limit-test" },
    }),
  );
  assert.equal(returned.changed, true);
  assert.deepEqual(returned.returnedItems.map((item) => item.qty), [5]);
  assert.equal(
    (
      await prisma.menuItem.findUniqueOrThrow({
        where: { id: limitedDealId },
        select: { dealLimitQty: true },
      })
    ).dealLimitQty,
    10,
  );

  const returnMovementCount = await prisma.stockMovement.count({
    where: {
      orderId: order.id,
      targetType: DEAL_LIMIT_TARGET_TYPE,
      reason: "ORDER_RETURNED_STOCK",
    },
  });
  const secondReturn = await prisma.$transaction((tx) =>
    returnOrderDealLimits(tx, {
      outletId,
      orderId: order.id,
      actor: { actorType: "ADMIN_USER", actorId: "deal-limit-test" },
    }),
  );
  assert.equal(secondReturn.changed, false);
  assert.equal(
    await prisma.stockMovement.count({
      where: {
        orderId: order.id,
        targetType: DEAL_LIMIT_TARGET_TYPE,
        reason: "ORDER_RETURNED_STOCK",
      },
    }),
    returnMovementCount,
    "Manual deal-limit return must be idempotent.",
  );
}

async function assertSoldOutRejectsWithoutMovement() {
  assert(limitedDealId, "limitedDealId missing.");
  const dealId = limitedDealId;
  await prisma.menuItem.update({
    where: { id: dealId },
    data: { dealLimitQty: 1 },
  });
  const order = await createOrder("PAID");
  const movementCountBefore = await prisma.stockMovement.count({
    where: { orderId: order.id, targetType: DEAL_LIMIT_TARGET_TYPE },
  });

  await assert.rejects(
    prisma.$transaction((tx) =>
      decrementOrderDealLimits(tx, {
        outletId,
        orderId: order.id,
        snapshot: dealSnapshot(dealId, 2),
      }),
    ),
    (err) =>
      err instanceof DealLimitUnavailableError &&
      err.items[0]?.targetType === DEAL_LIMIT_TARGET_TYPE &&
      err.items[0]?.requestedQty === 2 &&
      err.items[0]?.availableQty === 1,
  );
  assert.equal(
    (
      await prisma.menuItem.findUniqueOrThrow({
        where: { id: dealId },
        select: { dealLimitQty: true },
      })
    ).dealLimitQty,
    1,
  );
  assert.equal(
    await prisma.stockMovement.count({
      where: { orderId: order.id, targetType: DEAL_LIMIT_TARGET_TYPE },
    }),
    movementCountBefore,
    "Rejected deal-limit finalization must not create movement rows.",
  );
}

async function assertUnlimitedAndNonDealBehavior() {
  assert(unlimitedDealId && normalItemId, "fixture ids missing.");
  const unlimitedDeal = unlimitedDealId;
  const normalItem = normalItemId;
  const unlimitedOrder = await createOrder("PAID");
  await prisma.$transaction((tx) =>
    decrementOrderDealLimits(tx, {
      outletId,
      orderId: unlimitedOrder.id,
      snapshot: dealSnapshot(unlimitedDeal, 4),
    }),
  );
  const persistedUnlimitedDeal = await prisma.menuItem.findUniqueOrThrow({
    where: { id: unlimitedDeal },
    select: { dealLimitMode: true, dealLimitQty: true, lockVersion: true },
  });
  assert.equal(persistedUnlimitedDeal.dealLimitMode, "UNLIMITED");
  assert.equal(persistedUnlimitedDeal.dealLimitQty, 20);
  assert.equal(persistedUnlimitedDeal.lockVersion, 0);
  assert.equal(
    await prisma.stockMovement.count({
      where: {
        orderId: unlimitedOrder.id,
        targetType: DEAL_LIMIT_TARGET_TYPE,
      },
    }),
    0,
    "Unlimited deals must not create deal-limit stock movements.",
  );

  const invalidOrder = await createOrder("PAID");
  await assert.rejects(
    prisma.$transaction((tx) =>
      decrementOrderDealLimits(tx, {
        outletId,
        orderId: invalidOrder.id,
        snapshot: dealSnapshot(normalItem, 1),
      }),
    ),
    DealLimitUnavailableError,
  );
}

async function assertCancelRestock() {
  assert(limitedDealId, "limitedDealId missing.");
  const dealId = limitedDealId;
  await prisma.menuItem.update({
    where: { id: dealId },
    data: { dealLimitQty: 8 },
  });
  const order = await createOrder("AWAITING_COUNTER_PAYMENT");
  await prisma.$transaction((tx) =>
    decrementOrderDealLimits(tx, {
      outletId,
      orderId: order.id,
      snapshot: dealSnapshot(dealId, 3),
    }),
  );
  assert.equal(
    (
      await prisma.menuItem.findUniqueOrThrow({
        where: { id: dealId },
        select: { dealLimitQty: true },
      })
    ).dealLimitQty,
    5,
  );

  const cancelled = await prisma.$transaction((tx) =>
    restockCancelledOrderDealLimits(tx, {
      outletId,
      orderId: order.id,
      previousStatus: "AWAITING_COUNTER_PAYMENT",
      nextStatus: "CANCELLED",
      productionStartedAt: null,
    }),
  );
  assert.equal(cancelled.changed, true);
  assert.equal(
    (
      await prisma.menuItem.findUniqueOrThrow({
        where: { id: dealId },
        select: { dealLimitQty: true },
      })
    ).dealLimitQty,
    8,
  );
  const restockCount = await prisma.stockMovement.count({
    where: {
      orderId: order.id,
      targetType: DEAL_LIMIT_TARGET_TYPE,
      reason: "CASH_ORDER_CANCELLED_RESTOCK",
    },
  });

  const secondCancel = await prisma.$transaction((tx) =>
    restockCancelledOrderDealLimits(tx, {
      outletId,
      orderId: order.id,
      previousStatus: "AWAITING_COUNTER_PAYMENT",
      nextStatus: "CANCELLED",
      productionStartedAt: null,
    }),
  );
  assert.equal(secondCancel.changed, false);
  assert.equal(
    await prisma.stockMovement.count({
      where: {
        orderId: order.id,
        targetType: DEAL_LIMIT_TARGET_TYPE,
        reason: "CASH_ORDER_CANCELLED_RESTOCK",
      },
    }),
    restockCount,
    "Cancelled deal-limit restock must be idempotent.",
  );
}

async function run() {
  await assertHelpers();
  await seed();
  try {
    await assertEditorContextIncludesDealLimitFields();
    await assertLimitedDealDecrementAndManualReturn();
    await assertSoldOutRejectsWithoutMovement();
    await assertUnlimitedAndNonDealBehavior();
    await assertCancelRestock();
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

run()
  .then(() => {
    console.log("test-deal-selling-limit passed");
  })
  .catch(async (err) => {
    console.error(err);
    await cleanup().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(1);
  });
