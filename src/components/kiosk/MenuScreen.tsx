"use client";

import { ArrowLeft, Package, Plus, Utensils } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { getKioskLowStockLabel } from "@/lib/kiosk-stock-label";
import { fmt } from "@/lib/pricing";
import { formatOrderTypeLabel, STORE_CONFIG } from "@/lib/store-config";
import type { CartItemState, CategoryDTO, MenuItemDTO, OrderType } from "@/lib/types";
import BadgeChip from "./BadgeChip";
import CartSidebar from "./CartSidebar";
import ItemVisual from "./ItemVisual";

export default function MenuScreen({
  orderType,
  categories,
  items,
  activeCategory,
  setActiveCategory,
  onItem,
  cart,
  updateQty,
  removeLine,
  subtotal,
  gst,
  total,
  itemCount,
  notice,
  onCheckout,
  onBack,
  mode = "ordering",
}: {
  orderType: OrderType;
  categories: CategoryDTO[];
  items: MenuItemDTO[];
  activeCategory: string;
  setActiveCategory: (slug: string) => void;
  onItem: (item: MenuItemDTO) => void;
  cart: CartItemState[];
  updateQty: (lineId: string, delta: number) => void;
  removeLine: (lineId: string) => void;
  subtotal: number;
  gst: number;
  total: number;
  itemCount: number;
  notice?: string | null;
  onCheckout: () => void;
  onBack: () => void;
  mode?: "ordering" | "preview";
}) {
  const activeCat = categories.find((c) => c.slug === activeCategory);
  const catById = new Map(categories.map((c) => [c.id, c.slug]));
  const visible = items.filter((i) => catById.get(i.categoryId) === activeCategory);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: BRAND.gray }}>
      <div style={{ background: BRAND.red }} className="text-white">
        <div
          className="flex items-center justify-between px-6 py-3 text-xs font-bold tracking-widest"
          style={{ background: BRAND.redDark }}
        >
          <button
            onClick={onBack}
            aria-label="Change order type"
            className="btn-press flex items-center gap-2 hover:opacity-80"
          >
            <ArrowLeft size={14} strokeWidth={3} /> CHANGE ORDER TYPE
          </button>
          <span className="flex items-center gap-2">
            {orderType === "DINE_IN" ? <Utensils size={14} /> : <Package size={14} />}
            {formatOrderTypeLabel(orderType)}
          </span>
          <span>KIOSK #{STORE_CONFIG.kioskId}</span>
        </div>

        <div className="overflow-x-auto no-scrollbar">
          <div className="flex gap-2 px-4 py-3 min-w-max">
            {categories.map((cat) => {
              const active = cat.slug === activeCategory;
              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.slug)}
                  aria-pressed={active}
                  aria-label={`Category ${cat.name}`}
                  className={`btn-press flex-shrink-0 flex flex-col items-center justify-center gap-1 min-w-[96px] min-h-[80px] px-4 py-3 rounded-2xl transition-all ${
                    active ? "scale-105" : "opacity-80 hover:opacity-100"
                  }`}
                  style={{
                    background: active ? BRAND.yellow : "rgba(255,255,255,0.15)",
                    color: active ? BRAND.black : "white",
                  }}
                >
                  <span className="text-3xl">{cat.icon}</span>
                  <span className="text-xs font-black uppercase tracking-wide">{cat.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex-1 grid lg:grid-cols-[1fr_400px]">
        <div className="p-6">
          <div className="flex items-baseline justify-between mb-5">
            <div>
              <div className="text-xs font-black tracking-widest opacity-60 mb-1">MENU</div>
              <h2 className="display text-4xl capitalize">{activeCat?.name ?? ""}</h2>
            </div>
            <div className="text-xs font-bold opacity-60">{visible.length} items</div>
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {visible.map((item, idx) => {
              const outOfStock = item.isOutOfStock;
              const unavailableLabel =
                item.dealLimitSoldOut
                  ? "Sold out"
                  : item.stockMode === "QUANTITY" &&
                item.isOutOfStock &&
                (item.stockQty ?? 0) > 0
                  ? "Unavailable"
                  : "Out of stock";
              const lowStockLabel = getKioskLowStockLabel(item);

              return (
                <button
                  key={item.id}
                  onClick={() => {
                    if (!outOfStock) onItem(item);
                  }}
                  aria-disabled={outOfStock}
                  aria-label={
                    outOfStock
                      ? `${item.name} — ${unavailableLabel.toLowerCase()}`
                      : `Add ${item.name} — ${fmt(item.price)}`
                  }
                  className="btn-press tile-hover fade-up text-left bg-white rounded-2xl overflow-hidden relative group"
                  style={{
                    animationDelay: `${idx * 30}ms`,
                    cursor: outOfStock ? "not-allowed" : undefined,
                  }}
                >
                  {outOfStock && (
                    <div className="absolute top-3 left-3 z-20">
                      <span
                        className="px-3 py-1 rounded-full text-[10px] font-black tracking-widest"
                        style={{ background: BRAND.red, color: "white" }}
                      >
                        {unavailableLabel.toUpperCase()}
                      </span>
                    </div>
                  )}
                  {!outOfStock && lowStockLabel && (
                    <div className="absolute top-3 left-3 z-20">
                      <span
                        className="px-3 py-1 rounded-full text-[10px] font-black tracking-widest"
                        style={{ background: BRAND.yellow, color: BRAND.black }}
                      >
                        {lowStockLabel.toUpperCase()}
                      </span>
                    </div>
                  )}
                  {item.badge && (
                    <div
                      className={`absolute ${
                        outOfStock || lowStockLabel ? "top-12" : "top-3"
                      } left-3 z-10`}
                    >
                      <BadgeChip badge={item.badge} />
                    </div>
                  )}
                  {item.comboNum != null && (
                    <div
                      className="absolute top-3 right-3 z-10 display text-2xl px-3 py-1 rounded-lg"
                      style={{ background: BRAND.black, color: BRAND.yellow }}
                    >
                      #{item.comboNum}
                    </div>
                  )}

                <div className="relative h-48 overflow-hidden">
                  <ItemVisual item={item} size="card" />
                </div>

                <div className="p-4">
                  <div className="display text-xl mb-1 leading-tight">{item.name}</div>
                  <div className="text-xs opacity-60 mb-3 line-clamp-2 min-h-[32px]">
                    {item.description}
                  </div>
                  <div className="flex items-end justify-between">
                    <div>
                      {item.bundleSavings != null && (
                        <div className="text-[10px] font-black tracking-widest line-through opacity-40">
                          Save {fmt(item.bundleSavings)}
                        </div>
                      )}
                      <div className="display text-2xl" style={{ color: BRAND.red }}>
                        {fmt(item.price)}
                      </div>
                    </div>
                    {outOfStock ? (
                      <div
                        className="px-3 py-2 rounded-xl text-[10px] font-black tracking-widest"
                        style={{ background: "#FDE2E0", color: BRAND.red }}
                      >
                        UNAVAILABLE
                      </div>
                    ) : (
                      <div
                        className="w-11 h-11 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110"
                        style={{ background: BRAND.yellow, color: BRAND.black }}
                      >
                        <Plus size={22} strokeWidth={3} />
                      </div>
                    )}
                  </div>
                </div>
                </button>
              );
            })}
          </div>
        </div>

        {mode === "preview" ? (
          <aside
            className="hidden lg:flex flex-col items-center justify-center gap-3 p-8 text-center"
            style={{ background: BRAND.black, color: "white" }}
          >
            <div
              className="px-3 py-1 rounded-full text-[10px] font-black tracking-widest"
              style={{ background: BRAND.yellow, color: BRAND.black }}
            >
              PREVIEW MODE
            </div>
            <div className="display text-2xl leading-tight">
              No orders are placed in this view.
            </div>
            <div className="text-xs opacity-70 leading-snug">
              This is exactly what customers see right now. Tap any item to
              walk through the customize screen — nothing is added to a cart.
            </div>
          </aside>
        ) : (
          <CartSidebar
            cart={cart}
            updateQty={updateQty}
            removeLine={removeLine}
            subtotal={subtotal}
            gst={gst}
            total={total}
            itemCount={itemCount}
            onCheckout={onCheckout}
          />
        )}
      </div>
    </div>
  );
}
