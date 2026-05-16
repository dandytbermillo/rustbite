import { ModifierSelectionMode, Prisma } from "@prisma/client";
import {
  isReservedSyntheticModifierId,
  resolveSharedModifierSelectionRule,
  validateSharedModifierMoney,
  validateSharedModifierName,
  validateSharedModifierSelectionRule,
  type SharedModifierValidationResult,
} from "@/lib/shared-modifier-library";
import {
  writeMenuAuditAndRevision,
  writeMenuAuditLog,
} from "@/lib/menu-history";
import { validateOptionStockState } from "@/lib/option-stock";

export const SHARED_MODIFIER_GROUP_INCLUDE = {
  options: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
} satisfies Prisma.SharedModifierGroupInclude;

export const ITEM_MODIFIER_LINK_INCLUDE = {
  modifierGroup: { include: SHARED_MODIFIER_GROUP_INCLUDE },
  optionOverrides: {
    orderBy: [{ createdAt: "asc" }],
    include: { modifierOption: true },
  },
} satisfies Prisma.MenuItemModifierGroupInclude;

const MODIFIER_SELECTION_MODES = [
  "OPTIONAL_MULTI",
  "REQUIRED_SINGLE",
  "OPTIONAL_SINGLE",
  "REQUIRED_MULTI",
] as const satisfies readonly ModifierSelectionMode[];

const GROUP_CREATE_KEYS = new Set([
  "name",
  "description",
  "selectionMode",
  "minSelect",
  "maxSelect",
  "sortOrder",
  "isActive",
]);
const GROUP_WITH_FIRST_OPTION_CREATE_KEYS = new Set(["group", "firstOption"]);
const GROUP_PATCH_KEYS = new Set([...GROUP_CREATE_KEYS, "lockVersion"]);
const OPTION_CREATE_KEYS = new Set([
  "lockVersion",
  "name",
  "priceDelta",
  "sortOrder",
  "isActive",
  "stockMode",
  "isOutOfStock",
  "stockQty",
  "lowStockThreshold",
]);
const OPTION_CREATE_WITHOUT_LOCK_KEYS = new Set(
  [...OPTION_CREATE_KEYS].filter((key) => key !== "lockVersion"),
);
const OPTION_PATCH_KEYS = new Set([
  "lockVersion",
  "name",
  "priceDelta",
  "sortOrder",
  "isActive",
]);
const LOCK_ONLY_KEYS = new Set(["lockVersion"]);
const ITEM_GROUP_ATTACH_KEYS = new Set([
  "lockVersion",
  "modifierGroupId",
  "sortOrder",
  "minSelectOverride",
  "maxSelectOverride",
  "isActive",
]);
const ITEM_GROUP_PATCH_KEYS = new Set([
  "lockVersion",
  "sortOrder",
  "minSelectOverride",
  "maxSelectOverride",
  "isActive",
]);
const ITEM_OPTION_OVERRIDE_PATCH_KEYS = new Set([
  "lockVersion",
  "isHidden",
  "priceDeltaOverride",
  "sortOrderOverride",
]);

type SharedModifierTx = Prisma.TransactionClient;

type SharedModifierGroupRecord = Prisma.SharedModifierGroupGetPayload<{
  include: typeof SHARED_MODIFIER_GROUP_INCLUDE;
}>;

type ItemModifierGroupLinkRecord = Prisma.MenuItemModifierGroupGetPayload<{
  include: typeof ITEM_MODIFIER_LINK_INCLUDE;
}>;

type ItemModifierOptionOverrideRecord =
  Prisma.MenuItemModifierOptionOverrideGetPayload<{
    include: { modifierOption: true };
  }>;

