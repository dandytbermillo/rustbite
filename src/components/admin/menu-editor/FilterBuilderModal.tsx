"use client";

import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { BRAND } from "@/lib/brand";
import ModalShell from "./ModalShell";
import {
  buildFieldCatalogue,
  findFieldEntry,
  type FieldCatalogueEntry,
} from "@/lib/admin/filters/fields";
import {
  isMenuFilterMultiKey,
  type HistoryMethod,
  type MenuFilterState,
  type MenuFilterStructuredKey,
} from "@/lib/admin/filters/types";
import type { Cat } from "@/lib/admin/menu/visibility";

type Props = {
  filter: MenuFilterState;
  categories: Cat[];
  setSingleFilter: <K extends MenuFilterStructuredKey>(
    key: K,
    value: MenuFilterState[K],
    method: HistoryMethod,
  ) => void;
  onClose: () => void;
};

export default function FilterBuilderModal({
  filter,
  categories,
  setSingleFilter,
  onClose,
}: Props) {
  const catalogue = useMemo(
    () => buildFieldCatalogue(categories),
    [categories],
  );
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedField, setSelectedField] =
    useState<MenuFilterStructuredKey | null>(null);
  const [selectedValue, setSelectedValue] = useState<string | null>(null);
  const [selectedMultiValues, setSelectedMultiValues] = useState<string[]>([]);

  const fieldEntry: FieldCatalogueEntry | undefined = selectedField
    ? findFieldEntry(catalogue, selectedField)
    : undefined;

  const isMultiField =
    selectedField != null && isMenuFilterMultiKey(selectedField);

  const valueIsValid = isMultiField
    ? true // "All" (empty array) and any non-empty subset are both valid
    : fieldEntry?.options.some((o) => o.value === selectedValue) ?? false;

  // Apply is only meaningful when the selection differs from what's already
  // in the filter — otherwise clicking Apply is a silent no-op (e.g.
  // selecting "All" when the field is already unset). Comparing as a sorted
  // join keeps multi-value diffs order-insensitive.
  const selectionMatchesCurrent = (() => {
    if (selectedField == null) return true;
    if (isMultiField) {
      const current = ((filter[selectedField] as string[] | undefined) ?? [])
        .slice()
        .sort();
      const next = selectedMultiValues.slice().sort();
      return current.length === next.length && current.every((v, i) => v === next[i]);
    }
    return (filter[selectedField] ?? null) === (selectedValue ?? null);
  })();

  const canApply =
    selectedField != null && valueIsValid && !selectionMatchesCurrent;

  const apply = () => {
    if (!canApply || !selectedField) return;
    if (isMultiField) {
      setSingleFilter(
        selectedField,
        (selectedMultiValues.length === 0
          ? undefined
          : selectedMultiValues) as never,
        "push",
      );
    } else if (selectedValue) {
      setSingleFilter(selectedField, selectedValue as never, "push");
    }
    onClose();
  };

  const startStep2 = (key: MenuFilterStructuredKey) => {
    setSelectedField(key);
    if (isMenuFilterMultiKey(key)) {
      const current = (filter[key] as string[] | undefined) ?? [];
      setSelectedMultiValues([...current]);
      setSelectedValue(null);
    } else {
      const current = filter[key];
      setSelectedValue(typeof current === "string" ? current : null);
      setSelectedMultiValues([]);
    }
    setStep(2);
  };

  return (
    <ModalShell
      ariaLabel="Filter builder"
      titleNode={
        <h2
          className="text-2xl text-stone-900"
          style={{ fontFamily: "Archivo Black", letterSpacing: "-0.02em" }}
        >
          Build filter
        </h2>
      }
      subtitle="Pick a field, then a value. Apply to add it as a chip."
      headerMeta={
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-stone-100 text-[11px] font-black tracking-widest uppercase text-stone-700">
          Step {step} of 2
        </span>
      }
      body={
        <div className="px-8 py-6">
          {step === 1 ? (
            <FieldStep
              catalogue={catalogue}
              selected={selectedField}
              onSelect={startStep2}
            />
          ) : isMultiField ? (
            <MultiValueStep
              entry={fieldEntry}
              selected={selectedMultiValues}
              onToggle={(value) => {
                setSelectedMultiValues((prev) =>
                  prev.includes(value)
                    ? prev.filter((v) => v !== value)
                    : [...prev, value],
                );
              }}
              onSelectAll={() => setSelectedMultiValues([])}
              onBack={() => setStep(1)}
            />
          ) : (
            <ValueStep
              entry={fieldEntry}
              selected={selectedValue}
              onSelect={(value) => setSelectedValue(value)}
              onBack={() => setStep(1)}
            />
          )}
        </div>
      }
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-sm font-bold text-stone-700 hover:bg-stone-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={!canApply}
            data-testid="menu-filter-builder-apply"
            data-modal-autofocus
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black tracking-widest uppercase text-stone-900 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: canApply ? BRAND.yellow : "#E8E6DF" }}
          >
            <Check size={16} strokeWidth={2.5} />
            Apply
          </button>
        </>
      }
      onClose={onClose}
    />
  );
}

