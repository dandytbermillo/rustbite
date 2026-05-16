"use client";

import { useEffect, useMemo, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { getKioskLowStockMessage } from "@/lib/kiosk-stock-label";
import { fmt } from "@/lib/pricing";
import { snapshotFromUpgradeOption } from "@/lib/upgrade-snapshot";
import type {
  AddOnSetCartSelection,
  AddOnSetDTO,
  MenuItemDTO,
  Modifier,
  ModifierOption,
  UpgradeOptionDTO,
  UpgradeSnapshot,
} from "@/lib/types";

const toMod = (o: ModifierOption): Modifier => ({ id: o.id, name: o.name, price: o.priceDelta });
type AddOnSetOption = AddOnSetDTO["options"][number];

function upgradeCardTitle(option: UpgradeOptionDTO): string {
  if (option.customTitle?.trim()) return option.customTitle.trim();
  const first = option.linkedItems[0]?.nameSnapshot.trim();
  return first ? `ADD ${first.toUpperCase()}` : "MAKE IT A MEAL";
}

import BadgeChip from "./BadgeChip";
import ItemVisual from "./ItemVisual";
import TopBar from "./TopBar";

function addOnSetRuleText(set: AddOnSetDTO): string {
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

function namesMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function addOnOptionToModifier(option: AddOnSetOption): Modifier {
  return { id: option.id, name: option.name, price: option.priceDelta };
}

function SectionLabel({ text, accent }: { text: string; accent?: boolean }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div
        className="w-1 h-6 rounded-full"
        style={{ background: accent ? BRAND.red : BRAND.black }}
      />
      <div className="display text-xl uppercase">{text}</div>
      {accent && (
        <span
          className="px-2 py-0.5 text-[10px] font-black tracking-widest rounded-full"
          style={{ background: BRAND.red, color: "white" }}
        >
          SAVE
        </span>
      )}
    </div>
  );
}

function OptionStateLabels({ option }: { option: AddOnSetOption }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
      {!option.isAvailable && (
        <span
          className="rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-widest"
          style={{ background: BRAND.red, color: "white" }}
        >
          Sold out
        </span>
      )}
      {option.isAvailable && option.quantityLabel && (
        <span className="rounded-full bg-white/70 px-2 py-1 text-[10px] font-black uppercase tracking-widest opacity-60">
          {option.quantityLabel}
        </span>
      )}
      <span
        className="mono text-xs font-black"
        style={{ color: option.priceDelta > 0 ? BRAND.red : BRAND.black }}
      >
        {optionPriceLabel(option.priceDelta)}
      </span>
    </div>
  );
}

function CompactAddOnSetRow({
  set,
  option,
  active,
  onToggle,
}: {
  set: AddOnSetDTO;
  option: AddOnSetOption;
  active: boolean;
  onToggle: (set: AddOnSetDTO, option: Modifier) => void;
}) {
  const disabled = !option.isAvailable;
  const showContext = !namesMatch(set.name, option.name);
  return (
    <button
      type="button"
      onClick={() => onToggle(set, addOnOptionToModifier(option))}
      aria-pressed={active}
      disabled={disabled}
      className={`btn-press w-full rounded-2xl border-4 px-4 py-4 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
        active ? "shadow-lg" : ""
      }`}
      style={{
        background: active ? BRAND.yellow : "white",
        borderColor: active ? BRAND.black : "transparent",
      }}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="display text-xl leading-none">{option.name}</span>
            {set.isRequired && (
              <span
                className="rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-widest"
                style={{ background: BRAND.red, color: "white" }}
              >
                Required
              </span>
            )}
          </div>
          {showContext && (
            <div className="mt-1 text-xs font-black opacity-50">{set.name}</div>
          )}
        </div>
        <OptionStateLabels option={option} />
      </div>
    </button>
  );
}

function AddOnSetOptionButton({
  set,
  option,
  active,
  onToggle,
}: {
  set: AddOnSetDTO;
  option: AddOnSetOption;
  active: boolean;
  onToggle: (set: AddOnSetDTO, option: Modifier) => void;
}) {
  const disabled = !option.isAvailable;
  return (
    <button
      type="button"
      onClick={() => onToggle(set, addOnOptionToModifier(option))}
      aria-pressed={active}
      disabled={disabled}
      className={`btn-press min-h-[4.5rem] rounded-xl border-2 p-3 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
        active ? "border-black" : "border-transparent"
      }`}
      style={{ background: active ? BRAND.yellow : BRAND.gray }}
    >
      <div className="flex h-full items-center justify-between gap-3">
        <span className="min-w-0 text-sm font-bold">{option.name}</span>
        <OptionStateLabels option={option} />
      </div>
    </button>
  );
}

