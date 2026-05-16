"use client";

import { Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BRAND } from "@/lib/brand";
import { isMenuItemAvailable } from "@/lib/menu-availability";
import { isOptionAvailable, optionStockLabel } from "@/lib/option-stock";
import {
  isRequiredModifierMode,
  resolveSharedModifierSelectionRule,
} from "@/lib/shared-modifier-library";
import type { MenuStockMode } from "@/lib/types";
import type {
  Item,
  SharedModifierOption,
  SharedModifierSelectionMode,
} from "./types";

type Props = {
  item: Item;
  // Optional: previewing a pending image not yet saved (blob URL).
  previewImageUrl?: string | null;
};

type PreviewAddOnOption = {
  id: string;
  name: string;
  priceDelta: number;
  isAvailable: boolean;
  quantityLabel: string | null;
  sortOrder: number;
};

type PreviewAddOnSet = {
  itemLinkId: string;
  groupId: string;
  name: string;
  selectionMode: SharedModifierSelectionMode;
  minSelect: number;
  maxSelect: number | null;
  isRequired: boolean;
  isSatisfiable: boolean;
  sortOrder: number;
  options: PreviewAddOnOption[];
};

const fmt = (n: number) => `$${n.toFixed(2)}`;

function namesMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function addOnSetRuleText(set: PreviewAddOnSet): string {
  if (set.selectionMode === "REQUIRED_SINGLE") return "Choose one";
  if (set.selectionMode === "OPTIONAL_SINGLE") return "Choose up to one";
  if (set.maxSelect == null) {
    return set.minSelect > 0 ? `Choose at least ${set.minSelect}` : "Choose any";
  }
  if (set.minSelect === 0) return `Choose up to ${set.maxSelect}`;
  if (set.minSelect === set.maxSelect) return `Choose ${set.minSelect}`;
  return `Choose ${set.minSelect}-${set.maxSelect}`;
}

function optionPriceLabel(priceDelta: number): string {
  return priceDelta > 0 ? `+${fmt(priceDelta)}` : "FREE";
}

