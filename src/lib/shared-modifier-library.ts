export type ModifierSelectionMode =
  | "OPTIONAL_MULTI"
  | "REQUIRED_SINGLE"
  | "OPTIONAL_SINGLE"
  | "REQUIRED_MULTI";

export type ModifierContractMode = "LEGACY" | "SHARED" | "MIXED_COMPAT";

export type SharedModifierValidationResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export type SharedModifierSelectionRuleInput = {
  selectionMode: ModifierSelectionMode;
  minSelect: number;
  maxSelect: number | null;
};

export type SharedModifierSelectionOverrideInput = {
  minSelectOverride?: number | null;
  maxSelectOverride?: number | null;
};

export type EffectiveSharedModifierOptionInput = {
  id: string;
  groupId: string;
  name: string;
  priceDelta: number | string | { toString(): string };
  isActive: boolean;
  sortOrder: number;
};

export type EffectiveSharedModifierOptionOverrideInput = {
  modifierOptionId: string;
  isHidden: boolean;
  priceDeltaOverride: number | string | { toString(): string } | null;
  sortOrderOverride: number | null;
};

export type EffectiveSharedModifierGroupInput = {
  id: string;
  outletId: string;
  name: string;
  description?: string | null;
  selectionMode: ModifierSelectionMode;
  minSelect: number;
  maxSelect: number | null;
  isActive: boolean;
  sortOrder: number;
  options: EffectiveSharedModifierOptionInput[];
};

export type EffectiveMenuItemModifierGroupInput = {
  id: string;
  outletId: string;
  sortOrder: number;
  minSelectOverride: number | null;
  maxSelectOverride: number | null;
  isActive: boolean;
  modifierGroup: EffectiveSharedModifierGroupInput;
  optionOverrides: EffectiveSharedModifierOptionOverrideInput[];
};

export type EffectiveMenuItemModifiersInput = {
  id: string;
  outletId: string;
  modifierContractMode?: ModifierContractMode;
  modifierGroupLinks: EffectiveMenuItemModifierGroupInput[];
};

export type EffectiveSharedModifierOption = {
  id: string;
  name: string;
  priceDelta: number;
  sortOrder: number;
  isActive: boolean;
  isHidden: boolean;
};

export type EffectiveSharedModifierGroup = {
  id: string;
  itemLinkId: string;
  name: string;
  description: string | null;
  selectionMode: ModifierSelectionMode;
  minSelect: number;
  maxSelect: number | null;
  sortOrder: number;
  options: EffectiveSharedModifierOption[];
  isRequiredBroken: boolean;
};

export function normalizeSharedModifierName(value: string): string {
  return value.trim().toLowerCase();
}

export function isReservedSyntheticModifierId(value: string): boolean {
  return value.startsWith("legacy:");
}

export function isRequiredModifierMode(mode: ModifierSelectionMode): boolean {
  return mode === "REQUIRED_SINGLE" || mode === "REQUIRED_MULTI";
}

export function validateSharedModifierName(
  value: unknown,
  field = "name",
): SharedModifierValidationResult<string> {
  if (typeof value !== "string") {
    return { ok: false, error: `${field} must be a string` };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: false, error: `${field} is required` };
  }
  return { ok: true, value: trimmed };
}

export function validateSharedModifierMoney(
  value: unknown,
  field = "priceDelta",
): SharedModifierValidationResult<number> {
  if (typeof value !== "string" && typeof value !== "number") {
    return { ok: false, error: `${field} must be a valid amount 0 or greater` };
  }

  const raw = typeof value === "number" ? String(value) : value.trim();
  if (!raw) {
    return { ok: false, error: `${field} is required` };
  }
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(raw)) {
    return {
      ok: false,
      error: `${field} must be a non-negative amount with at most 2 decimal places`,
    };
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 999999.99) {
    return { ok: false, error: `${field} must fit Decimal(8, 2)` };
  }

  return { ok: true, value: parsed };
}

