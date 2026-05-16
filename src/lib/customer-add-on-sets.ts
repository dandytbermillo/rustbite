import { isOptionAvailable, optionStockLabel } from "@/lib/option-stock";
import {
  isRequiredModifierMode,
  resolveSharedModifierSelectionRule,
  validateModifierOutletConsistency,
  validateModifierOverrideGroupConsistency,
  type ModifierSelectionMode,
} from "@/lib/shared-modifier-library";
import type { AddOnSetDTO, AddOnSetOptionDTO, MenuStockMode } from "@/lib/types";

type Decimalish = number | string | { toString(): string };

type CustomerAddOnOptionInput = {
  id: string;
  groupId: string;
  name: string;
  priceDelta: Decimalish;
  isActive: boolean;
  stockMode: MenuStockMode;
  isOutOfStock: boolean;
  stockQty: number | null;
  lowStockThreshold: number | null;
  sortOrder: number;
};

type CustomerAddOnOptionOverrideInput = {
  modifierOptionId: string;
  isHidden: boolean;
  priceDeltaOverride: Decimalish | null;
  sortOrderOverride: number | null;
};

type CustomerAddOnLinkInput = {
  id: string;
  outletId: string;
  sortOrder: number;
  minSelectOverride: number | null;
  maxSelectOverride: number | null;
  isActive: boolean;
  modifierGroup: {
    id: string;
    outletId: string;
    name: string;
    selectionMode: ModifierSelectionMode;
    minSelect: number;
    maxSelect: number | null;
    isActive: boolean;
    options: CustomerAddOnOptionInput[];
  };
  optionOverrides: CustomerAddOnOptionOverrideInput[];
};

export type CustomerAddOnSetItemInput = {
  id: string;
  outletId: string;
  modifierGroupLinks: CustomerAddOnLinkInput[];
};

function decimalishToNumber(value: Decimalish): number {
  return typeof value === "number" ? value : Number(value.toString());
}

function displayRuleText(input: {
  selectionMode: ModifierSelectionMode;
  minSelect: number;
  maxSelect: number | null;
}): string {
  if (input.selectionMode === "OPTIONAL_SINGLE") return "Choose up to 1";
  if (input.selectionMode === "REQUIRED_SINGLE") return "Choose 1";
  if (input.maxSelect == null) {
    return input.minSelect > 0 ? `Choose at least ${input.minSelect}` : "Choose any";
  }
  if (input.minSelect === 0) return `Choose up to ${input.maxSelect}`;
  if (input.minSelect === input.maxSelect) return `Choose ${input.minSelect}`;
  return `Choose ${input.minSelect}-${input.maxSelect}`;
}

function normalizeOptionStock(option: CustomerAddOnOptionInput) {
  const stockMode: MenuStockMode =
    option.stockMode === "QUANTITY" ? "QUANTITY" : "MANUAL";
  return {
    stockMode,
    isOutOfStock:
      stockMode === "QUANTITY" ? false : Boolean(option.isOutOfStock),
    stockQty: stockMode === "QUANTITY" ? option.stockQty ?? 0 : null,
    lowStockThreshold:
      stockMode === "QUANTITY" ? option.lowStockThreshold ?? null : null,
  };
}

function customerAddOnOption(
  option: CustomerAddOnOptionInput,
  override: CustomerAddOnOptionOverrideInput | undefined,
): AddOnSetOptionDTO | null {
  if (!option.isActive || override?.isHidden) return null;

  const stock = normalizeOptionStock(option);
  const isAvailable = isOptionAvailable(stock);
  return {
    id: option.id,
    groupId: option.groupId,
    name: option.name,
    priceDelta:
      override?.priceDeltaOverride != null
        ? decimalishToNumber(override.priceDeltaOverride)
        : decimalishToNumber(option.priceDelta),
    isAvailable,
    unavailableReason: isAvailable ? null : "OUT_OF_STOCK",
    quantityLabel:
      stock.stockMode === "QUANTITY" ? optionStockLabel(stock) : null,
    sortOrder: override?.sortOrderOverride ?? option.sortOrder,
  };
}

export function customerAddOnSetsForItem(
  item: CustomerAddOnSetItemInput,
): AddOnSetDTO[] {
  const sets: AddOnSetDTO[] = [];

  for (const link of item.modifierGroupLinks) {
    const group = link.modifierGroup;
    if (!link.isActive || !group.isActive) continue;

    const outletCheck = validateModifierOutletConsistency({
      menuItemOutletId: item.outletId,
      modifierGroupOutletId: group.outletId,
      linkOutletId: link.outletId,
    });
    if (!outletCheck.ok) continue;

    const rule = resolveSharedModifierSelectionRule(
      {
        selectionMode: group.selectionMode,
        minSelect: group.minSelect,
        maxSelect: group.maxSelect,
      },
      {
        minSelectOverride: link.minSelectOverride,
        maxSelectOverride: link.maxSelectOverride,
      },
    );
    if (!rule.ok) continue;

    const overrides = new Map(
      link.optionOverrides.map((override) => [override.modifierOptionId, override]),
    );
    const options = group.options
      .flatMap((option): AddOnSetOptionDTO[] => {
        if (
          !validateModifierOverrideGroupConsistency({
            linkModifierGroupId: group.id,
            optionGroupId: option.groupId,
          }).ok
        ) {
          return [];
        }
        const dto = customerAddOnOption(option, overrides.get(option.id));
        return dto ? [dto] : [];
      })
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

    const isRequired = isRequiredModifierMode(rule.value.selectionMode);
    const availableOptionCount = options.filter((option) => option.isAvailable).length;
    const isSatisfiable = availableOptionCount >= rule.value.minSelect;
    if (options.length === 0 && !isRequired) continue;

    sets.push({
      itemLinkId: link.id,
      groupId: group.id,
      name: group.name,
      displayRuleText: displayRuleText(rule.value),
      selectionMode: rule.value.selectionMode,
      minSelect: rule.value.minSelect,
      maxSelect: rule.value.maxSelect,
      isRequired,
      isSatisfiable,
      sortOrder: link.sortOrder,
      options,
    });
  }

  return sets.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export function blocksCustomerOrderingUntilAddOnSetsAreSelectable(
  addOnSets: readonly AddOnSetDTO[],
): boolean {
  return addOnSets.some((set) => set.isRequired && !set.isSatisfiable);
}
