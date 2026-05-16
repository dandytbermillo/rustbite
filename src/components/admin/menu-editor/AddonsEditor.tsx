"use client";

import { useState } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import { BRAND } from "@/lib/brand";
import type { AdminModifierInput } from "./types";

type Props = {
  addons: AdminModifierInput[];
  onChange: (next: AdminModifierInput[]) => void;
  errors?: Record<number, string>;
  demoteCreation?: boolean;
};

// Same shape as SizesEditor — kept separate to give the section its own
// header/title and so future per-type behaviors (e.g. "is mutually exclusive"
// flag for sizes) don't need a discriminator on a shared editor.
// These rows are the temporary item-specific add-ons. Add-on sets are edited
// through the Workspace Add-ons library panel.
// TODO(wiring): drag-to-reorder via @dnd-kit.
export default function AddonsEditor({
  addons,
  onChange,
  errors,
  demoteCreation = false,
}: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  function update(index: number, patch: Partial<AdminModifierInput>) {
    onChange(addons.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  }
  function remove(index: number) {
    onChange(addons.filter((_, i) => i !== index));
  }
  function add() {
    onChange([...addons, { name: "", priceDelta: 0 }]);
    if (demoteCreation) setAdvancedOpen(true);
  }

  const rows =
    addons.length === 0 ? null : (
      <div className="flex flex-col gap-2">
        {addons.map((addon, i) => (
          <div
            key={i}
            className="grid grid-cols-[24px_1fr_140px_auto] gap-2.5 items-center px-2.5 py-1.5 border border-stone-200 rounded-xl bg-white hover:border-stone-300"
          >
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
            <input
              type="text"
              value={addon.name}
              onChange={(e) => update(i, { name: e.target.value })}
              placeholder="Item-specific add-on name"
              className="px-3 py-2.5 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:border-stone-900"
              style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
            />
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500 font-mono font-bold pointer-events-none">
                +$
              </span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={addon.priceDelta}
                onChange={(e) =>
                  update(i, { priceDelta: parseFloat(e.target.value) || 0 })
                }
                className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-stone-200 font-mono text-sm focus:outline-none focus:ring-2 focus:border-stone-900"
                style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
              />
            </div>
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label={`Remove item-specific add-on ${addon.name || i + 1}`}
              className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 hover:text-red-600"
            >
              <X size={16} strokeWidth={2.5} />
            </button>
            {errors?.[i] && (
              <div className="col-span-4 text-xs font-bold text-red-600 ml-9">
                {errors[i]}
              </div>
            )}
          </div>
        ))}
      </div>
    );

  if (demoteCreation) {
    return (
      <div>
        {addons.length > 0 && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-black tracking-widest uppercase text-stone-700">
                  Item-specific add-ons
                </span>
                <span className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-stone-500">
                  Fallback
                </span>
              </div>
            </div>
            {rows}
            <p className="mt-3 text-xs font-bold leading-relaxed text-stone-500">
              Use add-on sets for new reusable add-ons. Keep these rows only when
              this item needs one-off behavior.
            </p>
          </>
        )}

        <div className={addons.length > 0 ? "mt-3" : ""}>
          <button
            type="button"
            onClick={() => setAdvancedOpen((open) => !open)}
            className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-stone-600 hover:border-stone-400"
            aria-expanded={advancedOpen}
          >
            Advanced item-specific add-ons
            <ChevronDown
              size={13}
              strokeWidth={2.5}
              className={advancedOpen ? "rotate-180" : ""}
              aria-hidden
            />
          </button>
          {advancedOpen && (
            <div className="mt-3 rounded-xl border border-dashed border-stone-300 bg-stone-50 p-4">
              {addons.length === 0 && (
                <p className="mb-3 text-xs font-bold leading-relaxed text-stone-500">
                  Add-on sets are the default. Use an item-specific add-on only
                  for a one-off option that should not be reused by other items.
                </p>
              )}
              <button
                type="button"
                onClick={add}
                className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[11px] font-black tracking-widest"
                style={{ background: BRAND.black, color: BRAND.yellow }}
              >
                <Plus size={14} strokeWidth={2.5} />
                Add item-specific add-on
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-black tracking-widest uppercase text-stone-700">
          Item-specific add-ons
        </span>
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[11px] font-black tracking-widest"
          style={{ background: BRAND.black, color: BRAND.yellow }}
        >
          <Plus size={14} strokeWidth={2.5} />
          Add item-specific add-on
        </button>
      </div>

      {addons.length === 0 ? (
        <div className="p-5 text-center text-sm text-stone-500 border border-dashed border-stone-300 rounded-xl">
          No item-specific add-ons configured.
        </div>
      ) : (
        rows
      )}
    </div>
  );
}
