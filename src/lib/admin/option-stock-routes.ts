import type { MenuStockMode } from "@/lib/menu-availability";
import {
  validateOptionStockState,
  type OptionStockState,
} from "@/lib/option-stock";

export type OptionStockPatchInput = {
  lockVersion: number;
  stockMode: MenuStockMode;
  isOutOfStock: boolean;
  stockQty: number | null;
  lowStockThreshold: number | null;
};

const OPTION_STOCK_PATCH_KEYS = new Set([
  "lockVersion",
  "stockMode",
  "isOutOfStock",
  "stockQty",
  "lowStockThreshold",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseLockVersion(value: unknown): { value?: number; error?: string } {
  if (value === undefined || value === null || value === "") {
    return { error: "lockVersion is required" };
  }
  if (typeof value !== "number" && typeof value !== "string") {
    return { error: "lockVersion must be a whole number 0 or greater" };
  }

  const parsed = typeof value === "number" ? value : Number(value.trim());
  if (!Number.isInteger(parsed) || parsed < 0) {
    return { error: "lockVersion must be a whole number 0 or greater" };
  }
  return { value: parsed };
}

export function validateOptionStockPatchInput(
  raw: unknown
): { ok: true; value: OptionStockPatchInput } | { ok: false; error: string } {
  if (!isRecord(raw)) return { ok: false, error: "Invalid payload" };

  for (const key of Object.keys(raw)) {
    if (!OPTION_STOCK_PATCH_KEYS.has(key)) {
      return { ok: false, error: `${key} is not allowed` };
    }
  }

  const lockVersion = parseLockVersion(raw.lockVersion);
  if (lockVersion.error) return { ok: false, error: lockVersion.error };

  if (raw.stockMode == null || raw.stockMode === "") {
    return { ok: false, error: "stockMode is required" };
  }

  const stockInput: OptionStockState = {
    stockMode:
      String(raw.stockMode).trim().toUpperCase() === "QUANTITY"
        ? "QUANTITY"
        : String(raw.stockMode).trim().toUpperCase() === "MANUAL"
          ? "MANUAL"
          : null,
    isOutOfStock: raw.isOutOfStock === true,
    stockQty:
      raw.stockQty === undefined || raw.stockQty === null || raw.stockQty === ""
        ? null
        : Number(raw.stockQty),
    lowStockThreshold:
      raw.lowStockThreshold === undefined ||
      raw.lowStockThreshold === null ||
      raw.lowStockThreshold === ""
        ? null
        : Number(raw.lowStockThreshold),
  };

  if (stockInput.stockMode == null) {
    return { ok: false, error: "stock mode is invalid" };
  }

  const stock = validateOptionStockState(stockInput);
  if (!stock.ok) return { ok: false, error: stock.error };

  return {
    ok: true,
    value: {
      lockVersion: lockVersion.value as number,
      stockMode: stock.value.stockMode as MenuStockMode,
      isOutOfStock: Boolean(stock.value.isOutOfStock),
      stockQty: stock.value.stockQty,
      lowStockThreshold: stock.value.lowStockThreshold,
    },
  };
}

export function optionStockFieldsChanged(
  before: OptionStockState,
  after: OptionStockPatchInput
): boolean {
  const normalizedBefore = validateOptionStockState(before);
  if (!normalizedBefore.ok) return true;

  return (
    normalizedBefore.value.stockMode !== after.stockMode ||
    normalizedBefore.value.isOutOfStock !== after.isOutOfStock ||
    normalizedBefore.value.stockQty !== after.stockQty ||
    normalizedBefore.value.lowStockThreshold !== after.lowStockThreshold
  );
}

function dormantWholeNumber(value: number | null | undefined): number | null {
  return Number.isInteger(value) && (value as number) >= 0 ? (value as number) : null;
}

export function optionStockPersistenceFields(
  before: OptionStockState,
  after: OptionStockPatchInput
): Omit<OptionStockPatchInput, "lockVersion"> {
  return {
    stockMode: after.stockMode,
    isOutOfStock: after.isOutOfStock,
    stockQty:
      after.stockMode === "MANUAL"
        ? dormantWholeNumber(before.stockQty)
        : after.stockQty,
    lowStockThreshold:
      after.stockMode === "MANUAL"
        ? dormantWholeNumber(before.lowStockThreshold)
        : after.lowStockThreshold,
  };
}