function FieldStep({
  catalogue,
  selected,
  onSelect,
}: {
  catalogue: FieldCatalogueEntry[];
  selected: MenuFilterStructuredKey | null;
  onSelect: (key: MenuFilterStructuredKey) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {catalogue.map((entry) => {
        const active = selected === entry.key;
        return (
          <button
            key={entry.key}
            type="button"
            data-testid={`menu-filter-builder-field-${entry.key}`}
            onClick={() => onSelect(entry.key)}
            className={`text-left p-4 rounded-2xl border transition-colors ${
              active
                ? "border-stone-900 bg-stone-50"
                : "border-stone-200 hover:border-stone-400"
            }`}
          >
            <div
              className="text-base text-stone-900"
              style={{ fontFamily: "Archivo Black", letterSpacing: "-0.02em" }}
            >
              {entry.label}
            </div>
            <div className="mt-1 text-xs text-stone-500">
              {entry.description}
            </div>
            <div className="mt-2 text-[11px] font-bold uppercase tracking-widest text-stone-400">
              {entry.options.length} option{entry.options.length === 1 ? "" : "s"}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ValueStep({
  entry,
  selected,
  onSelect,
  onBack,
}: {
  entry: FieldCatalogueEntry | undefined;
  selected: string | null;
  onSelect: (value: string) => void;
  onBack: () => void;
}) {
  if (!entry) {
    return (
      <button
        type="button"
        onClick={onBack}
        className="text-sm font-bold text-stone-600 hover:text-stone-900"
      >
        ← Pick a field first
      </button>
    );
  }
  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="text-sm font-bold text-stone-600 hover:text-stone-900 mb-4"
      >
        ← Back to fields
      </button>
      <div className="text-[11px] font-black tracking-widest uppercase text-stone-500 mb-2">
        {entry.label} value
      </div>
      <div className="flex flex-wrap gap-2">
        {entry.options.map((option) => {
          const active = option.value === selected;
          return (
            <button
              key={option.value}
              type="button"
              data-testid={`menu-filter-builder-value-${entry.key}-${option.value}`}
              onClick={() => onSelect(option.value)}
              className={`px-3.5 py-2 rounded-xl border text-sm font-bold transition-colors ${
                active
                  ? "border-stone-900 bg-stone-900 text-white"
                  : "border-stone-200 bg-white text-stone-700 hover:border-stone-400"
              }`}
            >
              {option.label}
              {option.value !== option.label && (
                <span className="ml-1.5 text-xs font-medium opacity-70">
                  {option.value}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MultiValueStep({
  entry,
  selected,
  onToggle,
  onSelectAll,
  onBack,
}: {
  entry: FieldCatalogueEntry | undefined;
  selected: string[];
  onToggle: (value: string) => void;
  onSelectAll: () => void;
  onBack: () => void;
}) {
  if (!entry) {
    return (
      <button
        type="button"
        onClick={onBack}
        className="text-sm font-bold text-stone-600 hover:text-stone-900"
      >
        ← Pick a field first
      </button>
    );
  }
  const allActive = selected.length === 0;
  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="text-sm font-bold text-stone-600 hover:text-stone-900 mb-4"
      >
        ← Back to fields
      </button>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] font-black tracking-widest uppercase text-stone-500">
          {entry.label} value{selected.length > 1 ? "s" : ""}
        </div>
        <div className="text-[11px] font-bold text-stone-500">
          {allActive
            ? "All values shown"
            : `${selected.length} selected`}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-testid={`menu-filter-builder-value-${entry.key}-all`}
          onClick={onSelectAll}
          aria-pressed={allActive}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-sm font-bold transition-colors ${
            allActive
              ? "border-stone-900 bg-stone-900 text-white"
              : "border-stone-200 bg-white text-stone-700 hover:border-stone-400"
          }`}
        >
          {allActive && <Check size={14} strokeWidth={2.5} />}
          All
        </button>
        {entry.options.map((option) => {
          const active = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              data-testid={`menu-filter-builder-value-${entry.key}-${option.value}`}
              onClick={() => onToggle(option.value)}
              aria-pressed={active}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-sm font-bold transition-colors ${
                active
                  ? "border-stone-900 bg-stone-900 text-white"
                  : "border-stone-200 bg-white text-stone-700 hover:border-stone-400"
              }`}
            >
              {active && <Check size={14} strokeWidth={2.5} />}
              {option.label}
              {option.value !== option.label && (
                <span className="ml-1 text-xs font-medium opacity-70">
                  {option.value}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
