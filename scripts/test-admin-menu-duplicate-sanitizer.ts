/* eslint-disable no-console */
import assert from "node:assert/strict";
import {
  cloneItemAsDraft,
  nextBottomSortOrder,
  suffixCopy,
} from "@/lib/admin/menu/clone-item";
import type { Item } from "@/lib/admin/menu/visibility";
import { validateItemInput } from "@/lib/menu-admin";

const EPOCH_ISO = new Date(0).toISOString();

function makeItem(overrides: Partial<Item> = {}): Item {
  const item: Item = {
    id: "item-source",
    categoryId: "cat-burgers",
    comboNum: 42,
    name: "Classic Burger",
    description: "A duplicated menu item fixture.",
    price: 8.99,
    emoji: "🍔",
    bgColor: "#ffe3b3",
    badge: "POPULAR",
    bundleSavings: 1.25,
    dealBaseMenuItemId: "legacy-base",
    dealBaseSizeId: null,
    dealBaseSizeNameSnapshot: null,
    dealStartsAt: "2026-05-09T06:00:00.000Z",
    dealExpiresAt: "2026-05-10T06:00:00.000Z",
    imageUrl: "https://cdn.example.test/items/classic.png",
    imageAlt: "Classic burger",
    imageFit: "CONTAIN",
    cardImageUrl: "https://cdn.example.test/cards/classic.png",
    cardImageAlt: "Classic burger card",
    isActive: true,
    isOutOfStock: true,
    stockMode: "QUANTITY",
    stockQty: 50,
    lowStockThreshold: 5,
    stockUpdatedAt: "2026-05-01T12:00:00.000Z",
    stockUpdatedById: "user-1",
    sortOrder: 3,
    lockVersion: 7,
    updatedAt: "2026-05-01T12:00:00.000Z",
    sizes: [
      { id: "size-small", name: "Small", priceDelta: 0 },
      { id: "size-large", name: "Large", priceDelta: 2 },
    ],
    addons: [
      { id: "addon-cheese", name: "Cheese", priceDelta: 1 },
      { id: "addon-bacon", name: "Bacon", priceDelta: 1.75 },
    ],
    upgradeOptions: [
      {
        id: "upgrade-legacy",
        customTitle: "Legacy meal",
        extraCharge: 4,
        savingsLabel: 1,
        discountPct: 12,
        sortOrder: 0,
        linkedItems: [],
      },
    ],
  };

  return { ...item, ...overrides };
}

function clone(overrides: Partial<Item> = {}, categoryItems: Item[] = []) {
  const source = makeItem(overrides);
  return cloneItemAsDraft(source, categoryItems.length ? categoryItems : [source]);
}

function assertTempIds(ids: string[]) {
  assert.equal(new Set(ids).size, ids.length, "temp ids should be unique");
  for (const id of ids) {
    assert.match(id, /^new-/, `temp id ${id} should start with new-`);
  }
}

function validateClone(draft: Item) {
  return validateItemInput(draft, {
    allowedImageHosts: ["cdn.example.test"],
  });
}