function AddOnSetCard({
  set,
  selected,
  onToggle,
}: {
  set: AddOnSetDTO;
  selected: Modifier[];
  onToggle: (set: AddOnSetDTO, option: Modifier) => void;
}) {
  return (
    <div className="rounded-2xl bg-white p-4">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <div className="display text-lg leading-none">{set.name}</div>
          <div className="text-xs font-black opacity-60">
            {addOnSetRuleText(set)}
          </div>
        </div>
        {set.isRequired && (
          <span
            className="rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-widest"
            style={{ background: BRAND.red, color: "white" }}
          >
            Required
          </span>
        )}
      </div>
      {set.options.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {set.options.map((option) => {
            const active = selected.some((candidate) => candidate.id === option.id);
            return (
              <AddOnSetOptionButton
                key={option.id}
                set={set}
                option={option}
                active={active}
                onToggle={onToggle}
              />
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border-2 border-dashed border-stone-200 p-3 text-sm font-black opacity-50">
          No options available
        </div>
      )}
    </div>
  );
}

export default function CustomizeScreen({
  item,
  size,
  setSize,
  addons,
  addOnSetSelections,
  setAddOnSetSelections,
  selectedUpgradeOptionId,
  selectedUpgradeSnapshot,
  setSelectedUpgrade,
  qty,
  setQty,
  maxQty,
  onAdd,
  onBack,
}: {
  item: MenuItemDTO;
  size: Modifier | null;
  setSize: (s: Modifier | null) => void;
  addons: Modifier[];
  addOnSetSelections: AddOnSetCartSelection[];
  setAddOnSetSelections: (a: AddOnSetCartSelection[]) => void;
  selectedUpgradeOptionId: string | null;
  selectedUpgradeSnapshot: UpgradeSnapshot | null;
  setSelectedUpgrade: (
    next:
      | { id: string; snapshot: UpgradeSnapshot }
      | null
  ) => void;
  qty: number;
  setQty: (q: number) => void;
  maxQty: number | null;
  onAdd: () => void;
  onBack: () => void;
}) {
  const toggleAddOnSetOption = (set: AddOnSetDTO, option: Modifier) => {
    if (!set.options.some((candidate) => candidate.id === option.id && candidate.isAvailable)) {
      return;
    }

    const existing = addOnSetSelections.find(
      (selection) => selection.itemLinkId === set.itemLinkId
    );
    const existingOptions = existing?.options ?? [];
    const isSelected = existingOptions.some((selected) => selected.id === option.id);
    const singleSelect =
      set.selectionMode === "OPTIONAL_SINGLE" ||
      set.selectionMode === "REQUIRED_SINGLE" ||
      set.maxSelect === 1;

    let nextOptions: Modifier[];
    if (isSelected) {
      nextOptions = existingOptions.filter((selected) => selected.id !== option.id);
    } else if (singleSelect) {
      nextOptions = [option];
    } else {
      if (set.maxSelect != null && existingOptions.length >= set.maxSelect) {
        return;
      }
      nextOptions = [...existingOptions, option];
    }

    const nextSelections = addOnSetSelections.filter(
      (selection) => selection.itemLinkId !== set.itemLinkId
    );
    if (nextOptions.length > 0) {
      nextSelections.push({
        itemLinkId: set.itemLinkId,
        groupId: set.groupId,
        name: set.name,
        options: nextOptions,
      });
    }
    setAddOnSetSelections(nextSelections);
  };

  const currentPrice = useMemo(() => {
    const s = size?.price ?? 0;
    const ad = addons.reduce((acc, x) => acc + x.price, 0);
    const addOnSetTotal = addOnSetSelections.reduce(
      (sum, set) =>
        sum + set.options.reduce((optionSum, option) => optionSum + option.price, 0),
      0
    );
    const u = selectedUpgradeSnapshot?.extraCharge ?? 0;
    return (item.price + s + ad + addOnSetTotal + u) * qty;
  }, [item, size, addons, addOnSetSelections, selectedUpgradeSnapshot, qty]);
  const [quantityNotice, setQuantityNotice] = useState<string | null>(null);

  useEffect(() => {
    if (maxQty != null && maxQty > 0 && qty > maxQty) {
      setQty(maxQty);
    }
  }, [maxQty, qty, setQty]);

  useEffect(() => {
    setQuantityNotice(null);
  }, [item.id, maxQty]);

  const lowStockMessage = getKioskLowStockMessage(item);
  const noStockMessage =
    maxQty != null && maxQty <= 0
      ? `${item.name} is now out of stock. Pick another item.`
      : null;
  const visibleQuantityNotice =
    quantityNotice ?? noStockMessage ?? lowStockMessage;
  const isQuantityNoticeBlocking = quantityNotice != null || noStockMessage != null;
  const increaseDisabled = maxQty != null && maxQty <= 0;
  const addOnSetsSatisfied = item.addOnSets.every((set) => {
    const count =
      addOnSetSelections.find((selection) => selection.itemLinkId === set.itemLinkId)
        ?.options.length ?? 0;
    if (count < set.minSelect) return false;
    if (set.maxSelect != null && count > set.maxSelect) return false;
    return true;
  });
  const canAdd = (maxQty == null || maxQty > 0) && addOnSetsSatisfied;
  const sizeCircles = [24, 34, 44];
  const decreaseQty = () => {
    setQuantityNotice(null);
    setQty(Math.max(1, qty - 1));
  };
  const increaseQty = () => {
    if (maxQty != null && qty >= maxQty) {
      setQuantityNotice(
        `Only ${maxQty} left for ${item.name}. Lower the quantity from ${qty + 1} before adding.`
      );
      return;
    }

    setQuantityNotice(null);
    setQty(qty + 1);
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: BRAND.gray }}>
      <TopBar onBack={onBack} step={2} />
      <div className="flex-1 grid lg:grid-cols-[1.1fr_1fr] gap-0">
        <div
          className="relative flex flex-col justify-center items-center p-8 overflow-hidden"
          style={{ background: item.bgColor }}
        >
          <div className="noise-bg absolute inset-0 opacity-40" />
          {item.comboNum != null && (
            <div
              className="absolute top-8 left-8 display text-4xl px-4 py-2 rounded-xl"
              style={{ background: BRAND.black, color: BRAND.yellow }}
            >
              #{item.comboNum}
            </div>
          )}
          {item.badge && (
            <div className="absolute top-8 right-8">
              <BadgeChip badge={item.badge} />
            </div>
          )}
          <div className="relative w-[14rem] h-[14rem] md:w-[22rem] md:h-[22rem] rounded-3xl overflow-hidden">
            <ItemVisual item={item} size="hero" />
          </div>
          <div className="relative z-10 text-center mt-4 max-w-lg">
            <h1 className="display text-4xl md:text-6xl mb-3 leading-none">{item.name}</h1>
            <p className="text-lg opacity-70 mb-4">{item.description}</p>
            <div
              className="display text-3xl mono"
              style={{ color: BRAND.red }}
            >
              {fmt(item.price)}
            </div>
          </div>
        </div>

        <div className="p-8 space-y-6 overflow-y-auto">
          {item.upgradeOptions.length > 0 && (
            <div>
              <SectionLabel text="Make it a meal?" accent />
              <div className="space-y-3">
                {item.upgradeOptions.map((upgrade) => {
                  const active = selectedUpgradeOptionId === upgrade.id;
                  const title = upgradeCardTitle(upgrade);
                  return (
                    <button
                      key={upgrade.id}
                      onClick={() => {
                        if (active) {
                          setSelectedUpgrade(null);
                        } else {
                          setSelectedUpgrade({
                            id: upgrade.id,
                            snapshot: snapshotFromUpgradeOption(upgrade),
                          });
                        }
                      }}
                      aria-pressed={active}
                      className={`btn-press w-full p-5 rounded-2xl border-4 transition-all text-left ${
                        active ? "shadow-lg" : "border-transparent"
                      }`}
                      style={{
                        background: active ? BRAND.yellow : "white",
                        borderColor: active ? BRAND.black : "transparent",
                      }}
                    >
                      <div className="space-y-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="display text-2xl leading-none line-clamp-2">
                              {title}
                            </div>
                            <div className="mt-3 text-[10px] font-black tracking-widest opacity-50">
                              INCLUDES
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <div
                              className="display text-xl"
                              style={{ color: BRAND.red }}
                            >
                              +{fmt(upgrade.extraCharge)}
                            </div>
                            {upgrade.savingsLabel != null && (
                              <div className="text-xs font-black opacity-60">
                                Save {fmt(upgrade.savingsLabel)}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="divide-y divide-stone-200/80">
                          {upgrade.linkedItems.map((li) => (
                            <div
                              key={li.id}
                              className="grid grid-cols-[3rem_1fr] items-center gap-3 py-3 first:pt-0 last:pb-0"
                            >
                              <div
                                className="w-10 h-10 rounded-lg flex items-center justify-center text-xl"
                                style={{ background: li.bgColor }}
                              >
                                {li.emoji}
                              </div>
                              <div className="min-w-0">
                                <div className="text-sm font-black leading-tight truncate">
                                  {li.nameSnapshot}
                                  {li.sizeName && (
                                    <span className="font-normal opacity-60">
                                      {" "}
                                      · {li.sizeName}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {item.sizes.length > 0 && (
            <div>
              <SectionLabel text="Pick a size" />
              <div className="grid grid-cols-3 gap-3">
                {item.sizes.map((s, idx) => {
                  const active = size?.id === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => setSize(toMod(s))}
                      aria-pressed={active}
                      className={`btn-press relative p-4 rounded-2xl border-4 text-center transition-all ${
                        active ? "" : "border-transparent"
                      }`}
                      style={{
                        background: active ? BRAND.yellow : "white",
                        borderColor: active ? BRAND.black : "transparent",
                      }}
                    >
                      <div
                        className="mx-auto rounded-full mb-2"
                        style={{
                          width: sizeCircles[idx] ?? 34,
                          height: sizeCircles[idx] ?? 34,
                          background: BRAND.red,
                        }}
                      />
                      <div className="display text-lg">{s.name}</div>
                      <div className="text-xs font-bold opacity-60">
                        {s.priceDelta === 0 ? "Included" : `+${fmt(s.priceDelta)}`}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {item.addOnSets.length > 0 && (
            <div>
              <SectionLabel text="Add-ons" />
              <div className="space-y-4">
                {item.addOnSets.map((set) => {
                  const selected =
                    addOnSetSelections.find(
                      (selection) => selection.itemLinkId === set.itemLinkId
                    )?.options ?? [];
                  const [singleOption] = set.options;
                  if (set.options.length === 1 && singleOption) {
                    return (
                      <CompactAddOnSetRow
                        key={set.itemLinkId}
                        set={set}
                        option={singleOption}
                        active={selected.some(
                          (candidate) => candidate.id === singleOption.id,
                        )}
                        onToggle={toggleAddOnSetOption}
                      />
                    );
                  }
                  return (
                    <AddOnSetCard
                      key={set.itemLinkId}
                      set={set}
                      selected={selected}
                      onToggle={toggleAddOnSetOption}
                    />
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <SectionLabel text="How many?" />
            <div className="flex items-center gap-4 p-4 rounded-2xl bg-white">
              <button
                onClick={decreaseQty}
                aria-label="Decrease quantity"
                className="btn-press w-14 h-14 rounded-xl flex items-center justify-center"
                style={{ background: BRAND.gray }}
              >
                <Minus size={22} strokeWidth={3} />
              </button>
              <div className="flex-1 text-center display text-5xl">{qty}</div>
              <button
                onClick={increaseQty}
                aria-label="Increase quantity"
                disabled={increaseDisabled}
                className="btn-press w-14 h-14 rounded-xl flex items-center justify-center disabled:opacity-40"
                style={{ background: BRAND.yellow }}
              >
                <Plus size={22} strokeWidth={3} />
              </button>
            </div>
            {visibleQuantityNotice && (
              <div
                className="mt-3 rounded-xl px-4 py-3 text-sm font-black"
                style={{
                  background: isQuantityNoticeBlocking ? "#FEE2E2" : "#FFF2CC",
                  color: isQuantityNoticeBlocking ? BRAND.red : BRAND.black,
                }}
              >
                {visibleQuantityNotice}
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        className="sticky bottom-0 z-20 p-4 border-t-4"
        style={{ background: BRAND.cream, borderColor: BRAND.yellow }}
      >
        <button
          onClick={onAdd}
          disabled={!canAdd}
          className="btn-press w-full flex items-center justify-between px-8 py-5 rounded-2xl display text-2xl transition-transform hover:scale-[1.01] disabled:opacity-50"
          style={{ background: BRAND.red, color: "white", boxShadow: "0 6px 0 rgba(0,0,0,0.2)" }}
        >
          <span>ADD TO ORDER</span>
          <span className="mono">{fmt(currentPrice)}</span>
        </button>
      </div>
    </div>
  );
}
