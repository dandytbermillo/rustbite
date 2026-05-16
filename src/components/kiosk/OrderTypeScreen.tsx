"use client";

import { ChevronRight, Package, Utensils } from "lucide-react";
import { BRAND } from "@/lib/brand";
import {
  getOrderTypePresentation,
  STORE_CONFIG,
} from "@/lib/store-config";
import TopBar from "./TopBar";
import type { OrderType } from "@/lib/types";

export default function OrderTypeScreen({
  onPick,
  onBack,
}: {
  onPick: (t: OrderType) => void;
  onBack: () => void;
}) {
  const dineIn = getOrderTypePresentation("DINE_IN");
  const takeOut = getOrderTypePresentation("TAKEOUT");

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar onBack={onBack} step={1} />
      <div className="flex-1 flex flex-col items-center justify-center px-8 py-10 fade-up">
        <div className="text-center mb-12">
          <div
            className="inline-block px-4 py-1 rounded-full text-xs font-black tracking-widest mb-4"
            style={{ background: BRAND.yellow }}
          >
            {STORE_CONFIG.serviceModel === "TABLE_SERVICE"
              ? "HOW TO EAT"
              : "HOW SHOULD WE PACK IT?"}
          </div>
          <h2 className="display text-5xl md:text-8xl" style={{ color: BRAND.black }}>
            {STORE_CONFIG.serviceModel === "TABLE_SERVICE" ? (
              <>
                Where are you
                <br />
                eating today?
              </>
            ) : (
              <>
                Where will you
                <br />
                enjoy it?
              </>
            )}
          </h2>
        </div>

        <div className="grid md:grid-cols-2 gap-6 w-full max-w-5xl">
          <button
            onClick={() => onPick("DINE_IN")}
            aria-label="Dine in"
            className="btn-press tile-hover relative overflow-hidden p-12 rounded-3xl text-left"
            style={{ background: BRAND.red, color: "white", boxShadow: "0 8px 0 rgba(0,0,0,0.15)" }}
          >
            <div className="absolute -right-4 -bottom-4 text-[16rem] opacity-20 rotate-12 pointer-events-none">🍽️</div>
            <div className="relative z-10">
              <Utensils size={72} strokeWidth={2} className="mb-6" />
              <div className="text-sm font-bold tracking-widest mb-2" style={{ color: BRAND.yellow }}>
                {dineIn.eyebrow}
              </div>
              <div className="display text-6xl mb-3">{dineIn.title}</div>
              <div className="text-lg opacity-90">{dineIn.description}</div>
              <div className="mt-8 inline-flex items-center gap-2 text-sm font-bold px-4 py-2 rounded-full bg-white/20 backdrop-blur">
                {dineIn.badge} <ChevronRight size={16} />
              </div>
            </div>
          </button>

          <button
            onClick={() => onPick("TAKEOUT")}
            aria-label="Takeout"
            className="btn-press tile-hover relative overflow-hidden p-12 rounded-3xl text-left"
            style={{ background: BRAND.yellow, color: BRAND.black, boxShadow: "0 8px 0 rgba(0,0,0,0.15)" }}
          >
            <div className="absolute -right-4 -bottom-4 text-[16rem] opacity-20 rotate-12 pointer-events-none">🛍️</div>
            <div className="relative z-10">
              <Package size={72} strokeWidth={2} className="mb-6" />
              <div className="text-sm font-bold tracking-widest mb-2" style={{ color: BRAND.red }}>
                {takeOut.eyebrow}
              </div>
              <div className="display text-6xl mb-3">{takeOut.title}</div>
              <div className="text-lg opacity-80">{takeOut.description}</div>
              <div className="mt-8 inline-flex items-center gap-2 text-sm font-bold px-4 py-2 rounded-full bg-black/10">
                {takeOut.badge} <ChevronRight size={16} />
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