function normalizeOptionStock(option: SharedModifierOption) {
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

function buildPreviewAddOnSets(item: Item): PreviewAddOnSet[] {
  if (item.upgradeOptions.length > 0) return [];

  const sets: PreviewAddOnSet[] = [];
  for (const link of item.modifierGroupLinks ?? []) {
    const group = link.modifierGroup;
    if (!link.isActive || !group.isActive) continue;

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
      link.optionOverrides.map((override) => [
        override.modifierOptionId,
        override,
      ]),
    );
    const options = group.options
      .flatMap((option): PreviewAddOnOption[] => {
        if (option.groupId !== group.id || !option.isActive) return [];

        const override = overrides.get(option.id);
        if (override?.isHidden) return [];

        const stock = normalizeOptionStock(option);
        return [
          {
            id: option.id,
            name: option.name,
            priceDelta: override?.priceDeltaOverride ?? option.priceDelta,
            isAvailable: isOptionAvailable(stock),
            quantityLabel:
              stock.stockMode === "QUANTITY" ? optionStockLabel(stock) : null,
            sortOrder: override?.sortOrderOverride ?? option.sortOrder,
          },
        ];
      })
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

    const isRequired = isRequiredModifierMode(rule.value.selectionMode);
    if (options.length === 0 && !isRequired) continue;

    sets.push({
      itemLinkId: link.id,
      groupId: group.id,
      name: group.name,
      selectionMode: rule.value.selectionMode,
      minSelect: rule.value.minSelect,
      maxSelect: rule.value.maxSelect,
      isRequired,
      isSatisfiable:
        options.filter((option) => option.isAvailable).length >=
        rule.value.minSelect,
      sortOrder: link.sortOrder,
      options,
    });
  }

  return sets.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

// Mirrors the kiosk's per-item screen used for sized non-deal items
// (PICK A SIZE + HOW MANY? + ADD TO ORDER bar). Read-only; the operator
// uses it as a live "this is what customers see" preview.
export default function KioskItemPreview({ item, previewImageUrl }: Props) {
  const [selectedSizeIndex, setSelectedSizeIndex] = useState(
    item.sizes.length > 1 ? 1 : 0
  );
  const [qty, setQty] = useState(1);
  const [addOnSelections, setAddOnSelections] = useState<Record<string, string[]>>({});

  const addOnSets = useMemo(() => buildPreviewAddOnSets(item), [item]);

  useEffect(() => {
    setSelectedSizeIndex(item.sizes.length > 1 ? 1 : 0);
    setQty(1);
    setAddOnSelections({});
  }, [item.id, item.sizes.length]);

  const toggleAddOnOption = (
    set: PreviewAddOnSet,
    option: PreviewAddOnOption,
  ) => {
    if (!option.isAvailable) return;

    setAddOnSelections((current) => {
      const existing = current[set.itemLinkId] ?? [];
      const isSelected = existing.includes(option.id);
      const singleSelect =
        set.selectionMode === "OPTIONAL_SINGLE" ||
        set.selectionMode === "REQUIRED_SINGLE" ||
        set.maxSelect === 1;

      let nextIds: string[];
      if (isSelected) {
        nextIds = existing.filter((id) => id !== option.id);
      } else if (singleSelect) {
        nextIds = [option.id];
      } else {
        if (set.maxSelect != null && existing.length >= set.maxSelect) {
          return current;
        }
        nextIds = [...existing, option.id];
      }

      const next = { ...current };
      if (nextIds.length > 0) {
        next[set.itemLinkId] = nextIds;
      } else {
        delete next[set.itemLinkId];
      }
      return next;
    });
  };

  const sizeDelta =
    item.sizes.length > 0 ? item.sizes[Math.min(selectedSizeIndex, item.sizes.length - 1)]?.priceDelta ?? 0 : 0;
  const addOnUnit = addOnSets.reduce((sum, set) => {
    const selectedIds = new Set(addOnSelections[set.itemLinkId] ?? []);
    return (
      sum +
      set.options.reduce(
        (optionSum, option) =>
          selectedIds.has(option.id) ? optionSum + option.priceDelta : optionSum,
        0,
      )
    );
  }, 0);
  const unit = (item.price ?? 0) + sizeDelta + addOnUnit;
  const total = unit * qty;
  const heroUrl = previewImageUrl ?? item.imageUrl;
  const unavailable = !isMenuItemAvailable(item);
  const unavailableLabel =
    item.stockMode === "QUANTITY" && item.isOutOfStock && (item.stockQty ?? 0) > 0
      ? "Unavailable"
      : "Out of stock";
  const addOnSetsSatisfied = addOnSets.every((set) => {
    const selectedOptionIds = new Set(addOnSelections[set.itemLinkId] ?? []);
    const count = set.options.filter((option) =>
      selectedOptionIds.has(option.id),
    ).length;
    if (count < set.minSelect) return false;
    if (set.maxSelect != null && count > set.maxSelect) return false;
    return set.isSatisfiable;
  });
  const canAdd = !unavailable && addOnSetsSatisfied;

  return (
    <div className="rounded-3xl overflow-hidden shadow-2xl" style={{ background: BRAND.black }}>
      {/* Step bar */}
      <div className="flex items-center gap-2 p-3" aria-hidden>
        <Step>✓ Order type</Step>
        <Sep />
        <Step active>2 Menu</Step>
        <Sep />
        <Step>3 Review</Step>
        <Sep />
        <Step>4 Payment</Step>
      </div>

      {/* Screen body */}
      <div className="grid grid-cols-[5fr_4fr] min-h-[440px] bg-white rounded-xl overflow-hidden mx-3">
        {/* Item display side */}
        <div
          className="relative px-5 pt-4 pb-5 flex flex-col"
          style={{ background: item.bgColor || BRAND.cream }}
        >
          <div className="flex justify-end items-center gap-1.5 min-h-[28px]">
            {item.badge && (
              <span
                className="px-2.5 py-1 rounded-full text-[10px] font-black tracking-widest uppercase"
                style={{
                  background: item.badge === "HOT" ? BRAND.red : BRAND.yellow,
                  color: item.badge === "HOT" ? "white" : BRAND.black,
                }}
              >
                {item.badge}
              </span>
            )}
          </div>

          <div className="flex-1 flex items-center justify-center my-2 min-h-[140px]">
            {heroUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={heroUrl}
                alt={item.imageAlt ?? item.name}
                className={item.imageFit === "CONTAIN" ? "max-w-[80%] max-h-[180px] object-contain" : "max-w-[80%] max-h-[200px] object-cover"}
                style={{ filter: "drop-shadow(0 14px 22px rgba(0,0,0,0.15))" }}
              />
            ) : (
              <span
                className="text-[100px] leading-none"
                style={{ filter: "drop-shadow(0 14px 22px rgba(0,0,0,0.15))" }}
              >
                {item.emoji || "🍽️"}
              </span>
            )}
          </div>

          <div
            className="text-2xl leading-none mb-1"
            style={{ fontFamily: "Archivo Black", letterSpacing: "-0.02em" }}
          >
            {item.name || "Untitled"}
          </div>
          {item.description && (
            <div className="text-xs text-stone-600 leading-snug mb-2.5 line-clamp-2">
              {item.description}
            </div>
          )}
          <div
            className="text-2xl"
            style={{ fontFamily: "Archivo Black", color: BRAND.red, letterSpacing: "-0.02em" }}
          >
            {fmt(unit)}
          </div>

          {unavailable && (
            <div
              className="absolute inset-0 flex items-center justify-center text-white tracking-widest"
              style={{ background: "rgba(20,20,20,0.55)", fontFamily: "Archivo Black", fontSize: "22px" }}
            >
              {unavailableLabel.toUpperCase()}
            </div>
          )}
        </div>

        {/* Modifier side */}
        <div className="bg-stone-100 p-4 flex flex-col gap-3.5 max-h-[440px] overflow-y-auto">
          <Section title="Pick a size">
            {item.sizes.length === 0 ? (
              <div
                className="rounded-xl border border-dashed border-stone-400 p-3 text-center text-stone-500 text-xs"
              >
                No sizes — kiosk will charge base price.
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {item.sizes.map((s, i) => {
                  const active = i === selectedSizeIndex;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setSelectedSizeIndex(i)}
                      className="rounded-xl py-3 px-2 text-center cursor-pointer transition-colors flex flex-col items-center gap-1.5 min-h-[88px] justify-center border-2"
                      style={{
                        background: active ? BRAND.yellow : "white",
                        borderColor: active ? BRAND.black : "white",
                      }}
                    >
                      <span className="w-3.5 h-3.5 rounded-full" style={{ background: BRAND.red }} />
                      <span className="text-xs" style={{ fontFamily: "Archivo Black" }}>
                        {(s.name || `Size ${i + 1}`).slice(0, 12)}
                      </span>
                      <span className="text-[10px] font-bold font-mono" style={{ color: active ? BRAND.black : "#44403c" }}>
                        {i === 0 ? "Included" : `+${fmt(s.priceDelta)}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </Section>

          {addOnSets.length > 0 && (
            <Section title="Add-ons">
              <div className="space-y-2">
                {addOnSets.map((set) => {
                  const selectedIds = new Set(addOnSelections[set.itemLinkId] ?? []);
                  const [singleOption] = set.options;
                  if (set.options.length === 1 && singleOption) {
                    return (
                      <PreviewCompactAddOnSetRow
                        key={set.itemLinkId}
                        set={set}
                        option={singleOption}
                        active={selectedIds.has(singleOption.id)}
                        onToggle={toggleAddOnOption}
                      />
                    );
                  }
                  return (
                    <PreviewAddOnSetCard
                      key={set.itemLinkId}
                      set={set}
                      selectedIds={selectedIds}
                      onToggle={toggleAddOnOption}
                    />
                  );
                })}
              </div>
            </Section>
          )}

          <Section title="How many?">
            <div className="grid grid-cols-[60px_1fr_60px] items-center bg-white rounded-xl h-[60px] overflow-hidden">
              <button
                type="button"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                disabled={qty <= 1}
                className="h-full inline-flex items-center justify-center bg-stone-100 disabled:opacity-30"
                aria-label="Decrease quantity"
              >
                <Minus size={20} strokeWidth={3} />
              </button>
              <div
                className="text-center text-2xl"
                style={{ fontFamily: "Archivo Black" }}
              >
                {qty}
              </div>
              <button
                type="button"
                onClick={() => setQty((q) => Math.min(99, q + 1))}
                className="h-full inline-flex items-center justify-center"
                style={{ background: BRAND.yellow }}
                aria-label="Increase quantity"
              >
                <Plus size={20} strokeWidth={3} />
              </button>
            </div>
          </Section>
        </div>
      </div>

      {/* ADD TO ORDER bar */}
      <div
        className="flex items-center justify-between px-5 py-3.5 mt-3 mx-3 mb-3 rounded-b-xl"
        style={{
          background: BRAND.red,
          color: "white",
          borderTop: `4px solid ${BRAND.yellow}`,
          opacity: canAdd ? 1 : 0.55,
        }}
      >
        <span style={{ fontFamily: "Archivo Black" }} className="uppercase tracking-wider text-sm">
          Add to order
        </span>
        <span className="font-mono text-base font-black">{fmt(total)}</span>
      </div>
    </div>
  );
}

function PreviewOptionStateLabels({ option }: { option: PreviewAddOnOption }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
      {!option.isAvailable && (
        <span
          className="rounded-full px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest"
          style={{ background: BRAND.red, color: "white" }}
        >
          Sold out
        </span>
      )}
      {option.isAvailable && option.quantityLabel && (
        <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest text-stone-500">
          {option.quantityLabel}
        </span>
      )}
      <span
        className="font-mono text-[10px] font-black"
        style={{ color: option.priceDelta > 0 ? BRAND.red : BRAND.black }}
      >
        {optionPriceLabel(option.priceDelta)}
      </span>
    </div>
  );
}

function PreviewCompactAddOnSetRow({
  set,
  option,
  active,
  onToggle,
}: {
  set: PreviewAddOnSet;
  option: PreviewAddOnOption;
  active: boolean;
  onToggle: (set: PreviewAddOnSet, option: PreviewAddOnOption) => void;
}) {
  const showContext = !namesMatch(set.name, option.name);
  return (
    <button
      type="button"
      onClick={() => onToggle(set, option)}
      aria-pressed={active}
      disabled={!option.isAvailable}
      className="w-full rounded-xl border-2 px-3 py-2.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60"
      style={{
        background: active ? BRAND.yellow : "white",
        borderColor: active ? BRAND.black : "transparent",
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className="truncate text-xs"
              style={{ fontFamily: "Archivo Black" }}
            >
              {option.name}
            </span>
            {set.isRequired && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest"
                style={{ background: BRAND.red, color: "white" }}
              >
                Required
              </span>
            )}
          </div>
          {showContext && (
            <div className="mt-0.5 truncate text-[10px] font-bold text-stone-500">
              {set.name}
            </div>
          )}
        </div>
        <PreviewOptionStateLabels option={option} />
      </div>
    </button>
  );
}

function PreviewAddOnSetCard({
  set,
  selectedIds,
  onToggle,
}: {
  set: PreviewAddOnSet;
  selectedIds: Set<string>;
  onToggle: (set: PreviewAddOnSet, option: PreviewAddOnOption) => void;
}) {
  return (
    <div className="rounded-xl bg-white p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm" style={{ fontFamily: "Archivo Black" }}>
            {set.name}
          </div>
          <div className="text-[10px] font-black text-stone-500">
            {addOnSetRuleText(set)}
          </div>
        </div>
        {set.isRequired && (
          <span
            className="rounded-full px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest"
            style={{ background: BRAND.red, color: "white" }}
          >
            Required
          </span>
        )}
      </div>

      {set.options.length > 0 ? (
        <div className="grid grid-cols-2 gap-1.5">
          {set.options.map((option) => {
            const active = selectedIds.has(option.id);
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onToggle(set, option)}
                aria-pressed={active}
                disabled={!option.isAvailable}
                className="min-h-[54px] rounded-lg border-2 p-2 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60"
                style={{
                  background: active ? BRAND.yellow : BRAND.gray,
                  borderColor: active ? BRAND.black : "transparent",
                }}
              >
                <div className="flex h-full items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-[11px] font-black">
                    {option.name}
                  </span>
                  <PreviewOptionStateLabels option={option} />
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-stone-300 p-2 text-[10px] font-black text-stone-500">
          No options available
        </div>
      )}
    </div>
  );
}

function Step({ active, children }: { active?: boolean; children: React.ReactNode }) {
  return (
    <span
      className="px-2.5 py-1.5 rounded-full text-[9px] font-black tracking-widest uppercase whitespace-nowrap"
      style={
        active
          ? { background: BRAND.yellow, color: BRAND.black }
          : { background: "rgba(255,255,255,0.06)", color: "#a8a29e" }
      }
    >
      {children}
    </span>
  );
}

function Sep() {
  return <span className="text-stone-500 text-[10px]">›</span>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        className="text-[11px] font-black tracking-widest uppercase mb-2 pl-2"
        style={{ borderLeft: `3px solid ${BRAND.red}` }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}
