/* eslint-disable no-console */
import "dotenv/config";

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DEFAULT_SITE_ID } from "@/lib/outlets";
import type { AdminPermissionContext } from "@/lib/admin-sessions";
import type {
  WorkspaceMenuAddonOption,
  WorkspaceMenuSharedModifierOptionSummary,
} from "@/lib/admin/workspace/menu-summary";

const require = createRequire(import.meta.url);
const shortRunId = Date.now().toString(36);
const runId = `workspace-option-stock-${shortRunId}`;
const outletId = `${runId}-outlet`;
const categoryId = `${runId}-category`;
const itemId = `${runId}-item`;
const groupId = `${runId}-group`;
const linkId = `${runId}-link`;

const addonIds = {
  manualIn: `${runId}-addon-manual-in`,
  manualOut: `${runId}-addon-manual-out`,
  quantityOk: `${runId}-addon-quantity-ok`,
  quantityLow: `${runId}-addon-quantity-low`,
  quantityZero: `${runId}-addon-quantity-zero`,
};

const sharedOptionIds = {
  manualIn: `${runId}-shared-manual-in`,
  manualOut: `${runId}-shared-manual-out`,
  quantityOk: `${runId}-shared-quantity-ok`,
  quantityLow: `${runId}-shared-quantity-low`,
  quantityZero: `${runId}-shared-quantity-zero`,
  hidden: `${runId}-shared-hidden`,
  inactive: `${runId}-shared-inactive`,
};

type MenuSummaryModule = typeof import("@/lib/admin/workspace/menu-summary");

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

async function loadMenuSummaryModule(): Promise<MenuSummaryModule> {
  stubServerOnly();
  return import("@/lib/admin/workspace/menu-summary");
}

function decimal(value: string) {
  return new Prisma.Decimal(value);
}

async function cleanupFixture() {
  await prisma.menuItemModifierOptionOverride.deleteMany({
    where: { itemModifierGroup: { outletId } },
  });
  await prisma.menuItemModifierGroup.deleteMany({ where: { outletId } });
  await prisma.sharedModifierGroup.deleteMany({ where: { outletId } });
  await prisma.addonOption.deleteMany({ where: { item: { outletId } } });
  await prisma.sizeOption.deleteMany({ where: { item: { outletId } } });
  await prisma.menuItem.deleteMany({ where: { outletId } });
  await prisma.category.deleteMany({ where: { outletId } });
  await prisma.outletMenuVersion.deleteMany({ where: { outletId } });
  await prisma.outletSettings.deleteMany({ where: { outletId } });
  await prisma.outlet.deleteMany({ where: { id: outletId } });
}

