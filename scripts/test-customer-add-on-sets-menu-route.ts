/* eslint-disable no-console */
import "dotenv/config";

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import {
  buildDatabaseDeviceSessionValue,
  DEVICE_SESSION_COOKIE,
} from "@/lib/device-auth";
import { prisma } from "@/lib/db";
import { DEFAULT_SITE_ID } from "@/lib/outlets";

const require = createRequire(import.meta.url);
const shortRunId = Date.now().toString(36);
const runId = `customer-add-ons-${shortRunId}`;
const outletId = `outlet-${runId}`;
const otherOutletId = `outlet-${runId}-other`;
const kioskDeviceId = `device-${runId}`;

type MenuItemPayload = {
  id: string;
  name: string;
  isOutOfStock: boolean;
  addOnSets: AddOnSetPayload[];
  upgradeOptions: Array<{
    id: string;
    customTitle: string | null;
    linkedItems: Array<{
      menuItemId: string | null;
      nameSnapshot: string;
    }>;
  }>;
};

type AddOnSetPayload = {
  itemLinkId: string;
  groupId: string;
  name: string;
  displayRuleText: string;
  selectionMode: string;
  minSelect: number;
  maxSelect: number | null;
  isRequired: boolean;
  isSatisfiable: boolean;
  sortOrder: number;
  options: AddOnOptionPayload[];
};

type AddOnOptionPayload = {
  id: string;
  groupId: string;
  name: string;
  priceDelta: number;
  isAvailable: boolean;
  unavailableReason: string | null;
  quantityLabel: string | null;
  sortOrder: number;
};

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

function request(path: string, cookie?: string) {
  return new NextRequest(`http://localhost${path}`, {
    headers: {
      ...(cookie ? { cookie } : {}),
      origin: "http://localhost",
      referer: "http://localhost/",
    },
  });
}

function assertNoAdminFields(value: Record<string, unknown>, label: string) {
  for (const key of [
    "outletId",
    "lockVersion",
    "createdAt",
    "updatedAt",
    "stockUpdatedAt",
    "stockUpdatedById",
    "isHidden",
    "priceDeltaOverride",
    "description",
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(value, key),
      false,
      `${label} should not expose ${key}.`
    );
  }
}

