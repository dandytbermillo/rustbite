/* eslint-disable no-console */
import assert from "node:assert/strict";

// Polyfill window + localStorage for the recent-filters module before
// importing it. The recent-filters module guards on typeof window, so
// installing both here lets the in-process test exercise the persistence
// path the way the browser would.
{
  const store = new Map<string, string>();
  const localStorageStub = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
  (globalThis as Record<string, unknown>).window = globalThis;
  (globalThis as Record<string, unknown>).localStorage = localStorageStub;
}

import type { Cat, Item } from "../src/lib/admin/menu/visibility";
import { dealExpirationSummary } from "../src/lib/admin/menu/visibility";
import {
  buildFieldCatalogue,
} from "../src/lib/admin/filters/fields";
import {
  parseInput,
  suggestStructuredPromotion,
} from "../src/lib/admin/filters/parser";
import {
  decodeFilter,
  encodeFilter,
  encodeFilterToString,
} from "../src/lib/admin/filters/url-state";
import {
  buildMatchContext,
  classifyItemStatus,
  itemMatchesFilter,
} from "../src/lib/admin/filters/match";
import type { MenuFilterState } from "../src/lib/admin/filters/types";

// ---------- Fixtures ----------
const NOW_MS = new Date("2026-05-02T12:00:00.000Z").getTime();
const FUTURE = new Date(NOW_MS + 7 * 86_400_000).toISOString();
const PAST = new Date(NOW_MS - 86_400_000).toISOString();
const SCHEDULED_START = new Date(NOW_MS + 60 * 60_000).toISOString();

const chicken: Cat = {
  id: "cat-chicken",
  slug: "chicken",
  name: "Chicken",
  icon: "🐔",
  sortOrder: 1,
  isActive: true,
  updatedAt: PAST,
};
const deals: Cat = {
  id: "cat-deals",
  slug: "deals",
  name: "Deals",
  icon: "🔥",
  sortOrder: 2,
  isActive: true,
  updatedAt: PAST,
};
const drinks: Cat = {
  id: "cat-drinks",
  slug: "drinks",
  name: "Drinks",
  icon: "🥤",
  sortOrder: 3,
  isActive: true,
  updatedAt: PAST,
};
const burgers: Cat = {
  id: "cat-burgers",
  slug: "burgers",
  name: "Burgers",
  icon: "🍔",
  sortOrder: 4,
  isActive: true,
  updatedAt: PAST,
};
const hiddenCategory: Cat = {
  id: "cat-archived",
  slug: "archived",
  name: "Archived",
  icon: "📦",
  sortOrder: 99,
  isActive: false,
  updatedAt: PAST,
};
const categories = [chicken, deals, drinks, burgers, hiddenCategory];

function makeItem(overrides: Partial<Item> & Pick<Item, "id" | "categoryId" | "name">): Item {
  const defaults: Item = {
    id: overrides.id,
    categoryId: overrides.categoryId,
    comboNum: null,
    name: overrides.name,
    description: "",
    price: 5,
    emoji: "🍗",
    bgColor: "#fff",
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
    updatedAt: PAST,
    sizes: [],
    addons: [],
    upgradeOptions: [],
  };
  return { ...defaults, ...overrides };
}

