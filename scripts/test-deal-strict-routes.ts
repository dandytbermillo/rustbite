/* eslint-disable no-console */
import { Prisma } from "@prisma/client";
import { createRequire } from "module";
import { NextRequest } from "next/server";
import "dotenv/config";
import { DEVICE_SESSION_COOKIE } from "@/lib/device-auth";
import { prisma } from "@/lib/db";

const require = createRequire(import.meta.url);
const runId = `deal-strict-routes-${Date.now()}`;
const outletId = `outlet-${runId}`;
const categoryId = `cat-${runId}-burgers`;
const dealsCategoryId = `cat-${runId}-deals`;
const baseItemId = `item-${runId}-base`;
const friesItemId = `item-${runId}-fries`;
const drinkItemId = `item-${runId}-drink`;
const dealItemId = `item-${runId}-deal`;
const upgradeOptionId = `upgrade-${runId}-deal`;
const deviceId = `device-${runId}`;
const expectedTotal = 11.55;

let kioskToken: string | null = null;
const originalStrictDealBaseEnforcement =
  process.env.STRICT_DEAL_BASE_ENFORCEMENT;

type MenuItemShape = {
  id: string;
  upgradeOptions: Array<{ id: string; linkedItems: Array<{ menuItemId: string | null }> }>;
};

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

function setStrictDealBaseEnforcement(enabled: boolean) {
  process.env.STRICT_DEAL_BASE_ENFORCEMENT = enabled ? "true" : "false";
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

async function cleanup() {
  await prisma.paymentTransaction.deleteMany({ where: { outletId } });
  await prisma.upgradeItemLink.deleteMany({
    where: { upgradeOption: { item: { outletId } } },
  });
  await prisma.upgradeOption.deleteMany({ where: { item: { outletId } } });
  await prisma.sizeOption.deleteMany({ where: { item: { outletId } } });
  await prisma.addonOption.deleteMany({ where: { item: { outletId } } });
  await prisma.menuItem.deleteMany({ where: { outletId } });
  await prisma.category.deleteMany({ where: { outletId } });
  await prisma.deviceSession.deleteMany({ where: { deviceId } });
  await prisma.device.deleteMany({ where: { id: deviceId } });
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
      name: `Deal strict route test ${runId}`,
      slug: outletId,
      orderPrefix: `D${Date.now()}`,
      isActive: true,
    },
  });
  await prisma.category.createMany({
    data: [
      {
        id: categoryId,
        outletId,
        slug: "burgers",
        name: "Burgers",
        icon: "T",
        sortOrder: 1,
        isActive: true,
      },
      {
        id: dealsCategoryId,
        outletId,
        slug: "deals",
        name: "Deals",
        icon: "T",
        sortOrder: 2,
        isActive: true,
      },
    ],
  });
  await prisma.menuItem.createMany({
    data: [
      {
        id: baseItemId,
        outletId,
        categoryId,
        name: `Strict Base Burger ${runId}`,
        description: "Temporary base item for strict deal route tests.",
        price: new Prisma.Decimal("8.00"),
        emoji: "T",
        bgColor: "#fff3b0",
        isActive: true,
        isOutOfStock: false,
        sortOrder: 1,
      },
      {
        id: friesItemId,
        outletId,
        categoryId,
        name: `Strict Fries ${runId}`,
        description: "Required available component.",
        price: new Prisma.Decimal("2.00"),
        emoji: "T",
        bgColor: "#fff3b0",
        isActive: true,
        isOutOfStock: false,
        sortOrder: 2,
      },
      {
        id: drinkItemId,
        outletId,
        categoryId,
        name: `Strict Drink ${runId}`,
        description: "Required component toggled by the test.",
        price: new Prisma.Decimal("1.00"),
        emoji: "T",
        bgColor: "#fff3b0",
        isActive: true,
        isOutOfStock: true,
        sortOrder: 3,
      },
      {
        id: dealItemId,
        outletId,
        categoryId: dealsCategoryId,
        name: `Strict Combo ${runId}`,
        description: "Temporary deal item for strict route tests.",
        price: new Prisma.Decimal("8.00"),
        emoji: "T",
        bgColor: "#fff3b0",
        badge: "DEAL",
        dealBaseMenuItemId: baseItemId,
        dealExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        isActive: true,
        isOutOfStock: false,
        sortOrder: 4,
      },
    ],
  });
  await prisma.upgradeOption.create({
    data: {
      id: upgradeOptionId,
      itemId: dealItemId,
      extraCharge: new Prisma.Decimal("3.00"),
      savingsLabel: new Prisma.Decimal("0.00"),
      sortOrder: 0,
      linkedItems: {
        create: [
          {
            linkedMenuItemId: friesItemId,
            itemNameSnapshot: `Strict Fries ${runId}`,
            sortOrder: 0,
          },
          {
            linkedMenuItemId: drinkItemId,
            itemNameSnapshot: `Strict Drink ${runId}`,
            sortOrder: 1,
          },
        ],
      },
    },
  });

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

