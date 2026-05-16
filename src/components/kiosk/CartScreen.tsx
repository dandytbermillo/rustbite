"use client";

import { useMemo } from "react";
import { ChevronRight, Minus, Plus, Sparkles, Trash2 } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { cartLineSummaryParts } from "@/lib/cart-summary";
import { maxOrderableQuantityForItem } from "@/lib/kiosk-cart-reconcile";
import { computeLineTotal, fmt } from "@/lib/pricing";
import { formatOrderTypeLabel, STORE_CONFIG } from "@/lib/store-config";
import type { CartItemState, MenuItemDTO, OrderType } from "@/lib/types";
import ItemVisual from "./ItemVisual";
import TopBar from "./TopBar";

const UPSELL_NAMES = ["Golden Fries", "Vanilla Milkshake", "Soft Serve Cone"];

type CartLineIssue = {
  message: string;
  requestedQty: number;
  availableQty: number;
};

export default function CartScreen({
  cart,
  items,
  notice,
  lineIssues = {},
  updateQty,
  removeLine,
  resolveLineIssue,
  subtotal,
  gst,
  total,
  orderType,
  onAddUpsell,
  onBack,
  onPay,
  payDisabled = false,
}: {
  cart: CartItemState[];
  items: MenuItemDTO[];
  notice?: string | null;
  lineIssues?: Record<string, CartLineIssue>;
  updateQty: (lineId: string, delta: number) => void;
  removeLine: (lineId: string) => void;
  resolveLineIssue?: (lineId: string) => void;
  subtotal: number;
  gst: number;
  total: number;
  orderType: OrderType;
  onAddUpsell: (item: MenuItemDTO) => void;
  onBack: () => void;
  onPay: () => void;
  payDisabled?: boolean;
}) {
  const upsellItems = useMemo(
    () =>
      UPSELL_NAMES.map((n) =>
        items.find((i) => i.name === n && !i.isOutOfStock)
      ).filter((x): x is MenuItemDTO => !!x),
    [items]
  );

  const receiptRef = useMemo(
    () => `#PRE-${Math.floor(Math.random() * 9999)}`,
    []
  );
  const quantityRequestedByItem = useMemo(() => {
    const requested = new Map<string, number>();
    for (const line of cart) {
      requested.set(line.item.id, (requested.get(line.item.id) ?? 0) + line.qty);
    }
    return requested;
  }, [cart]);
  const itemById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items]
  );

  return (
    <div className="min-h-screen flex flex-col" style={{ background: BRAND.gray }}>
      <TopBar onBack={onBack} step={3} />
      <div className="flex-1 grid lg:grid-cols-[1fr_420px] gap-6 p-6">
        <div>
          <div className="mb-5">
            <div
              className="inline-block px-3 py-1 rounded-full text-xs font-black tracking-widest mb-2"
              style={{ background: BRAND.yellow }}
            >
              REVIEW YOUR ORDER
            </div>
            <h2 className="display text-4xl md:text-5xl">Anything else?</h2>
            <div className="text-xs font-black tracking-widest opacity-60 mt-2">
              {formatOrderTypeLabel(orderType)} · {cart.length}{" "}
              {cart.length === 1 ? "ITEM" : "ITEMS"}
            </div>
          </div>

          {notice && (
            <div
              className="mb-5 rounded-2xl border-2 px-4 py-3 text-sm font-bold"
              style={{
                background: "#FFF2CC",
                borderColor: BRAND.yellow,
                color: BRAND.black,
              }}
            >
              {notice}
            </div>
          )}

          <div className="space-y-3 mb-8">
            {cart.map((ci) => {
              const summaryParts = cartLineSummaryParts(ci);
              const issue = lineIssues[ci.lineId];
              const liveItem = itemById.get(ci.item.id) ?? ci.item;
              const maxQty = maxOrderableQuantityForItem(liveItem);
              const requestedQty = quantityRequestedByItem.get(ci.item.id) ?? ci.qty;
              const increaseDisabled = !!issue || (maxQty != null && requestedQty >= maxQty);
              return (
                <div
                  key={ci.lineId}
                  className={`bg-white rounded-2xl p-4 flex gap-4 fade-up border-2 ${
                    issue ? "border-red-400" : "border-transparent"
                  }`}
                  style={
                    issue
                      ? { background: "#FFF7F2" }
                      : undefined
                  }
                >
                  <div className="relative w-20 h-20 rounded-xl overflow-hidden flex-shrink-0">
                    <ItemVisual item={ci.item} size="cart" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="display text-xl leading-tight">{ci.item.name}</div>
                        {summaryParts.length > 0 && (
                          <div className="text-xs opacity-60 space-y-0.5 mt-1">
                            {summaryParts.map((part) => (
                              <div key={part}>• {part}</div>
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => removeLine(ci.lineId)}
                        aria-label={`Remove ${ci.item.name}`}
                        className="btn-press p-2 rounded-lg hover:bg-black/5"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                    <div className="flex items-center justify-between mt-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => updateQty(ci.lineId, -1)}
                          aria-label="Decrease quantity"
                          className="btn-press w-10 h-10 rounded-lg flex items-center justify-center"
                          style={{ background: BRAND.gray }}
                        >
                          <Minus size={14} strokeWidth={3} />
                        </button>
                        <span className="mono font-black w-6 text-center">{ci.qty}</span>
                        <button
                          onClick={() => updateQty(ci.lineId, 1)}
                          aria-label="Increase quantity"
                          disabled={increaseDisabled}
                          className="btn-press w-10 h-10 rounded-lg flex items-center justify-center disabled:opacity-35 disabled:cursor-not-allowed"
                          style={{ background: increaseDisabled ? BRAND.gray : BRAND.yellow }}
                        >
                          <Plus size={14} strokeWidth={3} />
                        </button>
                      </div>
                      <div className="display text-xl">{fmt(computeLineTotal(ci))}</div>
                    </div>
                    {issue && (
                      <div
                        className="mt-3 flex flex-col gap-2 rounded-xl border-2 px-3 py-3 text-sm font-black sm:flex-row sm:items-center sm:justify-between"
                        style={{
                          background: "#FFF2CC",
                          borderColor: BRAND.yellow,
                          color: BRAND.black,
                        }}
                      >
                        <span>{issue.message}</span>
                        {resolveLineIssue && (
                          <button
                            type="button"
                            onClick={() => resolveLineIssue(ci.lineId)}
                            className="btn-press rounded-full px-4 py-2 text-xs font-black uppercase tracking-widest"
                            style={{ background: BRAND.black, color: "white" }}
                          >
                            {issue.availableQty <= 0 ? "Remove" : "Reduce"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {upsellItems.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Sparkles size={20} style={{ color: BRAND.red }} strokeWidth={2.5} />
                <div className="display text-xl">WAIT — DID YOU FORGET?</div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {upsellItems.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => onAddUpsell(u)}
                    aria-label={`Add ${u.name} for ${fmt(u.price)}`}
                    className="btn-press tile-hover bg-white rounded-2xl p-4 text-center"
                  >
                    <div className="relative h-20 rounded-lg overflow-hidden mb-2">
                      <ItemVisual item={u} size="cart" />
                    </div>
                    <div className="font-black text-sm mb-1">{u.name}</div>
                    <div className="display text-lg" style={{ color: BRAND.red }}>
                      +{fmt(u.price)}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div
          className="h-fit lg:sticky lg:top-4 bg-white rounded-2xl overflow-hidden"
          style={{ boxShadow: "0 8px 0 rgba(0,0,0,0.1)" }}
        >
          <div
            className="px-5 py-4 flex items-center justify-between"
            style={{ background: BRAND.black, color: "white" }}
          >
            <span className="font-black uppercase tracking-wider">Receipt</span>
            <span className="mono text-xs opacity-60">{receiptRef}</span>
          </div>
          <div className="p-5 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="opacity-60">Subtotal</span>
              <span className="mono font-bold">{fmt(subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="opacity-60">GST (5%)</span>
              <span className="mono font-bold">{fmt(gst)}</span>
            </div>
            <div className="border-t-2 border-dashed my-3" />
            <div className="flex items-baseline justify-between">
              <span className="display text-2xl">TOTAL</span>
              <span className="display text-4xl" style={{ color: BRAND.red }}>
                {fmt(total)}
              </span>
            </div>
          </div>
          <div className="p-5 pt-0">
            <button
              onClick={onPay}
              disabled={cart.length === 0 || payDisabled}
              className="btn-press w-full flex items-center justify-center gap-2 py-5 rounded-2xl display text-xl disabled:opacity-40"
              style={{ background: BRAND.red, color: "white", boxShadow: "0 6px 0 rgba(0,0,0,0.2)" }}
            >
              PAY NOW <ChevronRight size={22} strokeWidth={3} />
            </button>
            <div className="text-center text-xs opacity-60 mt-3 font-bold tracking-widest">
              {STORE_CONFIG.paymentMode === "TERMINAL"
                ? "LIVE PAYMENT · CARD READER REQUIRED"
                : "DEMO CHECKOUT · NO PAYMENT CAPTURED"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