export function validateSharedModifierSelectionRule(
  input: SharedModifierSelectionRuleInput,
): SharedModifierValidationResult<SharedModifierSelectionRuleInput> {
  const { selectionMode, minSelect, maxSelect } = input;
  if (!Number.isInteger(minSelect) || minSelect < 0) {
    return { ok: false, error: "minSelect must be a whole number 0 or greater" };
  }
  if (maxSelect != null && (!Number.isInteger(maxSelect) || maxSelect < minSelect)) {
    return { ok: false, error: "maxSelect must be null or greater than or equal to minSelect" };
  }
  if (
    (selectionMode === "OPTIONAL_MULTI" || selectionMode === "REQUIRED_MULTI") &&
    maxSelect != null &&
    maxSelect < 1
  ) {
    return { ok: false, error: "multi-select maxSelect must be null or at least 1" };
  }

  if (selectionMode === "REQUIRED_MULTI" && minSelect < 1) {
    return { ok: false, error: "REQUIRED_MULTI requires minSelect of at least 1" };
  }
  if (selectionMode === "OPTIONAL_SINGLE" && (minSelect !== 0 || maxSelect !== 1)) {
    return { ok: false, error: "OPTIONAL_SINGLE requires minSelect 0 and maxSelect 1" };
  }
  if (selectionMode === "REQUIRED_SINGLE" && (minSelect !== 1 || maxSelect !== 1)) {
    return { ok: false, error: "REQUIRED_SINGLE requires minSelect 1 and maxSelect 1" };
  }

  return { ok: true, value: input };
}

export function resolveSharedModifierSelectionRule(
  group: SharedModifierSelectionRuleInput,
  override: SharedModifierSelectionOverrideInput = {},
): SharedModifierValidationResult<SharedModifierSelectionRuleInput> {
  return validateSharedModifierSelectionRule({
    selectionMode: group.selectionMode,
    minSelect: override.minSelectOverride ?? group.minSelect,
    maxSelect: override.maxSelectOverride ?? group.maxSelect,
  });
}

export function validateModifierOutletConsistency(input: {
  menuItemOutletId: string;
  modifierGroupOutletId: string;
  linkOutletId?: string | null;
}): SharedModifierValidationResult {
  if (input.menuItemOutletId !== input.modifierGroupOutletId) {
    return { ok: false, error: "modifier group belongs to another outlet" };
  }
  if (input.linkOutletId != null && input.linkOutletId !== input.menuItemOutletId) {
    return { ok: false, error: "item modifier link outlet does not match item outlet" };
  }
  return { ok: true, value: undefined };
}

export function validateModifierOverrideGroupConsistency(input: {
  linkModifierGroupId: string;
  optionGroupId: string;
}): SharedModifierValidationResult {
  if (input.linkModifierGroupId !== input.optionGroupId) {
    return { ok: false, error: "modifier option does not belong to the item modifier group" };
  }
  return { ok: true, value: undefined };
}

function decimalishToNumber(value: number | string | { toString(): string }): number {
  return typeof value === "number" ? value : Number(value.toString());
}

export function computeEffectiveModifierGroups(
  item: EffectiveMenuItemModifiersInput,
): EffectiveSharedModifierGroup[] {
  const groups: EffectiveSharedModifierGroup[] = [];

  for (const link of item.modifierGroupLinks) {
    const group = link.modifierGroup;
    if (!link.isActive || !group.isActive) continue;

    const outletCheck = validateModifierOutletConsistency({
      menuItemOutletId: item.outletId,
      modifierGroupOutletId: group.outletId,
      linkOutletId: link.outletId,
    });
    if (!outletCheck.ok) continue;

    const rule = resolveSharedModifierSelectionRule(group, {
      minSelectOverride: link.minSelectOverride,
      maxSelectOverride: link.maxSelectOverride,
    });
    if (!rule.ok) continue;

    const overrides = new Map(
      link.optionOverrides.map((override) => [override.modifierOptionId, override]),
    );
    const options = group.options
      .flatMap((option): EffectiveSharedModifierOption[] => {
        const groupCheck = validateModifierOverrideGroupConsistency({
          linkModifierGroupId: group.id,
          optionGroupId: option.groupId,
        });
        if (!groupCheck.ok || !option.isActive) return [];

        const override = overrides.get(option.id);
        if (override?.isHidden) return [];

        return [
          {
            id: option.id,
            name: option.name,
            priceDelta: decimalishToNumber(override?.priceDeltaOverride ?? option.priceDelta),
            sortOrder: override?.sortOrderOverride ?? option.sortOrder,
            isActive: option.isActive,
            isHidden: false,
          },
        ];
      })
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

    const isRequiredBroken = isRequiredModifierMode(rule.value.selectionMode)
      && options.length < rule.value.minSelect;
    if (options.length === 0 && !isRequiredBroken) continue;

    groups.push({
      id: group.id,
      itemLinkId: link.id,
      name: group.name,
      description: group.description ?? null,
      selectionMode: rule.value.selectionMode,
      minSelect: rule.value.minSelect,
      maxSelect: rule.value.maxSelect,
      sortOrder: link.sortOrder,
      options,
      isRequiredBroken,
    });
  }

  return groups.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}
