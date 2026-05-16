"use client";

import { BadgePercent, Plus, X, RotateCcw } from "lucide-react";
import { BRAND } from "@/lib/brand";
import type { AdminUpgradeOptionInput, AdminUpgradeItemLinkInput } from "./types";

const DISCOUNT_CHIPS = [5, 10, 12, 15, 20] as const;

type LinkPreviewItem = {
  id: string;
  emoji: string;
  name: string;
  size: string | null;
  price: number | null; // null when out of stock
  isOutOfStock: boolean;
  repairMessage?: string;
  blocksSave?: boolean;
};

type Props = {
  option: AdminUpgradeOptionInput;
  onChange: (next: AdminUpgradeOptionInput) => void;
  onRemove?: () => void;
  // The parent resolves linkedMenuItem/linkedSize to display rows. The
  // editor doesn't fetch — it only renders the chrome.
  links: Array<AdminUpgradeItemLinkInput & { preview: LinkPreviewItem }>;
  defaultDiscountPct: number; // from AppSettings
  // TODO(wiring): fire to open an item picker dialog. For the skeleton
  // it's a stub; in the wired version this opens a modal that filters
  // in-stock items by category and returns a chosen menuItemId/sizeId.
  onAddLinkedItem: () => void;
  onRemoveLinkedItem: (linkId: string | undefined, index: number) => void;
  onReplaceLinkedItem?: (index: number) => void;
  requireCompleteLinkedItems?: boolean;
  optionNumber?: number;
};