async function fetchDealFromMenu(menuRoute: typeof import("@/app/api/menu/route")) {
  const response = await menuRoute.GET(kioskRequest("GET", "http://localhost/api/menu"));
  const body = await json<{ items: MenuItemShape[] }>(response);
  assertEqual(response.status, 200, "Kiosk menu should load.");
  return body.items.find((item) => item.id === dealItemId) ?? null;
}

async function createPaymentSession(
  paymentsRoute: typeof import("@/app/api/payments/sessions/route")
) {
  const response = await paymentsRoute.POST(
    kioskRequest("POST", "http://localhost/api/payments/sessions", {
      orderType: "TAKEOUT",
      paymentMethod: "CASH",
      expectedTotal,
      items: [
        {
          menuItemId: dealItemId,
          selectedUpgradeOptionId: upgradeOptionId,
          qty: 1,
        },
      ],
    })
  );
  const body = await json<{ id?: string; errorCode?: string; error?: string }>(response);
  return { response, body };
}

async function main() {
  stubServerOnly();
  const [menuRoute, paymentsRoute] = await Promise.all([
    import("@/app/api/menu/route"),
    import("@/app/api/payments/sessions/route"),
  ]);

  await cleanup();
  await seed();

  setStrictDealBaseEnforcement(false);
  const legacyPartialDeal = await fetchDealFromMenu(menuRoute);
  assert(legacyPartialDeal, "Flag-off /api/menu should keep legacy partial deal.");
  assertEqual(
    legacyPartialDeal.upgradeOptions[0]?.linkedItems.length,
    1,
    "Flag-off /api/menu should keep the option with only renderable links."
  );

  const legacyPartialPayment = await createPaymentSession(paymentsRoute);
  assertEqual(
    legacyPartialPayment.response.status,
    201,
    "Flag-off checkout should keep legacy partial deal behavior."
  );

  setStrictDealBaseEnforcement(true);
  const strictIncompleteDeal = await fetchDealFromMenu(menuRoute);
  assertEqual(
    strictIncompleteDeal,
    null,
    "Flag-on /api/menu should hide a deal whose required option component is out of stock."
  );

  const strictIncompletePayment = await createPaymentSession(paymentsRoute);
  assertEqual(
    strictIncompletePayment.response.status,
    409,
    "Flag-on checkout should reject a deal with an unavailable required component."
  );
  assertEqual(
    strictIncompletePayment.body.errorCode,
    "MENU_ITEM_UNAVAILABLE",
    "Flag-on checkout should use stale-cart unavailable error for incomplete deals."
  );

  await prisma.menuItem.update({
    where: { id: drinkItemId },
    data: { isOutOfStock: false },
  });
  const strictCompleteDeal = await fetchDealFromMenu(menuRoute);
  assert(strictCompleteDeal, "Flag-on /api/menu should show a complete valid deal.");
  assertEqual(
    strictCompleteDeal.upgradeOptions[0]?.linkedItems.length,
    2,
    "Flag-on /api/menu should keep all required links when all are available."
  );

  const strictCompletePayment = await createPaymentSession(paymentsRoute);
  assertEqual(
    strictCompletePayment.response.status,
    201,
    "Flag-on checkout should accept a complete valid deal."
  );

  await prisma.menuItem.update({
    where: { id: baseItemId },
    data: { isOutOfStock: true },
  });
  const strictUnavailableBaseDeal = await fetchDealFromMenu(menuRoute);
  assertEqual(
    strictUnavailableBaseDeal,
    null,
    "Flag-on /api/menu should hide a deal whose base item is out of stock."
  );

  const strictUnavailableBasePayment = await createPaymentSession(paymentsRoute);
  assertEqual(
    strictUnavailableBasePayment.response.status,
    409,
    "Flag-on checkout should reject a deal whose base item is out of stock."
  );
  assertEqual(
    strictUnavailableBasePayment.body.errorCode,
    "MENU_ITEM_UNAVAILABLE",
    "Flag-on checkout should use stale-cart unavailable error for unavailable base."
  );

  console.log("Strict deal route regression passed.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (originalStrictDealBaseEnforcement == null) {
      delete process.env.STRICT_DEAL_BASE_ENFORCEMENT;
    } else {
      process.env.STRICT_DEAL_BASE_ENFORCEMENT =
        originalStrictDealBaseEnforcement;
    }
    await cleanup().catch((err) => {
      console.error("Cleanup failed:", err);
      process.exitCode = 1;
    });
    await prisma.$disconnect();
  });
