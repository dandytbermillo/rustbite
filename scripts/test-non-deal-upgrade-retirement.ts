/* eslint-disable no-console */
import { Prisma } from "@prisma/client";
import { createRequire } from "module";
import { NextRequest } from "next/server";
import "dotenv/config";
import { hashAdminPassword } from "@/lib/admin-passwords";
import { DEVICE_SESSION_COOKIE } from "@/lib/device-auth";
import { prisma } from "@/lib/db";
import type { MenuSnapshot } from "@/lib/menu-history";

const require = createRequire(import.meta.url);
const runId = `nondeal-upgrades-${Date.now()}`;
const outletId = `outlet-${runId}`;
const nonDealCategoryId = `cat-${runId}-burgers`;
const dealsCategoryId = `cat-${runId}-deals`;
const baseItemId = `item-${runId}-base`;
const linkedItemId = `item-${runId}-linked`;
const dealItemId = `item-${runId}-deal`;
const legacyUpgradeId = `upgrade-${runId}-legacy`;
const dealUpgradeId = `upgrade-${runId}-deal`;
const restoreNonDealItemId = `item-${runId}-restore-nondeal`;
const restoreDealItemId = `item-${runId}-restore-deal`;
const restoreExistingQtyItemId = `item-${runId}-restore-existing-qty`;
const restoreNewQtyItemId = `item-${runId}-restore-new-qty`;
const ownerEmail = `${runId}-owner@example.test`;
const ADMIN_ACTIVE_OUTLET_COOKIE = "rb_admin_active_outlet";
let adminToken: string | null = null;
let kioskToken: string | null = null;
let deviceId: string | null = null;

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