const liveChicken = makeItem({
  id: "i-chicken-live",
  categoryId: chicken.id,
  name: "Crispy Tender",
  badge: "HOT",
});
const hiddenChicken = makeItem({
  id: "i-chicken-hidden",
  categoryId: chicken.id,
  name: "Retired Wing",
  isActive: false,
});
const outOfStockChicken = makeItem({
  id: "i-chicken-oos",
  categoryId: chicken.id,
  name: "Bacon Cheddar",
  isOutOfStock: true,
});
const drink = makeItem({
  id: "i-drink",
  categoryId: drinks.id,
  name: "Soda",
});
const quantityOutBurger = makeItem({
  id: "i-burger-quantity-out",
  categoryId: burgers.id,
  name: "Quantity Out Burger",
  stockMode: "QUANTITY",
  stockQty: 0,
  lowStockThreshold: 3,
});
const lowStockBurger = makeItem({
  id: "i-burger-low",
  categoryId: burgers.id,
  name: "Low Stock Burger",
  stockMode: "QUANTITY",
  stockQty: 2,
  lowStockThreshold: 3,
});
const healthyQuantityBurger = makeItem({
  id: "i-burger-healthy",
  categoryId: burgers.id,
  name: "Healthy Quantity Burger",
  stockMode: "QUANTITY",
  stockQty: 4,
  lowStockThreshold: 3,
});
const noThresholdBurger = makeItem({
  id: "i-burger-no-threshold",
  categoryId: burgers.id,
  name: "No Threshold Burger",
  stockMode: "QUANTITY",
  stockQty: 2,
  lowStockThreshold: null,
});
const hiddenQuantityOutBurger = makeItem({
  id: "i-burger-hidden-quantity-out",
  categoryId: burgers.id,
  name: "Hidden Quantity Out Burger",
  isActive: false,
  stockMode: "QUANTITY",
  stockQty: 0,
  lowStockThreshold: 3,
});
const hiddenCategoryOutItem = makeItem({
  id: "i-hidden-category-out",
  categoryId: hiddenCategory.id,
  name: "Archived Out Item",
  isOutOfStock: true,
});

const baseBurger = makeItem({
  id: "i-burger-base",
  categoryId: chicken.id,
  name: "Classic Burger",
});
const dealItemLive = makeItem({
  id: "i-deal-live",
  categoryId: deals.id,
  name: "Combo Deal",
  badge: "HOT",
  dealBaseMenuItemId: baseBurger.id,
  dealExpiresAt: FUTURE,
  upgradeOptions: [
    {
      id: "u1",
      customTitle: null,
      extraCharge: 0,
      savingsLabel: null,
      discountPct: 10,
      sortOrder: 0,
      linkedItems: [
        {
          id: "l1",
          linkedMenuItemId: drink.id,
          linkedSizeId: null,
          itemNameSnapshot: "Soda",
          sizeNameSnapshot: null,
          sortOrder: 0,
          linkedMenuItem: {
            id: drink.id,
            name: drink.name,
            emoji: drink.emoji,
            bgColor: drink.bgColor,
            isActive: true,
            isOutOfStock: false,
            stockMode: "MANUAL",
            stockQty: null,
            price: 2,
            sizeCount: 0,
          },
          linkedSize: null,
        },
      ],
    },
  ],
});
const dealQuantityOutShell = makeItem({
  id: "i-deal-quantity-out-shell",
  categoryId: deals.id,
  name: "Quantity Out Deal Shell",
  isOutOfStock: true,
  stockMode: "QUANTITY",
  stockQty: 0,
  lowStockThreshold: 3,
  dealBaseMenuItemId: baseBurger.id,
  dealExpiresAt: FUTURE,
  upgradeOptions: dealItemLive.upgradeOptions,
});
const dealItemExpired = makeItem({
  id: "i-deal-expired",
  categoryId: deals.id,
  name: "Old Deal",
  dealBaseMenuItemId: baseBurger.id,
  dealExpiresAt: PAST,
  upgradeOptions: dealItemLive.upgradeOptions,
});
const dealItemScheduled = makeItem({
  id: "i-deal-scheduled",
  categoryId: deals.id,
  name: "Later Deal",
  dealBaseMenuItemId: baseBurger.id,
  dealStartsAt: SCHEDULED_START,
  dealExpiresAt: FUTURE,
  upgradeOptions: dealItemLive.upgradeOptions,
});
const dealItemHiddenAndExpired = makeItem({
  id: "i-deal-hidden-expired",
  categoryId: deals.id,
  name: "Retired Old Deal",
  isActive: false,
  dealBaseMenuItemId: baseBurger.id,
  dealExpiresAt: PAST,
  upgradeOptions: dealItemLive.upgradeOptions,
});
const dealBrokenOption = makeItem({
  id: "i-deal-broken",
  categoryId: deals.id,
  name: "Broken Deal",
  dealBaseMenuItemId: baseBurger.id,
  dealExpiresAt: FUTURE,
  upgradeOptions: [
    {
      id: "u-broken",
      customTitle: null,
      extraCharge: 0,
      savingsLabel: null,
      discountPct: 10,
      sortOrder: 0,
      linkedItems: [
        {
          id: "l-broken",
          linkedMenuItemId: null,
          linkedSizeId: null,
          itemNameSnapshot: "Missing Item",
          sizeNameSnapshot: null,
          sortOrder: 0,
          linkedMenuItem: null,
          linkedSize: null,
        },
      ],
    },
  ],
});

