import assert from "node:assert/strict";
import { itemMatchesFilter, buildMatchContext } from "../src/lib/admin/filters/match";
import type { MenuFilterState } from "../src/lib/admin/filters/types";
import {
  buildLinkClassificationContext,
  classifyLink,
  dealBaseAvailabilityReason,
  itemVisibleInMenuFilter,
  type Cat,
  type Item,
  type UpgradeLink,
} from "../src/lib/admin/menu/visibility";
import {
  DEAL_VISIBILITY_REASONS,
  isDealCustomerVisible,
  isRequiredDealLinkCustomerRenderable,
} from "../src/lib/deal-base-validation";
import {
  normalizeDealShellStockInput,
  validateItemInput,
} from "../src/lib/menu-admin";
import { isMenuItemAvailable } from "../src/lib/menu-availability";

const NOW = new Date("2026-05-02T12:00:00.000Z");
const FUTURE = new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();

const burgers: Cat = {
  id: "cat-burgers",
  slug: "burgers",
  name: "Burgers",
  icon: "🍔",
  sortOrder: 1,
  isActive: true,
  updatedAt: NOW.toISOString(),
};

const sides: Cat = {
  id: "cat-sides",
  slug: "sides",
  name: "Sides",
  icon: "🍟",
  sortOrder: 2,
  isActive: true,
  updatedAt: NOW.toISOString(),
};

const deals: Cat = {
  id: "cat-deals",
  slug: "deals",
  name: "Deals",
  icon: "🔥",
  sortOrder: 0,
  isActive: true,
  updatedAt: NOW.toISOString(),
};

const categories = [deals, burgers, sides];

function makeItem(overrides: Partial<Item> & Pick<Item, "id" | "categoryId" | "name">): Item {
  const { id, categoryId, name, ...rest } = overrides;
  const defaults: Item = {
    id,
    categoryId,
    comboNum: null,
    name,
    description: "Test item",
    price: 5,
    emoji: "🍔",
    bgColor: "#fff3b0",
    badge: null,
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
    stockUpdatedById: null,
    sortOrder: 0,
    lockVersion: 0,
    updatedAt: NOW.toISOString(),
    sizes: [],
    addons: [],
    upgradeOptions: [],
  };
  return { ...defaults, ...rest };
}

function filter(overrides: Partial<MenuFilterState>): MenuFilterState {
  return {
    query: "",
    category: [],
    badge: undefined,
    status: undefined,
    stock: undefined,
    attention: [],
    ...overrides,
  };
}

const quantityInput = validateItemInput(
  {
    categoryId: burgers.id,
    name: "Quantity Burger",
    description: "Tracked stock item",
    price: 7.49,
    emoji: "🍔",
    bgColor: "#fff3b0",
    badge: null,
    bundleSavings: null,
    dealBaseMenuItemId: null,
    dealExpiresAt: null,
    imageUrl: null,
    imageAlt: null,
    imageFit: "COVER",
    cardImageUrl: null,
    cardImageAlt: null,
    isActive: true,
    isOutOfStock: true,
    stockMode: "QUANTITY",
    stockQty: 0,
    lowStockThreshold: 3,
    sortOrder: 0,
    sizes: [],
    addons: [],
    upgradeOptions: [],
  },
  { allowedImageHosts: [] }
);

assert.equal(quantityInput.error, undefined);
assert.equal(quantityInput.value?.stockMode, "QUANTITY");
assert.equal(quantityInput.value?.stockQty, 0);
assert.equal(quantityInput.value?.lowStockThreshold, 3);
assert.equal(
  quantityInput.value?.isOutOfStock,
  true,
  "Quantity mode must preserve the pause/sellability flag."
);
assert.ok(quantityInput.value);
assert.deepEqual(
  {
    stockMode: normalizeDealShellStockInput(quantityInput.value, true).stockMode,
    stockQty: normalizeDealShellStockInput(quantityInput.value, true).stockQty,
    lowStockThreshold: normalizeDealShellStockInput(quantityInput.value, true)
      .lowStockThreshold,
    isOutOfStock: normalizeDealShellStockInput(quantityInput.value, true).isOutOfStock,
  },
  {
    stockMode: "MANUAL",
    stockQty: null,
    lowStockThreshold: null,
    isOutOfStock: false,
  },
  "Deal shell stock must be normalized server-side."
);
assert.equal(
  normalizeDealShellStockInput(quantityInput.value, false).stockMode,
  "QUANTITY",
  "Non-deal stock mode must not be normalized away."
);

assert.equal(
  validateItemInput(
    {
      ...quantityInput.value,
      stockMode: "QUANTITY",
      stockQty: -1,
    },
    { allowedImageHosts: [] }
).error,
  "stock quantity must be a whole number 0 or greater"
);

const baseQtyZero = makeItem({
  id: "base-qty-zero",
  categoryId: burgers.id,
  name: "Base Qty Zero",
  stockMode: "QUANTITY",
  stockQty: 0,
});
const baseQtyTwo = makeItem({
  id: "base-qty-two",
  categoryId: burgers.id,
  name: "Base Qty Two",
  stockMode: "QUANTITY",
  stockQty: 2,
});
const sideQtyOne = makeItem({
  id: "side-qty-one",
  categoryId: sides.id,
  name: "Fries Qty One",
  stockMode: "QUANTITY",
  stockQty: 1,
});
const sideQtyZero = makeItem({
  id: "side-qty-zero",
  categoryId: sides.id,
  name: "Fries Qty Zero",
  stockMode: "QUANTITY",
  stockQty: 0,
});