async function seedFixture() {
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
      name: `Workspace Option Stock ${shortRunId}`,
      slug: outletId,
      orderPrefix: `OS${shortRunId.slice(-4).toUpperCase()}`,
      isActive: true,
    },
  });

  await prisma.category.create({
    data: {
      id: categoryId,
      outletId,
      slug: `${runId}-burgers`,
      name: "Workspace Option Stock Burgers",
      icon: "🍔",
      sortOrder: 1,
      isActive: true,
    },
  });

  await prisma.menuItem.create({
    data: {
      id: itemId,
      outletId,
      categoryId,
      name: "Workspace Option Stock Burger",
      description: "Workspace option stock fixture",
      price: decimal("10.00"),
      emoji: "🍔",
      bgColor: "#FFE3B3",
      isActive: true,
      stockMode: "MANUAL",
      isOutOfStock: false,
      modifierContractMode: "SHARED",
      sortOrder: 1,
      addons: {
        create: [
          {
            id: addonIds.manualIn,
            name: "Manual in add-on",
            priceDelta: decimal("0.50"),
            stockMode: "MANUAL",
            isOutOfStock: false,
            sortOrder: 1,
          },
          {
            id: addonIds.manualOut,
            name: "Manual out add-on",
            priceDelta: decimal("0.60"),
            stockMode: "MANUAL",
            isOutOfStock: true,
            sortOrder: 2,
          },
          {
            id: addonIds.quantityOk,
            name: "Quantity ok add-on",
            priceDelta: decimal("0.70"),
            stockMode: "QUANTITY",
            stockQty: 5,
            lowStockThreshold: 2,
            sortOrder: 3,
          },
          {
            id: addonIds.quantityLow,
            name: "Quantity low add-on",
            priceDelta: decimal("0.80"),
            stockMode: "QUANTITY",
            stockQty: 1,
            lowStockThreshold: 2,
            sortOrder: 4,
          },
          {
            id: addonIds.quantityZero,
            name: "Quantity zero add-on",
            priceDelta: decimal("0.90"),
            stockMode: "QUANTITY",
            stockQty: 0,
            lowStockThreshold: 2,
            sortOrder: 5,
          },
        ],
      },
    },
  });

  await prisma.sharedModifierGroup.create({
    data: {
      id: groupId,
      outletId,
      name: "Workspace Option Stock Shared Set",
      description: "Read-only stock state fixture",
      selectionMode: "OPTIONAL_MULTI",
      minSelect: 0,
      maxSelect: null,
      isActive: true,
      sortOrder: 1,
      options: {
        create: [
          {
            id: sharedOptionIds.manualIn,
            name: "Manual in shared option",
            priceDelta: decimal("1.00"),
            stockMode: "MANUAL",
            isOutOfStock: false,
            isActive: true,
            sortOrder: 1,
          },
          {
            id: sharedOptionIds.manualOut,
            name: "Manual out shared option",
            priceDelta: decimal("1.10"),
            stockMode: "MANUAL",
            isOutOfStock: true,
            isActive: true,
            sortOrder: 2,
          },
          {
            id: sharedOptionIds.quantityOk,
            name: "Quantity ok shared option",
            priceDelta: decimal("1.20"),
            stockMode: "QUANTITY",
            stockQty: 4,
            lowStockThreshold: 2,
            isActive: true,
            sortOrder: 3,
          },
          {
            id: sharedOptionIds.quantityLow,
            name: "Quantity low shared option",
            priceDelta: decimal("1.30"),
            stockMode: "QUANTITY",
            stockQty: 1,
            lowStockThreshold: 2,
            isActive: true,
            sortOrder: 4,
          },
          {
            id: sharedOptionIds.quantityZero,
            name: "Quantity zero shared option",
            priceDelta: decimal("1.40"),
            stockMode: "QUANTITY",
            stockQty: 0,
            lowStockThreshold: 2,
            isActive: true,
            sortOrder: 5,
          },
          {
            id: sharedOptionIds.hidden,
            name: "Hidden shared option",
            priceDelta: decimal("1.50"),
            stockMode: "MANUAL",
            isOutOfStock: false,
            isActive: true,
            sortOrder: 6,
          },
          {
            id: sharedOptionIds.inactive,
            name: "Inactive shared option",
            priceDelta: decimal("1.60"),
            stockMode: "MANUAL",
            isOutOfStock: false,
            isActive: false,
            sortOrder: 7,
          },
        ],
      },
    },
  });

  await prisma.menuItemModifierGroup.create({
    data: {
      id: linkId,
      outletId,
      menuItemId: itemId,
      modifierGroupId: groupId,
      sortOrder: 1,
      isActive: true,
      optionOverrides: {
        create: {
          modifierOptionId: sharedOptionIds.hidden,
          isHidden: true,
        },
      },
    },
  });
}

function context(): AdminPermissionContext {
  return {
    actor: {
      sessionId: `${runId}-session`,
      userId: `${runId}-owner`,
      email: `${runId}@example.test`,
      displayName: "Workspace Option Stock Owner",
      accountType: "OWNER",
      siteRole: "OWNER",
      mfaEnrollmentRequired: false,
    },
    outletId,
    activeOutlet: {
      status: "active",
      outletId,
      outletName: `Workspace Option Stock ${shortRunId}`,
      role: "OWNER",
    },
  };
}