const items = [
  liveChicken,
  hiddenChicken,
  outOfStockChicken,
  drink,
  quantityOutBurger,
  lowStockBurger,
  healthyQuantityBurger,
  noThresholdBurger,
  hiddenQuantityOutBurger,
  hiddenCategoryOutItem,
  baseBurger,
  dealItemLive,
  dealQuantityOutShell,
  dealItemExpired,
  dealItemHiddenAndExpired,
  dealBrokenOption,
];

const catalogue = buildFieldCatalogue(categories);
const ctx = buildMatchContext(items, categories, NOW_MS);

const categoryOf = (item: Item): Cat => {
  const cat = categories.find((c) => c.id === item.categoryId);
  if (!cat) throw new Error(`No category for ${item.id}`);
  return cat;
};

function visibleIds(filter: MenuFilterState): string[] {
  return items
    .filter((i) => itemMatchesFilter(i, categoryOf(i), filter, ctx))
    .map((i) => i.id)
    .sort();
}

// ---------- Tests ----------

// Field catalogue must include inactive categories (admins manage them)
{
  const categoryEntry = catalogue.find((e) => e.key === "category");
  assert.ok(categoryEntry);
  const slugs = categoryEntry!.options.map((o) => o.value);
  assert.ok(slugs.includes("archived"), "field catalogue must include hidden categories");
  const archived = categoryEntry!.options.find((o) => o.value === "archived");
  assert.ok(archived?.label.includes("hidden"), "hidden category should be marked in label");
}

// Parser: structured + free text
{
  const result = parseInput("category:chicken live", catalogue);
  assert.deepEqual(result.category, ["chicken"]);
  assert.equal(result.query, "live");
}

// Parser: two structured tokens
{
  const result = parseInput("category:deals badge:HOT", catalogue);
  assert.deepEqual(result.category, ["deals"]);
  assert.equal(result.badge, "HOT");
  assert.equal(result.query, undefined);
}

// Parser: multi-select category accumulates values
{
  const result = parseInput("category:deals category:burgers category:chicken", catalogue);
  assert.deepEqual(result.category, ["deals", "burgers", "chicken"]);
}

// Parser: multi-select category dedupes
{
  const result = parseInput("category:deals category:deals", catalogue);
  assert.deepEqual(result.category, ["deals"]);
}

// Parser: single-select status follows last-wins (not multi)
{
  const result = parseInput("status:live status:hidden", catalogue);
  assert.equal(result.status, "hidden");
}

// Parser: unknown fields fall into free text, not dropped
{
  const result = parseInput("foo:bar burger", catalogue);
  assert.ok(result.query?.includes("foo:bar"), "unknown field token must stay in query");
  assert.ok(result.query?.includes("burger"));
}

// Parser: expires:<7d falls into free text (v1 defer regression)
{
  const result = parseInput("expires:<7d", catalogue);
  assert.equal(result.query, "expires:<7d");
  assert.equal((result as Record<string, unknown>).expires, undefined);
}

// Parser: invalid value for known field falls into free text
{
  const result = parseInput("status:bogus", catalogue);
  assert.equal(result.status, undefined);
  assert.equal(result.query, "status:bogus");
}

// Parser: bare values stay in query (never auto-promote)
{
  const result = parseInput("live HOT chicken", catalogue);
  assert.equal(result.status, undefined);
  assert.equal(result.badge, undefined);
  assert.ok(result.query?.includes("live"));
  assert.ok(result.query?.includes("HOT"));
  assert.ok(result.query?.includes("chicken"));
}

// suggestStructuredPromotion: known status value
{
  const suggestion = suggestStructuredPromotion("live", catalogue);
  assert.deepEqual(suggestion, { key: "status", value: "live" });
}

// suggestStructuredPromotion: known badge
{
  const suggestion = suggestStructuredPromotion("HOT", catalogue);
  assert.deepEqual(suggestion, { key: "badge", value: "HOT" });
}

// URL: empty state encodes to nothing
{
  assert.equal(encodeFilterToString({}), "");
}