async function seedDeviceSession() {
  const productionAuth = await import("@/lib/production-auth");
  const token = productionAuth.createSessionToken();
  await prisma.deviceSession.create({
    data: {
      deviceId: kioskDeviceId,
      tokenHash: productionAuth.hashSessionToken(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return `${DEVICE_SESSION_COOKIE}=${buildDatabaseDeviceSessionValue("kiosk", token)}`;
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
  await prisma.outlet.createMany({
    data: [
      {
        id: outletId,
        siteId: DEFAULT_SITE_ID,
        name: `Customer add-on route ${shortRunId}`,
        slug: outletId,
        orderPrefix: `CA${shortRunId.slice(-4).toUpperCase()}`,
        isActive: true,
      },
      {
        id: otherOutletId,
        siteId: DEFAULT_SITE_ID,
        name: `Customer add-on other ${shortRunId}`,
        slug: otherOutletId,
        orderPrefix: `CB${shortRunId.slice(-4).toUpperCase()}`,
        isActive: true,
      },
    ],
  });
  await prisma.device.create({
    data: {
      id: kioskDeviceId,
      siteId: DEFAULT_SITE_ID,
      outletId,
      name: `Kiosk ${shortRunId}`,
      role: "kiosk",
      secretHash: "unused",
      isActive: true,
    },
  });

  const category = await prisma.category.create({
    data: {
      outletId,
      slug: `${runId}-burgers`,
      name: `Burgers ${shortRunId}`,
      icon: "B",
      sortOrder: 9000,
      isActive: true,
    },
  });
  const dealsCategory = await prisma.category.create({
    data: {
      outletId,
      slug: "deals",
      name: `Deals ${shortRunId}`,
      icon: "D",
      sortOrder: 8999,
      isActive: true,
    },
  });

  const [optionalItem, requiredItem, brokenRequiredItem, dealComponentItem] =
    await Promise.all([
      prisma.menuItem.create({
        data: {
          outletId,
          categoryId: category.id,
          name: `Optional add-ons burger ${shortRunId}`,
          description: "Optional add-on fixture",
          price: new Prisma.Decimal("10.00"),
          emoji: "B",
          bgColor: "#FFE3B3",
          isActive: true,
          stockMode: "MANUAL",
          isOutOfStock: false,
          sortOrder: 1,
        },
      }),
      prisma.menuItem.create({
        data: {
          outletId,
          categoryId: category.id,
          name: `Required add-ons burger ${shortRunId}`,
          description: "Required add-on fixture",
          price: new Prisma.Decimal("11.00"),
          emoji: "R",
          bgColor: "#FFE3B3",
          isActive: true,
          stockMode: "MANUAL",
          isOutOfStock: false,
          sortOrder: 2,
        },
      }),
      prisma.menuItem.create({
        data: {
          outletId,
          categoryId: category.id,
          name: `Broken required add-ons burger ${shortRunId}`,
          description: "Broken required add-on fixture",
          price: new Prisma.Decimal("12.00"),
          emoji: "X",
          bgColor: "#FFE3B3",
          isActive: true,
          stockMode: "MANUAL",
          isOutOfStock: false,
          sortOrder: 3,
        },
      }),
      prisma.menuItem.create({
        data: {
          outletId,
          categoryId: category.id,
          name: `Deal component with add-ons ${shortRunId}`,
          description: "Deal linked component with add-on fixture",
          price: new Prisma.Decimal("5.00"),
          emoji: "C",
          bgColor: "#FFE3B3",
          isActive: true,
          stockMode: "MANUAL",
          isOutOfStock: false,
          sortOrder: 4,
        },
      }),
    ]);

  const dealItem = await prisma.menuItem.create({
    data: {
      outletId,
      categoryId: dealsCategory.id,
      dealBaseMenuItemId: optionalItem.id,
      name: `Deal add-ons ignored ${shortRunId}`,
      description: "Deal add-on fixture",
      price: new Prisma.Decimal("9.00"),
      emoji: "D",
      bgColor: "#FFE3B3",
      isActive: true,
      stockMode: "MANUAL",
      isOutOfStock: false,
      dealExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      sortOrder: 4,
      upgradeOptions: {
        create: {
          customTitle: "Deal option 1",
          extraCharge: new Prisma.Decimal("0.00"),
          sortOrder: 1,
          linkedItems: {
            create: {
              linkedMenuItemId: dealComponentItem.id,
              itemNameSnapshot: dealComponentItem.name,
              sortOrder: 1,
            },
          },
        },
      },
    },
  });

  const optionalGroup = await prisma.sharedModifierGroup.create({
    data: {
      outletId,
      name: `Optional toppings ${shortRunId}`,
      description: "Customer-visible optional toppings",
      selectionMode: "OPTIONAL_MULTI",
      minSelect: 0,
      maxSelect: null,
      sortOrder: 10,
      isActive: true,
      options: {
        create: [
          {
            name: "Visible cheese",
            priceDelta: new Prisma.Decimal("1.00"),
            stockMode: "MANUAL",
            isOutOfStock: false,
            sortOrder: 2,
            isActive: true,
          },
          {
            name: "Sold out sauce",
            priceDelta: new Prisma.Decimal("0.25"),
            stockMode: "QUANTITY",
            stockQty: 0,
            lowStockThreshold: 2,
            sortOrder: 3,
            isActive: true,
          },
          {
            name: "Hidden bacon",
            priceDelta: new Prisma.Decimal("2.00"),
            stockMode: "MANUAL",
            isOutOfStock: false,
            sortOrder: 4,
            isActive: true,
          },
          {
            name: "Inactive pickle",
            priceDelta: new Prisma.Decimal("0.50"),
            stockMode: "MANUAL",
            isOutOfStock: false,
            sortOrder: 5,
            isActive: false,
          },
        ],
      },
    },
    include: { options: true },
  });

  const visibleCheese = optionalGroup.options.find(
    (option) => option.name === "Visible cheese"
  );
  const hiddenBacon = optionalGroup.options.find(
    (option) => option.name === "Hidden bacon"
  );
  assert(visibleCheese);
  assert(hiddenBacon);

  await prisma.menuItemModifierGroup.create({
    data: {
      outletId,
      menuItemId: optionalItem.id,
      modifierGroupId: optionalGroup.id,
      sortOrder: 2,
      isActive: true,
      optionOverrides: {
        create: [
          {
            modifierOptionId: visibleCheese.id,
            priceDeltaOverride: new Prisma.Decimal("1.50"),
            sortOrderOverride: 0,
            isHidden: false,
          },
          {
            modifierOptionId: hiddenBacon.id,
            isHidden: true,
          },
        ],
      },
    },
  });
  await prisma.menuItemModifierGroup.create({
    data: {
      outletId,
      menuItemId: dealComponentItem.id,
      modifierGroupId: optionalGroup.id,
      sortOrder: 1,
      isActive: true,
    },
  });
  await prisma.menuItemModifierGroup.create({
    data: {
      outletId,
      menuItemId: dealItem.id,
      modifierGroupId: optionalGroup.id,
      sortOrder: 1,
      isActive: true,
    },
  });

  const inactiveLinkGroup = await prisma.sharedModifierGroup.create({
    data: {
      outletId,
      name: `Inactive link group ${shortRunId}`,
      selectionMode: "OPTIONAL_MULTI",
      minSelect: 0,
      maxSelect: null,
      isActive: true,
      options: {
        create: {
          name: "Inactive link option",
          priceDelta: new Prisma.Decimal("0.10"),
          isActive: true,
        },
      },
    },
  });
  await prisma.menuItemModifierGroup.create({
    data: {
      outletId,
      menuItemId: optionalItem.id,
      modifierGroupId: inactiveLinkGroup.id,
      sortOrder: 4,
      isActive: false,
    },
  });

  const inactiveGroup = await prisma.sharedModifierGroup.create({
    data: {
      outletId,
      name: `Inactive group ${shortRunId}`,
      selectionMode: "OPTIONAL_MULTI",
      minSelect: 0,
      maxSelect: null,
      isActive: false,
      options: {
        create: {
          name: "Inactive group option",
          priceDelta: new Prisma.Decimal("0.10"),
          isActive: true,
        },
      },
    },
  });
  await prisma.menuItemModifierGroup.create({
    data: {
      outletId,
      menuItemId: optionalItem.id,
      modifierGroupId: inactiveGroup.id,
      sortOrder: 5,
      isActive: true,
    },
  });

  const crossOutletGroup = await prisma.sharedModifierGroup.create({
    data: {
      outletId: otherOutletId,
      name: `Cross outlet group ${shortRunId}`,
      selectionMode: "OPTIONAL_MULTI",
      minSelect: 0,
      maxSelect: null,
      isActive: true,
      options: {
        create: {
          name: "Cross outlet option",
          priceDelta: new Prisma.Decimal("0.10"),
          isActive: true,
        },
      },
    },
  });
  await prisma.menuItemModifierGroup.create({
    data: {
      outletId,
      menuItemId: optionalItem.id,
      modifierGroupId: crossOutletGroup.id,
      sortOrder: 6,
      isActive: true,
    },
  });

  const requiredGroup = await prisma.sharedModifierGroup.create({
    data: {
      outletId,
      name: `Required sauce ${shortRunId}`,
      description: "Required add-on until kiosk selection exists",
      selectionMode: "REQUIRED_SINGLE",
      minSelect: 1,
      maxSelect: 1,
      sortOrder: 20,
      isActive: true,
      options: {
        create: {
          name: "House sauce",
          priceDelta: new Prisma.Decimal("0.00"),
          stockMode: "MANUAL",
          isOutOfStock: false,
          sortOrder: 1,
          isActive: true,
        },
      },
    },
  });
  await prisma.menuItemModifierGroup.create({
    data: {
      outletId,
      menuItemId: requiredItem.id,
      modifierGroupId: requiredGroup.id,
      sortOrder: 1,
      isActive: true,
    },
  });

  const brokenRequiredGroup = await prisma.sharedModifierGroup.create({
    data: {
      outletId,
      name: `Required extras ${shortRunId}`,
      description: "Unsatisfiable required add-on",
      selectionMode: "REQUIRED_MULTI",
      minSelect: 2,
      maxSelect: null,
      sortOrder: 30,
      isActive: true,
      options: {
        create: [
          {
            name: "Available extra",
            priceDelta: new Prisma.Decimal("0.00"),
            stockMode: "MANUAL",
            isOutOfStock: false,
            sortOrder: 1,
            isActive: true,
          },
          {
            name: "Unavailable extra",
            priceDelta: new Prisma.Decimal("0.00"),
            stockMode: "QUANTITY",
            stockQty: 0,
            sortOrder: 2,
            isActive: true,
          },
        ],
      },
    },
  });
  await prisma.menuItemModifierGroup.create({
    data: {
      outletId,
      menuItemId: brokenRequiredItem.id,
      modifierGroupId: brokenRequiredGroup.id,
      sortOrder: 1,
      isActive: true,
    },
  });

  return {
    optionalItem,
    requiredItem,
    brokenRequiredItem,
    dealComponentItem,
    dealItem,
    cookie: await seedDeviceSession(),
  };
}

async function cleanup() {
  await prisma.deviceSession.deleteMany({ where: { deviceId: kioskDeviceId } });
  await prisma.deviceOutletAccess.deleteMany({ where: { deviceId: kioskDeviceId } });
  await prisma.device.deleteMany({ where: { id: kioskDeviceId } });
  await prisma.menuHistoryState.deleteMany({
    where: { outletId: { in: [outletId, otherOutletId] } },
  });
  await prisma.menuRevision.deleteMany({
    where: { outletId: { in: [outletId, otherOutletId] } },
  });
  await prisma.menuAuditLog.deleteMany({
    where: { outletId: { in: [outletId, otherOutletId] } },
  });
  await prisma.outletMenuVersion.deleteMany({
    where: { outletId: { in: [outletId, otherOutletId] } },
  });
  await prisma.menuItem.deleteMany({
    where: { outletId: { in: [outletId, otherOutletId] } },
  });
  await prisma.sharedModifierGroup.deleteMany({
    where: { outletId: { in: [outletId, otherOutletId] } },
  });
  await prisma.category.deleteMany({
    where: { outletId: { in: [outletId, otherOutletId] } },
  });
  await prisma.outlet.deleteMany({
    where: { id: { in: [outletId, otherOutletId] } },
  });
}

function itemByName(items: MenuItemPayload[], name: string) {
  const item = items.find((candidate) => candidate.name === name);
  assert(item, `Expected menu item ${name}.`);
  return item;
}

async function main() {
  stubServerOnly();
  process.env.STRICT_DEAL_BASE_ENFORCEMENT = "true";
  const menuRoute = await import("@/app/api/menu/route");

  await cleanup();
  const fixture = await seed();
  const response = await menuRoute.GET(request("/api/menu", fixture.cookie));
  assert.equal(response.status, 200, "/api/menu should accept kiosk sessions.");

  const body = (await response.json()) as {
    outletId: string;
    scheduleRefreshAt: string | null;
    items: MenuItemPayload[];
  };
  assert.equal(body.outletId, outletId);

  const optionalItem = itemByName(body.items, fixture.optionalItem.name);
  assert.equal(optionalItem.isOutOfStock, false);
  assert.equal(optionalItem.addOnSets.length, 1);

  const optionalSet = optionalItem.addOnSets[0];
  assertNoAdminFields(optionalSet as unknown as Record<string, unknown>, "addOnSet");
  assert.equal(optionalSet.name, `Optional toppings ${shortRunId}`);
  assert.equal(optionalSet.displayRuleText, "Choose any");
  assert.equal(optionalSet.selectionMode, "OPTIONAL_MULTI");
  assert.equal(optionalSet.minSelect, 0);
  assert.equal(optionalSet.maxSelect, null);
  assert.equal(optionalSet.isRequired, false);
  assert.equal(optionalSet.isSatisfiable, true);
  assert.equal(optionalSet.sortOrder, 2);
  assert.ok(optionalSet.itemLinkId, "set should expose a stable item link id.");
  assert.ok(optionalSet.groupId, "set should expose a group id.");

  const optionNames = optionalSet.options.map((option) => option.name);
  assert.deepEqual(optionNames, ["Visible cheese", "Sold out sauce"]);

  const visibleCheese = optionalSet.options[0];
  assertNoAdminFields(
    visibleCheese as unknown as Record<string, unknown>,
    "addOnSet option"
  );
  assert.equal(visibleCheese.priceDelta, 1.5);
  assert.equal(visibleCheese.isAvailable, true);
  assert.equal(visibleCheese.unavailableReason, null);
  assert.equal(visibleCheese.quantityLabel, null);
  assert.equal(visibleCheese.sortOrder, 0);

  const soldOutSauce = optionalSet.options[1];
  assert.equal(soldOutSauce.priceDelta, 0.25);
  assert.equal(soldOutSauce.isAvailable, false);
  assert.equal(soldOutSauce.unavailableReason, "OUT_OF_STOCK");
  assert.equal(soldOutSauce.quantityLabel, "0 left");
  assert.equal(soldOutSauce.groupId, optionalSet.groupId);

  const dealComponentItem = itemByName(body.items, fixture.dealComponentItem.name);
  assert.equal(
    dealComponentItem.addOnSets.length,
    1,
    "Deal linked components can have their own add-on sets when sold normally."
  );

  const requiredItem = itemByName(body.items, fixture.requiredItem.name);
  assert.equal(
    requiredItem.isOutOfStock,
    false,
    "Satisfiable required add-on sets should stay orderable because the kiosk supports add-on-set selection."
  );
  assert.equal(requiredItem.addOnSets.length, 1);
  assert.equal(requiredItem.addOnSets[0].isRequired, true);
  assert.equal(requiredItem.addOnSets[0].isSatisfiable, true);
  assert.equal(requiredItem.addOnSets[0].displayRuleText, "Choose 1");
  assert.equal(requiredItem.addOnSets[0].options.length, 1);

  const brokenRequiredItem = itemByName(
    body.items,
    fixture.brokenRequiredItem.name
  );
  assert.equal(brokenRequiredItem.isOutOfStock, true);
  assert.equal(brokenRequiredItem.addOnSets.length, 1);
  assert.equal(brokenRequiredItem.addOnSets[0].isRequired, true);
  assert.equal(brokenRequiredItem.addOnSets[0].isSatisfiable, false);
  assert.equal(brokenRequiredItem.addOnSets[0].displayRuleText, "Choose at least 2");
  assert.deepEqual(
    brokenRequiredItem.addOnSets[0].options.map((option) => ({
      name: option.name,
      isAvailable: option.isAvailable,
      quantityLabel: option.quantityLabel,
    })),
    [
      { name: "Available extra", isAvailable: true, quantityLabel: null },
      { name: "Unavailable extra", isAvailable: false, quantityLabel: "0 left" },
    ]
  );

  const dealItem = itemByName(body.items, fixture.dealItem.name);
  assert.equal(dealItem.isOutOfStock, false);
  assert.deepEqual(
    dealItem.addOnSets,
    [],
    "Deal category items should not expose attached add-on sets; deals use deal upgrade options."
  );
  assert.equal(dealItem.upgradeOptions.length, 1);
  assert.deepEqual(
    dealItem.upgradeOptions[0].linkedItems.map((link) => ({
      menuItemId: link.menuItemId,
      nameSnapshot: link.nameSnapshot,
    })),
    [
      {
        menuItemId: fixture.dealComponentItem.id,
        nameSnapshot: fixture.dealComponentItem.name,
      },
    ],
    "Deal DTO should still expose its deal upgrade option without linked component add-on sets."
  );

  const scheduleNow = Date.now();
  await prisma.menuItem.update({
    where: { id: fixture.dealItem.id },
    data: {
      dealStartsAt: new Date(scheduleNow + 60 * 60 * 1000),
      dealExpiresAt: new Date(scheduleNow + 25 * 60 * 60 * 1000),
    },
  });
  const scheduledDealResponse = await menuRoute.GET(request("/api/menu", fixture.cookie));
  assert.equal(scheduledDealResponse.status, 200);
  const scheduledDealBody = (await scheduledDealResponse.json()) as {
    scheduleRefreshAt: string | null;
    items: MenuItemPayload[];
  };
  assert.equal(
    scheduledDealBody.scheduleRefreshAt,
    new Date(scheduleNow + 60 * 60 * 1000).toISOString(),
    "Kiosk should know when to refresh for the next scheduled deal start."
  );
  assert.equal(
    scheduledDealBody.items.some((item) => item.id === fixture.dealItem.id),
    false,
    "Scheduled deals should stay out of the kiosk menu until their start time."
  );

  await prisma.menuItem.update({
    where: { id: fixture.dealItem.id },
    data: {
      dealStartsAt: new Date(scheduleNow + 2 * 60 * 60 * 1000),
      dealExpiresAt: new Date(scheduleNow + 60 * 60 * 1000),
    },
  });
  const invalidScheduleResponse = await menuRoute.GET(request("/api/menu", fixture.cookie));
  assert.equal(invalidScheduleResponse.status, 200);
  const invalidScheduleBody = (await invalidScheduleResponse.json()) as {
    scheduleRefreshAt: string | null;
    items: MenuItemPayload[];
  };
  assert.equal(
    invalidScheduleBody.items.some((item) => item.id === fixture.dealItem.id),
    false,
    "Invalid deal schedules should not render even if the raw expiration prefilter could match."
  );

  await prisma.menuItem.update({
    where: { id: fixture.dealItem.id },
    data: {
      dealStartsAt: new Date(scheduleNow - 60 * 60 * 1000),
      dealExpiresAt: new Date(scheduleNow + 24 * 60 * 60 * 1000),
    },
  });

  await prisma.menuItem.update({
    where: { id: fixture.dealComponentItem.id },
    data: { isOutOfStock: true },
  });
  const hiddenDealResponse = await menuRoute.GET(request("/api/menu", fixture.cookie));
  assert.equal(hiddenDealResponse.status, 200);
  const hiddenDealBody = (await hiddenDealResponse.json()) as {
    items: MenuItemPayload[];
  };
  assert.equal(
    hiddenDealBody.items.some((item) => item.id === fixture.dealItem.id),
    false,
    "When the required linked component is out of stock, no complete deal option remains and the deal is hidden."
  );
}

main()
  .then(async () => {
    await cleanup();
    console.log("Customer add-on set menu route tests passed.");
  })
  .catch(async (err) => {
    await cleanup().catch(() => {});
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
