/* eslint-disable no-console */
import "dotenv/config";

import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import {
  buildOrderItemCreates,
  buildCheckoutSnapshot,
  CheckoutContractError,
} from "@/lib/checkout";
import { prisma } from "@/lib/db";
import { DEFAULT_SITE_ID } from "@/lib/outlets";

const shortRunId = Date.now().toString(36);
const runId = `customer-add-ons-checkout-${shortRunId}`;
const outletId = `outlet-${runId}`;

async function cleanup() {
  await prisma.paymentTransaction.deleteMany({ where: { outletId } });
  await prisma.menuHistoryState.deleteMany({ where: { outletId } });
  await prisma.menuRevision.deleteMany({ where: { outletId } });
  await prisma.menuAuditLog.deleteMany({ where: { outletId } });
  await prisma.outletMenuVersion.deleteMany({ where: { outletId } });
  await prisma.menuItem.deleteMany({ where: { outletId } });
  await prisma.sharedModifierGroup.deleteMany({ where: { outletId } });
  await prisma.category.deleteMany({ where: { outletId } });
  await prisma.outlet.deleteMany({ where: { id: outletId } });
}

async function expectCheckoutError(
  input: Parameters<typeof buildCheckoutSnapshot>[0],
  expectedCode: CheckoutContractError["code"]
) {
  await assert.rejects(
    () => buildCheckoutSnapshot(input, outletId),
    (err) => err instanceof CheckoutContractError && err.code === expectedCode
  );
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
      name: `Customer add-on checkout ${shortRunId}`,
      slug: outletId,
      orderPrefix: `CC${shortRunId.slice(-4).toUpperCase()}`,
      isActive: true,
    },
  });

  const category = await prisma.category.create({
    data: {
      outletId,
      slug: `${runId}-burgers`,
      name: `Burgers ${shortRunId}`,
      icon: "B",
      sortOrder: 1,
      isActive: true,
    },
  });
  const dealsCategory = await prisma.category.create({
    data: {
      outletId,
      slug: "deals",
      name: `Deals ${shortRunId}`,
      icon: "D",
      sortOrder: 0,
      isActive: true,
    },
  });

  const item = await prisma.menuItem.create({
    data: {
      outletId,
      categoryId: category.id,
      name: `Checkout burger ${shortRunId}`,
      description: "Checkout add-on set fixture",
      price: new Prisma.Decimal("10.00"),
      emoji: "B",
      bgColor: "#FFE3B3",
      isActive: true,
      stockMode: "MANUAL",
      isOutOfStock: false,
    },
  });
  const linkedDealComponent = await prisma.menuItem.create({
    data: {
      outletId,
      categoryId: category.id,
      name: `Checkout deal component ${shortRunId}`,
      description: "Deal linked component with add-on set fixture",
      price: new Prisma.Decimal("5.00"),
      emoji: "C",
      bgColor: "#FFE3B3",
      isActive: true,
      stockMode: "MANUAL",
      isOutOfStock: false,
    },
  });

  const optionalGroup = await prisma.sharedModifierGroup.create({
    data: {
      outletId,
      name: `Toppings ${shortRunId}`,
      selectionMode: "OPTIONAL_MULTI",
      minSelect: 0,
      maxSelect: 2,
      isActive: true,
      options: {
        create: [
          {
            name: "Visible cheese",
            priceDelta: new Prisma.Decimal("1.50"),
            stockMode: "MANUAL",
            isOutOfStock: false,
            isActive: true,
            sortOrder: 1,
          },
          {
            name: "Limited sauce",
            priceDelta: new Prisma.Decimal("0.75"),
            stockMode: "QUANTITY",
            stockQty: 4,
            lowStockThreshold: 2,
            isActive: true,
            sortOrder: 2,
          },
          {
            name: "Sold out relish",
            priceDelta: new Prisma.Decimal("0.25"),
            stockMode: "QUANTITY",
            stockQty: 0,
            isActive: true,
            sortOrder: 3,
          },
        ],
      },
    },
    include: { options: true },
  });
  const optionalLink = await prisma.menuItemModifierGroup.create({
    data: {
      outletId,
      menuItemId: item.id,
      modifierGroupId: optionalGroup.id,
      isActive: true,
      sortOrder: 1,
    },
  });
  await prisma.menuItemModifierGroup.create({
    data: {
      outletId,
      menuItemId: linkedDealComponent.id,
      modifierGroupId: optionalGroup.id,
      isActive: true,
      sortOrder: 1,
    },
  });

  const requiredGroup = await prisma.sharedModifierGroup.create({
    data: {
      outletId,
      name: `Required sauce ${shortRunId}`,
      selectionMode: "REQUIRED_SINGLE",
      minSelect: 1,
      maxSelect: 1,
      isActive: true,
      options: {
        create: {
          name: "House sauce",
          priceDelta: new Prisma.Decimal("0.00"),
          stockMode: "MANUAL",
          isOutOfStock: false,
          isActive: true,
        },
      },
    },
    include: { options: true },
  });
  const requiredLink = await prisma.menuItemModifierGroup.create({
    data: {
      outletId,
      menuItemId: item.id,
      modifierGroupId: requiredGroup.id,
      isActive: true,
      sortOrder: 2,
    },
  });

  const deal = await prisma.menuItem.create({
    data: {
      outletId,
      categoryId: dealsCategory.id,
      dealBaseMenuItemId: item.id,
      name: `Checkout deal ${shortRunId}`,
      description: "Deal should not accept add-on set selections",
      price: new Prisma.Decimal("9.00"),
      emoji: "D",
      bgColor: "#FFE3B3",
      isActive: true,
      isOutOfStock: false,
      stockMode: "MANUAL",
      dealExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      upgradeOptions: {
        create: {
          customTitle: "Deal option 1",
          extraCharge: new Prisma.Decimal("0.00"),
          sortOrder: 1,
          linkedItems: {
            create: {
              linkedMenuItemId: linkedDealComponent.id,
              itemNameSnapshot: linkedDealComponent.name,
              sortOrder: 1,
            },
          },
        },
      },
    },
    include: { upgradeOptions: true },
  });
  await prisma.menuItemModifierGroup.create({
    data: {
      outletId,
      menuItemId: deal.id,
      modifierGroupId: optionalGroup.id,
      isActive: true,
      sortOrder: 1,
    },
  });

  return {
    item,
    linkedDealComponent,
    deal,
    optionalLink,
    requiredLink,
    cheese: optionalGroup.options.find((option) => option.name === "Visible cheese")!,
    limitedSauce: optionalGroup.options.find(
      (option) => option.name === "Limited sauce"
    )!,
    soldOutRelish: optionalGroup.options.find(
      (option) => option.name === "Sold out relish"
    )!,
    houseSauce: requiredGroup.options[0],
    dealOptionId: deal.upgradeOptions[0].id,
  };
}