// URL: encode roundtrip
{
  const filter: MenuFilterState = {
    category: ["deals"],
    badge: "HOT",
    status: "live",
    stock: "out",
    query: "burger",
  };
  const params = encodeFilter(filter);
  const decoded = decodeFilter(params, catalogue);
  assert.deepEqual(decoded, filter);
}

// URL: ?category=deals&badge=HOT decodes correctly (legacy single-value form)
{
  const params = new URLSearchParams("category=deals&badge=HOT");
  const decoded = decodeFilter(params, catalogue);
  assert.deepEqual(decoded, { category: ["deals"], badge: "HOT" });
}

// URL: repeated-key encoding for multi-select category
{
  const params = encodeFilter({ category: ["deals", "burgers"] });
  assert.deepEqual(params.getAll("category"), ["deals", "burgers"]);
}

// URL: repeated-key decoding roundtrip
{
  const params = new URLSearchParams("category=deals&category=burgers&category=chicken");
  const decoded = decodeFilter(params, catalogue);
  assert.deepEqual(decoded.category, ["deals", "burgers", "chicken"]);
}

// URL: empty category array does not encode
{
  const params = encodeFilter({ category: [] });
  assert.equal(params.getAll("category").length, 0);
}

// URL: invalid values dropped from multi-key, valid ones kept
{
  const params = new URLSearchParams("category=deals&category=nonsense&category=burgers");
  const decoded = decodeFilter(params, catalogue);
  assert.deepEqual(decoded.category, ["deals", "burgers"]);
}

// URL: invalid values are dropped
{
  const params = new URLSearchParams(
    "category=nonexistent&status=garbage&badge=NOPE&stock=meh&q=ok",
  );
  const decoded = decodeFilter(params, catalogue);
  assert.deepEqual(decoded, { query: "ok" });
}

// Status classification: customer-visible deal -> live
{
  assert.equal(classifyItemStatus(dealItemLive, deals, ctx), "live");
}

// Status classification: expired deal -> expired
{
  assert.equal(classifyItemStatus(dealItemExpired, deals, ctx), "expired");
}

// Status classification: scheduled deal -> scheduled
{
  assert.equal(classifyItemStatus(dealItemScheduled, deals, ctx), "scheduled");
}

// Deal summary: short active windows show minutes, not a rounded day.
{
  const dealMinutesLeft = makeItem({
    id: "i-deal-minutes-left",
    categoryId: deals.id,
    name: "Minutes Left Deal",
    dealExpiresAt: new Date(NOW_MS + 17 * 60_000).toISOString(),
  });
  assert.equal(dealExpirationSummary(dealMinutesLeft, NOW_MS), "17 min left");
}

// Deal summary: same-day active windows show hours/minutes, not a rounded day.
{
  const dealHoursLeft = makeItem({
    id: "i-deal-hours-left",
    categoryId: deals.id,
    name: "Hours Left Deal",
    dealExpiresAt: new Date(NOW_MS + 95 * 60_000).toISOString(),
  });
  assert.equal(dealExpirationSummary(dealHoursLeft, NOW_MS), "1h 35m left");
}

// Deal summary: scheduled deals use the same precise short-window formatter.
{
  const dealStartsSoon = makeItem({
    id: "i-deal-starts-soon",
    categoryId: deals.id,
    name: "Starts Soon Deal",
    dealStartsAt: new Date(NOW_MS + 12 * 60_000).toISOString(),
    dealExpiresAt: new Date(NOW_MS + 2 * 60 * 60_000).toISOString(),
  });
  assert.equal(dealExpirationSummary(dealStartsSoon, NOW_MS), "Starts in 12 min");
}

// Status classification: inactive + expired -> hidden (precedence)
{
  assert.equal(classifyItemStatus(dealItemHiddenAndExpired, deals, ctx), "hidden");
}

// Status classification: broken deal option -> null (no status bucket)
{
  assert.equal(classifyItemStatus(dealBrokenOption, deals, ctx), null);
}

// Status classification: live chicken -> live
{
  assert.equal(classifyItemStatus(liveChicken, chicken, ctx), "live");
}

// Status classification: out-of-stock chicken still classified by status (live)
{
  assert.equal(classifyItemStatus(outOfStockChicken, chicken, ctx), "live");
}

