import assert from "node:assert/strict";
import {
  DEAL_VISIBILITY_REASONS,
  getCompleteDealUpgradeLinks,
  isDealCustomerVisible,
  isStrictDealBaseEnforcementEnabled,
  type DealCustomerVisibilityLike,
} from "../src/lib/deal-base-validation";

const future = new Date("2026-05-08T12:00:00.000Z");
const now = new Date("2026-05-01T12:00:00.000Z");

const baseBurger = {
  id: "burger-1",
  outletId: "cafeteria",
  name: "Classic Cheeseburger",
  isActive: true,
  isOutOfStock: false,
  category: { slug: "burgers" },
  sizes: [],
};

const fries = {
  id: "fries-1",
  outletId: "cafeteria",
  name: "Golden Fries",
  isActive: true,
  isOutOfStock: false,
  category: { slug: "sides" },
  sizes: [],
};

const nestedDeal = {
  id: "deal-2",
  outletId: "cafeteria",
  name: "Nested Deal",
  isActive: true,
  isOutOfStock: false,
  category: { slug: "deals" },
  sizes: [],
};

function makeDeal(
  overrides: Partial<DealCustomerVisibilityLike> = {}
): DealCustomerVisibilityLike {
  return {
    id: "deal-1",
    name: "Classic Combo",
    outletId: "cafeteria",
    isActive: true,
    dealExpiresAt: future,
    dealBaseMenuItemId: baseBurger.id,
    dealBaseMenuItem: baseBurger,
    upgradeOptions: [
      {
        id: "upgrade-1",
        linkedItems: [
          {
            id: "link-1",
            linkedMenuItemId: fries.id,
            linkedSizeId: null,
            sizeNameSnapshot: null,
            linkedMenuItem: fries,
            linkedSize: null,
          },
        ],
      },
    ],
    ...overrides,
  };
}

assert.equal(isStrictDealBaseEnforcementEnabled({}), false);
assert.equal(
  isStrictDealBaseEnforcementEnabled({ STRICT_DEAL_BASE_ENFORCEMENT: "true" }),
  true
);
assert.equal(
  isStrictDealBaseEnforcementEnabled({ STRICT_DEAL_BASE_ENFORCEMENT: "1" }),
  true
);

const validDeal = makeDeal();
assert.equal(isDealCustomerVisible(validDeal, now).visible, true);
assert.equal(
  getCompleteDealUpgradeLinks(validDeal, validDeal.upgradeOptions[0]!).length,
  1
);

const missingBase = isDealCustomerVisible(
  makeDeal({ dealBaseMenuItemId: null, dealBaseMenuItem: null }),
  now
);
assert.equal(missingBase.visible, false);
assert.equal(missingBase.reason, DEAL_VISIBILITY_REASONS.NEEDS_REPAIR);

const unavailableBase = isDealCustomerVisible(
  makeDeal({
    dealBaseMenuItem: {
      ...baseBurger,
      isOutOfStock: true,
    },
  }),
  now
);
assert.equal(unavailableBase.visible, false);
assert.equal(unavailableBase.reason, DEAL_VISIBILITY_REASONS.BASE_UNAVAILABLE);

const pausedQuantityBase = isDealCustomerVisible(
  makeDeal({
    dealBaseMenuItem: {
      ...baseBurger,
      isOutOfStock: true,
      stockMode: "QUANTITY",
      stockQty: 8,
    },
  }),
  now
);
assert.equal(pausedQuantityBase.visible, false);
assert.equal(pausedQuantityBase.reason, DEAL_VISIBILITY_REASONS.BASE_UNAVAILABLE);

const nestedLinkDeal = makeDeal({
  upgradeOptions: [
    {
      id: "upgrade-1",
      linkedItems: [
        {
          id: "link-1",
          linkedMenuItemId: nestedDeal.id,
          linkedSizeId: null,
          sizeNameSnapshot: null,
          linkedMenuItem: nestedDeal,
          linkedSize: null,
        },
      ],
    },
  ],
});
const nestedLinkVisibility = isDealCustomerVisible(nestedLinkDeal, now);
assert.equal(nestedLinkVisibility.visible, false);
assert.equal(nestedLinkVisibility.reason, DEAL_VISIBILITY_REASONS.NEEDS_REPAIR);
assert.equal(
  getCompleteDealUpgradeLinks(
    nestedLinkDeal,
    nestedLinkDeal.upgradeOptions[0]!
  ).length,
  0
);

const partialOption = makeDeal({
  upgradeOptions: [
    {
      id: "upgrade-1",
      linkedItems: [
        {
          id: "link-1",
          linkedMenuItemId: fries.id,
          linkedSizeId: null,
          sizeNameSnapshot: null,
          linkedMenuItem: fries,
          linkedSize: null,
        },
        {
          id: "link-2",
          linkedMenuItemId: "drink-1",
          linkedSizeId: null,
          sizeNameSnapshot: null,
          linkedMenuItem: {
            id: "drink-1",
            outletId: "cafeteria",
            name: "Fountain Drink",
            isActive: true,
            isOutOfStock: true,
            category: { slug: "drinks" },
            sizes: [],
          },
          linkedSize: null,
        },
      ],
    },
  ],
});
const partialOptionVisibility = isDealCustomerVisible(partialOption, now);
assert.equal(partialOptionVisibility.visible, false);
assert.equal(
  partialOptionVisibility.reason,
  DEAL_VISIBILITY_REASONS.INCLUDED_ITEMS_UNAVAILABLE
);
assert.equal(
  getCompleteDealUpgradeLinks(partialOption, partialOption.upgradeOptions[0]!)
    .length,
  0
);

console.log("Strict deal visibility test passed.");
