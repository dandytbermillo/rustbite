import assert from "node:assert/strict";
import {
  computeCartTotals,
  formatStockUnavailableNotice,
  reconcileCustomizeDraftAgainstMenu,
  rebuildCartAgainstMenu,
} from "@/lib/kiosk-cart-reconcile";
import {
  getKioskLowStockLabel,
  getKioskLowStockMessage,
} from "@/lib/kiosk-stock-label";
import { computeLineTotal, round2 } from "@/lib/pricing";
import type { CartItemState, MenuItemDTO } from "@/lib/types";

function item(overrides: Partial<MenuItemDTO> = {}): MenuItemDTO {
  return {
    id: "burger-1",
    categoryId: "burgers",
    comboNum: null,
    name: "Classic Cheeseburger",
    description: "Single patty",
    price: 10,
    emoji: "burger",
    bgColor: "#fff3bf",
    badge: null,
    bundleSavings: null,
    imageUrl: null,
    imageAlt: null,
    imageFit: "COVER",
    cardImageUrl: null,
    cardImageAlt: null,
    isOutOfStock: false,
    stockMode: "MANUAL",
    stockQty: null,
    lowStockThreshold: null,
    sizes: [
      { id: "small", name: "Small", priceDelta: 0 },
      { id: "medium", name: "Medium", priceDelta: 2 },
    ],
    addons: [{ id: "cheese", name: "Extra cheese", priceDelta: 1 }],
    addOnSets: [],
    upgradeOptions: [],
    ...overrides,
  };
}

function line(menuItem: MenuItemDTO = item()): CartItemState {
  return {
    lineId: "line-1",
    item: menuItem,
    size: { id: "medium", name: "Medium", price: 2 },
    addons: [{ id: "cheese", name: "Extra cheese", price: 1 }],
    addOnSetSelections: [],
    selectedUpgradeOptionId: null,
    selectedUpgradeSnapshot: null,
    qty: 2,
  };
}

const draftLine = line();
assert.equal(computeLineTotal(draftLine), 26);
assert.equal(computeCartTotals([draftLine]).total, 27.3);

const itemWithAddOnSet = item({
  addons: [],
  addOnSets: [
    {
      itemLinkId: "link-toppings",
      groupId: "group-toppings",
      name: "Toppings",
      displayRuleText: "Choose up to 2",
      selectionMode: "OPTIONAL_MULTI",
      minSelect: 0,
      maxSelect: 2,
      isRequired: false,
      isSatisfiable: true,
      sortOrder: 1,
      options: [
        {
          id: "shared-cheese",
          groupId: "group-toppings",
          name: "Shared cheese",
          priceDelta: 1.5,
          isAvailable: true,
          unavailableReason: null,
          quantityLabel: null,
          sortOrder: 1,
        },
        {
          id: "shared-sauce",
          groupId: "group-toppings",
          name: "Shared sauce",
          priceDelta: 0.5,
          isAvailable: true,
          unavailableReason: null,
          quantityLabel: null,
          sortOrder: 2,
        },
      ],
    },
  ],
});
const sharedAddOnLine = line(itemWithAddOnSet);
sharedAddOnLine.addons = [];
sharedAddOnLine.addOnSetSelections = [
  {
    itemLinkId: "link-toppings",
    groupId: "group-toppings",
    name: "Old toppings",
    options: [{ id: "shared-cheese", name: "Old cheese", price: 0.75 }],
  },
];
assert.equal(computeLineTotal(sharedAddOnLine), 25.5);

const rebuiltSharedAddOnLine = rebuildCartAgainstMenu([sharedAddOnLine], {
  items: [itemWithAddOnSet],
});
assert.equal(rebuiltSharedAddOnLine.ok, true);
assert.deepEqual(
  rebuiltSharedAddOnLine.ok &&
    rebuiltSharedAddOnLine.cart[0].addOnSetSelections[0],
  {
    itemLinkId: "link-toppings",
    groupId: "group-toppings",
    name: "Toppings",
    options: [{ id: "shared-cheese", name: "Shared cheese", price: 1.5 }],
  }
);
assert.equal(rebuiltSharedAddOnLine.ok && rebuiltSharedAddOnLine.total, 28.35);