// Match: status:live for chicken returns visible chicken items (live + out-of-stock)
{
  const result = visibleIds({ status: "live" });
  assert.ok(result.includes(liveChicken.id));
  assert.ok(result.includes(outOfStockChicken.id));
  assert.ok(!result.includes(hiddenChicken.id));
  assert.ok(!result.includes(dealItemExpired.id));
  assert.ok(result.includes(dealItemLive.id));
  assert.ok(!result.includes(dealBrokenOption.id));
}

// Match: status:hidden returns manually inactive rows
{
  const result = visibleIds({ status: "hidden" });
  assert.ok(result.includes(hiddenChicken.id));
  assert.ok(result.includes(dealItemHiddenAndExpired.id));
  assert.ok(!result.includes(liveChicken.id));
}

// Match: status:expired returns expired deal rows
{
  const result = visibleIds({ status: "expired" });
  assert.ok(result.includes(dealItemExpired.id));
  assert.ok(!result.includes(dealItemLive.id));
  assert.ok(!result.includes(dealItemHiddenAndExpired.id), "hidden + expired -> hidden, not expired");
}

// Match: stock:out returns rows that are not currently sellable. Per
// isMenuItemAvailable in src/lib/menu-availability.ts, this includes
// manually out-of-stock items AND inactive (hidden) items because both
// short-circuit availability. Updated 2026-05-02 when the matcher was
// switched from item.isOutOfStock to isMenuItemAvailable.
{
  const result = visibleIds({ stock: "out" });
  assert.ok(result.includes(outOfStockChicken.id));
  assert.ok(result.includes(hiddenChicken.id));
}

// Match: stock:in excludes both out-of-stock and inactive rows.
{
  const result = visibleIds({ stock: "in" });
  assert.ok(!result.includes(outOfStockChicken.id));
  assert.ok(!result.includes(hiddenChicken.id));
  assert.ok(result.includes(liveChicken.id));
}

// Match: category:chicken + free-text "live" returns live chicken items
{
  const result = visibleIds({ category: ["chicken"], query: "live" });
  assert.ok(result.includes(liveChicken.id), "free-text 'live' should match status text on liveChicken");
}

// Match: free-text matches deal base item name
{
  const result = visibleIds({ query: "Classic Burger" });
  assert.ok(result.includes(dealItemLive.id), "deal should match by base item name");
}

// Match: category-name free-text returns ALL items in that category
{
  // Use "drinks" which is the category name AND not in any item's haystack
  // text. The drink item's name is "Soda", not "drinks".
  const result = visibleIds({ query: "drinks" });
  assert.ok(result.includes(drink.id), "category-name free-text should surface items in that category");
}

// Match: structured + free-text combine (AND)
{
  const result = visibleIds({ category: ["deals"], query: "Combo" });
  assert.ok(result.includes(dealItemLive.id));
  assert.ok(!result.includes(liveChicken.id));
}

// Match: multi-select category returns union of categories (OR within field)
{
  const result = visibleIds({ category: ["chicken", "drinks"] });
  assert.ok(result.includes(liveChicken.id));
  assert.ok(result.includes(drink.id));
  assert.ok(!result.includes(dealItemLive.id), "deal not in chicken or drinks");
}

// Match: empty category array means "no category filter" (matches all)
{
  const filterEmpty = visibleIds({});
  const filterAllEmpty = visibleIds({ category: [] });
  assert.deepEqual(filterAllEmpty, filterEmpty);
}

// isMenuFilterEmpty: attention-only filter is NOT empty (regression for the
// bug where the badge added the chip but no rows were filtered because
// isMenuFilterEmpty short-circuited the sections memo).
{
  const { isMenuFilterEmpty } = require("../src/lib/admin/filters/types") as typeof import("../src/lib/admin/filters/types");
  assert.equal(isMenuFilterEmpty({}), true);
  assert.equal(isMenuFilterEmpty({ attention: ["deals"] }), false);
  assert.equal(isMenuFilterEmpty({ attention: [] }), true);
}