type SharedModifierOptionRecord = {
  id: string;
  groupId: string;
  name: string;
  priceDelta: Prisma.Decimal;
  isActive: boolean;
  stockMode: "MANUAL" | "QUANTITY";
  isOutOfStock: boolean;
  stockQty: number | null;
  lowStockThreshold: number | null;
  stockUpdatedAt: Date | null;
  stockUpdatedById: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

type SharedModifierStockMode = "MANUAL" | "QUANTITY";

type ModifierGroupWriteFields = {
  name: string;
  description: string | null;
  selectionMode: ModifierSelectionMode;
  minSelect: number;
  maxSelect: number | null;
  sortOrder: number;
  isActive: boolean;
};

export type ModifierGroupCreateInput = ModifierGroupWriteFields;

export type ModifierGroupPatchInput = {
  lockVersion: number;
  fields: Partial<ModifierGroupWriteFields>;
};

type ModifierOptionWriteFields = {
  name: string;
  priceDelta: number;
  sortOrder: number;
  isActive: boolean;
};

export type ModifierOptionCreateInput = ModifierOptionWriteFields & {
  lockVersion: number;
  stockMode: SharedModifierStockMode;
  isOutOfStock: boolean;
  stockQty: number | null;
  lowStockThreshold: number | null;
};

export type ModifierOptionCreateFields = Omit<
  ModifierOptionCreateInput,
  "lockVersion"
>;

export type ModifierGroupWithFirstOptionCreateInput = {
  group: ModifierGroupCreateInput;
  firstOption: ModifierOptionCreateFields;
};

export type ModifierOptionPatchInput = {
  lockVersion: number;
  fields: Partial<ModifierOptionWriteFields>;
};

export type ItemModifierGroupAttachInput = {
  lockVersion: number;
  modifierGroupId: string;
  sortOrder: number;
  minSelectOverride: number | null;
  maxSelectOverride: number | null;
  isActive: boolean;
};

export type ItemModifierGroupPatchInput = {
  lockVersion: number;
  fields: Partial<
    Pick<
      ItemModifierGroupAttachInput,
      "sortOrder" | "minSelectOverride" | "maxSelectOverride" | "isActive"
    >
  >;
};

export type ItemModifierOptionOverridePatchInput = {
  lockVersion: number;
  fields: {
    isHidden?: boolean;
    priceDeltaOverride?: number | null;
    sortOrderOverride?: number | null;
  };
};

export type LockVersionInput = {
  lockVersion: number;
};

export type SharedModifierAuditAction =
  | "MODIFIER_GROUP_CREATED"
  | "MODIFIER_GROUP_UPDATED"
  | "MODIFIER_GROUP_DEACTIVATED"
  | "MODIFIER_GROUP_HARD_DELETED"
  | "MODIFIER_OPTION_CREATED"
  | "MODIFIER_OPTION_UPDATED"
  | "MODIFIER_OPTION_DEACTIVATED"
  | "MODIFIER_OPTION_HARD_DELETED"
  | "ITEM_MODIFIER_GROUP_ATTACHED"
  | "ITEM_MODIFIER_GROUP_UPDATED"
  | "ITEM_MODIFIER_GROUP_DETACHED"
  | "ITEM_MODIFIER_OVERRIDE_UPDATED"
  | "ITEM_MODIFIER_OVERRIDE_CLEARED";

function ok<T>(value: T): SharedModifierValidationResult<T> {
  return { ok: true, value };
}

function err<T = never>(error: string): SharedModifierValidationResult<T> {
  return { ok: false, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function rejectUnknownKeys(raw: Record<string, unknown>, allowed: Set<string>) {
  const unknown = Object.keys(raw).find((key) => !allowed.has(key));
  return unknown ? `${unknown} is not allowed` : null;
}

function hasOwn(raw: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(raw, key);
}

function parseInteger(
  value: unknown,
  field: string,
  options: { min?: number; nullable?: boolean } = {}
): SharedModifierValidationResult<number | null> {
  if (value == null) {
    return options.nullable ? ok(null) : err(`${field} is required`);
  }
  if (!Number.isInteger(value)) {
    return err(`${field} must be a whole number`);
  }
  const parsed = Number(value);
  if (options.min != null && parsed < options.min) {
    return err(`${field} must be ${options.min} or greater`);
  }
  return ok(parsed);
}

function parseBoolean(
  value: unknown,
  field: string
): SharedModifierValidationResult<boolean> {
  if (typeof value !== "boolean") {
    return err(`${field} must be true or false`);
  }
  return ok(value);
}

function parseDescription(value: unknown) {
  if (value == null) return ok<string | null>(null);
  if (typeof value !== "string") return err<string | null>("description must be a string");
  const trimmed = value.trim();
  if (!trimmed) return ok<string | null>(null);
  if (trimmed.length > 240) {
    return err<string | null>("description must be 240 characters or fewer");
  }
  return ok<string | null>(trimmed);
}

function parseSelectionMode(
  value: unknown
): SharedModifierValidationResult<ModifierSelectionMode> {
  if (
    typeof value !== "string" ||
    !(MODIFIER_SELECTION_MODES as readonly string[]).includes(value)
  ) {
    return err("selectionMode is invalid");
  }
  return ok(value as ModifierSelectionMode);
}

function defaultSelectionRule(selectionMode: ModifierSelectionMode) {
  if (selectionMode === "OPTIONAL_SINGLE") {
    return { minSelect: 0, maxSelect: 1 };
  }
  if (selectionMode === "REQUIRED_SINGLE") {
    return { minSelect: 1, maxSelect: 1 };
  }
  if (selectionMode === "REQUIRED_MULTI") {
    return { minSelect: 1, maxSelect: null };
  }
  return { minSelect: 0, maxSelect: null };
}

function parseName(value: unknown, field = "name") {
  const parsed = validateSharedModifierName(value, field);
  if (!parsed.ok) return parsed;
  if (parsed.value.length > 80) {
    return err(`${field} must be 80 characters or fewer`);
  }
  return parsed;
}

function parseDatabaseId(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    return err<string>(`${field} is required`);
  }
  const trimmed = value.trim();
  if (isReservedSyntheticModifierId(trimmed)) {
    return err<string>(`${field} cannot use a reserved legacy id`);
  }
  return ok(trimmed);
}

function parseSortOrder(value: unknown) {
  return parseInteger(value, "sortOrder");
}

function parseLockVersion(raw: Record<string, unknown>) {
  return parseInteger(raw.lockVersion, "lockVersion", { min: 0 });
}

function parseOptionStockMode(
  value: unknown
): SharedModifierValidationResult<SharedModifierStockMode> {
  if (value === "MANUAL" || value === "QUANTITY") return ok(value);
  return err("stockMode is invalid");
}

function parseCreateOptionStockFields(
  raw: Record<string, unknown>
): SharedModifierValidationResult<{
  stockMode: SharedModifierStockMode;
  isOutOfStock: boolean;
  stockQty: number | null;
  lowStockThreshold: number | null;
}> {
  const stockMode = hasOwn(raw, "stockMode")
    ? parseOptionStockMode(raw.stockMode)
    : ok<SharedModifierStockMode>("MANUAL");
  if (!stockMode.ok) return stockMode;

  const isOutOfStock = hasOwn(raw, "isOutOfStock")
    ? parseBoolean(raw.isOutOfStock, "isOutOfStock")
    : ok(false);
  if (!isOutOfStock.ok) return isOutOfStock;

  const stockQty = hasOwn(raw, "stockQty")
    ? parseInteger(raw.stockQty, "stockQty", { min: 0, nullable: true })
    : ok<number | null>(null);
  if (!stockQty.ok) return stockQty;

  const lowStockThreshold = hasOwn(raw, "lowStockThreshold")
    ? parseInteger(raw.lowStockThreshold, "lowStockThreshold", {
        min: 0,
        nullable: true,
      })
    : ok<number | null>(null);
  if (!lowStockThreshold.ok) return lowStockThreshold;

  const stock = validateOptionStockState({
    stockMode: stockMode.value,
    isOutOfStock: isOutOfStock.value,
    stockQty: stockQty.value,
    lowStockThreshold: lowStockThreshold.value,
  });
  if (!stock.ok) return err(stock.error);

  return ok({
    stockMode: stock.value.stockMode === "QUANTITY" ? "QUANTITY" : "MANUAL",
    isOutOfStock: Boolean(stock.value.isOutOfStock),
    stockQty: stock.value.stockQty,
    lowStockThreshold: stock.value.lowStockThreshold,
  });
}

function parseGroupRuleFields(raw: Record<string, unknown>, current?: {
  selectionMode: ModifierSelectionMode;
  minSelect: number;
  maxSelect: number | null;
}) {
  const selectionMode =
    hasOwn(raw, "selectionMode")
      ? parseSelectionMode(raw.selectionMode)
      : ok(current?.selectionMode ?? "OPTIONAL_MULTI");
  if (!selectionMode.ok) return selectionMode;

  const defaults = defaultSelectionRule(selectionMode.value);
  const minSelect =
    hasOwn(raw, "minSelect")
      ? parseInteger(raw.minSelect, "minSelect", { min: 0 })
      : ok(current ? current.minSelect : defaults.minSelect);
  if (!minSelect.ok || minSelect.value == null) {
    return err(minSelect.ok ? "minSelect is required" : minSelect.error);
  }

  const maxSelect =
    hasOwn(raw, "maxSelect")
      ? parseInteger(raw.maxSelect, "maxSelect", { min: 0, nullable: true })
      : ok(current ? current.maxSelect : defaults.maxSelect);
  if (!maxSelect.ok) return maxSelect;

  return validateSharedModifierSelectionRule({
    selectionMode: selectionMode.value,
    minSelect: minSelect.value,
    maxSelect: maxSelect.value,
  });
}

export function validateCreateModifierGroupInput(
  raw: unknown
): SharedModifierValidationResult<ModifierGroupCreateInput> {
  if (!isRecord(raw)) return err("Body must be a JSON object");
  const unknown = rejectUnknownKeys(raw, GROUP_CREATE_KEYS);
  if (unknown) return err(unknown);

  const name = parseName(raw.name);
  if (!name.ok) return name;

  const description = hasOwn(raw, "description")
    ? parseDescription(raw.description)
    : ok<string | null>(null);
  if (!description.ok) return description;

  const rule = parseGroupRuleFields(raw);
  if (!rule.ok) return rule;

  const sortOrder = hasOwn(raw, "sortOrder") ? parseSortOrder(raw.sortOrder) : ok(0);
  if (!sortOrder.ok || sortOrder.value == null) {
    return err(sortOrder.ok ? "sortOrder is required" : sortOrder.error);
  }

  const isActive = hasOwn(raw, "isActive")
    ? parseBoolean(raw.isActive, "isActive")
    : ok(true);
  if (!isActive.ok) return isActive;

  return ok({
    name: name.value,
    description: description.value,
    selectionMode: rule.value.selectionMode,
    minSelect: rule.value.minSelect,
    maxSelect: rule.value.maxSelect,
    sortOrder: sortOrder.value,
    isActive: isActive.value,
  });
}

function parseModifierOptionCreateFields(
  raw: Record<string, unknown>
): SharedModifierValidationResult<ModifierOptionCreateFields> {
  const name = parseName(raw.name);
  if (!name.ok) return name;

  const priceDelta = hasOwn(raw, "priceDelta")
    ? validateSharedModifierMoney(raw.priceDelta)
    : ok(0);
  if (!priceDelta.ok) return priceDelta;

  const sortOrder = hasOwn(raw, "sortOrder") ? parseSortOrder(raw.sortOrder) : ok(0);
  if (!sortOrder.ok || sortOrder.value == null) {
    return err(sortOrder.ok ? "sortOrder is required" : sortOrder.error);
  }

  const isActive = hasOwn(raw, "isActive")
    ? parseBoolean(raw.isActive, "isActive")
    : ok(true);
  if (!isActive.ok) return isActive;

  const stock = parseCreateOptionStockFields(raw);
  if (!stock.ok) return stock;

  return ok({
    name: name.value,
    priceDelta: priceDelta.value,
    sortOrder: sortOrder.value,
    isActive: isActive.value,
    stockMode: stock.value.stockMode,
    isOutOfStock: stock.value.isOutOfStock,
    stockQty: stock.value.stockQty,
    lowStockThreshold: stock.value.lowStockThreshold,
  });
}

export function validateCreateModifierGroupWithFirstOptionInput(
  raw: unknown
): SharedModifierValidationResult<ModifierGroupWithFirstOptionCreateInput> {
  if (!isRecord(raw)) return err("Body must be a JSON object");
  const unknown = rejectUnknownKeys(raw, GROUP_WITH_FIRST_OPTION_CREATE_KEYS);
  if (unknown) return err(unknown);

  if (!isRecord(raw.group)) return err("group must be a JSON object");
  const group = validateCreateModifierGroupInput(raw.group);
  if (!group.ok) return group;

  if (!isRecord(raw.firstOption)) {
    return err("firstOption must be a JSON object");
  }
  const optionUnknown = rejectUnknownKeys(
    raw.firstOption,
    OPTION_CREATE_WITHOUT_LOCK_KEYS,
  );
  if (optionUnknown) return err(optionUnknown);

  const firstOption = parseModifierOptionCreateFields(raw.firstOption);
  if (!firstOption.ok) return firstOption;

  return ok({ group: group.value, firstOption: firstOption.value });
}

export function validatePatchModifierGroupInput(
  raw: unknown
): SharedModifierValidationResult<ModifierGroupPatchInput> {
  if (!isRecord(raw)) return err("Body must be a JSON object");
  const unknown = rejectUnknownKeys(raw, GROUP_PATCH_KEYS);
  if (unknown) return err(unknown);

  const lockVersion = parseLockVersion(raw);
  if (!lockVersion.ok || lockVersion.value == null) {
    return err(lockVersion.ok ? "lockVersion is required" : lockVersion.error);
  }

  const fields: Partial<ModifierGroupWriteFields> = {};
  if (hasOwn(raw, "name")) {
    const name = parseName(raw.name);
    if (!name.ok) return name;
    fields.name = name.value;
  }
  if (hasOwn(raw, "description")) {
    const description = parseDescription(raw.description);
    if (!description.ok) return description;
    fields.description = description.value;
  }
  if (hasOwn(raw, "selectionMode")) {
    const selectionMode = parseSelectionMode(raw.selectionMode);
    if (!selectionMode.ok) return selectionMode;
    fields.selectionMode = selectionMode.value;
  }
  if (hasOwn(raw, "minSelect")) {
    const minSelect = parseInteger(raw.minSelect, "minSelect", { min: 0 });
    if (!minSelect.ok || minSelect.value == null) {
      return err(minSelect.ok ? "minSelect is required" : minSelect.error);
    }
    fields.minSelect = minSelect.value;
  }
  if (hasOwn(raw, "maxSelect")) {
    const maxSelect = parseInteger(raw.maxSelect, "maxSelect", {
      min: 0,
      nullable: true,
    });
    if (!maxSelect.ok) return maxSelect;
    fields.maxSelect = maxSelect.value;
  }
  if (hasOwn(raw, "sortOrder")) {
    const sortOrder = parseSortOrder(raw.sortOrder);
    if (!sortOrder.ok || sortOrder.value == null) {
      return err(sortOrder.ok ? "sortOrder is required" : sortOrder.error);
    }
    fields.sortOrder = sortOrder.value;
  }
  if (hasOwn(raw, "isActive")) {
    const isActive = parseBoolean(raw.isActive, "isActive");
    if (!isActive.ok) return isActive;
    fields.isActive = isActive.value;
  }

  return ok({ lockVersion: lockVersion.value, fields });
}

export function validateNextModifierGroupRule(
  current: {
    selectionMode: ModifierSelectionMode;
    minSelect: number;
    maxSelect: number | null;
  },
  fields: Partial<ModifierGroupWriteFields>
) {
  return validateSharedModifierSelectionRule({
    selectionMode: fields.selectionMode ?? current.selectionMode,
    minSelect: fields.minSelect ?? current.minSelect,
    maxSelect: hasOwn(fields as Record<string, unknown>, "maxSelect")
      ? fields.maxSelect ?? null
      : current.maxSelect,
  });
}

export function validateCreateModifierOptionInput(
  raw: unknown
): SharedModifierValidationResult<ModifierOptionCreateInput> {
  if (!isRecord(raw)) return err("Body must be a JSON object");
  const unknown = rejectUnknownKeys(raw, OPTION_CREATE_KEYS);
  if (unknown) return err(unknown);

  const lockVersion = parseLockVersion(raw);
  if (!lockVersion.ok || lockVersion.value == null) {
    return err(lockVersion.ok ? "lockVersion is required" : lockVersion.error);
  }
  const fields = parseModifierOptionCreateFields(raw);
  if (!fields.ok) return fields;

  return ok({
    lockVersion: lockVersion.value,
    ...fields.value,
  });
}

export function validatePatchModifierOptionInput(
  raw: unknown
): SharedModifierValidationResult<ModifierOptionPatchInput> {
  if (!isRecord(raw)) return err("Body must be a JSON object");
  const unknown = rejectUnknownKeys(raw, OPTION_PATCH_KEYS);
  if (unknown) return err(unknown);

  const lockVersion = parseLockVersion(raw);
  if (!lockVersion.ok || lockVersion.value == null) {
    return err(lockVersion.ok ? "lockVersion is required" : lockVersion.error);
  }

  const fields: ModifierOptionPatchInput["fields"] = {};
  if (hasOwn(raw, "name")) {
    const name = parseName(raw.name);
    if (!name.ok) return name;
    fields.name = name.value;
  }
  if (hasOwn(raw, "priceDelta")) {
    const priceDelta = validateSharedModifierMoney(raw.priceDelta);
    if (!priceDelta.ok) return priceDelta;
    fields.priceDelta = priceDelta.value;
  }
  if (hasOwn(raw, "sortOrder")) {
    const sortOrder = parseSortOrder(raw.sortOrder);
    if (!sortOrder.ok || sortOrder.value == null) {
      return err(sortOrder.ok ? "sortOrder is required" : sortOrder.error);
    }
    fields.sortOrder = sortOrder.value;
  }
  if (hasOwn(raw, "isActive")) {
    const isActive = parseBoolean(raw.isActive, "isActive");
    if (!isActive.ok) return isActive;
    fields.isActive = isActive.value;
  }

  return ok({ lockVersion: lockVersion.value, fields });
}

export function validateLockVersionInput(
  raw: unknown
): SharedModifierValidationResult<LockVersionInput> {
  if (!isRecord(raw)) return err("Body must be a JSON object");
  const unknown = rejectUnknownKeys(raw, LOCK_ONLY_KEYS);
  if (unknown) return err(unknown);
  const lockVersion = parseLockVersion(raw);
  if (!lockVersion.ok || lockVersion.value == null) {
    return err(lockVersion.ok ? "lockVersion is required" : lockVersion.error);
  }
  return ok({ lockVersion: lockVersion.value });
}

function parseNullableOverrideInteger(
  raw: Record<string, unknown>,
  field: string
) {
  if (!hasOwn(raw, field)) return ok<number | null | undefined>(undefined);
  return parseInteger(raw[field], field, { min: 0, nullable: true });
}

function parseNullableMoneyOverride(
  raw: Record<string, unknown>,
  field: string
) {
  if (!hasOwn(raw, field)) return ok<number | null | undefined>(undefined);
  if (raw[field] == null) return ok<number | null>(null);
  const parsed = validateSharedModifierMoney(raw[field], field);
  if (!parsed.ok) return parsed;
  return ok<number | null>(parsed.value);
}

export function validateAttachItemModifierGroupInput(
  raw: unknown
): SharedModifierValidationResult<ItemModifierGroupAttachInput> {
  if (!isRecord(raw)) return err("Body must be a JSON object");
  const unknown = rejectUnknownKeys(raw, ITEM_GROUP_ATTACH_KEYS);
  if (unknown) return err(unknown);

  const lockVersion = parseLockVersion(raw);
  if (!lockVersion.ok || lockVersion.value == null) {
    return err(lockVersion.ok ? "lockVersion is required" : lockVersion.error);
  }
  const modifierGroupId = parseDatabaseId(raw.modifierGroupId, "modifierGroupId");
  if (!modifierGroupId.ok) return modifierGroupId;

  const sortOrder = hasOwn(raw, "sortOrder") ? parseSortOrder(raw.sortOrder) : ok(0);
  if (!sortOrder.ok || sortOrder.value == null) {
    return err(sortOrder.ok ? "sortOrder is required" : sortOrder.error);
  }
  const minSelectOverride = parseNullableOverrideInteger(raw, "minSelectOverride");
  if (!minSelectOverride.ok) return minSelectOverride;
  const maxSelectOverride = parseNullableOverrideInteger(raw, "maxSelectOverride");
  if (!maxSelectOverride.ok) return maxSelectOverride;
  const isActive = hasOwn(raw, "isActive")
    ? parseBoolean(raw.isActive, "isActive")
    : ok(true);
  if (!isActive.ok) return isActive;

  return ok({
    lockVersion: lockVersion.value,
    modifierGroupId: modifierGroupId.value,
    sortOrder: sortOrder.value,
    minSelectOverride: minSelectOverride.value ?? null,
    maxSelectOverride: maxSelectOverride.value ?? null,
    isActive: isActive.value,
  });
}

export function validatePatchItemModifierGroupInput(
  raw: unknown
): SharedModifierValidationResult<ItemModifierGroupPatchInput> {
  if (!isRecord(raw)) return err("Body must be a JSON object");
  const unknown = rejectUnknownKeys(raw, ITEM_GROUP_PATCH_KEYS);
  if (unknown) return err(unknown);

  const lockVersion = parseLockVersion(raw);
  if (!lockVersion.ok || lockVersion.value == null) {
    return err(lockVersion.ok ? "lockVersion is required" : lockVersion.error);
  }

  const fields: ItemModifierGroupPatchInput["fields"] = {};
  if (hasOwn(raw, "sortOrder")) {
    const sortOrder = parseSortOrder(raw.sortOrder);
    if (!sortOrder.ok || sortOrder.value == null) {
      return err(sortOrder.ok ? "sortOrder is required" : sortOrder.error);
    }
    fields.sortOrder = sortOrder.value;
  }
  const minSelectOverride = parseNullableOverrideInteger(raw, "minSelectOverride");
  if (!minSelectOverride.ok) return minSelectOverride;
  if (minSelectOverride.value !== undefined) {
    fields.minSelectOverride = minSelectOverride.value;
  }
  const maxSelectOverride = parseNullableOverrideInteger(raw, "maxSelectOverride");
  if (!maxSelectOverride.ok) return maxSelectOverride;
  if (maxSelectOverride.value !== undefined) {
    fields.maxSelectOverride = maxSelectOverride.value;
  }
  if (hasOwn(raw, "isActive")) {
    const isActive = parseBoolean(raw.isActive, "isActive");
    if (!isActive.ok) return isActive;
    fields.isActive = isActive.value;
  }

  return ok({ lockVersion: lockVersion.value, fields });
}

export function validatePatchItemModifierOptionOverrideInput(
  raw: unknown
): SharedModifierValidationResult<ItemModifierOptionOverridePatchInput> {
  if (!isRecord(raw)) return err("Body must be a JSON object");
  const unknown = rejectUnknownKeys(raw, ITEM_OPTION_OVERRIDE_PATCH_KEYS);
  if (unknown) return err(unknown);

  const lockVersion = parseLockVersion(raw);
  if (!lockVersion.ok || lockVersion.value == null) {
    return err(lockVersion.ok ? "lockVersion is required" : lockVersion.error);
  }

  const fields: ItemModifierOptionOverridePatchInput["fields"] = {};
  if (hasOwn(raw, "isHidden")) {
    const isHidden = parseBoolean(raw.isHidden, "isHidden");
    if (!isHidden.ok) return isHidden;
    fields.isHidden = isHidden.value;
  }
  const priceDeltaOverride = parseNullableMoneyOverride(raw, "priceDeltaOverride");
  if (!priceDeltaOverride.ok) return priceDeltaOverride;
  if (priceDeltaOverride.value !== undefined) {
    fields.priceDeltaOverride = priceDeltaOverride.value;
  }
  const sortOrderOverride = parseNullableOverrideInteger(raw, "sortOrderOverride");
  if (!sortOrderOverride.ok) return sortOrderOverride;
  if (sortOrderOverride.value !== undefined) {
    fields.sortOrderOverride = sortOrderOverride.value;
  }

  return ok({ lockVersion: lockVersion.value, fields });
}

export function modifierGroupDataFromFields(
  fields: Partial<ModifierGroupWriteFields>
): Prisma.SharedModifierGroupUpdateInput {
  const data: Prisma.SharedModifierGroupUpdateInput = {};
  if (fields.name != null) data.name = fields.name;
  if (hasOwn(fields as Record<string, unknown>, "description")) {
    data.description = fields.description ?? null;
  }
  if (fields.selectionMode != null) data.selectionMode = fields.selectionMode;
  if (fields.minSelect != null) data.minSelect = fields.minSelect;
  if (hasOwn(fields as Record<string, unknown>, "maxSelect")) {
    data.maxSelect = fields.maxSelect ?? null;
  }
  if (fields.sortOrder != null) data.sortOrder = fields.sortOrder;
  if (fields.isActive != null) data.isActive = fields.isActive;
  return data;
}

export function modifierOptionDataFromFields(
  fields: ModifierOptionPatchInput["fields"]
): Prisma.SharedModifierOptionUpdateInput {
  const data: Prisma.SharedModifierOptionUpdateInput = {};
  if (fields.name != null) data.name = fields.name;
  if (fields.priceDelta != null) {
    data.priceDelta = new Prisma.Decimal(fields.priceDelta);
  }
  if (fields.sortOrder != null) data.sortOrder = fields.sortOrder;
  if (fields.isActive != null) data.isActive = fields.isActive;
  return data;
}

export function itemModifierGroupDataFromFields(
  fields: ItemModifierGroupPatchInput["fields"]
): Prisma.MenuItemModifierGroupUpdateInput {
  const data: Prisma.MenuItemModifierGroupUpdateInput = {};
  if (fields.sortOrder != null) data.sortOrder = fields.sortOrder;
  if (hasOwn(fields as Record<string, unknown>, "minSelectOverride")) {
    data.minSelectOverride = fields.minSelectOverride ?? null;
  }
  if (hasOwn(fields as Record<string, unknown>, "maxSelectOverride")) {
    data.maxSelectOverride = fields.maxSelectOverride ?? null;
  }
  if (fields.isActive != null) data.isActive = fields.isActive;
  return data;
}

export function itemModifierOverrideDataFromFields(
  fields: ItemModifierOptionOverridePatchInput["fields"]
): Prisma.MenuItemModifierOptionOverrideUncheckedUpdateInput {
  const data: Prisma.MenuItemModifierOptionOverrideUncheckedUpdateInput = {};
  if (fields.isHidden != null) data.isHidden = fields.isHidden;
  if (hasOwn(fields as Record<string, unknown>, "priceDeltaOverride")) {
    data.priceDeltaOverride =
      fields.priceDeltaOverride == null
        ? null
        : new Prisma.Decimal(fields.priceDeltaOverride);
  }
  if (hasOwn(fields as Record<string, unknown>, "sortOrderOverride")) {
    data.sortOrderOverride = fields.sortOrderOverride ?? null;
  }
  return data;
}

export function hasModifierGroupChanges(
  current: SharedModifierGroupRecord,
  fields: Partial<ModifierGroupWriteFields>
) {
  return Object.entries(fields).some(([key, value]) => {
    if (key === "description") return current.description !== value;
    return current[key as keyof ModifierGroupWriteFields] !== value;
  });
}

export function hasModifierOptionChanges(
  current: SharedModifierOptionRecord,
  fields: ModifierOptionPatchInput["fields"]
) {
  return Object.entries(fields).some(([key, value]) => {
    if (key === "priceDelta") return Number(current.priceDelta) !== value;
    return current[key as keyof ModifierOptionWriteFields] !== value;
  });
}

export function hasItemModifierGroupChanges(
  current: ItemModifierGroupLinkRecord,
  fields: ItemModifierGroupPatchInput["fields"]
) {
  return Object.entries(fields).some(([key, value]) =>
    current[key as keyof ItemModifierGroupPatchInput["fields"]] !== value
  );
}

export function hasItemModifierOverrideChanges(
  current: ItemModifierOptionOverrideRecord | null,
  fields: ItemModifierOptionOverridePatchInput["fields"]
) {
  const next = {
    isHidden: fields.isHidden ?? current?.isHidden ?? false,
    priceDeltaOverride: hasOwn(fields as Record<string, unknown>, "priceDeltaOverride")
      ? fields.priceDeltaOverride ?? null
      : current?.priceDeltaOverride != null
        ? Number(current.priceDeltaOverride)
        : null,
    sortOrderOverride: hasOwn(fields as Record<string, unknown>, "sortOrderOverride")
      ? fields.sortOrderOverride ?? null
      : current?.sortOrderOverride ?? null,
  };
  if (!current) {
    return next.isHidden || next.priceDeltaOverride != null || next.sortOrderOverride != null;
  }
  return (
    current.isHidden !== next.isHidden ||
    (current.priceDeltaOverride != null ? Number(current.priceDeltaOverride) : null) !==
      next.priceDeltaOverride ||
    current.sortOrderOverride !== next.sortOrderOverride
  );
}

export function serializeSharedModifierOption(option: SharedModifierOptionRecord) {
  return {
    id: option.id,
    groupId: option.groupId,
    name: option.name,
    priceDelta: Number(option.priceDelta),
    isActive: option.isActive,
    stockMode: option.stockMode,
    isOutOfStock: option.isOutOfStock,
    stockQty: option.stockQty,
    lowStockThreshold: option.lowStockThreshold,
    stockUpdatedAt: option.stockUpdatedAt?.toISOString() ?? null,
    stockUpdatedById: option.stockUpdatedById,
    sortOrder: option.sortOrder,
    createdAt: option.createdAt.toISOString(),
    updatedAt: option.updatedAt.toISOString(),
  };
}

export function serializeSharedModifierGroup(group: SharedModifierGroupRecord) {
  return {
    id: group.id,
    outletId: group.outletId,
    name: group.name,
    description: group.description,
    selectionMode: group.selectionMode,
    minSelect: group.minSelect,
    maxSelect: group.maxSelect,
    isActive: group.isActive,
    sortOrder: group.sortOrder,
    lockVersion: group.lockVersion,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
    options: group.options.map(serializeSharedModifierOption),
  };
}

export function serializeItemModifierOptionOverride(
  override: ItemModifierOptionOverrideRecord
) {
  return {
    id: override.id,
    menuItemModifierGroupId: override.menuItemModifierGroupId,
    modifierOptionId: override.modifierOptionId,
    isHidden: override.isHidden,
    priceDeltaOverride:
      override.priceDeltaOverride != null ? Number(override.priceDeltaOverride) : null,
    sortOrderOverride: override.sortOrderOverride,
    createdAt: override.createdAt.toISOString(),
    updatedAt: override.updatedAt.toISOString(),
    modifierOption: serializeSharedModifierOption(override.modifierOption),
  };
}

export function serializeItemModifierGroupLink(link: ItemModifierGroupLinkRecord) {
  return {
    id: link.id,
    outletId: link.outletId,
    menuItemId: link.menuItemId,
    modifierGroupId: link.modifierGroupId,
    sortOrder: link.sortOrder,
    minSelectOverride: link.minSelectOverride,
    maxSelectOverride: link.maxSelectOverride,
    isActive: link.isActive,
    createdAt: link.createdAt.toISOString(),
    updatedAt: link.updatedAt.toISOString(),
    modifierGroup: serializeSharedModifierGroup(link.modifierGroup),
    optionOverrides: link.optionOverrides.map(serializeItemModifierOptionOverride),
  };
}

export function modifierOptionSnapshotFromRecord(option: SharedModifierOptionRecord) {
  return {
    id: option.id,
    groupId: option.groupId,
    name: option.name,
    priceDelta: Number(option.priceDelta),
    isActive: option.isActive,
    stockSnapshotVersion: 1,
    stockMode: option.stockMode,
    isOutOfStock:
      option.stockMode === "QUANTITY" ? false : option.isOutOfStock,
    stockQty: option.stockMode === "QUANTITY" ? option.stockQty ?? 0 : null,
    lowStockThreshold:
      option.stockMode === "QUANTITY" ? option.lowStockThreshold : null,
    stockUpdatedAt: option.stockUpdatedAt?.toISOString() ?? null,
    stockUpdatedById: option.stockUpdatedById,
    sortOrder: option.sortOrder,
  };
}

export function modifierGroupSnapshotFromRecord(group: SharedModifierGroupRecord) {
  return {
    id: group.id,
    outletId: group.outletId,
    name: group.name,
    description: group.description,
    selectionMode: group.selectionMode,
    minSelect: group.minSelect,
    maxSelect: group.maxSelect,
    isActive: group.isActive,
    sortOrder: group.sortOrder,
    lockVersion: group.lockVersion,
    options: group.options.map(modifierOptionSnapshotFromRecord),
  };
}

export function itemModifierOptionOverrideSnapshotFromRecord(
  override: ItemModifierOptionOverrideRecord
) {
  return {
    id: override.id,
    menuItemModifierGroupId: override.menuItemModifierGroupId,
    modifierOptionId: override.modifierOptionId,
    optionName: override.modifierOption.name,
    optionGroupId: override.modifierOption.groupId,
    isHidden: override.isHidden,
    priceDeltaOverride:
      override.priceDeltaOverride != null ? Number(override.priceDeltaOverride) : null,
    sortOrderOverride: override.sortOrderOverride,
  };
}

export function itemModifierGroupLinkSnapshotFromRecord(
  link: ItemModifierGroupLinkRecord
) {
  return {
    id: link.id,
    outletId: link.outletId,
    menuItemId: link.menuItemId,
    modifierGroupId: link.modifierGroupId,
    sortOrder: link.sortOrder,
    minSelectOverride: link.minSelectOverride,
    maxSelectOverride: link.maxSelectOverride,
    isActive: link.isActive,
    modifierGroup: modifierGroupSnapshotFromRecord(link.modifierGroup),
    optionOverrides: link.optionOverrides.map(
      itemModifierOptionOverrideSnapshotFromRecord
    ),
  };
}

export async function isModifierGroupAttachedToActiveItem(
  tx: SharedModifierTx,
  groupId: string
) {
  const count = await tx.menuItemModifierGroup.count({
    where: {
      modifierGroupId: groupId,
      isActive: true,
      menuItem: { isActive: true },
    },
  });
  return count > 0;
}

export function validateItemModifierGroupRule(input: {
  selectionMode: ModifierSelectionMode;
  minSelect: number;
  maxSelect: number | null;
  minSelectOverride?: number | null;
  maxSelectOverride?: number | null;
}) {
  return resolveSharedModifierSelectionRule(
    {
      selectionMode: input.selectionMode,
      minSelect: input.minSelect,
      maxSelect: input.maxSelect,
    },
    {
      minSelectOverride: input.minSelectOverride,
      maxSelectOverride: input.maxSelectOverride,
    }
  );
}

export async function writeSharedModifierAudit(
  tx: SharedModifierTx,
  input: {
    actionType: SharedModifierAuditAction;
    targetType:
      | "MODIFIER_GROUP"
      | "MODIFIER_OPTION"
      | "ITEM_MODIFIER_GROUP"
      | "ITEM_MODIFIER_OVERRIDE";
    outletId: string;
    targetId: string;
    targetLabel: string;
    beforePayload?: Prisma.InputJsonValue;
    afterPayload?: Prisma.InputJsonValue;
    affectsAttachedMenu: boolean;
  }
) {
  const auditInput = {
    actionType: input.actionType,
    targetType: input.targetType,
    outletId: input.outletId,
    targetId: input.targetId,
    targetLabel: input.targetLabel,
    beforePayload: input.beforePayload,
    afterPayload: input.afterPayload,
  };
  if (input.affectsAttachedMenu) {
    return writeMenuAuditAndRevision(tx, auditInput);
  }
  await writeMenuAuditLog(tx, auditInput);
  return null;
}
