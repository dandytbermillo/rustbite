"use client";

import { ChevronRight, Minus, Plus, ShoppingBag, X } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { cartLineSummaryParts } from "@/lib/cart-summary";
import { computeLineTotal, fmt } from "@/lib/pricing";
import type { CartItemState } from "@/lib/types";
import ItemVisual from "./ItemVisual";

export default function CartSidebar({
  cart,
  updateQty,
  removeLine,
  subtotal,
  gst,
  total,
  itemCount,
  onCheckout,
}: {
  cart: CartItemState[];
  updateQty: (lineId: string, delta: number) => void;
  removeLine: (lineId: string) => void;
  subtotal: number;
  gst: number;
  total: number;
  itemCount: number;
  onCheckout: () => void;
}) {
  return (
    <aside
      className="bg-white border-l-4 flex flex-col lg:sticky lg:top-0 lg:h-screen"
      style={{ borderColor: BRAND.yellow }}
      aria-label="Your cart"
    >
      <div
        className="px-5 py-4 flex items-center justify-between"
        style={{ background: BRAND.black, color: "white" }}
      >
        <div className="flex items-center gap-3">
          <ShoppingBag size={20} strokeWidth={2.5} />
          <span className="font-black uppercase tracking-wider">Your Order</span>
        </div>
        <div className="display text-xl" style={{ color: BRAND.yellow }}>
          {itemCount} {itemCount === 1 ? "ITEM" : "ITEMS"}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {cart.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8">
            <div className="text-7xl mb-4 opacity-30">🛒</div>
            <div className="display text-2xl mb-2">Nothing here yet!</div>
            <div className="text-sm opacity-60">Tap a menu item to add it to your order.</div>
          </div>
        ) : (
          <div className="space-y-3">
            {cart.map((ci) => {
              const summary = cartLineSummaryParts(ci).join(" · ");
              return (
                <div
                  key={ci.lineId}
                  className="flex gap-3 p-3 rounded-xl fade-up"
                  style={{ background: BRAND.gray }}
                >
                  <div className="relative w-14 h-14 rounded-lg overflow-hidden flex-shrink-0">
                    <ItemVisual item={ci.item} size="sidebar" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between">
                      <div className="font-black text-sm leading-tight pr-2">{ci.item.name}</div>
                      <button
                        onClick={() => removeLine(ci.lineId)}
                        aria-label={`Remove ${ci.item.name}`}
                        className="btn-press p-1 rounded hover:bg-black/10"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    {summary && (
                      <div className="text-[10px] opacity-60 leading-tight my-1">
                        {summary}
                      </div>
                    )}
                    <div className="flex items-center justify-between mt-1">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => updateQty(ci.lineId, -1)}
                          aria-label="Decrease quantity"
                          className="btn-press w-8 h-8 rounded-md flex items-center justify-center font-black bg-white"
                        >
                          <Minus size={12} strokeWidth={3} />
                        </button>
                        <span className="mono font-black w-5 text-center">{ci.qty}</span>
                        <button
                          onClick={() => updateQty(ci.lineId, 1)}
                          aria-label="Increase quantity"
                          className="btn-press w-8 h-8 rounded-md flex items-center justify-center font-black"
                          style={{ background: BRAND.yellow }}
                        >
                          <Plus size={12} strokeWidth={3} />
                        </button>
                      </div>
                      <div className="mono font-black text-sm">{fmt(computeLineTotal(ci))}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {cart.length > 0 && (
        <div
          className="border-t-2 border-dashed p-4 space-y-3"
          style={{ borderColor: BRAND.gray }}
        >
          <div className="flex justify-between text-sm">
            <span className="opacity-60">Subtotal</span>
            <span className="mono font-bold">{fmt(subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="opacity-60">GST (5%)</span>
            <span className="mono font-bold">{fmt(gst)}</span>
          </div>
          <div
            className="flex items-baseline justify-between pt-2 border-t-2"
            style={{ borderColor: BRAND.black }}
          >
            <span className="display text-2xl">TOTAL</span>
            <span className="display text-3xl" style={{ color: BRAND.red }}>
              {fmt(total)}
            </span>
          </div>
          <button
            onClick={onCheckout}
            className="btn-press w-full flex items-center justify-center gap-2 py-5 rounded-2xl display text-xl transition-transform hover:scale-[1.02] min-h-[48px]"
            style={{ background: BRAND.red, color: "white", boxShadow: "0 6px 0 rgba(0,0,0,0.15)" }}
          >
            CHECKOUT <ChevronRight size={22} strokeWidth={3} />
          </button>
        </div>
      )}
    </aside>
  );
}