async function main() {
  process.env.STRICT_DEAL_BASE_ENFORCEMENT = "true";
  await cleanup();
  const fixture = await seed();

  await expectCheckoutError(
    {
      orderType: "DINE_IN",
      paymentMethod: "CASH",
      expectedTotal: 0,
      items: [
        {
          menuItemId: fixture.item.id,
          qty: 1,
          addOnSetSelections: [
            {
              itemLinkId: fixture.optionalLink.id,
              optionIds: [fixture.cheese.id],
            },
          ],
        },
      ],
    },
    "MENU_MODIFIER_INVALID"
  );

  const snapshot = await buildCheckoutSnapshot(
    {
      orderType: "DINE_IN",
      paymentMethod: "CASH",
      expectedTotal: 0,
      items: [
        {
          menuItemId: fixture.item.id,
          qty: 2,
          addOnSetSelections: [
            {
              itemLinkId: fixture.optionalLink.id,
              optionIds: [fixture.cheese.id, fixture.limitedSauce.id],
            },
            {
              itemLinkId: fixture.requiredLink.id,
              optionIds: [fixture.houseSauce.id],
            },
          ],
        },
      ],
    },
    outletId
  );

  assert.equal(snapshot.subtotal, 24.5);
  assert.equal(snapshot.items[0].lineTotal, 24.5);
  assert.deepEqual(snapshot.items[0].addons, [
    { name: `${`Toppings ${shortRunId}`}: Visible cheese`, priceDelta: 1.5 },
    { name: `${`Toppings ${shortRunId}`}: Limited sauce`, priceDelta: 0.75 },
    { name: `${`Required sauce ${shortRunId}`}: House sauce`, priceDelta: 0 },
  ]);
  assert.deepEqual(snapshot.items[0].addOnSetSelections, [
    {
      itemLinkId: fixture.optionalLink.id,
      groupId: fixture.cheese.groupId,
      name: `Toppings ${shortRunId}`,
      options: [
        { id: fixture.cheese.id, name: "Visible cheese", priceDelta: 1.5 },
        { id: fixture.limitedSauce.id, name: "Limited sauce", priceDelta: 0.75 },
      ],
    },
    {
      itemLinkId: fixture.requiredLink.id,
      groupId: fixture.houseSauce.groupId,
      name: `Required sauce ${shortRunId}`,
      options: [{ id: fixture.houseSauce.id, name: "House sauce", priceDelta: 0 }],
    },
  ]);

  const orderItemCreates = buildOrderItemCreates(snapshot);
  assert.deepEqual(
    orderItemCreates[0].addOnSetSelectionsJson,
    snapshot.items[0].addOnSetSelections,
    "OrderItem creates should persist structured add-on set selections for Workspace order display.",
  );

  assert.deepEqual(snapshot.stockRequirements, [
    {
      targetType: "SHARED_MODIFIER_OPTION",
      targetId: fixture.limitedSauce.id,
      targetNameSnapshot: "Limited sauce",
      sharedModifierOptionId: fixture.limitedSauce.id,
      qty: 2,
      source: "SHARED_MODIFIER_OPTION",
      orderLineMenuItemId: fixture.item.id,
    },
  ]);

  const dealSnapshot = await buildCheckoutSnapshot(
    {
      orderType: "TAKEOUT",
      paymentMethod: "CASH",
      expectedTotal: 0,
      items: [
        {
          menuItemId: fixture.deal.id,
          qty: 1,
          selectedUpgradeOptionId: fixture.dealOptionId,
        },
      ],
    },
    outletId
  );
  assert.equal(dealSnapshot.subtotal, 9);
  assert.equal(dealSnapshot.items[0].lineTotal, 9);
  assert.deepEqual(
    dealSnapshot.items[0].addons,
    [],
    "Deal checkout should not snapshot add-on sets from the deal, base item, or linked component."
  );
  assert.deepEqual(
    dealSnapshot.items[0].addOnSetSelections,
    [],
    "Deal checkout should not require or snapshot add-on set selections."
  );
  assert.equal(
    dealSnapshot.items[0].selectedUpgradeSnapshot?.id,
    fixture.dealOptionId
  );
  assert.deepEqual(
    dealSnapshot.items[0].selectedUpgradeSnapshot?.linkedItems.map((link) => ({
      menuItemId: link.menuItemId,
      nameSnapshot: link.nameSnapshot,
    })),
    [
      {
        menuItemId: fixture.linkedDealComponent.id,
        nameSnapshot: fixture.linkedDealComponent.name,
      },
    ],
    "Deal checkout should keep the deal upgrade snapshot separate from add-on set snapshots."
  );

  const dealOrderItemCreates = buildOrderItemCreates(dealSnapshot);
  assert.deepEqual(dealOrderItemCreates[0].addonsJson, []);
  assert.deepEqual(
    dealOrderItemCreates[0].addOnSetSelectionsJson,
    [],
    "Deal order items should persist an empty structured add-on set snapshot."
  );
  assert.notEqual(
    dealOrderItemCreates[0].upgradeSnapshotJson,
    Prisma.JsonNull,
    "Deal order items should still persist the selected deal upgrade snapshot."
  );

  const scheduleNow = Date.now();
  await prisma.menuItem.update({
    where: { id: fixture.deal.id },
    data: {
      dealStartsAt: new Date(scheduleNow + 60 * 60 * 1000),
      dealExpiresAt: new Date(scheduleNow + 25 * 60 * 60 * 1000),
    },
  });
  await expectCheckoutError(
    {
      orderType: "TAKEOUT",
      paymentMethod: "CASH",
      expectedTotal: 0,
      items: [
        {
          menuItemId: fixture.deal.id,
          qty: 1,
          selectedUpgradeOptionId: fixture.dealOptionId,
        },
      ],
    },
    "MENU_ITEM_UNAVAILABLE"
  );

  await prisma.menuItem.update({
    where: { id: fixture.deal.id },
    data: {
      dealStartsAt: new Date(scheduleNow + 2 * 60 * 60 * 1000),
      dealExpiresAt: new Date(scheduleNow + 60 * 60 * 1000),
    },
  });
  await expectCheckoutError(
    {
      orderType: "TAKEOUT",
      paymentMethod: "CASH",
      expectedTotal: 0,
      items: [
        {
          menuItemId: fixture.deal.id,
          qty: 1,
          selectedUpgradeOptionId: fixture.dealOptionId,
        },
      ],
    },
    "MENU_ITEM_UNAVAILABLE"
  );

  await prisma.menuItem.update({
    where: { id: fixture.deal.id },
    data: {
      dealStartsAt: new Date(scheduleNow - 60 * 60 * 1000),
      dealExpiresAt: new Date(scheduleNow + 24 * 60 * 60 * 1000),
    },
  });

  await expectCheckoutError(
    {
      orderType: "DINE_IN",
      paymentMethod: "CASH",
      expectedTotal: 0,
      items: [
        {
          menuItemId: fixture.item.id,
          qty: 1,
          addOnSetSelections: [
            {
              itemLinkId: fixture.optionalLink.id,
              optionIds: [fixture.soldOutRelish.id],
            },
            {
              itemLinkId: fixture.requiredLink.id,
              optionIds: [fixture.houseSauce.id],
            },
          ],
        },
      ],
    },
    "MENU_STOCK_UNAVAILABLE"
  );

  await prisma.menuItem.update({
    where: { id: fixture.linkedDealComponent.id },
    data: { isOutOfStock: true },
  });
  await expectCheckoutError(
    {
      orderType: "TAKEOUT",
      paymentMethod: "CASH",
      expectedTotal: 0,
      items: [
        {
          menuItemId: fixture.deal.id,
          qty: 1,
          selectedUpgradeOptionId: fixture.dealOptionId,
        },
      ],
    },
    "MENU_ITEM_UNAVAILABLE"
  );

  await expectCheckoutError(
    {
      orderType: "TAKEOUT",
      paymentMethod: "CASH",
      expectedTotal: 0,
      items: [
        {
          menuItemId: fixture.deal.id,
          qty: 1,
          selectedUpgradeOptionId: fixture.dealOptionId,
          addOnSetSelections: [
            {
              itemLinkId: fixture.optionalLink.id,
              optionIds: [fixture.cheese.id],
            },
          ],
        },
      ],
    },
    "MENU_MODIFIER_INVALID"
  );
}

main()
  .then(async () => {
    await cleanup();
    console.log("Customer add-on set checkout tests passed.");
  })
  .catch(async (err) => {
    await cleanup().catch(() => {});
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
