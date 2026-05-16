import assert from "node:assert/strict";
import {
  isMenuItemAvailable,
  isQuantityTracked,
  type MenuAvailabilityInput,
} from "../src/lib/menu-availability";
import { validateItemInput } from "../src/lib/menu-admin";
import {
  hasOptionStockFields,
  isAddonOptionAvailable,
  isOptionLowStock,
  isSharedModifierOptionAvailable,
  optionStockLabel,
  stripOptionStockFields,
  validateOptionStockState,
} from "../src/lib/option-stock";

function item(overrides: Partial<MenuAvailabilityInput> = {}): MenuAvailabilityInput {
  return {
    isActive: true,
    isOutOfStock: false,
    stockMode: "MANUAL",
    stockQty: null,
    ...overrides,
  };
}

assert.equal(isQuantityTracked(item()), false);
assert.equal(isQuantityTracked(item({ stockMode: "QUANTITY" })), true);

assert.equal(isMenuItemAvailable(item()), true);
assert.equal(isMenuItemAvailable(item({ isOutOfStock: true })), false);
assert.equal(isMenuItemAvailable(item({ isActive: false })), false);

assert.equal(
  isMenuItemAvailable({
    isActive: true,
    isOutOfStock: false,
  }),
  true,
  "Missing stockMode must behave like legacy MANUAL mode."
);

assert.equal(
  isMenuItemAvailable(item({ stockMode: "QUANTITY", stockQty: 3 })),
  true
);
assert.equal(
  isMenuItemAvailable(item({ stockMode: "QUANTITY", stockQty: 0 })),
  false
);
assert.equal(
  isMenuItemAvailable(item({ stockMode: "QUANTITY", stockQty: null })),
  false
);
assert.equal(
  isMenuItemAvailable(
    item({ stockMode: "QUANTITY", stockQty: 2, isOutOfStock: true })
  ),
  false,
  "QUANTITY mode must honor the menu-item pause flag."
);
assert.equal(
  isMenuItemAvailable(item({ stockMode: "QUANTITY", stockQty: 2, isActive: false })),
  false,
  "Inactive must override quantity."
);

assert.equal(isAddonOptionAvailable({ stockMode: "MANUAL" }), true);
assert.equal(
  isAddonOptionAvailable({ stockMode: "MANUAL", isOutOfStock: true }),
  false
);
assert.equal(
  isAddonOptionAvailable({ stockMode: "QUANTITY", stockQty: 2, isOutOfStock: true }),
  true,
  "Option QUANTITY mode must ignore stale manual out-of-stock state."
);
assert.equal(
  isSharedModifierOptionAvailable({
    stockMode: "QUANTITY",
    stockQty: 2,
    isActive: false,
  }),
  false,
  "Inactive shared modifier options must not be available."
);
assert.equal(optionStockLabel({ stockMode: "QUANTITY", stockQty: 2 }), "2 left");
assert.equal(optionStockLabel({ stockMode: "MANUAL", isOutOfStock: true }), "Out");
assert.equal(
  isOptionLowStock({
    stockMode: "QUANTITY",
    stockQty: 2,
    lowStockThreshold: 3,
  }),
  true
);

const validOptionStock = validateOptionStockState({
  stockMode: "QUANTITY",
  stockQty: 4,
  lowStockThreshold: 2,
  isOutOfStock: true,
});
assert.equal(validOptionStock.ok, true);
if (validOptionStock.ok) {
  assert.deepEqual(validOptionStock.value, {
    stockMode: "QUANTITY",
    isOutOfStock: false,
    stockQty: 4,
    lowStockThreshold: 2,
  });
}
assert.deepEqual(
  validateOptionStockState({ stockMode: "QUANTITY", stockQty: -1 }),
  { ok: false, error: "stock quantity must be a non-negative integer" }
);
assert.equal(hasOptionStockFields({ name: "Extra", stockMode: "MANUAL" }), true);
assert.deepEqual(
  stripOptionStockFields({
    name: "Extra",
    priceDelta: 1,
    stockMode: "QUANTITY",
    stockQty: 4,
  }),
  { name: "Extra", priceDelta: 1 }
);

const modifierStockPayload = validateItemInput(
  {
    categoryId: "category-1",
    comboNum: null,
    name: "Stock Payload Guard",
    description: "Payload guard item",
    price: 1,
    emoji: "S",
    bgColor: "#ffffff",
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
    isOutOfStock: false,
    stockMode: "MANUAL",
    stockQty: null,
    lowStockThreshold: null,
    sortOrder: 0,
    sizes: [],
    addons: [
      {
        id: "addon-1",
        name: "Extra",
        priceDelta: 1,
        stockMode: "QUANTITY",
      },
    ],
    upgradeOptions: [],
  },
  { allowedImageHosts: [] }
);
assert.match(
  modifierStockPayload.error ?? "",
  /stock fields must use the stock controls/
);

const pausedQuantityItemPayload = validateItemInput(
  {
    categoryId: "category-1",
    comboNum: null,
    name: "Paused Quantity Item",
    description: "Quantity item paused for operations",
    price: 1,
    emoji: "Q",
    bgColor: "#ffffff",
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
    stockQty: 9,
    lowStockThreshold: 3,
    sortOrder: 0,
    sizes: [],
    addons: [],
    upgradeOptions: [],
  },
  { allowedImageHosts: [] }
);
assert.equal(pausedQuantityItemPayload.error, undefined);
assert.equal(
  pausedQuantityItemPayload.value?.isOutOfStock,
  true,
  "Admin item validation must preserve quantity-mode pause state."
);
assert.equal(pausedQuantityItemPayload.value?.stockQty, 9);

console.log("Menu stock Slice 1 helper tests passed.");
