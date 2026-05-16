"use client";

// Dashboard's recent-orders list with inline read-only details. Order mutation
// workflows stay on /admin/orders, counter, and kitchen surfaces.

import React, { Fragment, useState } from "react";
import Link from "next/link";
import { ChevronDown, ExternalLink } from "lucide-react";
import type { OrderDetailRow } from "@/components/admin/OrderDetailPanel";
import {
  SEMANTIC_COLORS,
  STATUS_DISPLAY_LABELS,
  STATUS_TO_SEMANTIC,
} from "@/lib/order-status-display";
import { formatUpgradeForOrderRead } from "@/lib/order-read";
import { fmt } from "@/lib/pricing";

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

const GRID_TEMPLATE =
  "84px 110px 90px minmax(0,1fr) 170px 70px 88px 24px";
const GRID_MIN_WIDTH = 740;

function adminOrderHref(orderId: string, status: string): string {
  const params = new URLSearchParams({ status, order: orderId });
  return `/admin/orders?${params.toString()}`;
}

export function DashboardRecentOrderDetails({
  order: o,
}: {
  order: OrderDetailRow;
}) {
  const awaitingCounterPayment =
    o.status === "AWAITING_COUNTER_PAYMENT" && o.paymentMethod === "CASH";

  return (
    <div className="border-t border-stone-200 bg-stone-50 px-4 py-4 md:px-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(260px,0.95fr)]">
        <div>
          <div className="mb-2 text-[10px] font-black tracking-widest text-stone-500 uppercase">
            Line items
          </div>
          <div className="space-y-2">
            {o.items.map((it) => {
              const adds = Array.isArray(it.addonsJson)
                ? (it.addonsJson as Array<{ name: string }>).map((a) => a.name)
                : [];
              const upgradeLabel = formatUpgradeForOrderRead(it);

              return (
                <div
                  key={it.id}
                  className="grid grid-cols-[42px_minmax(0,1fr)_88px] items-start gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2.5"
                >
                  <div className="mono text-right text-[12px] font-black text-stone-500">
                    x{it.qty}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 text-sm font-black text-stone-950">
                      <span className="truncate">{it.nameSnapshot}</span>
                      {upgradeLabel && (
                        <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-black tracking-widest text-amber-900 uppercase">
                          {upgradeLabel}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs font-semibold text-stone-500">
                      {it.sizeName && <span>{it.sizeName}</span>}
                      {it.sizeName && adds.length > 0 && <span> · </span>}
                      {adds.length > 0 && <span>{adds.join(", ")}</span>}
                      {!it.sizeName && adds.length === 0 && (
                        <span className="text-stone-400">No modifiers</span>
                      )}
                    </div>
                  </div>
                  <div className="mono text-right text-[12px] font-black text-stone-700">
                    {fmt(it.lineTotal)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-black tracking-widest text-stone-500 uppercase">
                Order snapshot
              </div>
              <div className="mt-1 text-sm font-black text-stone-950">
                #{o.orderNumber}
              </div>
            </div>
            <Link
              href={adminOrderHref(o.id, o.status)}
              className="inline-flex items-center gap-1.5 rounded-md border border-stone-200 px-2.5 py-1.5 text-[10px] font-black tracking-widest text-stone-700 uppercase hover:border-stone-400"
            >
              Open in Orders
              <ExternalLink size={12} strokeWidth={2.5} aria-hidden />
            </Link>
          </div>

          <div className="grid grid-cols-3 gap-3 border-t border-stone-100 pt-3 text-xs">
            <div>
              <div className="font-black tracking-widest text-stone-400 uppercase">
                Subtotal
              </div>
              <div className="mono mt-1 font-black text-stone-900">
                {fmt(o.subtotal)}
              </div>
            </div>
            <div>
              <div className="font-black tracking-widest text-stone-400 uppercase">
                GST
              </div>
              <div className="mono mt-1 font-black text-stone-900">
                {fmt(o.gst)}
              </div>
            </div>
            <div>
              <div className="font-black tracking-widest text-stone-400 uppercase">
                Total
              </div>
              <div className="mono mt-1 font-black text-stone-950">
                {fmt(o.total)}
              </div>
            </div>
          </div>

          <div className="mt-4 border-t border-stone-100 pt-3">
            <div className="text-[10px] font-black tracking-widest text-stone-500 uppercase">
              Payment
            </div>
            <div className="mt-1 text-sm font-bold text-stone-900">
              {o.paymentProvider ?? "-"} · {o.paymentMethod ?? "-"} ·{" "}
              {o.paymentStatus ?? "-"}
            </div>
            {o.paymentReference && (
              <div className="mono mt-1 text-xs font-semibold text-stone-500">
                Ref {o.paymentReference}
              </div>
            )}
            {o.paymentFailureMessage && (
              <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs font-bold text-red-800">
                {o.paymentFailureMessage}
              </div>
            )}
            {awaitingCounterPayment && (
              <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs font-bold text-amber-900">
                Cash collection and paid-status changes happen in the orders
                workflow.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RecentOrdersList({
  orders,
}: {
  orders: OrderDetailRow[];
}) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <section className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
      <div
        className="flex items-center justify-between gap-3 border-b border-stone-200 px-5 py-3.5"
        style={{ background: "linear-gradient(180deg, #FAF9F5 0%, #fff 100%)" }}
      >
        <div>
          <div className="text-lg font-black text-stone-950">Recent orders</div>
          <div className="text-xs font-semibold text-stone-500">
            Read-only dashboard detail view.
          </div>
        </div>
        <Link
          href="/admin/orders"
          className="inline-flex items-center gap-1.5 rounded-md border border-stone-200 px-3 py-2 text-[10px] font-black tracking-widest text-stone-700 uppercase hover:border-stone-400"
        >
          View all
          <ExternalLink size={12} strokeWidth={2.5} aria-hidden />
        </Link>
      </div>

      {orders.length === 0 ? (
        <div className="p-10 text-center">
          <div className="text-3xl opacity-40 mb-2">📋</div>
          <div className="text-sm text-stone-600">No orders yet.</div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div
            className="grid items-center gap-4 px-5 py-2.5 text-[10px] font-black tracking-widest text-stone-500 uppercase border-b border-stone-200 bg-stone-50"
            style={{ gridTemplateColumns: GRID_TEMPLATE, minWidth: GRID_MIN_WIDTH }}
          >
            <span>#</span>
            <span>Time</span>
            <span>Type</span>
            <span>Items</span>
            <span>Status</span>
            <span>Pay</span>
            <span className="text-right">Total</span>
            <span />
          </div>

          {orders.map((o, idx) => {
            const semantic = STATUS_TO_SEMANTIC[o.status] ?? "cancelled";
            const colors = SEMANTIC_COLORS[semantic];
            const isOpen = open === o.id;
            const urgent =
              semantic === "pay-pending" || semantic === "ready";
            const itemCount = o.items.reduce((s, it) => s + it.qty, 0);
            const firstItemName = o.items[0]?.nameSnapshot ?? "—";
            const isLast = idx === orders.length - 1;

            return (
              <Fragment key={o.id}>
                <div
                  onClick={() => setOpen(isOpen ? null : o.id)}
                  className={`grid cursor-pointer items-center gap-4 px-5 py-3 transition-colors ${
                    isOpen
                      ? "bg-stone-50"
                      : isLast
                      ? "hover:bg-stone-50"
                      : "border-b border-stone-100 hover:bg-stone-50"
                  }`}
                  style={{
                    gridTemplateColumns: GRID_TEMPLATE,
                    minWidth: GRID_MIN_WIDTH,
                    boxShadow:
                      urgent && !isOpen
                        ? `inset 3px 0 0 ${colors.accent}`
                        : undefined,
                  }}
                >
                  <div className="mono text-[13px] font-bold text-stone-900">
                    <span className="text-stone-400">#</span>
                    {o.orderNumber}
                  </div>
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <div className="mono text-[13px] font-bold text-stone-900">
                      {shortTime(o.createdAt)}
                    </div>
                    <div className="text-[10.5px] font-semibold text-stone-500">
                      {relativeTime(o.createdAt)}
                    </div>
                  </div>
                  <div className="text-[11px] font-black tracking-widest text-stone-600 uppercase">
                    {o.orderType}
                  </div>
                  <div className="flex items-center gap-2 min-w-0 text-[13px] text-stone-600">
                    <span className="text-stone-300 mono font-bold flex-shrink-0">
                      ×{itemCount}
                    </span>
                    <span className="truncate">
                      <span className="font-bold text-stone-900">
                        {firstItemName}
                      </span>
                      {o.items.length > 1 && (
                        <span className="text-stone-500">
                          {" "}
                          +{o.items.length - 1} more
                        </span>
                      )}
                    </span>
                  </div>
                  <div>
                    <span
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black tracking-widest border"
                      style={{
                        background: colors.bg,
                        color: colors.text,
                        borderColor: colors.border,
                      }}
                    >
                      <span
                        className="inline-block w-1.5 h-1.5 rounded-full"
                        style={{ background: colors.dot }}
                      />
                      {STATUS_DISPLAY_LABELS[o.status] ?? o.status}
                    </span>
                  </div>
                  <div className="text-[11.5px] font-bold text-stone-600">
                    {o.paymentMethod ?? "—"}
                  </div>
                  <div className="mono font-black text-[15px] text-right text-stone-900">
                    {fmt(o.total)}
                  </div>
                  <div
                    className="text-stone-400 transition-transform"
                    style={{
                      transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                    }}
                  >
                    <ChevronDown size={16} strokeWidth={2.5} />
                  </div>
                </div>
                {isOpen && <DashboardRecentOrderDetails order={o} />}
              </Fragment>
            );
          })}
        </div>
      )}
    </section>
  );
}