export default function UpgradeOptionEditor({
  option,
  onChange,
  onRemove,
  links,
  defaultDiscountPct,
  onAddLinkedItem,
  onRemoveLinkedItem,
  onReplaceLinkedItem,
  requireCompleteLinkedItems = false,
  optionNumber = 1,
}: Props) {
  const pct = option.discountPct ?? defaultDiscountPct;
  const individuallyRenderable = links.filter(
    (l) => !l.preview.isOutOfStock && !l.preview.blocksSave
  );
  const isComplete =
    links.length > 0 &&
    links.every((link) => !link.preview.isOutOfStock && !link.preview.blocksSave);
  const hiddenByRequiredComponent =
    requireCompleteLinkedItems && links.length > 0 && !isComplete;
  const customerRenderable = requireCompleteLinkedItems
    ? isComplete
      ? links
      : []
    : individuallyRenderable;
  const itemsTotal = customerRenderable.reduce(
    (sum, l) => sum + (l.preview.price ?? 0),
    0
  );
  const save = +(itemsTotal * pct / 100).toFixed(2);
  const customerPays = +(itemsTotal - save).toFixed(2);
  const fmt = (n: number) => `$${n.toFixed(2)}`;

  const autoTitle =
    customerRenderable.length === 0
      ? "—"
      : customerRenderable.map((l) => l.preview.name).join(" + ");

  return (
    <div className="border border-stone-200 rounded-3xl p-5 bg-white shadow-sm">
      {/* Card header */}
      <div className="flex items-center gap-3 mb-4 pb-3.5 border-b border-stone-100">
        <span
          role="button"
          tabIndex={0}
          aria-label="Drag to reorder"
          className="cursor-grab w-6 h-7 inline-flex items-center justify-center text-stone-400 hover:text-stone-700"
        >
          <span
            className="block w-2 h-3.5"
            style={{
              backgroundImage:
                "radial-gradient(circle, currentColor 1px, transparent 1.5px)",
              backgroundSize: "4px 4px",
            }}
          />
        </span>
        <div
          className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border border-yellow-200 bg-yellow-50 text-stone-900"
          aria-hidden
        >
          <BadgePercent size={21} strokeWidth={2.5} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-black tracking-widest uppercase text-stone-500">
            Deal option {optionNumber} · auto-titled
          </div>
          <div
            className="text-lg leading-tight text-stone-900"
            style={{ fontFamily: "Archivo Black", letterSpacing: "-0.02em" }}
          >
            Add <span>{autoTitle}</span>
          </div>
          <div className="mt-1 text-xs text-stone-500">
            {hiddenByRequiredComponent
              ? "This deal option is hidden because one or more required items are unavailable."
              : "Kiosk customers see this exact text on the deal option card."}
          </div>
        </div>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="px-3 py-2 rounded-full text-[11px] font-black tracking-widest"
            style={{ color: BRAND.red }}
          >
            Remove
          </button>
        )}
      </div>

      {/* Linked items */}
      <div className="mb-4">
        <div className="text-[11px] font-black tracking-widest uppercase text-stone-700 mb-2">
          Required items in this option
        </div>
        <div className="flex flex-col gap-2">
          {links.map((link, i) => (
            <div
              key={link.id ?? i}
              className={`grid grid-cols-[24px_44px_1fr_auto_auto] gap-3 items-center px-3.5 py-2.5 border rounded-xl ${
                link.preview.blocksSave
                  ? "bg-red-50 border-red-300"
                  : link.preview.isOutOfStock
                  ? "bg-stone-50 border-dashed border-stone-300"
                  : "bg-white border-stone-200 hover:border-stone-300"
              }`}
            >
              <span className="cursor-grab text-stone-400" aria-hidden>⋮⋮</span>
              <div
                className="w-11 h-11 rounded-xl border border-stone-200 flex items-center justify-center text-2xl"
                style={{ background: BRAND.cream }}
              >
                {link.preview.emoji}
              </div>
              <div className={`min-w-0 ${link.preview.isOutOfStock ? "opacity-70" : ""}`}>
                <div className="text-sm font-bold text-stone-900 truncate">
                  {link.preview.name}
                  {link.preview.size && (
                    <span className="text-stone-500 font-medium"> · {link.preview.size}</span>
                  )}
                </div>
                {(link.preview.repairMessage || link.preview.isOutOfStock) && (
                  <div className="mt-0.5 inline-flex items-center gap-1.5 text-[10px] font-black tracking-widest uppercase" style={{ color: BRAND.redDark }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: BRAND.redDark }} />
                    {link.preview.repairMessage ?? "Out of stock — hidden from customers"}
                  </div>
                )}
              </div>
              <span className="font-mono text-sm text-stone-700 whitespace-nowrap">
                {link.preview.price == null ? "—" : fmt(link.preview.price)}
              </span>
              <div className="flex items-center gap-1.5">
                {link.preview.blocksSave && onReplaceLinkedItem && (
                  <button
                    type="button"
                    onClick={() => onReplaceLinkedItem(i)}
                    className="px-2.5 py-1.5 rounded-lg border border-red-200 bg-white text-[10px] font-black tracking-widest uppercase text-red-700 hover:border-red-400"
                  >
                    Replace
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onRemoveLinkedItem(link.id, i)}
                  aria-label={`Remove ${link.preview.name}`}
                  className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 hover:text-red-600"
                >
                  <X size={16} strokeWidth={2.5} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={onAddLinkedItem}
          className="mt-3 w-full inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-3 text-sm font-bold text-stone-800 transition-colors hover:border-stone-900 hover:bg-white hover:text-stone-900"
        >
          <Plus size={16} strokeWidth={2.4} />
          Add required item to this option
        </button>
      </div>

      {/* Discount block */}
      <div className="mt-5">
        <div className="flex items-baseline justify-between mb-2.5">
          <span className="text-[11px] font-black tracking-widest uppercase text-stone-700">
            Discount
          </span>
          {option.discountPct != null && option.discountPct !== defaultDiscountPct && (
            <button
              type="button"
              onClick={() => onChange({ ...option, discountPct: defaultDiscountPct })}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-black tracking-widest"
              style={{ color: BRAND.red }}
            >
              <RotateCcw size={12} strokeWidth={2.5} />
              Use site default ({defaultDiscountPct}%)
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5 mb-3.5">
          {DISCOUNT_CHIPS.map((value) => {
            const active = pct === value;
            const isDefault = value === defaultDiscountPct;
            return (
              <button
                key={value}
                type="button"
                onClick={() => onChange({ ...option, discountPct: value })}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full font-mono text-xs font-black border transition-colors"
                style={
                  active
                    ? { background: BRAND.black, color: BRAND.yellow, borderColor: BRAND.black }
                    : { background: "white", color: "#44403c", borderColor: "#e7e5e4" }
                }
              >
                {value}%
                {isDefault && (
                  <span
                    className="px-1.5 py-0.5 rounded-full text-[9px] font-black tracking-widest uppercase"
                    style={{ background: BRAND.yellow, color: BRAND.black }}
                  >
                    default
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3.5 flex-wrap">
          <div className="relative w-40">
            <input
              type="number"
              min={0}
              max={99}
              step={1}
              value={pct}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                onChange({ ...option, discountPct: Number.isFinite(v) ? v : null });
              }}
              className="w-full pl-4 pr-9 py-3.5 text-right rounded-xl border-2 border-stone-300 font-mono font-black text-xl focus:outline-none focus:ring-2 focus:border-stone-900"
              style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-stone-500 font-mono font-black text-base pointer-events-none">
              %
            </span>
          </div>
          <span className="text-sm text-stone-600">
            of items normally totaling{" "}
            <strong className="font-mono font-bold text-stone-900">{fmt(itemsTotal)}</strong>
          </span>
        </div>

        {/* Calc card */}
        <div
          aria-live="polite"
          className="mt-4 p-4 rounded-2xl border border-stone-200 font-mono text-sm"
          style={{ background: BRAND.cream }}
        >
          <CalcLine label="Items normally total" value={fmt(itemsTotal)} />
          <CalcLine label={`Discount (${pct}%)`} value={`− ${fmt(save)}`} />
          <div className="border-t border-dashed border-stone-400/50 my-1.5" />
          <CalcLine
            label="Customer pays"
            value={fmt(customerPays)}
            emphasize
          />
          <CalcLine
            label='"Save" tag shown to customer'
            value={`Save ${fmt(save)}`}
            tone="red"
          />
        </div>
      </div>
    </div>
  );
}

function CalcLine({
  label,
  value,
  emphasize,
  tone,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
  tone?: "red";
}) {
  return (
    <div
      className="flex justify-between py-1"
      style={{
        color: tone === "red" ? BRAND.red : "#44403c",
        fontFamily: emphasize ? "Archivo Black" : undefined,
        fontSize: emphasize ? "16px" : undefined,
      }}
    >
      <span>{label}</span>
      <span style={{ color: emphasize ? BRAND.black : undefined }}>{value}</span>
    </div>
  );
}
