import assert from "node:assert/strict";
import {
  computeEffectiveModifierGroups,
  isReservedSyntheticModifierId,
  resolveSharedModifierSelectionRule,
  validateModifierOutletConsistency,
  validateModifierOverrideGroupConsistency,
  validateSharedModifierMoney,
  validateSharedModifierName,
  validateSharedModifierSelectionRule,
  type EffectiveMenuItemModifiersInput,
  type ModifierSelectionMode,
} from "@/lib/shared-modifier-library";

function assertOk<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.error);
  return result.value;
}

function assertNotOk(result: { ok: true; value: unknown } | { ok: false; error: string }) {
  assert.equal(result.ok, false, "expected validation failure");
}

const validRules: Array<[ModifierSelectionMode, number, number | null]> = [
  ["OPTIONAL_MULTI", 0, null],
  ["OPTIONAL_MULTI", 0, 3],
  ["REQUIRED_MULTI", 1, null],
  ["REQUIRED_MULTI", 2, 4],
  ["OPTIONAL_SINGLE", 0, 1],
  ["REQUIRED_SINGLE", 1, 1],
];

for (const [selectionMode, minSelect, maxSelect] of validRules) {
  assertOk(validateSharedModifierSelectionRule({ selectionMode, minSelect, maxSelect }));
}

assertNotOk(
  validateSharedModifierSelectionRule({
    selectionMode: "REQUIRED_MULTI",
    minSelect: 0,
    maxSelect: null,
  }),
);
assertNotOk(
  validateSharedModifierSelectionRule({
    selectionMode: "OPTIONAL_SINGLE",
    minSelect: 1,
    maxSelect: 1,
  }),
);
assertNotOk(
  validateSharedModifierSelectionRule({
    selectionMode: "REQUIRED_SINGLE",
    minSelect: 1,
    maxSelect: null,
  }),
);
assertNotOk(
  validateSharedModifierSelectionRule({
    selectionMode: "OPTIONAL_MULTI",
    minSelect: 3,
    maxSelect: 2,
  }),
);
assertNotOk(
  validateSharedModifierSelectionRule({
    selectionMode: "OPTIONAL_MULTI",
    minSelect: 0,
    maxSelect: 0,
  }),
);
assertNotOk(
  resolveSharedModifierSelectionRule(
    { selectionMode: "OPTIONAL_MULTI", minSelect: 0, maxSelect: null },
    { maxSelectOverride: 0 },
  ),
);

assert.deepEqual(
  assertOk(
    resolveSharedModifierSelectionRule(
      { selectionMode: "OPTIONAL_MULTI", minSelect: 0, maxSelect: 5 },
      { minSelectOverride: 2, maxSelectOverride: 4 },
    ),
  ),
  { selectionMode: "OPTIONAL_MULTI", minSelect: 2, maxSelect: 4 },
);

assert.equal(assertOk(validateSharedModifierMoney("0")), 0);
assert.equal(assertOk(validateSharedModifierMoney("12.34")), 12.34);
assert.equal(assertOk(validateSharedModifierMoney(12.3)), 12.3);
assert.equal(assertOk(validateSharedModifierMoney("999999.99")), 999999.99);
assertNotOk(validateSharedModifierMoney("1.239"));
assertNotOk(validateSharedModifierMoney("-1"));
assertNotOk(validateSharedModifierMoney("1000000"));
assertNotOk(validateSharedModifierMoney(Number.NaN));
assertNotOk(validateSharedModifierMoney("1e2"));

assert.equal(assertOk(validateSharedModifierName("  Sauces  ")), "Sauces");
assertNotOk(validateSharedModifierName("   "));

assertOk(
  validateModifierOutletConsistency({
    menuItemOutletId: "cafeteria",
    modifierGroupOutletId: "cafeteria",
    linkOutletId: "cafeteria",
  }),
);
assertNotOk(
  validateModifierOutletConsistency({
    menuItemOutletId: "cafeteria",
    modifierGroupOutletId: "truck",
    linkOutletId: "cafeteria",
  }),
);
assertNotOk(
  validateModifierOutletConsistency({
    menuItemOutletId: "cafeteria",
    modifierGroupOutletId: "cafeteria",
    linkOutletId: "truck",
  }),
);

