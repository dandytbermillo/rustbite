"use client";

import { useEffect, useMemo, useState } from "react";
import { Save } from "lucide-react";

export type WorkspaceOptionStockMode = "MANUAL" | "QUANTITY";

export type WorkspaceOptionStockValue = {
  mode?: WorkspaceOptionStockMode;
  stockMode?: WorkspaceOptionStockMode;
  isOutOfStock?: boolean | null;
  stockQty?: number | null;
  lowStockThreshold?: number | null;
};

export type WorkspaceOptionStockPatch = {
  stockMode: WorkspaceOptionStockMode;
  isOutOfStock: boolean;
  stockQty: number | null;
  lowStockThreshold: number | null;
};

type Props = {
  value: WorkspaceOptionStockValue;
  disabled?: boolean;
  busy?: boolean;
  layout?: "card" | "inline";
  showSaveButton?: boolean;
  onChange?: (patch: WorkspaceOptionStockPatch) => void;
  onSave: (patch: WorkspaceOptionStockPatch) => void | Promise<void>;
};

function numberDraft(value: number | null | undefined): string {
  return value == null ? "" : String(value);
}

export function normalizeWorkspaceOptionStock(
  value: WorkspaceOptionStockValue,
): WorkspaceOptionStockPatch {
  const stockMode = value.stockMode ?? value.mode ?? "MANUAL";
  if (stockMode === "QUANTITY") {
    return {
      stockMode,
      isOutOfStock: false,
      stockQty: value.stockQty ?? 0,
      lowStockThreshold: value.lowStockThreshold ?? null,
    };
  }

  return {
    stockMode,
    isOutOfStock: Boolean(value.isOutOfStock),
    stockQty: null,
    lowStockThreshold: null,
  };
}