function byId<T extends { id: string }>(values: T[], id: string): T {
  const value = values.find((candidate) => candidate.id === id);
  assert(value, `Expected value with id ${id}`);
  return value;
}

function expectStock(
  option: WorkspaceMenuAddonOption | WorkspaceMenuSharedModifierOptionSummary,
  expected: {
    label: string;
    tone: "green" | "amber" | "red" | "stone";
    available: boolean;
    low: boolean;
  },
) {
  assert.deepEqual(
    {
      label: option.stock.label,
      tone: option.stock.tone,
      available: option.stock.available,
      low: option.stock.low,
    },
    expected,
    `${option.name} stock summary mismatch`,
  );
}

async function main() {
  const { buildAdminWorkspaceMenuSummary } = await loadMenuSummaryModule();

  await cleanupFixture();
  await seedFixture();

  const summary = await buildAdminWorkspaceMenuSummary({
    context: context(),
    filter: { targetItemId: null },
    limitPerSection: 8,
    now: new Date("2026-05-08T18:00:00.000Z"),
  });

  const row = summary.sections
    .flatMap((section) => section.items)
    .find((candidate) => candidate.id === itemId);
  assert(row, "Workspace menu summary should include the fixture item.");

  expectStock(byId(row.addonOptions, addonIds.manualIn), {
    label: "In",
    tone: "green",
    available: true,
    low: false,
  });
  expectStock(byId(row.addonOptions, addonIds.manualOut), {
    label: "Out",
    tone: "red",
    available: false,
    low: false,
  });
  expectStock(byId(row.addonOptions, addonIds.quantityOk), {
    label: "5 left",
    tone: "stone",
    available: true,
    low: false,
  });
  expectStock(byId(row.addonOptions, addonIds.quantityLow), {
    label: "Low · 1 left",
    tone: "amber",
    available: true,
    low: true,
  });
  expectStock(byId(row.addonOptions, addonIds.quantityZero), {
    label: "0 left",
    tone: "red",
    available: false,
    low: false,
  });

  const group = byId(row.sharedModifierGroups, groupId);
  assert.equal(group.activeOptionCount, 6, "Active option count should include hidden and out-of-stock active options.");
  assert.equal(group.visibleOptionCount, 3, "Visible option count should exclude hidden, inactive, and out-of-stock options.");

  expectStock(byId(group.options, sharedOptionIds.manualIn), {
    label: "In",
    tone: "green",
    available: true,
    low: false,
  });
  expectStock(byId(group.options, sharedOptionIds.manualOut), {
    label: "Out",
    tone: "red",
    available: false,
    low: false,
  });
  expectStock(byId(group.options, sharedOptionIds.quantityOk), {
    label: "4 left",
    tone: "stone",
    available: true,
    low: false,
  });
  expectStock(byId(group.options, sharedOptionIds.quantityLow), {
    label: "Low · 1 left",
    tone: "amber",
    available: true,
    low: true,
  });
  expectStock(byId(group.options, sharedOptionIds.quantityZero), {
    label: "0 left",
    tone: "red",
    available: false,
    low: false,
  });

  const hidden = byId(group.options, sharedOptionIds.hidden);
  assert.equal(hidden.isHidden, true, "Hidden option should preserve its override state.");
  expectStock(hidden, {
    label: "In",
    tone: "green",
    available: false,
    low: false,
  });

  const inactive = byId(group.options, sharedOptionIds.inactive);
  assert.equal(inactive.isActive, false, "Inactive option should preserve its active state.");
  expectStock(inactive, {
    label: "In",
    tone: "green",
    available: false,
    low: false,
  });

  console.log("Admin workspace option stock summary tests passed.");
}

main()
  .catch((error) => {
    console.error("Admin workspace option stock summary tests failed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await cleanupFixture();
    } finally {
      await prisma.$disconnect();
    }
  });
