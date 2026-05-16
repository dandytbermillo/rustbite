import assert from "node:assert/strict";
import {
  buildAddonLibraryCandidates,
  type AddonAuditMenuItem,
} from "@/lib/admin/shared-modifier-audit";

function item(
  overrides: Partial<AddonAuditMenuItem> & Pick<AddonAuditMenuItem, "id" | "name" | "outletId">,
): AddonAuditMenuItem {
  const outletName = overrides.outletId === "truck" ? "Food Truck" : "Cafeteria";
  return {
    outletName,
    categorySlug: "burgers",
    categoryName: "Burgers",
    addons: [],
    ...overrides,
  };
}

const report = buildAddonLibraryCandidates([
  item({
    id: "burger-1",
    name: "Classic Burger",
    outletId: "cafeteria",
    addons: [
      { id: "a1", name: " Extra Cheese ", priceDelta: "1.00" },
      { id: "a2", name: "Bacon", priceDelta: "2.50" },
    ],
  }),
  item({
    id: "burger-2",
    name: "Double Burger",
    outletId: "cafeteria",
    addons: [
      { id: "a3", name: "bacon", priceDelta: "2.50" },
      { id: "a4", name: "extra cheese", priceDelta: "1.00" },
    ],
  }),
  item({
    id: "truck-burger",
    name: "Truck Burger",
    outletId: "truck",
    addons: [
      { id: "a5", name: "Bacon", priceDelta: "2.50" },
      { id: "a6", name: "Extra Cheese", priceDelta: "1.00" },
    ],
  }),
  item({
    id: "chicken-1",
    name: "Chicken Sandwich",
    outletId: "cafeteria",
    categorySlug: "chicken",
    categoryName: "Chicken",
    addons: [{ id: "a7", name: "Bacon", priceDelta: "2.00" }],
  }),
]);

assert.equal(report.candidates.length, 1, "exact candidates must not span outlets");
assert.equal(report.candidates[0].outletId, "cafeteria");
assert.equal(report.candidates[0].itemCount, 2);
assert.equal(report.candidates[0].optionCount, 2);
assert.deepEqual(
  report.candidates[0].items.map((entry) => entry.id),
  ["burger-1", "burger-2"],
);
assert.deepEqual(
  report.candidates[0].options.map((option) => [option.normalizedName, option.priceDelta]),
  [
    ["bacon", 2.5],
    ["extra cheese", 1],
  ],
);

assert.equal(report.outliers.length, 1, "same option name with price variants needs review");
assert.equal(report.outliers[0].outletId, "cafeteria");
assert.equal(report.outliers[0].normalizedName, "bacon");
assert.deepEqual(report.outliers[0].prices, [2, 2.5]);

const jsonBefore = JSON.stringify(report);
const repeat = buildAddonLibraryCandidates([
  item({
    id: "burger-2",
    name: "Double Burger",
    outletId: "cafeteria",
    addons: [
      { id: "a4", name: "extra cheese", priceDelta: "1.00" },
      { id: "a3", name: "bacon", priceDelta: "2.50" },
    ],
  }),
  item({
    id: "burger-1",
    name: "Classic Burger",
    outletId: "cafeteria",
    addons: [
      { id: "a2", name: "Bacon", priceDelta: "2.50" },
      { id: "a1", name: " Extra Cheese ", priceDelta: "1.00" },
    ],
  }),
]);
assert.equal(
  JSON.stringify(repeat.candidates),
  JSON.stringify(report.candidates),
  "candidate output should be deterministic for review",
);
assert.equal(jsonBefore.includes("truck-burger"), false, "cross-outlet exact match must stay separate");

console.log("Shared modifier library Slice 2 audit tests passed.");
