"use client";

import { ArrowLeft, Check, ChevronRight } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { STORE_CONFIG } from "@/lib/store-config";

export default function TopBar({
  onBack,
  step,
}: {
  onBack: () => void;
  step: number;
}) {
  const labels = ["Order Type", "Menu", "Review", "Payment"];
  return (
    <div
      className="flex items-center justify-between px-4 py-3 text-white"
      style={{ background: BRAND.black }}
    >
      <button
        onClick={onBack}
        aria-label="Back"
        className="btn-press flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-white/10 min-h-[48px]"
      >
        <ArrowLeft size={18} strokeWidth={3} />
        <span className="font-black text-sm">BACK</span>
      </button>
      <div className="flex items-center gap-3">
        {labels.map((l, i) => {
          const active = i + 1 === step;
          const done = i + 1 < step;
          return (
            <div key={l} className="flex items-center gap-2">
              <div
                className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-black tracking-widest"
                style={{
                  background: active
                    ? BRAND.yellow
                    : done
                    ? "rgba(255,255,255,0.15)"
                    : "transparent",
                  color: active ? BRAND.black : "white",
                }}
              >
                <span>{done ? <Check size={12} strokeWidth={3} /> : i + 1}</span>
                <span className="hidden sm:inline">{l.toUpperCase()}</span>
              </div>
              {i < labels.length - 1 && (
                <ChevronRight size={14} className="opacity-30" />
              )}
            </div>
          );
        })}
      </div>
      <div className="text-xs font-black tracking-widest opacity-60">
        {STORE_CONFIG.storeName.toUpperCase()}
      </div>
    </div>
  );
}