// Attention: matches deals that are saved as live but unbuyable right now
// (expired, broken/incomplete options, base unavailable, etc.)
{
  const result = visibleIds({ attention: ["deals"] });
  // dealItemExpired is active+expired -> needs attention
  assert.ok(result.includes(dealItemExpired.id), "expired active deal should need attention");
  // dealBrokenOption is active with a broken upgrade link -> needs attention
  assert.ok(result.includes(dealBrokenOption.id), "broken-option deal should need attention");
  // dealItemLive is fully buyable -> not in the bucket
  assert.ok(!result.includes(dealItemLive.id), "live deal should NOT need attention");
  // dealItemHiddenAndExpired is inactive -> operator already paused it; not in the bucket
  assert.ok(!result.includes(dealItemHiddenAndExpired.id), "manually hidden deal should not surface in attention");
  // Non-deal items never match attention:deals
  assert.ok(!result.includes(liveChicken.id));
  assert.ok(!result.includes(outOfStockChicken.id));
}

// Attention: inventory-out matches active non-deal items that are unavailable
// now, and intentionally excludes hidden rows, hidden-category rows, and deal
// shells. This keeps the top-level admin notice focused on sellable catalogue
// items an operator can restock or return to stock.
{
  const result = visibleIds({ attention: ["inventory-out"] });
  assert.ok(result.includes(outOfStockChicken.id), "manual out-of-stock non-deal should need inventory attention");
  assert.ok(result.includes(quantityOutBurger.id), "quantity-tracked zero-stock non-deal should need inventory attention");
  assert.ok(!result.includes(lowStockBurger.id), "low-stock-but-available item is not inventory-out");
  assert.ok(!result.includes(hiddenChicken.id), "hidden non-deal should not surface in inventory-out notice");
  assert.ok(!result.includes(hiddenQuantityOutBurger.id), "hidden quantity item should not surface in inventory-out notice");
  assert.ok(!result.includes(hiddenCategoryOutItem.id), "hidden-category item should not surface in inventory-out notice");
  assert.ok(!result.includes(dealQuantityOutShell.id), "deal shell stock must not surface as non-deal inventory-out");
}

// Attention: inventory-low matches active non-deal quantity-tracked items at
// or below their configured threshold while still in stock. Items with no
// threshold are intentionally quiet.
{
  const result = visibleIds({ attention: ["inventory-low"] });
  assert.ok(result.includes(lowStockBurger.id), "quantity item at/below threshold should need low-stock attention");
  assert.ok(!result.includes(quantityOutBurger.id), "zero-stock item belongs to inventory-out, not low-stock");
  assert.ok(!result.includes(healthyQuantityBurger.id), "quantity above threshold should not be low-stock");
  assert.ok(!result.includes(noThresholdBurger.id), "quantity item without threshold should not be low-stock");
  assert.ok(!result.includes(hiddenQuantityOutBurger.id), "hidden quantity item should not surface in low-stock notice");
  assert.ok(!result.includes(hiddenCategoryOutItem.id), "hidden-category item should not surface in low-stock notice");
  assert.ok(!result.includes(dealQuantityOutShell.id), "deal shell stock must not surface as low-stock");
}

// Attention: multiple attention values are OR'd within the attention field.
{
  const result = visibleIds({ attention: ["inventory-out", "inventory-low"] });
  assert.ok(result.includes(outOfStockChicken.id));
  assert.ok(result.includes(quantityOutBurger.id));
  assert.ok(result.includes(lowStockBurger.id));
  assert.ok(!result.includes(healthyQuantityBurger.id));
}

// Parser: attention is a multi-key (accumulates like category)
{
  const result = parseInput(
    "attention:deals attention:inventory-out attention:inventory-low attention:deals",
    catalogue,
  );
  assert.deepEqual(result.attention, [
    "deals",
    "inventory-out",
    "inventory-low",
  ]);
}

// URL: attention encodes as repeated key
{
  const params = encodeFilter({
    attention: ["deals", "inventory-out", "inventory-low"],
  });
  assert.deepEqual(params.getAll("attention"), [
    "deals",
    "inventory-out",
    "inventory-low",
  ]);
}

// URL: attention decodes from repeated key
{
  const params = new URLSearchParams(
    "attention=deals&attention=inventory-out&attention=inventory-low",
  );
  const decoded = decodeFilter(params, catalogue);
  assert.deepEqual(decoded.attention, [
    "deals",
    "inventory-out",
    "inventory-low",
  ]);
}