const hiddenSharedAddOn = rebuildCartAgainstMenu([sharedAddOnLine], {
  items: [
    item({
      addons: [],
      addOnSets: [
        {
          ...itemWithAddOnSet.addOnSets[0],
          options: [
            {
              ...itemWithAddOnSet.addOnSets[0].options[0],
              isAvailable: false,
              unavailableReason: "HIDDEN",
            },
          ],
        },
      ],
    }),
  ],
});
assert.equal(hiddenSharedAddOn.ok, false);

const overMaxSharedAddOnLine = line(itemWithAddOnSet);
overMaxSharedAddOnLine.addons = [];
overMaxSharedAddOnLine.addOnSetSelections = [
  {
    itemLinkId: "link-toppings",
    groupId: "group-toppings",
    name: "Toppings",
    options: [
      { id: "shared-cheese", name: "Shared cheese", price: 1.5 },
      { id: "shared-sauce", name: "Shared sauce", price: 0.5 },
      { id: "extra", name: "Unexpected extra", price: 0.25 },
    ],
  },
];
assert.equal(
  rebuildCartAgainstMenu([overMaxSharedAddOnLine], {
    items: [itemWithAddOnSet],
  }).ok,
  false
);

const unrelatedItem = item({
  id: "fries-1",
  categoryId: "sides",
  name: "Golden Fries",
  price: 3.29,
  sizes: [],
  addons: [],
});

const unrelatedRefresh = reconcileCustomizeDraftAgainstMenu(draftLine, {
  items: [
    item({
      description: "Copy changed elsewhere, price and selected modifiers unchanged",
    }),
    unrelatedItem,
  ],
});

assert.equal(unrelatedRefresh.ok, true);
assert.equal(unrelatedRefresh.ok && unrelatedRefresh.totalChanged, false);
assert.equal(
  unrelatedRefresh.ok && unrelatedRefresh.line.item.description,
  "Copy changed elsewhere, price and selected modifiers unchanged"
);
assert.equal(
  unrelatedRefresh.ok && computeLineTotal(unrelatedRefresh.line),
  computeLineTotal(draftLine)
);

const priceChanged = reconcileCustomizeDraftAgainstMenu(draftLine, {
  items: [item({ price: 11 })],
});
assert.equal(priceChanged.ok, true);
assert.equal(priceChanged.ok && priceChanged.totalChanged, true);

const addonRemoved = reconcileCustomizeDraftAgainstMenu(draftLine, {
  items: [item({ addons: [] })],
});
assert.equal(addonRemoved.ok, false);

const itemSoldOut = reconcileCustomizeDraftAgainstMenu(draftLine, {
  items: [item({ isOutOfStock: true })],
});
assert.equal(itemSoldOut.ok, false);

const pausedQuantityItem = reconcileCustomizeDraftAgainstMenu(draftLine, {
  items: [
    item({
      stockMode: "QUANTITY",
      stockQty: 55,
      isOutOfStock: true,
    }),
  ],
});
assert.equal(
  pausedQuantityItem.ok,
  false,
  "Paused quantity item must not remain orderable in a stale cart."
);

const rebuilt = rebuildCartAgainstMenu([draftLine], { items: [item()] });
assert.equal(rebuilt.ok, true);
assert.equal(rebuilt.ok && round2(rebuilt.total), 27.3);

const hiddenItem = rebuildCartAgainstMenu([draftLine], { items: [] });
assert.equal(hiddenItem.ok, false);
assert.equal(
  hiddenItem.ok ? "" : hiddenItem.message,
  "Classic Cheeseburger is no longer available. Remove it before paying."
);

const quantityTracked = item({
  stockMode: "QUANTITY",
  stockQty: 3,
});
const quantityLine = line(quantityTracked);
quantityLine.qty = 4;
const overQuantity = rebuildCartAgainstMenu([quantityLine], {
  items: [quantityTracked],
});
assert.equal(overQuantity.ok, false);
assert.match(
  overQuantity.ok ? "" : overQuantity.message,
  /Only 3 left for Classic Cheeseburger\. Lower the quantity from 4 before paying\./
);

