"use client";

import { Plus, X } from "lucide-react";
import { BRAND } from "@/lib/brand";
import type { AdminModifierInput } from "./types";

type Props = {
  sizes: AdminModifierInput[];
  onChange: (next: AdminModifierInput[]) => void;
  // Validation messages flow from the parent's validateItemInput pass.
  errors?: Record<number, string>;
};

// TODO(wiring): drag-to-reorder via @dnd-kit or similar. The drag handles
// here are visual only — onDragStart/onDrop need a library binding.
export default function SizesEditor({ sizes, onChange, errors }: Props) {
  function update(index: number, patch: Partial<AdminModifierInput>) {
    const next = sizes.map((s, i) => (i === index ? { ...s, ...patch } : s));
    onChange(next);
  }
  function remove(index: number) {
    onChange(sizes.filter((_, i) => i !== index));
  }
  function add() {
    onChange([...sizes, { name: "", priceDelta: 0 }]);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-black tracking-widest uppercase text-stone-700">
          Sizes
        </span>
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[11px] font-black tracking-widest"
          style={{ background: BRAND.black, color: BRAND.yellow }}
        >
          <Plus size={14} strokeWidth={2.5} />
          Add size
        </button>
      </div>

      {sizes.length === 0 ? (
        <div className="p-5 text-center text-sm text-stone-500 border border-dashed border-stone-300 rounded-xl">
          No sizes — kiosk will charge the base price.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {sizes.map((size, i) => (
            <div
              key={i}
              className="grid grid-cols-[24px_1fr_140px_auto] gap-2.5 items-center px-2.5 py-1.5 border border-stone-200 rounded-xl bg-white hover:border-stone-300"
            >
              <DragHandle />
              <input
                type="text"
                value={size.name}
                onChange={(e) => update(i, { name: e.target.value })}
                placeholder="Size name"
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
                  value={size.priceDelta}
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
                aria-label={`Remove size ${size.name || i + 1}`}
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
      )}
    </div>
  );
}

function DragHandle() {
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label="Drag to reorder"
      className="cursor-grab w-6 h-7 inline-flex items-center justify-center text-stone-400 hover:text-stone-700"
    >
      <span
        className="block w-2 h-3.5"
        style={{
          backgroundImage: "radial-gradient(circle, currentColor 1px, transparent 1.5px)",
          backgroundSize: "4px 4px",
        }}
      />
    </span>
  );
}
