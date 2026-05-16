"use client";

import { useEffect, useState } from "react";
import { Check, ChefHat, Package, Utensils } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { fmt } from "@/lib/pricing";
import { formatOrderTypeLabel } from "@/lib/store-config";
import { formatUpgradeForOrderRead } from "@/lib/order-read";
import type { OrderSummary, OrderStatus } from "@/lib/types";

function elapsed(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function ageMinutes(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 60000;
}

export default function OrderCard({
  order,
  onAdvance,
  isNew,
  disabledReason,
}: {
  order: OrderSummary;
  onAdvance: (id: string, next: OrderStatus) => void;
  isNew: boolean;
  disabledReason?: string | null;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15000);
    return () => clearInterval(t);
  }, []);

  const isPreparing = order.status === "IN_KITCHEN";
  const age = ageMinutes(order.createdAt);
  const stale = age > 8;

  const headBg = isPreparing ? "#F39C12" : BRAND.red;
  const accent = isPreparing ? "#2a1a00" : BRAND.yellow;

  return (
    <article
      className={`rounded-2xl overflow-hidden flex flex-col ${isNew ? "flash-in" : ""}`}
      style={{
        background: "#1c1c1c",
        border: `3px solid ${stale ? "#ff3b30" : "transparent"}`,
      }}
      aria-label={`Order ${order.orderNumber}, ${order.status}`}
    >
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ background: headBg, color: "white" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="display px-3 py-1 rounded-lg text-3xl"
            style={{ background: "rgba(0,0,0,0.35)", color: accent }}
          >
            #{order.orderNumber}
          </div>
          <span className="inline-flex items-center gap-1 text-xs font-black tracking-widest uppercase">
            {order.orderType === "DINE_IN" ? (
              <><Utensils size={14} /> {formatOrderTypeLabel(order.orderType)}</>
            ) : (
              <><Package size={14} /> {formatOrderTypeLabel(order.orderType)}</>
            )}
          </span>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-black tracking-widest opacity-80">
            {order.status}
          </div>
          <div className="mono text-sm font-bold">{elapsed(order.createdAt)}</div>
        </div>
      </div>

      <div className="flex-1 px-4 py-3 space-y-2">
        {order.items.map((it) => {
          const mods: string[] = [];
          if (it.sizeName) mods.push(it.sizeName);
          const upgradeLabel = formatUpgradeForOrderRead(it);
          if (upgradeLabel) mods.push(upgradeLabel);
          const adds = Array.isArray(it.addonsJson) ? it.addonsJson.map((a) => a.name) : [];
          return (
            <div key={it.id} className="text-white">
              <div className="flex items-baseline justify-between gap-3">
                <div className="font-black text-lg leading-tight">
                  <span className="mono" style={{ color: BRAND.yellow }}>
                    ×{it.qty}
                  </span>{" "}
                  {it.nameSnapshot}
                </div>
                <div className="mono text-xs opacity-60">{fmt(it.lineTotal)}</div>
              </div>
              {(mods.length > 0 || adds.length > 0) && (
                <div className="text-xs font-bold opacity-70 pl-6">
                  {mods.join(" · ")}
                  {mods.length > 0 && adds.length > 0 ? " · " : ""}
                  {adds.join(", ")}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="px-4 py-3 flex gap-2 border-t border-white/10">
        {order.status === "PAID" && (
          <button
            onClick={() => onAdvance(order.id, "IN_KITCHEN")}
            disabled={Boolean(disabledReason)}
            title={disabledReason ?? undefined}
            className="btn-press flex-1 flex items-center justify-center gap-2 py-4 rounded-xl display text-lg min-h-[48px] disabled:opacity-40"
            style={{ background: "#F39C12", color: "white" }}
          >
            <ChefHat size={20} /> START
          </button>
        )}
        {order.status === "IN_KITCHEN" && (
          <button
            onClick={() => onAdvance(order.id, "READY")}
            disabled={Boolean(disabledReason)}
            title={disabledReason ?? undefined}
            className="btn-press flex-1 flex items-center justify-center gap-2 py-4 rounded-xl display text-lg min-h-[48px] disabled:opacity-40"
            style={{ background: BRAND.yellow, color: BRAND.black }}
          >
            <Check size={20} strokeWidth={3} /> READY
          </button>
        )}
        <button
          onClick={() => onAdvance(order.id, "CANCELLED")}
          disabled={Boolean(disabledReason)}
          title={disabledReason ?? undefined}
          aria-label={`Cancel order ${order.orderNumber}`}
          className="btn-press px-4 rounded-xl text-xs font-black tracking-widest opacity-70 hover:opacity-100 disabled:opacity-30"
          style={{ background: "#444", color: "white" }}
        >
          CANCEL
        </button>
      </div>
    </article>
  );
}
