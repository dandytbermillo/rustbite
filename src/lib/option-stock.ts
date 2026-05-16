import type { MenuStockMode } from "@/lib/types";

export type OptionStockState = {
  stockMode?: MenuStockMode | null;
  isOutOfStock?: boolean | null;
  stockQty?: number | null;
  lowStockThreshold?: number | null;
};

export type OptionStockValidationResult =
  | { ok: true; value: Required<OptionStockState> }
  | { ok: false; error: string };

const OPTION_STOCK_FIELD_NAMES = new Set([
  "stockMode",
  "isOutOfStock",
  "stockQty",
  "lowStockThreshold",
  "stockUpdatedAt",
  "stockUpdatedById",
]);

export function isOptionAvailable(option: OptionStockState): boolean {
  if (option.stockMode === "QUANTITY") {
    return (option.stockQty ?? 0) > 0;
  }
  return !option.isOutOfStock;
}

export function isAddonOptionAvailable(option: OptionStockState): boolean {
  return isOptionAvailable(option);
}

export function isSharedModifierOptionAvailable(
  option: OptionStockState & { isActive?: boolean | null }
): boolean {
  if (option.isActive === false) return false;
  return isOptionAvailable(option);
}

export function optionStockLabel(option: OptionStockState): string {
  if (option.stockMode === "QUANTITY") {
    const qty = option.stockQty ?? 0;
    return qty <= 0 ? "0 left" : `${qty} left`;
  }
  return option.isOutOfStock ? "Out" : "In";
}

export function isOptionLowStock(option: OptionStockState): boolean {
  if (option.stockMode !== "QUANTITY") return false;
  if (option.lowStockThreshold == null) return false;
  const qty = option.stockQty ?? 0;
  return qty > 0 && qty <= option.lowStockThreshold;
}

export function validateOptionStockState(
  input: OptionStockState
): OptionStockValidationResult {
  const stockMode = input.stockMode === "QUANTITY" ? "QUANTITY" : "MANUAL";
  const stockQty =
    stockMode === "QUANTITY" ? input.stockQty ?? 0 : null;
  const lowStockThreshold =
    stockMode === "QUANTITY" ? input.lowStockThreshold ?? null : null;

  if (stockQty != null && (!Number.isInteger(stockQty) || stockQty < 0)) {
    return { ok: false, error: "stock quantity must be a non-negative integer" };
  }
  if (
    lowStockThreshold != null &&
    (!Number.isInteger(lowStockThreshold) || lowStockThreshold < 0)
  ) {
    return {
      ok: false,
      error: "low stock threshold must be a non-negative integer",
    };
  }

  return {
    ok: true,
    value: {
      stockMode,
      isOutOfStock:
        stockMode === "QUANTITY" ? false : Boolean(input.isOutOfStock),
      stockQty,
      lowStockThreshold,
    },
  };
}

export function hasOptionStockFields(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).some((key) => OPTION_STOCK_FIELD_NAMES.has(key));
}

export function stripOptionStockFields<T extends Record<string, unknown>>(
  value: T
): Omit<T, keyof OptionStockState | "stockUpdatedAt" | "stockUpdatedById"> {
  const next = { ...value };
  for (const key of OPTION_STOCK_FIELD_NAMES) {
    delete next[key as keyof typeof next];
  }
  return next;
}