const firstQuantityLine = line(quantityTracked);
firstQuantityLine.lineId = "quantity-line-1";
firstQuantityLine.qty = 2;
const secondQuantityLine = line(quantityTracked);
secondQuantityLine.lineId = "quantity-line-2";
secondQuantityLine.qty = 2;
const aggregatedOverQuantity = rebuildCartAgainstMenu(
  [firstQuantityLine, secondQuantityLine],
  { items: [quantityTracked] }
);
assert.equal(aggregatedOverQuantity.ok, false);
assert.match(
  aggregatedOverQuantity.ok ? "" : aggregatedOverQuantity.message,
  /Only 3 left for Classic Cheeseburger\. Lower the quantity from 4 before paying\./
);

firstQuantityLine.qty = 1;
secondQuantityLine.qty = 2;
const exactQuantity = rebuildCartAgainstMenu(
  [firstQuantityLine, secondQuantityLine],
  { items: [quantityTracked] }
);
assert.equal(exactQuantity.ok, true);

const limitedDeal = item({
  id: "deal-1",
  categoryId: "deals",
  name: "Mushroom Swiss",
  stockMode: "MANUAL",
  stockQty: null,
  dealLimitMode: "LIMITED",
  dealLimitQty: 2,
  dealLimitLowThreshold: 1,
  dealLimitSoldOut: false,
});
const overDealLimitLine = line(limitedDeal);
overDealLimitLine.qty = 3;
const overDealLimit = rebuildCartAgainstMenu([overDealLimitLine], {
  items: [limitedDeal],
});
assert.equal(overDealLimit.ok, false);
assert.match(
  overDealLimit.ok ? "" : overDealLimit.message,
  /Only 2 left for Mushroom Swiss\. Lower the quantity from 3 before paying\./
);

const soldOutLimitedDeal = item({
  ...limitedDeal,
  dealLimitQty: 0,
  dealLimitSoldOut: true,
  isOutOfStock: true,
});
const soldOutDealLine = line(soldOutLimitedDeal);
soldOutDealLine.qty = 1;
const soldOutDeal = rebuildCartAgainstMenu([soldOutDealLine], {
  items: [soldOutLimitedDeal],
});
assert.equal(soldOutDeal.ok, false);
assert.match(
  soldOutDeal.ok ? "" : soldOutDeal.message,
  /Mushroom Swiss is now out of stock\. Remove it before paying\./
);

assert.equal(
  getKioskLowStockLabel({
    ...quantityTracked,
    stockQty: 3,
    lowStockThreshold: 3,
  }),
  "Limited"
);
assert.equal(
  getKioskLowStockMessage({
    ...quantityTracked,
    stockQty: 3,
    lowStockThreshold: 3,
  }),
  "Only a few left."
);
assert.equal(
  getKioskLowStockLabel({
    ...quantityTracked,
    stockQty: 4,
    lowStockThreshold: 3,
  }),
  null
);
assert.equal(
  getKioskLowStockLabel({
    ...quantityTracked,
    stockQty: 3,
    lowStockThreshold: null,
  }),
  null
);
assert.equal(
  getKioskLowStockLabel({
    ...quantityTracked,
    stockQty: 0,
    lowStockThreshold: 3,
  }),
  null
);

assert.equal(
  formatStockUnavailableNotice([
    {
      menuItemId: "burger-1",
      nameSnapshot: "Bacon Cheddar",
      requestedQty: 4,
      availableQty: 3,
    },
  ]),
  "Only 3 left for Bacon Cheddar. Lower the quantity from 4 before paying."
);

assert.equal(
  formatStockUnavailableNotice([
    {
      menuItemId: "burger-1",
      nameSnapshot: "Bacon Cheddar",
      requestedQty: 1,
      availableQty: 0,
    },
  ]),
  "Bacon Cheddar is now out of stock. Remove it before paying."
);

console.log("Kiosk cart reconcile regression tests passed.");