// URL: invalid attention values are dropped
{
  const params = new URLSearchParams(
    "attention=nonsense&attention=deals&attention=inventory-low",
  );
  const decoded = decodeFilter(params, catalogue);
  assert.deepEqual(decoded.attention, ["deals", "inventory-low"]);
}

// Recent filters: diff records added values across single + multi keys.
{
  const recent = require("../src/lib/admin/filters/recent-filters") as typeof import("../src/lib/admin/filters/recent-filters");
  recent.__clearRecentFiltersForTest();

  // Apply badge=HOT, then category:deals,burgers, then status:hidden.
  recent.recordFilterUsage({}, { badge: "HOT" });
  recent.recordFilterUsage({ badge: "HOT" }, { badge: "HOT", category: ["deals", "burgers"] });
  recent.recordFilterUsage(
    { badge: "HOT", category: ["deals", "burgers"] },
    { badge: "HOT", category: ["deals", "burgers"], status: "hidden" },
  );

  const stored = recent.loadRecentFilters();
  // Most-recent-first; within a single diff, multi-key values preserve the
  // order they appear in the array (selection order from the builder modal
  // or click order in the dropdown).
  assert.deepEqual(stored, [
    { key: "status", value: "hidden" },
    { key: "category", value: "deals" },
    { key: "category", value: "burgers" },
    { key: "badge", value: "HOT" },
  ]);
}

// Recent filters: re-applying an entry moves it to the front (MRU dedup).
{
  const recent = require("../src/lib/admin/filters/recent-filters") as typeof import("../src/lib/admin/filters/recent-filters");
  recent.__clearRecentFiltersForTest();
  recent.recordFilterUsage({}, { badge: "HOT" });
  recent.recordFilterUsage({}, { badge: "DEAL" });
  recent.recordFilterUsage({}, { badge: "HOT" }); // re-apply
  const stored = recent.loadRecentFilters();
  assert.deepEqual(stored.map((e) => `${e.key}:${e.value}`), [
    "badge:HOT",
    "badge:DEAL",
  ]);
}

// Recent filters: cap at 5 entries.
{
  const recent = require("../src/lib/admin/filters/recent-filters") as typeof import("../src/lib/admin/filters/recent-filters");
  recent.__clearRecentFiltersForTest();
  // Apply 6 distinct categories
  recent.recordFilterUsage({}, { category: ["deals"] });
  recent.recordFilterUsage({}, { category: ["burgers"] });
  recent.recordFilterUsage({}, { category: ["chicken"] });
  recent.recordFilterUsage({}, { category: ["drinks"] });
  recent.recordFilterUsage({}, { category: ["archived"] });
  recent.recordFilterUsage({}, { status: "hidden" });
  const stored = recent.loadRecentFilters();
  assert.equal(stored.length, 5);
  // Oldest entry (deals) was evicted.
  assert.ok(!stored.some((e) => e.key === "category" && e.value === "deals"));
}

// Recent filters: getRecentFiltersExcludingActive hides currently-set chips.
{
  const recent = require("../src/lib/admin/filters/recent-filters") as typeof import("../src/lib/admin/filters/recent-filters");
  recent.__clearRecentFiltersForTest();
  recent.recordFilterUsage({}, { category: ["deals"] });
  recent.recordFilterUsage({}, { badge: "HOT" });
  // With category:deals currently active, it should be hidden from recents.
  const visible = recent.getRecentFiltersExcludingActive({ category: ["deals"] });
  assert.deepEqual(visible.map((e) => `${e.key}:${e.value}`), ["badge:HOT"]);
}

// Recent filters: removing a chip does NOT add it to recents.
{
  const recent = require("../src/lib/admin/filters/recent-filters") as typeof import("../src/lib/admin/filters/recent-filters");
  recent.__clearRecentFiltersForTest();
  recent.recordFilterUsage({ category: ["deals"] }, {});
  assert.deepEqual(recent.loadRecentFilters(), []);
}

// Match: badge:HOT
{
  const result = visibleIds({ badge: "HOT" });
  assert.ok(result.includes(liveChicken.id));
  assert.ok(result.includes(dealItemLive.id));
  assert.ok(!result.includes(drink.id));
}

console.log("Admin menu filter tests passed.");
