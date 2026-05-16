/* eslint-disable no-console */
import assert from "node:assert/strict";
import { parseAdminOrderAddOnSnapshots } from "@/lib/admin/order-add-on-snapshots";

const parsed = parseAdminOrderAddOnSnapshots([
  { name: "Extra pickles", priceDelta: "0.30" },
  { name: "salad set: extra cheese", priceDelta: 3.5 },
  { name: "salad set: oil", priceDelta: 0 },
  { name: "green salad: green salad", priceDelta: "0" },
  { name: "Staff note:", priceDelta: 9 },
  { name: ": missing set", priceDelta: 1 },
  { name: "" },
  null,
]);

assert.deepEqual(
  parsed.itemAddOns,
  [
    { name: "Extra pickles", priceDelta: 0.3 },
    { name: "Staff note:", priceDelta: 9 },
    { name: ": missing set", priceDelta: 1 },
  ],
  "Non-set add-ons and malformed flattened names should remain item add-ons.",
);

assert.deepEqual(
  parsed.addOnSets,
  [
    {
      name: "salad set",
      options: [
        { name: "extra cheese", priceDelta: 3.5 },
        { name: "oil", priceDelta: 0 },
      ],
    },
    {
      name: "green salad",
      options: [{ name: "green salad", priceDelta: 0 }],
    },
  ],
  "Flattened add-on set snapshots should be grouped by set name in order.",
);

const structuredParsed = parseAdminOrderAddOnSnapshots(
  [
    { name: "Sauce: spicy", priceDelta: "0.40" },
    { name: "salad set: extra cheese", priceDelta: 3.5 },
    { name: "salad set: oil", priceDelta: 0 },
  ],
  [
    {
      itemLinkId: "link_salad",
      groupId: "group_salad",
      name: "salad set",
      options: [
        { id: "option_cheese", name: "extra cheese", priceDelta: 3.5 },
        { id: "option_oil", name: "oil", priceDelta: 0 },
      ],
    },
  ],
);

assert.deepEqual(
  structuredParsed.itemAddOns,
  [{ name: "Sauce: spicy", priceDelta: 0.4 }],
  "Structured add-on set snapshots should keep item add-ons with colons as item add-ons.",
);

assert.deepEqual(
  structuredParsed.addOnSets,
  [
    {
      name: "salad set",
      options: [
        { name: "extra cheese", priceDelta: 3.5 },
        { name: "oil", priceDelta: 0 },
      ],
    },
  ],
  "Structured add-on set snapshots should be rendered from addOnSetSelectionsJson.",
);

const structuredNameCollisionParsed = parseAdminOrderAddOnSnapshots(
  [
    { name: "salad set: oil", priceDelta: 1.25 },
    { name: "salad set: oil", priceDelta: 0 },
  ],
  [
    {
      itemLinkId: "link_salad",
      groupId: "group_salad",
      name: "salad set",
      options: [{ id: "option_oil", name: "oil", priceDelta: 0 }],
    },
  ],
);

assert.deepEqual(
  structuredNameCollisionParsed.itemAddOns,
  [{ name: "salad set: oil", priceDelta: 1.25 }],
  "Structured snapshots should only consume the counted flat compatibility rows and keep same-name item add-ons.",
);

assert.deepEqual(
  structuredNameCollisionParsed.addOnSets,
  [
    {
      name: "salad set",
      options: [{ name: "oil", priceDelta: 0 }],
    },
  ],
  "Structured snapshots should still render the add-on set when a same-name item add-on exists.",
);

const emptyStructuredParsed = parseAdminOrderAddOnSnapshots(
  [{ name: "Sauce: spicy", priceDelta: 0.4 }],
  [],
);

assert.deepEqual(
  emptyStructuredParsed,
  {
    itemAddOns: [{ name: "Sauce: spicy", priceDelta: 0.4 }],
    addOnSets: [],
  },
  "An empty structured snapshot should disable flat-name grouping for new orders.",
);

assert.deepEqual(
  parseAdminOrderAddOnSnapshots(
    [{ name: "salad set: oil", priceDelta: 0 }],
    { broken: true },
  ),
  {
    itemAddOns: [],
    addOnSets: [
      {
        name: "salad set",
        options: [{ name: "oil", priceDelta: 0 }],
      },
    ],
  },
  "Malformed structured snapshots should fall back to the legacy flat parser.",
);

assert.deepEqual(
  parseAdminOrderAddOnSnapshots(null),
  { itemAddOns: [], addOnSets: [] },
  "Missing add-on snapshots should render as an empty display model.",
);

console.log("workspace order add-on snapshot display checks passed");