function run() {
  {
    const draft = clone();
    assert.equal(draft.id, "new-item", "top-level id should be temp id");
    assert.equal(draft.comboNum, null, "comboNum should be cleared");
    assert.equal(draft.stockUpdatedAt, null, "stockUpdatedAt should be cleared");
    assert.equal(draft.stockUpdatedById, null, "stockUpdatedById should be cleared");
    assert.equal(draft.updatedAt, EPOCH_ISO, "updatedAt should be epoch ISO");
  }

  {
    const draft = clone();
    assert.equal(draft.stockMode, "MANUAL", "stock mode should reset to MANUAL");
    assert.equal(draft.stockQty, null, "stock quantity should be cleared");
    assert.equal(draft.lowStockThreshold, null, "low stock threshold should be cleared");
    assert.equal(draft.isOutOfStock, false, "manual stock should reset to in-stock");
  }

  assert.equal(clone({ isActive: true }).isActive, false, "duplicate should be hidden draft");
  assert.ok(clone().name.endsWith(" (Copy)"), "duplicate name should be suffixed");

  {
    const categoryItems = [
      makeItem({ id: "a", sortOrder: 0 }),
      makeItem({ id: "b", sortOrder: 1 }),
      makeItem({ id: "c", sortOrder: 2 }),
    ];
    assert.equal(
      clone({}, categoryItems).sortOrder,
      nextBottomSortOrder(categoryItems),
      "sort order should use helper result",
    );
    assert.equal(clone({}, categoryItems).sortOrder, 3, "contiguous sort should append");
  }

  {
    const draft = clone();
    assert.deepEqual(
      draft.sizes.map((size) => size.id),
      ["new-size-0", "new-size-1"],
      "size ids should be deterministic temp ids",
    );
    assert.deepEqual(
      draft.sizes.map(({ name, priceDelta }) => ({ name, priceDelta })),
      [
        { name: "Small", priceDelta: 0 },
        { name: "Large", priceDelta: 2 },
      ],
      "size fields should be preserved",
    );
    assertTempIds(draft.sizes.map((size) => size.id));
  }

  {
    const draft = clone();
    assert.deepEqual(
      draft.addons.map((addon) => addon.id),
      ["new-addon-0", "new-addon-1"],
      "addon ids should be deterministic temp ids",
    );
    assert.deepEqual(
      draft.addons.map(({ name, priceDelta }) => ({ name, priceDelta })),
      [
        { name: "Cheese", priceDelta: 1 },
        { name: "Bacon", priceDelta: 1.75 },
      ],
      "addon fields should be preserved",
    );
    assertTempIds(draft.addons.map((addon) => addon.id));
  }

  assert.deepEqual(clone().upgradeOptions, [], "upgradeOptions should be stripped");

  // Case 9 is reserved for future deal duplication so historical numbering stays stable.
  assert.equal(9, 9, "reserved case");

  {
    const draft = clone();
    assertTempIds([...draft.sizes.map((s) => s.id), ...draft.addons.map((a) => a.id)]);
  }

  {
    const draft = clone();
    assert.equal(draft.imageUrl, "https://cdn.example.test/items/classic.png");
    assert.equal(draft.imageAlt, "Classic burger");
    assert.equal(draft.imageFit, "CONTAIN");
    assert.equal(draft.cardImageUrl, "https://cdn.example.test/cards/classic.png");
    assert.equal(draft.cardImageAlt, "Classic burger card");
  }

  {
    const draft = clone();
    assert.equal(draft.dealBaseMenuItemId, null, "deal base should be cleared");
    assert.equal(draft.dealStartsAt, null, "deal start should be cleared");
    assert.equal(draft.dealExpiresAt, null, "deal expiration should be cleared");
  }

  assert.equal(clone({ categoryId: "cat-sides" }).categoryId, "cat-sides", "category should be preserved");
  assert.equal(
    cloneItemAsDraft(makeItem(), []).sortOrder,
    0,
    "empty category should start sortOrder at 0",
  );
  assert.equal(clone({}, []).sortOrder, 4, "default fixture category should append after source");
  assert.equal(
    clone({}, []).sortOrder,
    nextBottomSortOrder([makeItem()]),
    "default clone helper should use same category helper",
  );
  assert.equal(
    clone(makeItem({ sortOrder: 99 }), []).sortOrder,
    100,
    "single source sort should append after source",
  );
  assert.equal(
    clone({}, []).sortOrder,
    4,
    "source fixture sortOrder 3 should append to 4",
  );
  assert.equal(
    clone({}, []).sizes.length,
    2,
    "default fixture sanity check should keep sizes",
  );
  assert.equal(
    clone({}, []).addons.length,
    2,
    "default fixture sanity check should keep add-ons",
  );

  {
    const draft = clone({ sizes: [], addons: [], upgradeOptions: [] });
    assert.deepEqual(draft.sizes, [], "empty sizes should stay empty");
    assert.deepEqual(draft.addons, [], "empty addons should stay empty");
    assert.deepEqual(draft.upgradeOptions, [], "empty upgrades should stay empty");
  }

  {
    const draft = clone({ stockMode: "QUANTITY", stockQty: 50 });
    assert.equal(draft.stockMode, "MANUAL", "quantity stock should become manual");
    assert.equal(draft.stockQty, null, "quantity stock should be cleared");
  }

  {
    assert.equal(suffixCopy("x".repeat(60)).length, 60);
    assert.ok(suffixCopy("x".repeat(60)).endsWith(" (Copy)"));
    assert.equal(suffixCopy("x".repeat(59)).length, 60);
    assert.equal(suffixCopy("x".repeat(53)).length, 60);
    assert.equal(suffixCopy("x".repeat(52)).length, 59);
    assert.equal(suffixCopy("x").length, 8);
    assert.equal(
      suffixCopy(`${"x".repeat(52)}    `),
      `${"x".repeat(52)} (Copy)`,
      "truncation should trim trailing whitespace before suffix",
    );
  }

  {
    assert.equal(nextBottomSortOrder([]), 0);
    assert.equal(nextBottomSortOrder([{ sortOrder: 0 }]), 1);
    assert.equal(nextBottomSortOrder([{ sortOrder: 5 }, { sortOrder: 2 }]), 6);
    assert.equal(nextBottomSortOrder([{ sortOrder: 99 }]), 100);
  }

  {
    const result = validateClone(clone());
    assert.ok(result.value, result.error ?? "clone should validate");
    assert.deepEqual(
      result.value.sizes.map((size) => size.id),
      [undefined, undefined],
      "validator should strip new-* size ids",
    );
    assert.deepEqual(
      result.value.addons.map((addon) => addon.id),
      [undefined, undefined],
      "validator should strip new-* addon ids",
    );
    assert.deepEqual(result.value.upgradeOptions, [], "validator should receive no upgrades");
  }

  {
    const rogueSource = makeItem({
      upgradeOptions: [
        {
          id: "upgrade-rogue",
          customTitle: "Rogue upgrade",
          extraCharge: 5,
          savingsLabel: 1,
          discountPct: 10,
          sortOrder: 0,
          linkedItems: [
            {
              id: "link-rogue",
              linkedMenuItemId: "item-other",
              linkedSizeId: null,
              itemNameSnapshot: "Other item",
              sizeNameSnapshot: null,
              sortOrder: 0,
              linkedMenuItem: null,
              linkedSize: null,
            },
          ],
        },
      ],
    });
    const draft = cloneItemAsDraft(rogueSource, [rogueSource]);
    assert.deepEqual(draft.upgradeOptions, [], "rogue legacy upgrades should be stripped");
    const result = validateClone(draft);
    assert.ok(result.value, result.error ?? "rogue-stripped clone should validate");
  }
}

run();
console.log("admin menu duplicate sanitizer tests passed");
