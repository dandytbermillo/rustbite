import "dotenv/config";

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import {
  buildDatabaseDeviceSessionValue,
  DEVICE_SESSION_COOKIE,
} from "@/lib/device-auth";
import { prisma } from "@/lib/db";
import { DEFAULT_SITE_ID } from "@/lib/outlets";

const baseUrl =
  process.env.KIOSK_BROWSER_BASE_URL ??
  process.env.BROWSER_BASE_URL ??
  "http://127.0.0.1:3001";
const runId = `kiosk-addons-browser-${Date.now()}`;
const shortRunId = String(Date.now()).slice(-6);
const outletId = `outlet-${runId}`;
const categoryId = `category-burgers-${runId}`;
const dealsCategoryId = `category-deals-${runId}`;
const burgerItemId = `item-burger-${runId}`;
const dealItemId = `item-deal-${runId}`;
const linkedDealComponentId = `item-linked-${runId}`;
const optionalGroupId = `modifier-group-optional-${runId}`;
const requiredGroupId = `modifier-group-required-${runId}`;
const optionalSingleGroupId = `modifier-group-optional-single-${runId}`;
const optionalOptionId = `modifier-option-crispy-${runId}`;
const soldOutOptionId = `modifier-option-soldout-${runId}`;
const hiddenOptionId = `modifier-option-hidden-${runId}`;
const requiredOptionId = `modifier-option-sauce-${runId}`;
const optionalSingleOptionId = `modifier-option-avocado-${runId}`;
const deviceId = `device-${runId}`;
const burgerName = `Browser Burger ${shortRunId}`;
const dealName = `Browser Deal ${shortRunId}`;
const linkedDealComponentName = `Browser Component ${shortRunId}`;
const legacyAddonName = `Legacy mayo ${shortRunId}`;
const optionalGroupName = `Burger toppings ${shortRunId}`;
const requiredGroupName = `Burger sauce ${shortRunId}`;
const optionalSingleGroupName = `Avocado add-on ${shortRunId}`;

type JsonRecord = Record<string, unknown>;

function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

function hashSessionToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

async function assertServerReachable() {
  try {
    const response = await fetch(baseUrl, { redirect: "manual" });
    assert(response.status > 0, `Kiosk add-on-set browser test could not reach ${baseUrl}.`);
  } catch (err) {
    throw new Error(
      `Kiosk add-on-set browser test requires an already-running Next server at ${baseUrl}. ` +
        `Start it first, or set KIOSK_BROWSER_BASE_URL to the correct URL. ` +
        `Original error: ${(err as Error).message}`
    );
  }
}