assertOk(
  validateModifierOverrideGroupConsistency({
    linkModifierGroupId: "group-a",
    optionGroupId: "group-a",
  }),
);
assertNotOk(
  validateModifierOverrideGroupConsistency({
    linkModifierGroupId: "group-a",
    optionGroupId: "group-b",
  }),
);

assert.equal(isReservedSyntheticModifierId("legacy:addons:item-1"), true);
assert.equal(isReservedSyntheticModifierId("cm123"), false);

const fixture: EffectiveMenuItemModifiersInput = {
  id: "item-1",
  outletId: "cafeteria",
  modifierContractMode: "LEGACY",
  modifierGroupLinks: [
    {
      id: "link-optional",
      outletId: "cafeteria",
      sortOrder: 1,
      minSelectOverride: null,
      maxSelectOverride: null,
      isActive: true,
      modifierGroup: {
        id: "group-optional",
        outletId: "cafeteria",
        name: "Optional hidden",
        selectionMode: "OPTIONAL_MULTI",
        minSelect: 0,
        maxSelect: null,
        isActive: true,
        sortOrder: 1,
        options: [
          {
            id: "option-hidden",
            groupId: "group-optional",
            name: "Hidden",
            priceDelta: 1,
            isActive: true,
            sortOrder: 0,
          },
        ],
      },
      optionOverrides: [
        {
          modifierOptionId: "option-hidden",
          isHidden: true,
          priceDeltaOverride: null,
          sortOrderOverride: null,
        },
      ],
    },
    {
      id: "link-required",
      outletId: "cafeteria",
      sortOrder: 0,
      minSelectOverride: 2,
      maxSelectOverride: 3,
      isActive: true,
      modifierGroup: {
        id: "group-required",
        outletId: "cafeteria",
        name: "Required toppings",
        description: "Choose enough toppings",
        selectionMode: "REQUIRED_MULTI",
        minSelect: 1,
        maxSelect: null,
        isActive: true,
        sortOrder: 0,
        options: [
          {
            id: "option-cheese",
            groupId: "group-required",
            name: "Cheese",
            priceDelta: "1.00",
            isActive: true,
            sortOrder: 1,
          },
          {
            id: "option-bacon",
            groupId: "group-required",
            name: "Bacon",
            priceDelta: "2.00",
            isActive: true,
            sortOrder: 0,
          },
          {
            id: "option-wrong-group",
            groupId: "another-group",
            name: "Wrong group",
            priceDelta: "3.00",
            isActive: true,
            sortOrder: 2,
          },
        ],
      },
      optionOverrides: [
        {
          modifierOptionId: "option-bacon",
          isHidden: false,
          priceDeltaOverride: "2.50",
          sortOrderOverride: 5,
        },
      ],
    },
  ],
};

const effective = computeEffectiveModifierGroups(fixture);
assert.equal(effective.length, 1, "optional empty groups should be hidden");
assert.equal(effective[0].id, "group-required");
assert.equal(effective[0].minSelect, 2);
assert.equal(effective[0].maxSelect, 3);
assert.equal(effective[0].isRequiredBroken, false);
assert.deepEqual(
  effective[0].options.map((option) => [option.name, option.priceDelta]),
  [
    ["Cheese", 1],
    ["Bacon", 2.5],
  ],
);

const broken = computeEffectiveModifierGroups({
  ...fixture,
  modifierGroupLinks: [
    {
      ...fixture.modifierGroupLinks[1],
      minSelectOverride: 3,
    },
  ],
});
assert.equal(broken.length, 1);
assert.equal(broken[0].isRequiredBroken, true);

console.log("Shared modifier library Slice 1 helper tests passed.");