function adminRequest(method: string, url: string, body?: Record<string, unknown>) {
  assert(adminToken, "Admin token has not been created.");
  return new NextRequest(url, {
    method,
    headers: {
      cookie: `rb_admin_session=${adminToken}; ${ADMIN_ACTIVE_OUTLET_COOKIE}=${outletId}`,
      origin: "http://localhost",
      referer: "http://localhost/admin/menu",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function kioskRequest(method: string, url: string, body?: Record<string, unknown>) {
  assert(kioskToken, "Kiosk token has not been created.");
  return new NextRequest(url, {
    method,
    headers: {
      cookie: `${DEVICE_SESSION_COOKIE}=db:kiosk:${kioskToken}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function itemPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    categoryId: nonDealCategoryId,
    comboNum: null,
    name: `Test Burger ${runId}`,
    description: "Temporary non-deal item for upgrade retirement regression.",
    price: 10,
    emoji: "🍔",
    bgColor: "#fff3b0",
    badge: null,
    bundleSavings: null,
    dealExpiresAt: null,
    imageUrl: null,
    imageAlt: null,
    imageFit: "COVER",
    cardImageUrl: null,
    cardImageAlt: null,
    isActive: true,
    isOutOfStock: false,
    sortOrder: 9999,
    sizes: [],
    addons: [],
    upgradeOptions: [],
    ...overrides,
  };
}

async function cleanup() {
  if (deviceId) {
    await prisma.deviceSession.deleteMany({ where: { deviceId } });
    await prisma.device.deleteMany({ where: { id: deviceId } });
  }

  const owner = await prisma.adminUser.findUnique({
    where: { email: ownerEmail },
    select: { id: true },
  });
  if (owner) {
    await prisma.adminSession.deleteMany({ where: { userId: owner.id } });
    await prisma.adminUser.deleteMany({ where: { id: owner.id } });
  }

  await prisma.paymentTransaction.deleteMany({ where: { outletId } });
  await prisma.menuAuditLog.deleteMany({ where: { outletId } });
  await prisma.menuRevision.deleteMany({ where: { outletId } });
  await prisma.menuHistoryState.deleteMany({ where: { outletId } });
  await prisma.upgradeItemLink.deleteMany({
    where: { upgradeOption: { item: { outletId } } },
  });
  await prisma.upgradeOption.deleteMany({ where: { item: { outletId } } });
  await prisma.sizeOption.deleteMany({ where: { item: { outletId } } });
  await prisma.addonOption.deleteMany({ where: { item: { outletId } } });
  await prisma.menuItem.deleteMany({ where: { outletId } });
  await prisma.category.deleteMany({ where: { outletId } });
  await prisma.outletSettings.deleteMany({ where: { outletId } });
  await prisma.outlet.deleteMany({ where: { id: outletId } });
}

async function seed() {
  const productionAuth = await import("@/lib/production-auth");

  await prisma.site.upsert({
    where: { id: "site" },
    update: {},
    create: { id: "site", name: "Rushbite", timezone: "America/Edmonton" },
  });
  await prisma.outlet.create({
    data: {
      id: outletId,
      siteId: "site",
      name: `Non-deal upgrade test ${runId}`,
      slug: outletId,
      orderPrefix: `N${Date.now()}`,
      isActive: true,
    },
  });
  await prisma.category.createMany({
    data: [
      {
        id: nonDealCategoryId,
        outletId,
        slug: "burgers",
        name: "Burgers",
        icon: "🍔",
        sortOrder: 1,
        isActive: true,
      },
      {
        id: dealsCategoryId,
        outletId,
        slug: "deals",
        name: "Deals",
        icon: "🔥",
        sortOrder: 2,
        isActive: true,
      },
    ],
  });
  await prisma.menuItem.createMany({
    data: [
      {
        id: linkedItemId,
        outletId,
        categoryId: nonDealCategoryId,
        name: `Linked Fries ${runId}`,
        description: "Available linked item.",
        price: new Prisma.Decimal("3.00"),
        emoji: "🍟",
        bgColor: "#fff3b0",
        isActive: true,
        isOutOfStock: false,
        sortOrder: 1,
      },
      {
        id: baseItemId,
        outletId,
        categoryId: nonDealCategoryId,
        name: `Legacy Burger ${runId}`,
        description: "Non-deal item with stale upgrade rows.",
        price: new Prisma.Decimal("10.00"),
        emoji: "🍔",
        bgColor: "#fff3b0",
        isActive: true,
        isOutOfStock: false,
        sortOrder: 2,
      },
      {
        id: dealItemId,
        outletId,
        categoryId: dealsCategoryId,
        name: `Deal Burger ${runId}`,
        description: "Deal item with valid deal option.",
        price: new Prisma.Decimal("0.00"),
        emoji: "🔥",
        bgColor: "#fff3b0",
        badge: "DEAL",
        dealExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        isActive: true,
        isOutOfStock: false,
        sortOrder: 3,
      },
    ],
  });
  await prisma.upgradeOption.create({
    data: {
      id: legacyUpgradeId,
      itemId: baseItemId,
      extraCharge: new Prisma.Decimal("3.00"),
      savingsLabel: new Prisma.Decimal("1.00"),
      sortOrder: 0,
      linkedItems: {
        create: {
          linkedMenuItemId: linkedItemId,
          itemNameSnapshot: `Linked Fries ${runId}`,
          sortOrder: 0,
        },
      },
    },
  });
  await prisma.upgradeOption.create({
    data: {
      id: dealUpgradeId,
      itemId: dealItemId,
      extraCharge: new Prisma.Decimal("3.00"),
      savingsLabel: new Prisma.Decimal("1.00"),
      sortOrder: 0,
      linkedItems: {
        create: {
          linkedMenuItemId: linkedItemId,
          itemNameSnapshot: `Linked Fries ${runId}`,
          sortOrder: 0,
        },
      },
    },
  });

  const owner = await prisma.adminUser.create({
    data: {
      email: ownerEmail,
      displayName: "Non-deal Upgrade Test Owner",
      passwordHash: await hashAdminPassword("owner-password-14chars"),
      accountType: "OWNER",
      siteRole: "OWNER",
      isActive: true,
      mfaEnabledAt: new Date(),
    },
  });
  adminToken = productionAuth.createSessionToken();
  await prisma.adminSession.create({
    data: {
      userId: owner.id,
      tokenHash: productionAuth.hashSessionToken(adminToken),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      stepUpVerifiedAt: new Date(),
      stepUpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  deviceId = `device-${runId}`;
  await prisma.device.create({
    data: {
      id: deviceId,
      siteId: "site",
      outletId,
      name: `Kiosk ${runId}`,
      role: "kiosk",
      secretHash: "unused",
      isActive: true,
    },
  });
  kioskToken = productionAuth.createSessionToken();
  await prisma.deviceSession.create({
    data: {
      deviceId,
      tokenHash: productionAuth.hashSessionToken(kioskToken),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
}

async function main() {
  stubServerOnly();
  const [menuRoute, paymentsRoute, adminItemsRoute, adminItemRoute, menuHistory] =
    await Promise.all([
      import("@/app/api/menu/route"),
      import("@/app/api/payments/sessions/route"),
      import("@/app/api/admin/items/route"),
      import("@/app/api/admin/items/[id]/route"),
      import("@/lib/menu-history"),
    ]);

  await cleanup();
  await seed();

  const menuResponse = await menuRoute.GET(
    kioskRequest("GET", "http://localhost/api/menu")
  );
  assertEqual(menuResponse.status, 200, "Kiosk menu should load.");
  const menuJson = await json<{
    items: Array<{ id: string; upgradeOptions: unknown[] }>;
  }>(menuResponse);
  assertEqual(
    menuJson.items.find((item) => item.id === baseItemId)?.upgradeOptions.length,
    0,
    "/api/menu should hide legacy non-deal upgrade options."
  );
  assertEqual(
    menuJson.items.find((item) => item.id === dealItemId)?.upgradeOptions.length,
    1,
    "/api/menu should keep valid deal options."
  );

  const staleCheckout = await paymentsRoute.POST(
    kioskRequest("POST", "http://localhost/api/payments/sessions", {
      orderType: "TAKEOUT",
      paymentMethod: "CASH",
      expectedTotal: 0,
      items: [
        {
          menuItemId: baseItemId,
          selectedUpgradeOptionId: legacyUpgradeId,
          qty: 1,
        },
      ],
    })
  );
  const staleCheckoutJson = await json<{ errorCode?: string }>(staleCheckout);
  assertEqual(staleCheckout.status, 409, "Checkout should reject non-deal upgrades.");
  assertEqual(
    staleCheckoutJson.errorCode,
    "MENU_MODIFIER_INVALID",
    "Checkout should return stale-cart modifier error."
  );

  const adminList = await adminItemsRoute.GET(
    adminRequest("GET", "http://localhost/api/admin/items")
  );
  assertEqual(adminList.status, 200, "Admin item list should load.");
  const adminListJson = await json<{
    items: Array<{ id: string; upgradeOptions: unknown[] }>;
  }>(adminList);
  assertEqual(
    adminListJson.items.find((item) => item.id === baseItemId)?.upgradeOptions.length,
    0,
    "Admin item API should serialize non-deal upgrades as empty."
  );

  const rejectedCreate = await adminItemsRoute.POST(
    adminRequest("POST", "http://localhost/api/admin/items", {
      ...itemPayload({
        name: `Bad Non-deal Create ${runId}`,
        upgradeOptions: [
          {
            customTitle: null,
            extraCharge: 3,
            savingsLabel: 1,
            discountPct: null,
            sortOrder: 0,
            linkedItems: [{ linkedMenuItemId: linkedItemId, sortOrder: 0 }],
          },
        ],
      }),
    })
  );
  const rejectedCreateJson = await json<{ errorCode?: string }>(rejectedCreate);
  assertEqual(rejectedCreate.status, 400, "Admin create should reject non-deal upgrades.");
  assertEqual(
    rejectedCreateJson.errorCode,
    "non_deal_upgrade_options_not_allowed",
    "Admin create should use the non-deal upgrade error code."
  );

  const craftedDealName = `Crafted Stock Deal ${runId}`;
  const stockMovementsBeforeCraftedDeal = await prisma.stockMovement.count({
    where: { outletId },
  });
  const craftedDealCreate = await adminItemsRoute.POST(
    adminRequest("POST", "http://localhost/api/admin/items", {
      ...itemPayload({
        categoryId: dealsCategoryId,
        name: craftedDealName,
        description: "Crafted payload should not make a deal shell quantity-tracked.",
        badge: "DEAL",
        dealBaseMenuItemId: baseItemId,
        dealExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        isOutOfStock: true,
        stockMode: "QUANTITY",
        stockQty: 7,
        lowStockThreshold: 2,
        upgradeOptions: [],
      }),
    })
  );
  assertEqual(
    craftedDealCreate.status,
    201,
    "Admin create should accept the deal but normalize crafted deal stock fields."
  );
  const craftedDeal = await prisma.menuItem.findFirstOrThrow({
    where: { outletId, name: craftedDealName },
    select: {
      id: true,
      updatedAt: true,
      stockMode: true,
      stockQty: true,
      lowStockThreshold: true,
      isOutOfStock: true,
    },
  });
  assertEqual(craftedDeal.stockMode, "MANUAL", "Deal shell stock mode should be forced manual.");
  assertEqual(craftedDeal.stockQty, null, "Deal shell stock quantity should be cleared.");
  assertEqual(
    craftedDeal.lowStockThreshold,
    null,
    "Deal shell low-stock threshold should be cleared."
  );
  assertEqual(craftedDeal.isOutOfStock, false, "Deal shell out-of-stock flag should be false.");
  assertEqual(
    await prisma.stockMovement.count({ where: { outletId } }),
    stockMovementsBeforeCraftedDeal,
    "Deal shell stock normalization should not create stock movements."
  );

  const badDealStockState = await prisma.menuItem.update({
    where: { id: craftedDeal.id },
    data: {
      stockMode: "QUANTITY",
      stockQty: 99,
      lowStockThreshold: 1,
      stockUpdatedAt: new Date(),
      lockVersion: { increment: 1 },
    },
    select: { lockVersion: true },
  });
  const craftedDealUpdate = await adminItemRoute.PATCH(
    adminRequest("PATCH", `http://localhost/api/admin/items/${craftedDeal.id}`, {
      ...itemPayload({
        categoryId: dealsCategoryId,
        name: craftedDealName,
        description: "Crafted update should also keep deal shell stock disabled.",
        badge: "HOT",
        dealBaseMenuItemId: baseItemId,
        dealExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        lockVersion: badDealStockState.lockVersion,
        isOutOfStock: true,
        stockMode: "QUANTITY",
        stockQty: 11,
        lowStockThreshold: 4,
        upgradeOptions: [],
      }),
    }),
    { params: Promise.resolve({ id: craftedDeal.id }) }
  );
  assertEqual(
    craftedDealUpdate.status,
    200,
    "Admin update should normalize crafted deal shell stock fields."
  );
  const craftedDealAfterUpdate = await prisma.menuItem.findUniqueOrThrow({
    where: { id: craftedDeal.id },
    select: {
      stockMode: true,
      stockQty: true,
      lowStockThreshold: true,
      isOutOfStock: true,
    },
  });
  assertEqual(
    craftedDealAfterUpdate.stockMode,
    "MANUAL",
    "Deal shell stock mode should remain manual after update."
  );
  assertEqual(
    craftedDealAfterUpdate.stockQty,
    null,
    "Deal shell stock quantity should remain cleared after update."
  );
  assertEqual(
    craftedDealAfterUpdate.lowStockThreshold,
    null,
    "Deal shell threshold should remain cleared after update."
  );
  assertEqual(
    craftedDealAfterUpdate.isOutOfStock,
    false,
    "Deal shell out-of-stock flag should remain false after update."
  );
  assertEqual(
    await prisma.stockMovement.count({ where: { outletId } }),
    stockMovementsBeforeCraftedDeal,
    "Deal shell stock update normalization should not create stock movements."
  );

  const baseItem = await prisma.menuItem.findUniqueOrThrow({
    where: { id: baseItemId },
    select: { lockVersion: true },
  });
  const rejectedUpdate = await adminItemRoute.PATCH(
    adminRequest("PATCH", `http://localhost/api/admin/items/${baseItemId}`, {
      ...itemPayload({
        name: `Bad Non-deal Update ${runId}`,
        lockVersion: baseItem.lockVersion,
        upgradeOptions: [
          {
            customTitle: null,
            extraCharge: 3,
            savingsLabel: 1,
            discountPct: null,
            sortOrder: 0,
            linkedItems: [{ linkedMenuItemId: linkedItemId, sortOrder: 0 }],
          },
        ],
      }),
    }),
    { params: Promise.resolve({ id: baseItemId }) }
  );
  const rejectedUpdateJson = await json<{ errorCode?: string }>(rejectedUpdate);
  assertEqual(rejectedUpdate.status, 400, "Admin update should reject non-deal upgrades.");
  assertEqual(
    rejectedUpdateJson.errorCode,
    "non_deal_upgrade_options_not_allowed",
    "Admin update should use the non-deal upgrade error code."
  );

  const clearLegacy = await adminItemRoute.PATCH(
    adminRequest("PATCH", `http://localhost/api/admin/items/${baseItemId}`, {
      ...itemPayload({
        name: `Legacy Burger Updated ${runId}`,
        lockVersion: baseItem.lockVersion,
        upgradeOptions: [],
      }),
    }),
    { params: Promise.resolve({ id: baseItemId }) }
  );
  assertEqual(clearLegacy.status, 200, "Non-deal update with [] upgrades should save.");
  assertEqual(
    await prisma.upgradeOption.count({ where: { itemId: baseItemId } }),
    0,
    "Non-deal update should clear legacy upgrade rows."
  );

  const existingStockUpdatedAt = new Date("2026-05-02T12:00:00.000Z");
  await prisma.menuItem.create({
    data: {
      id: restoreExistingQtyItemId,
      outletId,
      categoryId: nonDealCategoryId,
      name: `Existing Quantity Item ${runId}`,
      description: "Current live quantity should survive menu restore.",
      price: new Prisma.Decimal("4.00"),
      emoji: "🍔",
      bgColor: "#fff3b0",
      isActive: true,
      isOutOfStock: false,
      stockMode: "QUANTITY",
      stockQty: 9,
      lowStockThreshold: 1,
      stockUpdatedAt: existingStockUpdatedAt,
      sortOrder: 9,
    },
  });
  const stockMovementsBeforeRestore = await prisma.stockMovement.count({
    where: { outletId },
  });

  const snapshot: MenuSnapshot = {
    categories: [
      {
        id: nonDealCategoryId,
        slug: "burgers",
        name: "Burgers",
        icon: "🍔",
        sortOrder: 1,
        isActive: true,
      },
      {
        id: dealsCategoryId,
        slug: "deals",
        name: "Deals",
        icon: "🔥",
        sortOrder: 2,
        isActive: true,
      },
    ],
    items: [
      {
        id: restoreNonDealItemId,
        categoryId: nonDealCategoryId,
        comboNum: null,
        name: `Restored Non-deal ${runId}`,
        description: "Snapshot has upgradeOptions, restore must drop them.",
        price: 9,
        emoji: "🍔",
        bgColor: "#fff3b0",
        badge: null,
        mealUpgrade: 2,
        mealSavings: null,
        bundleSavings: null,
        dealBaseMenuItemId: null,
        dealBaseSizeId: null,
        dealBaseSizeNameSnapshot: null,
        dealExpiresAt: null,
        imageUrl: null,
        imageAlt: null,
        imageFit: "COVER",
        cardImageUrl: null,
        cardImageAlt: null,
        isActive: true,
        isOutOfStock: false,
        stockMode: "MANUAL",
        stockQty: null,
        lowStockThreshold: null,
        stockUpdatedAt: null,
        sortOrder: 1,
        sizes: [],
        addons: [],
        upgradeOptions: [
          {
            id: `upgrade-${runId}-restore-nondeal`,
            customTitle: null,
            extraCharge: 2,
            savingsLabel: null,
            discountPct: null,
            sortOrder: 0,
            linkedItems: [],
          },
        ],
      },
      {
        id: restoreExistingQtyItemId,
        categoryId: nonDealCategoryId,
        comboNum: null,
        name: `Restored Existing Quantity ${runId}`,
        description: "Snapshot quantity should not overwrite current live stock.",
        price: 4,
        emoji: "🍔",
        bgColor: "#fff3b0",
        badge: null,
        mealUpgrade: null,
        mealSavings: null,
        bundleSavings: null,
        dealBaseMenuItemId: null,
        dealBaseSizeId: null,
        dealBaseSizeNameSnapshot: null,
        dealExpiresAt: null,
        imageUrl: null,
        imageAlt: null,
        imageFit: "COVER",
        cardImageUrl: null,
        cardImageAlt: null,
        isActive: true,
        isOutOfStock: true,
        stockMode: "QUANTITY",
        stockQty: 2,
        lowStockThreshold: 4,
        stockUpdatedAt: "2020-01-01T00:00:00.000Z",
        sortOrder: 2,
        sizes: [],
        addons: [],
        upgradeOptions: [],
      },
      {
        id: restoreNewQtyItemId,
        categoryId: nonDealCategoryId,
        comboNum: null,
        name: `Restored New Quantity ${runId}`,
        description: "New restored quantity item starts at zero until stock is set.",
        price: 5,
        emoji: "🍔",
        bgColor: "#fff3b0",
        badge: null,
        mealUpgrade: null,
        mealSavings: null,
        bundleSavings: null,
        dealBaseMenuItemId: null,
        dealBaseSizeId: null,
        dealBaseSizeNameSnapshot: null,
        dealExpiresAt: null,
        imageUrl: null,
        imageAlt: null,
        imageFit: "COVER",
        cardImageUrl: null,
        cardImageAlt: null,
        isActive: true,
        isOutOfStock: false,
        stockMode: "QUANTITY",
        stockQty: 7,
        lowStockThreshold: 5,
        stockUpdatedAt: "2020-01-01T00:00:00.000Z",
        sortOrder: 3,
        sizes: [],
        addons: [],
        upgradeOptions: [],
      },
      {
        id: restoreDealItemId,
        categoryId: dealsCategoryId,
        comboNum: 1,
        name: `Restored Deal ${runId}`,
        description: "Snapshot deal keeps upgradeOptions.",
        price: 0,
        emoji: "🔥",
        bgColor: "#fff3b0",
        badge: "DEAL",
        mealUpgrade: null,
        mealSavings: null,
        bundleSavings: null,
        dealBaseMenuItemId: null,
        dealBaseSizeId: null,
        dealBaseSizeNameSnapshot: null,
        dealExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        imageUrl: null,
        imageAlt: null,
        imageFit: "COVER",
        cardImageUrl: null,
        cardImageAlt: null,
        isActive: true,
        isOutOfStock: true,
        stockMode: "QUANTITY",
        stockQty: 5,
        lowStockThreshold: 2,
        stockUpdatedAt: "2020-01-01T00:00:00.000Z",
        sortOrder: 4,
        sizes: [],
        addons: [],
        upgradeOptions: [
          {
            id: `upgrade-${runId}-restore-deal`,
            customTitle: null,
            extraCharge: 2,
            savingsLabel: null,
            discountPct: null,
            sortOrder: 0,
            linkedItems: [],
          },
        ],
      },
    ],
  };

  await prisma.$transaction((tx) =>
    menuHistory.restoreMenuSnapshot(tx, snapshot, outletId)
  );
  assertEqual(
    await prisma.upgradeOption.count({ where: { itemId: restoreNonDealItemId } }),
    0,
    "Menu restore should not restore/synthesize non-deal upgrade options."
  );
  assertEqual(
    await prisma.upgradeOption.count({ where: { itemId: restoreDealItemId } }),
    1,
    "Menu restore should keep deal upgrade options."
  );
  const restoredExistingQty = await prisma.menuItem.findUniqueOrThrow({
    where: { id: restoreExistingQtyItemId },
    select: {
      stockMode: true,
      stockQty: true,
      lowStockThreshold: true,
      stockUpdatedAt: true,
      isOutOfStock: true,
    },
  });
  assertEqual(
    restoredExistingQty.stockMode,
    "QUANTITY",
    "Existing quantity item should keep quantity tracking after restore."
  );
  assertEqual(
    restoredExistingQty.stockQty,
    9,
    "Menu restore should preserve current live stock quantity."
  );
  assertEqual(
    restoredExistingQty.lowStockThreshold,
    4,
    "Menu restore should restore low-stock threshold configuration."
  );
  assertEqual(
    restoredExistingQty.stockUpdatedAt?.toISOString(),
    existingStockUpdatedAt.toISOString(),
    "Menu restore should preserve current stock update metadata."
  );
  assertEqual(
    restoredExistingQty.isOutOfStock,
    true,
    "Menu restore should preserve quantity-mode pause state."
  );
  const restoredNewQty = await prisma.menuItem.findUniqueOrThrow({
    where: { id: restoreNewQtyItemId },
    select: { stockMode: true, stockQty: true, lowStockThreshold: true, stockUpdatedAt: true },
  });
  assertEqual(
    restoredNewQty.stockMode,
    "QUANTITY",
    "New restored quantity item should keep quantity tracking config."
  );
  assertEqual(
    restoredNewQty.stockQty,
    0,
    "New restored quantity item should not resurrect snapshot stock quantity."
  );
  assertEqual(
    restoredNewQty.lowStockThreshold,
    5,
    "New restored quantity item should restore threshold configuration."
  );
  assertEqual(
    restoredNewQty.stockUpdatedAt,
    null,
    "New restored quantity item should not claim a historical stock update."
  );
  const restoredDealStock = await prisma.menuItem.findUniqueOrThrow({
    where: { id: restoreDealItemId },
    select: {
      stockMode: true,
      stockQty: true,
      lowStockThreshold: true,
      isOutOfStock: true,
    },
  });
  assertEqual(
    restoredDealStock.stockMode,
    "MANUAL",
    "Menu restore should force deal shells to manual stock mode."
  );
  assertEqual(
    restoredDealStock.stockQty,
    null,
    "Menu restore should clear deal shell stock quantity."
  );
  assertEqual(
    restoredDealStock.lowStockThreshold,
    null,
    "Menu restore should clear deal shell low-stock threshold."
  );
  assertEqual(
    restoredDealStock.isOutOfStock,
    false,
    "Menu restore should clear deal shell out-of-stock state."
  );
  assertEqual(
    await prisma.stockMovement.count({ where: { outletId } }),
    stockMovementsBeforeRestore,
    "Normal menu restore should not write stock movement rows."
  );

  console.log("Non-deal upgrade retirement regression passed.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((err) => {
      console.error("Cleanup failed:", err);
      process.exitCode = 1;
    });
    await prisma.$disconnect();
  });