async function seed() {
  await prisma.site.upsert({
    where: { id: DEFAULT_SITE_ID },
    update: {},
    create: {
      id: DEFAULT_SITE_ID,
      name: "Rushbite",
      timezone: "America/Edmonton",
    },
  });

  await prisma.outlet.create({
    data: {
      id: outletId,
      siteId: DEFAULT_SITE_ID,
      name: `Kiosk add-on browser ${runId}`,
      slug: outletId,
      orderPrefix: `A${String(Date.now()).slice(-6)}`,
      isActive: true,
    },
  });

  await prisma.category.createMany({
    data: [
      {
        id: categoryId,
        outletId,
        slug: `browser-burgers-${runId}`,
        name: "Burgers",
        icon: "🍔",
        sortOrder: 0,
        isActive: true,
      },
      {
        id: dealsCategoryId,
        outletId,
        slug: "deals",
        name: "Deals",
        icon: "🔥",
        sortOrder: 1,
        isActive: true,
      },
    ],
  });

  await prisma.menuItem.createMany({
    data: [
      {
        id: burgerItemId,
        outletId,
        categoryId,
        name: burgerName,
        description: "Browser test burger with reusable add-on sets",
        price: 10,
        emoji: "🍔",
        bgColor: "#FFE3E0",
        sortOrder: 0,
        isActive: true,
        isOutOfStock: false,
      },
      {
        id: linkedDealComponentId,
        outletId,
        categoryId,
        name: linkedDealComponentName,
        description: "Linked item that also has add-on sets",
        price: 4,
        emoji: "🍟",
        bgColor: "#FFF3BF",
        sortOrder: 1,
        isActive: true,
        isOutOfStock: false,
      },
      {
        id: dealItemId,
        outletId,
        categoryId: dealsCategoryId,
        dealBaseMenuItemId: burgerItemId,
        dealExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        name: dealName,
        description: "Browser test deal that must stay deal-only",
        price: 12,
        emoji: "🍔",
        bgColor: "#FFF3BF",
        badge: "DEAL",
        sortOrder: 0,
        isActive: true,
        isOutOfStock: false,
      },
    ],
  });

  await prisma.addonOption.create({
    data: {
      itemId: burgerItemId,
      name: legacyAddonName,
      priceDelta: 0.75,
      sortOrder: 0,
    },
  });

  await prisma.sharedModifierGroup.create({
    data: {
      id: optionalGroupId,
      outletId,
      name: optionalGroupName,
      selectionMode: "OPTIONAL_MULTI",
      minSelect: 0,
      maxSelect: 2,
      sortOrder: 0,
      options: {
        create: [
          {
            id: optionalOptionId,
            name: "Crispy onions",
            priceDelta: 1.5,
            stockMode: "MANUAL",
            isOutOfStock: false,
            sortOrder: 0,
          },
          {
            id: soldOutOptionId,
            name: "Sold out relish",
            priceDelta: 0.25,
            stockMode: "QUANTITY",
            stockQty: 0,
            lowStockThreshold: 1,
            sortOrder: 1,
          },
          {
            id: hiddenOptionId,
            name: "Hidden pepper",
            priceDelta: 0.5,
            stockMode: "MANUAL",
            isOutOfStock: false,
            sortOrder: 2,
          },
        ],
      },
    },
  });

  await prisma.sharedModifierGroup.create({
    data: {
      id: requiredGroupId,
      outletId,
      name: requiredGroupName,
      selectionMode: "REQUIRED_SINGLE",
      minSelect: 1,
      maxSelect: 1,
      sortOrder: 1,
      options: {
        create: [
          {
            id: requiredOptionId,
            name: "House sauce",
            priceDelta: 0,
            stockMode: "MANUAL",
            isOutOfStock: false,
            sortOrder: 0,
          },
        ],
      },
    },
  });

  await prisma.sharedModifierGroup.create({
    data: {
      id: optionalSingleGroupId,
      outletId,
      name: optionalSingleGroupName,
      selectionMode: "OPTIONAL_SINGLE",
      minSelect: 0,
      maxSelect: 1,
      sortOrder: 2,
      options: {
        create: [
          {
            id: optionalSingleOptionId,
            name: "Avocado",
            priceDelta: 2,
            stockMode: "MANUAL",
            isOutOfStock: false,
            sortOrder: 0,
          },
        ],
      },
    },
  });

  await prisma.menuItemModifierGroup.create({
    data: {
      outletId,
      menuItemId: burgerItemId,
      modifierGroupId: optionalGroupId,
      sortOrder: 0,
      optionOverrides: {
        create: [{ modifierOptionId: hiddenOptionId, isHidden: true }],
      },
    },
  });

  await prisma.menuItemModifierGroup.create({
    data: {
      outletId,
      menuItemId: burgerItemId,
      modifierGroupId: requiredGroupId,
      sortOrder: 1,
    },
  });

  await prisma.menuItemModifierGroup.create({
    data: {
      outletId,
      menuItemId: burgerItemId,
      modifierGroupId: optionalSingleGroupId,
      sortOrder: 2,
    },
  });

  await prisma.menuItemModifierGroup.createMany({
    data: [
      {
        outletId,
        menuItemId: linkedDealComponentId,
        modifierGroupId: optionalGroupId,
        sortOrder: 0,
      },
      {
        outletId,
        menuItemId: dealItemId,
        modifierGroupId: optionalGroupId,
        sortOrder: 0,
      },
    ],
  });

  await prisma.upgradeOption.create({
    data: {
      itemId: dealItemId,
      customTitle: "Deal option",
      extraCharge: 2,
      savingsLabel: 1,
      sortOrder: 0,
      linkedItems: {
        create: [
          {
            linkedMenuItemId: linkedDealComponentId,
            itemNameSnapshot: linkedDealComponentName,
            sortOrder: 0,
          },
        ],
      },
    },
  });

  await prisma.device.create({
    data: {
      id: deviceId,
      siteId: DEFAULT_SITE_ID,
      outletId,
      name: `Kiosk add-ons browser test ${runId}`,
      role: "kiosk",
      secretHash: "unused",
      isActive: true,
    },
  });

  const token = createSessionToken();
  await prisma.deviceSession.create({
    data: {
      deviceId,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  return {
    cookieValue: buildDatabaseDeviceSessionValue("kiosk", token),
  };
}

async function cleanup() {
  await prisma.paymentTransaction.deleteMany({ where: { outletId } });
  await prisma.stockMovement.deleteMany({ where: { outletId } });
  await prisma.order.deleteMany({ where: { outletId } });
  await prisma.deviceSession.deleteMany({ where: { deviceId } });
  await prisma.deviceOutletAccess.deleteMany({ where: { deviceId } });
  await prisma.device.deleteMany({ where: { id: deviceId } });
  await prisma.menuItemModifierGroupAttachmentHistory.deleteMany({
    where: { outletId },
  });
  await prisma.menuItem.deleteMany({ where: { outletId } });
  await prisma.sharedModifierGroup.deleteMany({ where: { outletId } });
  await prisma.category.deleteMany({ where: { outletId } });
  await prisma.menuHistoryState.deleteMany({ where: { outletId } });
  await prisma.menuRevision.deleteMany({ where: { outletId } });
  await prisma.menuAuditLog.deleteMany({ where: { outletId } });
  await prisma.outletMenuVersion.deleteMany({ where: { outletId } });
  await prisma.outletOrderVersion.deleteMany({ where: { outletId } });
  await prisma.outletDailyOrderSequence.deleteMany({ where: { outletId } });
  await prisma.outlet.deleteMany({ where: { id: outletId } });
}

function asRecordArray(value: unknown, label: string): JsonRecord[] {
  assert(Array.isArray(value), `${label} should be an array.`);
  return value as JsonRecord[];
}

function assertOrderSnapshot(order: Awaited<ReturnType<typeof loadCreatedOrder>>) {
  assert(order, "Expected kiosk flow to create an order.");
  assert.equal(order.status, "AWAITING_COUNTER_PAYMENT");
  assert.equal(order.paymentMethod, "CASH");
  assert.equal(order.items.length, 1);

  const [item] = order.items;
  assert(item, "Expected one order item.");
  assert.equal(item.menuItemId, burgerItemId);
  assert.equal(item.nameSnapshot, burgerName);
  assert.equal(item.qty, 1);
  assert.equal(Number(item.lineTotal), 11.5);

  const addOnSetSelections = asRecordArray(
    item.addOnSetSelectionsJson,
    "OrderItem.addOnSetSelectionsJson"
  );
  assert.equal(addOnSetSelections.length, 2);
  assert.deepEqual(
    addOnSetSelections.map((selection) => selection.name).sort(),
    [optionalGroupName, requiredGroupName].sort()
  );

  const optionalSelection = addOnSetSelections.find(
    (selection) => selection.groupId === optionalGroupId
  );
  assert(optionalSelection, "Expected optional add-on set snapshot.");
  const optionalOptions = asRecordArray(
    optionalSelection.options,
    "Optional add-on set options"
  );
  assert.equal(optionalOptions.length, 1);
  assert.equal(optionalOptions[0]?.id, optionalOptionId);
  assert.equal(optionalOptions[0]?.name, "Crispy onions");
  assert.equal(optionalOptions[0]?.priceDelta, 1.5);

  const requiredSelection = addOnSetSelections.find(
    (selection) => selection.groupId === requiredGroupId
  );
  assert(requiredSelection, "Expected required add-on set snapshot.");
  const requiredOptions = asRecordArray(
    requiredSelection.options,
    "Required add-on set options"
  );
  assert.equal(requiredOptions.length, 1);
  assert.equal(requiredOptions[0]?.id, requiredOptionId);
  assert.equal(requiredOptions[0]?.name, "House sauce");
  assert.equal(requiredOptions[0]?.priceDelta, 0);

  const addons = asRecordArray(item.addonsJson, "OrderItem.addonsJson");
  assert.deepEqual(
    addons.map((addon) => addon.name).sort(),
    [`${optionalGroupName}: Crispy onions`, `${requiredGroupName}: House sauce`].sort()
  );
  assert.equal(
    addons.some((addon) => addon.name === legacyAddonName),
    false,
    "Item-specific add-ons should not leak into the kiosk order."
  );
  assert.equal(
    addons.some((addon) => addon.name === `${optionalGroupName}: Sold out relish`),
    false,
    "Out-of-stock add-on-set options should not be selected."
  );
  assert.equal(
    addons.some((addon) => addon.name === `${optionalGroupName}: Hidden pepper`),
    false,
    "Hidden add-on-set options should not be selected."
  );
  assert.equal(
    item.upgradeSnapshotJson == null,
    true,
    "Normal item order should not have a deal upgrade snapshot."
  );

  const cartSnapshot = order.paymentTransaction?.cartSnapshot as unknown as JsonRecord;
  const cartItems = asRecordArray(cartSnapshot.items, "PaymentTransaction.cartSnapshot.items");
  assert.equal(cartItems.length, 1);
  const cartSelections = asRecordArray(
    cartItems[0]?.addOnSetSelections,
    "PaymentTransaction cart add-on set selections"
  );
  assert.equal(cartSelections.length, 2);
}

async function loadCreatedOrder() {
  return prisma.order.findFirst({
    where: { outletId },
    orderBy: { createdAt: "desc" },
    include: {
      items: true,
      paymentTransaction: true,
    },
  });
}

async function main() {
  await assertServerReachable();
  await cleanup();
  const { cookieValue } = await seed();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: baseUrl });
  await context.addCookies([
    {
      name: DEVICE_SESSION_COOKIE,
      value: cookieValue,
      url: baseUrl,
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);

  const page = await context.newPage();

  try {
    await page.goto("/kiosk", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /tap to order/i }).click({ force: true });
    await page.getByRole("button", { name: /takeout/i }).click();

    await page.getByRole("button", { name: "Category Burgers" }).click();
    await page.getByRole("button", { name: new RegExp(`Add ${burgerName}`) }).click();
    await expect(page.getByRole("heading", { name: burgerName })).toBeVisible();
    await expect(page.getByText(optionalGroupName)).toBeVisible();
    await expect(page.getByText(requiredGroupName)).toBeVisible();
    await expect(page.getByText(optionalSingleGroupName)).toBeVisible();
    await expect(page.getByText(legacyAddonName)).toHaveCount(0);
    await expect(page.getByText("Hidden pepper")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Sold out relish/i })).toBeDisabled();

    const addToOrder = page.getByRole("button", { name: /add to order/i });
    await expect(addToOrder).toBeDisabled();

    const avocado = page.getByRole("button", { name: /Avocado/i });
    await expect(avocado).toBeVisible();
    await avocado.click();
    await expect(addToOrder).toContainText("$12.00");
    await avocado.click();
    await expect(addToOrder).toContainText("$10.00");

    const houseSauce = page.getByRole("button", { name: /House sauce/i });
    await expect(houseSauce).toContainText("Required");
    await houseSauce.click();
    await expect(addToOrder).toBeEnabled();
    await page.getByRole("button", { name: /Crispy onions/i }).click();
    await expect(addToOrder).toContainText("$11.50");
    await addToOrder.click();
    await expect(page.getByText("+2 add-ons")).toBeVisible();

    await page.getByRole("button", { name: "Category Deals" }).click();
    await page.getByRole("button", { name: new RegExp(`Add ${dealName}`) }).click();
    await expect(page.getByRole("heading", { name: dealName })).toBeVisible();
    await expect(page.getByText("Make it a meal?")).toBeVisible();
    await expect(page.getByText(linkedDealComponentName)).toBeVisible();
    await expect(page.getByText(optionalGroupName)).toHaveCount(0);
    await expect(page.getByText(requiredGroupName)).toHaveCount(0);
    await expect(page.getByText(optionalSingleGroupName)).toHaveCount(0);
    await expect(page.getByText("Crispy onions")).toHaveCount(0);
    await expect(page.getByText("House sauce")).toHaveCount(0);
    await expect(page.getByText("Avocado")).toHaveCount(0);
    await page.getByRole("button", { name: "Back" }).click();

    await page.getByRole("button", { name: /checkout/i }).click();
    await expect(page.getByText("REVIEW YOUR ORDER")).toBeVisible();
    await expect(page.getByText(burgerName)).toBeVisible();
    await expect(page.getByText("+2 add-ons")).toBeVisible();
    await expect(page.getByText("$11.50").first()).toBeVisible();

    await page.getByRole("button", { name: /pay now/i }).click();
    await page.getByRole("button", { name: /Pay at Counter/i }).click();
    await page.getByRole("button", { name: /send to counter/i }).click();
    await expect(page.getByText("ORDER CREATED")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "PAY AT THE COUNTER" })).toBeVisible();

    assertOrderSnapshot(await loadCreatedOrder());

    console.log("Kiosk add-on-set browser smoke test passed.");
  } finally {
    await browser.close();
  }
}

main()
  .catch((err) => {
    console.error("Kiosk add-on-set browser smoke test failed.");
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch(() => {});
    await prisma.$disconnect();
  });