assert.equal(isMenuItemAvailable(baseQtyZero), false);
assert.equal(isMenuItemAvailable(baseQtyTwo), true);

const matchCtx = buildMatchContext(
  [baseQtyZero, baseQtyTwo, sideQtyOne],
  categories,
  NOW.getTime()
);
assert.equal(
  itemMatchesFilter(baseQtyZero, burgers, filter({ stock: "out" }), matchCtx),
  true
);
assert.equal(
  itemMatchesFilter(baseQtyZero, burgers, filter({ stock: "in" }), matchCtx),
  false
);
assert.equal(
  itemMatchesFilter(baseQtyTwo, burgers, filter({ stock: "in" }), matchCtx),
  true
);

function linkFor(item: Item): UpgradeLink {
  return {
    id: `link-${item.id}`,
    linkedMenuItemId: item.id,
    linkedSizeId: null,
    itemNameSnapshot: item.name,
    sizeNameSnapshot: null,
    sortOrder: 0,
    linkedMenuItem: {
      id: item.id,
      name: item.name,
      emoji: item.emoji,
      bgColor: item.bgColor,
      isActive: item.isActive,
      isOutOfStock: item.isOutOfStock,
      stockMode: item.stockMode,
      stockQty: item.stockQty,
      lowStockThreshold: item.lowStockThreshold,
      price: item.price,
      sizeCount: item.sizes.length,
    },
    linkedSize: null,
  };
}

const dealWithUnavailableBase = makeItem({
  id: "deal-base-zero",
  categoryId: deals.id,
  name: "Deal Base Zero",
  dealBaseMenuItemId: baseQtyZero.id,
  dealExpiresAt: FUTURE,
  upgradeOptions: [
    {
      id: "upgrade-1",
      customTitle: null,
      extraCharge: 0,
      savingsLabel: null,
      discountPct: 10,
      sortOrder: 0,
      linkedItems: [linkFor(sideQtyOne)],
    },
  ],
});

const unavailableBaseCtx = buildLinkClassificationContext(
  [dealWithUnavailableBase, baseQtyZero, sideQtyOne],
  categories
);
assert.equal(
  dealBaseAvailabilityReason(dealWithUnavailableBase, unavailableBaseCtx),
  "Base item out of stock"
);
assert.equal(
  itemVisibleInMenuFilter(
    dealWithUnavailableBase,
    deals,
    NOW.getTime(),
    unavailableBaseCtx
  ),
  false
);

const dealWithAvailableBase = makeItem({
  id: "deal-base-two",
  categoryId: deals.id,
  name: "Deal Base Two",
  dealBaseMenuItemId: baseQtyTwo.id,
  dealExpiresAt: FUTURE,
  upgradeOptions: [
    {
      id: "upgrade-2",
      customTitle: null,
      extraCharge: 0,
      savingsLabel: null,
      discountPct: 10,
      sortOrder: 0,
      linkedItems: [linkFor(sideQtyOne)],
    },
  ],
});
const availableBaseCtx = buildLinkClassificationContext(
  [dealWithAvailableBase, baseQtyTwo, sideQtyOne],
  categories
);
assert.equal(
  itemVisibleInMenuFilter(
    dealWithAvailableBase,
    deals,
    NOW.getTime(),
    availableBaseCtx
  ),
  true
);

assert.deepEqual(
  classifyLink(linkFor(sideQtyZero), availableBaseCtx),
  { kind: "out-of-stock-item" }
);

const customerDeal = {
  id: dealWithAvailableBase.id,
  name: dealWithAvailableBase.name,
  outletId: "cafeteria",
  isActive: true,
  dealBaseMenuItemId: baseQtyTwo.id,
  dealBaseMenuItem: {
    id: baseQtyTwo.id,
    outletId: "cafeteria",
    name: baseQtyTwo.name,
    isActive: true,
    isOutOfStock: false,
    stockMode: "QUANTITY" as const,
    stockQty: 2,
    category: { id: burgers.id, slug: burgers.slug },
  },
  dealExpiresAt: FUTURE,
  upgradeOptions: [
    {
      id: "customer-upgrade",
      linkedItems: [
        {
          id: "customer-link",
          linkedMenuItemId: sideQtyOne.id,
          linkedSizeId: null,
          sizeNameSnapshot: null,
          linkedMenuItem: {
            id: sideQtyOne.id,
            outletId: "cafeteria",
            name: sideQtyOne.name,
            isActive: true,
            isOutOfStock: false,
            stockMode: "QUANTITY" as const,
            stockQty: 1,
            category: { id: sides.id, slug: sides.slug },
            sizes: [],
          },
          linkedSize: null,
        },
      ],
    },
  ],
};

assert.equal(
  isRequiredDealLinkCustomerRenderable(
    customerDeal,
    customerDeal.upgradeOptions[0].linkedItems[0]
  ),
  true
);
assert.equal(isDealCustomerVisible(customerDeal, NOW).visible, true);

const customerDealBaseUnavailable = {
  ...customerDeal,
  dealBaseMenuItem: {
    ...customerDeal.dealBaseMenuItem,
    stockQty: 0,
  },
};
const visibility = isDealCustomerVisible(customerDealBaseUnavailable, NOW);
assert.equal(visibility.visible, false);
assert.equal(visibility.reason, DEAL_VISIBILITY_REASONS.BASE_UNAVAILABLE);

console.log("Menu stock Slice 2/3 regression tests passed.");