function parseWholeNumber(value: string, fallback: number): number {
  if (value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return parsed;
}

function parseWholeNumberOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function sameStock(a: WorkspaceOptionStockPatch, b: WorkspaceOptionStockPatch) {
  return (
    a.stockMode === b.stockMode &&
    a.isOutOfStock === b.isOutOfStock &&
    a.stockQty === b.stockQty &&
    a.lowStockThreshold === b.lowStockThreshold
  );
}

export default function WorkspaceOptionStockControls({
  value,
  disabled = false,
  busy = false,
  layout = "card",
  showSaveButton = true,
  onChange,
  onSave,
}: Props) {
  const normalizedValue = useMemo(
    () => normalizeWorkspaceOptionStock(value),
    [
      value.mode,
      value.stockMode,
      value.isOutOfStock,
      value.stockQty,
      value.lowStockThreshold,
    ],
  );
  const [mode, setMode] = useState<WorkspaceOptionStockMode>(
    normalizedValue.stockMode,
  );
  const [manualOut, setManualOut] = useState(normalizedValue.isOutOfStock);
  const [qty, setQty] = useState(
    numberDraft(value.stockQty ?? normalizedValue.stockQty),
  );
  const [low, setLow] = useState(
    numberDraft(value.lowStockThreshold ?? normalizedValue.lowStockThreshold),
  );

  useEffect(() => {
    setMode(normalizedValue.stockMode);
    setManualOut(normalizedValue.isOutOfStock);
    if (normalizedValue.stockMode === "QUANTITY" || value.stockQty != null) {
      setQty(numberDraft(value.stockQty ?? normalizedValue.stockQty));
    }
    if (
      normalizedValue.stockMode === "QUANTITY" ||
      value.lowStockThreshold != null
    ) {
      setLow(
        numberDraft(value.lowStockThreshold ?? normalizedValue.lowStockThreshold),
      );
    }
  }, [normalizedValue, value.stockQty, value.lowStockThreshold]);

  const draft: WorkspaceOptionStockPatch =
    mode === "QUANTITY"
      ? {
          stockMode: "QUANTITY",
          isOutOfStock: false,
          stockQty: parseWholeNumber(qty, 0),
          lowStockThreshold: parseWholeNumberOrNull(low),
        }
      : {
          stockMode: "MANUAL",
          isOutOfStock: manualOut,
          stockQty: null,
          lowStockThreshold: null,
        };
  const qtyInvalid =
    mode === "QUANTITY" &&
    qty.trim() !== "" &&
    (!Number.isInteger(Number(qty)) || Number(qty) < 0);
  const lowInvalid =
    mode === "QUANTITY" &&
    low.trim() !== "" &&
    (!Number.isInteger(Number(low)) || Number(low) < 0);
  const invalid = qtyInvalid || lowInvalid;
  const dirty = !sameStock(normalizedValue, draft);
  const blocked = disabled || busy;
  const inline = layout === "inline";

  async function save(patch = draft) {
    if (blocked) return;
    if (patch.stockMode === "QUANTITY" && invalid) return;
    await onSave(patch);
  }

  async function toggleManual() {
    const next: WorkspaceOptionStockPatch = {
      stockMode: "MANUAL",
      isOutOfStock: !manualOut,
      stockQty: null,
      lowStockThreshold: null,
    };
    setMode("MANUAL");
    setManualOut(next.isOutOfStock);
    onChange?.(next);
    if (showSaveButton) await save(next);
  }

  function updateMode(stockMode: WorkspaceOptionStockMode) {
    const next: WorkspaceOptionStockPatch =
      stockMode === "QUANTITY"
        ? {
            stockMode: "QUANTITY",
            isOutOfStock: false,
            stockQty: parseWholeNumber(qty, 0),
            lowStockThreshold: parseWholeNumberOrNull(low),
          }
        : {
            stockMode: "MANUAL",
            isOutOfStock: manualOut,
            stockQty: null,
            lowStockThreshold: null,
          };
    setMode(stockMode);
    if (stockMode === "QUANTITY") setManualOut(false);
    onChange?.(next);
  }

  function updateQty(nextQty: string) {
    setQty(nextQty);
    const next: WorkspaceOptionStockPatch = {
      stockMode: "QUANTITY",
      isOutOfStock: false,
      stockQty: parseWholeNumber(nextQty, 0),
      lowStockThreshold: parseWholeNumberOrNull(low),
    };
    onChange?.(next);
  }

  function updateLow(nextLow: string) {
    setLow(nextLow);
    const next: WorkspaceOptionStockPatch = {
      stockMode: "QUANTITY",
      isOutOfStock: false,
      stockQty: parseWholeNumber(qty, 0),
      lowStockThreshold: parseWholeNumberOrNull(nextLow),
    };
    onChange?.(next);
  }

  return (
    <div
      className={
        inline
          ? "min-w-0"
          : "rounded-xl border border-stone-200 bg-stone-50 p-3"
      }
    >
      <div
        className={
          inline
            ? "grid gap-2 lg:grid-cols-[160px_minmax(0,1fr)_auto] lg:items-center"
            : "grid gap-3"
        }
      >
        <div
          className={
            inline
              ? "contents"
              : "grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)] sm:items-center"
          }
        >
          <select
            value={mode}
            onChange={(event) =>
              updateMode(event.target.value as WorkspaceOptionStockMode)
            }
            disabled={blocked}
            className="rounded-lg border border-stone-200 bg-white px-2.5 py-2 text-[11px] font-black uppercase tracking-widest text-stone-800 outline-none disabled:opacity-50"
          >
            <option value="MANUAL">Manual</option>
            <option value="QUANTITY">Quantity</option>
          </select>

          {mode === "MANUAL" ? (
            <button
              type="button"
              onClick={() => void toggleManual()}
              disabled={blocked}
              className={`rounded-lg border px-3 py-2 text-[10px] font-black uppercase tracking-widest disabled:opacity-50 ${
                manualOut
                  ? "border-red-200 bg-red-50 text-red-800"
                  : "border-emerald-200 bg-emerald-50 text-emerald-800"
              }`}
            >
              {busy
                ? "Updating"
                : manualOut
                  ? "Mark in stock"
                  : "Mark out of stock"}
            </button>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                type="number"
                min={0}
                step={1}
                value={qty}
                onChange={(event) => updateQty(event.target.value)}
                disabled={blocked}
                aria-label="Option quantity on hand"
                className={`rounded-lg border bg-white px-2.5 py-2 text-xs font-black text-stone-900 outline-none disabled:opacity-50 ${
                  qtyInvalid ? "border-red-300" : "border-stone-200"
                }`}
                placeholder="Qty"
              />
              <input
                type="number"
                min={0}
                step={1}
                value={low}
                onChange={(event) => updateLow(event.target.value)}
                disabled={blocked}
                aria-label="Option low-stock threshold"
                className={`rounded-lg border bg-white px-2.5 py-2 text-xs font-black text-stone-900 outline-none disabled:opacity-50 ${
                  lowInvalid ? "border-red-300" : "border-stone-200"
                }`}
                placeholder="Low alert"
              />
            </div>
          )}
        </div>

        {showSaveButton && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void save()}
              disabled={blocked || invalid || !dirty}
              className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-stone-950 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-yellow-300 disabled:opacity-50"
            >
              <Save size={12} strokeWidth={2.5} aria-hidden />
              {busy ? "Saving" : "Save stock"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
