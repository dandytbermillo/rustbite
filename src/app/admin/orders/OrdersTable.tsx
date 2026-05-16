"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { fmt } from "@/lib/pricing";
import OrderDetailPanel, {
  type OrderDetailRow,
} from "@/components/admin/OrderDetailPanel";
import {
  SEMANTIC_COLORS,
  STATUS_DISPLAY_LABELS,
  STATUS_TO_SEMANTIC,
} from "@/lib/order-status-display";

type OrderRow = OrderDetailRow;

type Stats = {
  todayCount: number;
  todayRevenue: number;
  awaitingPayment: number;
  inKitchen: number;
  ready: number;
  completedToday: number;
};

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

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function formatLongDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDayLabel(
  date: Date,
  now: Date,
): { primary: string; secondary: string | null; isToday: boolean } {
  const dKey = dayKey(date);
  if (dKey === dayKey(now)) {
    return {
      primary: "TODAY",
      secondary: formatLongDate(date),
      isToday: true,
    };
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dKey === dayKey(yesterday)) {
    return {
      primary: "YESTERDAY",
      secondary: formatLongDate(date),
      isToday: false,
    };
  }
  const startOfNow = new Date(now);
  startOfNow.setHours(0, 0, 0, 0);
  const startOfDate = new Date(date);
  startOfDate.setHours(0, 0, 0, 0);
  const daysAgo = Math.round(
    (startOfNow.getTime() - startOfDate.getTime()) / 86400000,
  );
  if (daysAgo > 0 && daysAgo < 7) {
    const weekday = date
      .toLocaleDateString("en-US", { weekday: "long" })
      .toUpperCase();
    return {
      primary: weekday,
      secondary: `${formatLongDate(date)} · ${daysAgo} day${daysAgo === 1 ? "" : "s"} ago`,
      isToday: false,
    };
  }
  return {
    primary: formatLongDate(date).toUpperCase(),
    secondary: null,
    isToday: false,
  };
}

export default function OrdersTable({
  orders,
  stats,
  activeStatusFilter,
  dateFrom,
  dateTo,
  initialOpenOrderId,
}: {
  orders: OrderRow[];
  stats: Stats;
  activeStatusFilter: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  initialOpenOrderId: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState<string | null>(initialOpenOrderId);
  const targetOrderRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setOpen(initialOpenOrderId);
  }, [initialOpenOrderId]);

  useEffect(() => {
    if (!initialOpenOrderId) return;
    const frame = window.requestAnimationFrame(() => {
      targetOrderRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initialOpenOrderId, orders.length]);

  const setStatusFilter = (value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("status", value);
    else params.delete("status");
    params.delete("order");
    const qs = params.toString();
    router.push("/admin/orders" + (qs ? `?${qs}` : ""));
  };

  const isChipActive = (chipValue: string | null): boolean => {
    if (chipValue === null) return !activeStatusFilter;
    return activeStatusFilter === chipValue;
  };

  const attentionCount = stats.awaitingPayment + stats.ready;

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="display text-3xl flex items-baseline gap-3">
            Orders
            {attentionCount > 0 && (
              <span
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-black tracking-widest border align-middle"
                style={{
                  background: "#FEF3C7",
                  color: "#92400E",
                  borderColor: "rgba(245,158,11,0.3)",
                }}
              >
                <span className="live-dot" aria-hidden="true" />
                LIVE
              </span>
            )}
          </h1>
          <div className="text-sm text-stone-600 mt-1.5">
            <span className="text-stone-900 font-bold">{orders.length}</span>{" "}
            shown
            {attentionCount > 0 && (
              <>
                {" "}
                ·{" "}
                <span className="text-stone-900 font-bold">
                  {attentionCount}
                </span>{" "}
                need attention
              </>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        <StatCard
          variant="feature"
          label="Today's orders"
          value={stats.todayCount}
          active={isChipActive(null)}
          onClick={() => setStatusFilter(null)}
          revenue={stats.todayRevenue}
        />
        <StatCard
          variant="pay-pending"
          label="Awaiting payment"
          value={stats.awaitingPayment}
          active={isChipActive("AWAITING_COUNTER_PAYMENT")}
          onClick={() => setStatusFilter("AWAITING_COUNTER_PAYMENT")}
          urgency={stats.awaitingPayment > 0 ? "Action needed" : undefined}
        />
        <StatCard
          variant="kitchen"
          label="In kitchen"
          value={stats.inKitchen}
          active={isChipActive("IN_KITCHEN")}
          onClick={() => setStatusFilter("IN_KITCHEN")}
        />
        <StatCard
          variant="ready"
          label="Ready for pickup"
          value={stats.ready}
          active={isChipActive("READY")}
          onClick={() => setStatusFilter("READY")}
          urgency={stats.ready > 0 ? "Hand to customer" : undefined}
        />
        <StatCard
          variant="completed"
          label="Completed today"
          value={stats.completedToday}
          active={isChipActive("COMPLETED")}
          onClick={() => setStatusFilter("COMPLETED")}
        />
      </div>

      <form className="rounded-xl bg-white border border-stone-200 p-3 mb-5 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5 items-center flex-1 min-w-[300px]">
          <Chip
            active={isChipActive(null)}
            label="All"
            count={orders.length}
            onClick={() => setStatusFilter(null)}
          />
          <Chip
            active={isChipActive("AWAITING_COUNTER_PAYMENT")}
            label="Pay pending"
            count={stats.awaitingPayment}
            onClick={() => setStatusFilter("AWAITING_COUNTER_PAYMENT")}
          />
          <Chip
            active={isChipActive("IN_KITCHEN")}
            label="In kitchen"
            count={stats.inKitchen}
            onClick={() => setStatusFilter("IN_KITCHEN")}
          />
          <Chip
            active={isChipActive("READY")}
            label="Ready"
            count={stats.ready}
            onClick={() => setStatusFilter("READY")}
          />
          <Chip
            active={isChipActive("COMPLETED")}
            label="Completed"
            count={stats.completedToday}
            onClick={() => setStatusFilter("COMPLETED")}
          />
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          {activeStatusFilter && (
            <input type="hidden" name="status" value={activeStatusFilter} />
          )}
          <label className="text-[10px] font-black tracking-widest text-stone-500">
            FROM
            <input
              type="date"
              name="from"
              defaultValue={dateFrom ?? ""}
              className="block mt-1 border border-stone-300 rounded-md px-2 py-1.5 text-sm font-normal text-stone-900"
            />
          </label>
          <label className="text-[10px] font-black tracking-widest text-stone-500">
            TO
            <input
              type="date"
              name="to"
              defaultValue={dateTo ?? ""}
              className="block mt-1 border border-stone-300 rounded-md px-2 py-1.5 text-sm font-normal text-stone-900"
            />
          </label>
          <button
            type="submit"
            className="px-4 py-2 rounded-md text-xs font-black tracking-widest"
            style={{ background: BRAND.black, color: "white" }}
          >
            APPLY
          </button>
        </div>
      </form>

      {orders.length === 0 ? (
        <div className="rounded-xl bg-white border border-stone-200 p-10 text-center">
          <div className="text-3xl opacity-40 mb-2">📋</div>
          <div className="display text-xl text-stone-900">No orders found</div>
          <div className="text-sm text-stone-600">
            {activeStatusFilter || dateFrom || dateTo
              ? "No orders match the selected filters. Clear the status or date range to broaden the view."
              : "New kiosk and counter orders will appear here as soon as they are placed."}
          </div>
        </div>
      ) : (
        (() => {
          const now = new Date();
          const groupTotals = new Map<
            string,
            { count: number; total: number }
          >();
          for (const o of orders) {
            const k = dayKey(new Date(o.createdAt));
            if (!groupTotals.has(k)) groupTotals.set(k, { count: 0, total: 0 });
            const g = groupTotals.get(k)!;
            g.count += 1;
            g.total += o.total;
          }
          let prevDayKey: string | null = null;

          return (
            <div className="overflow-x-auto pb-2">
              <div className="min-w-[740px] space-y-1.5">
                {orders.map((o) => {
                  const semantic = STATUS_TO_SEMANTIC[o.status] ?? "cancelled";
                  const colors = SEMANTIC_COLORS[semantic];
                  const isOpen = open === o.id;
                  const isTargetOrder = initialOpenOrderId === o.id;
                  const urgent =
                    semantic === "pay-pending" || semantic === "ready";
                  const itemCount = o.items.reduce((s, it) => s + it.qty, 0);
                  const firstItemName = o.items[0]?.nameSnapshot ?? "—";
                  const orderDate = new Date(o.createdAt);
                  const k = dayKey(orderDate);
                  const showDivider = k !== prevDayKey;
                  const isFirstGroup = prevDayKey === null;
                  prevDayKey = k;
                  const dayLabels = showDivider
                    ? formatDayLabel(orderDate, now)
                    : null;
                  const groupInfo = groupTotals.get(k)!;

                  return (
                    <Fragment key={o.id}>
                      {showDivider && dayLabels && (
                        <div
                          className={`flex items-baseline justify-between gap-3 px-2 pb-2 flex-wrap ${
                            isFirstGroup ? "pt-0" : "pt-5"
                          }`}
                        >
                          <div className="flex items-baseline gap-3 flex-wrap">
                            <span className="display text-base text-stone-900">
                              {dayLabels.primary}
                            </span>
                            {dayLabels.secondary && (
                              <span className="mono text-xs text-stone-500 font-bold">
                                <span className="text-stone-300">·</span>{" "}
                                {dayLabels.secondary}
                              </span>
                            )}
                            {dayLabels.isToday && (
                              <span
                                className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[9.5px] font-black tracking-widest border"
                                style={{
                                  background: "#FEF3C7",
                                  color: "#92400E",
                                  borderColor: "rgba(245,158,11,0.3)",
                                }}
                              >
                                <span className="live-dot" aria-hidden="true" />
                                LIVE
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-stone-500 mono">
                            <span className="text-stone-900 font-bold">
                              {groupInfo.count}
                            </span>{" "}
                            {groupInfo.count === 1 ? "order" : "orders"}
                            <span className="text-stone-300 mx-1">·</span>
                            <span className="text-stone-900 font-bold">
                              {fmt(groupInfo.total)}
                            </span>
                          </div>
                        </div>
                      )}
                      <div
                        ref={isTargetOrder ? targetOrderRef : undefined}
                        data-testid={
                          isTargetOrder ? "orders-target-row" : undefined
                        }
                        aria-current={isTargetOrder ? "true" : undefined}
                        onClick={() => setOpen(isOpen ? null : o.id)}
                        className={`group bg-white border transition-all cursor-pointer rounded-xl scroll-mt-28 ${
                          isOpen
                            ? "border-stone-900 shadow-md rounded-b-none"
                            : "border-stone-200 hover:border-stone-400"
                        } ${
                          isTargetOrder
                            ? "ring-2 ring-yellow-400 ring-offset-2"
                            : ""
                        }`}
                        style={
                          urgent && !isOpen
                            ? {
                                boxShadow: `inset 3px 0 0 ${colors.accent}`,
                              }
                            : undefined
                        }
                      >
                        <div
                          className="grid items-center gap-4 px-4 py-3.5"
                          style={{
                            gridTemplateColumns:
                              "84px 110px 90px minmax(0,1fr) 170px 70px 88px 24px",
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
                              transform: isOpen
                                ? "rotate(180deg)"
                                : "rotate(0deg)",
                            }}
                          >
                            <ChevronDown size={16} strokeWidth={2.5} />
                          </div>
                        </div>
                      </div>

                      {isOpen && <OrderDetailPanel order={o} />}
                    </Fragment>
                  );
                })}
              </div>
            </div>
          );
        })()
      )}
    </div>
  );
}

function StatCard({
  variant,
  label,
  value,
  active,
  onClick,
  revenue,
  urgency,
}: {
  variant: "feature" | "pay-pending" | "kitchen" | "ready" | "completed";
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
  revenue?: number;
  urgency?: string;
}) {
  const isFeature = variant === "feature";
  const accentByVariant: Record<typeof variant, string> = {
    feature: BRAND.yellow,
    "pay-pending": "#F59E0B",
    kitchen: "#3B82F6",
    ready: BRAND.yellow,
    completed: "#10B981",
  };
  const accent = accentByVariant[variant];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group text-left rounded-xl border p-4 transition-all ${
        isFeature
          ? "bg-stone-900 text-white border-stone-900"
          : "bg-white border-stone-200 hover:border-stone-400"
      } ${
        active && !isFeature
          ? "ring-2 ring-stone-900 ring-offset-1 border-stone-900"
          : ""
      } ${active && isFeature ? "ring-2 ring-yellow-400 ring-offset-1" : ""}`}
      style={
        !isFeature
          ? {
              boxShadow: `inset 3px 0 0 ${accent}`,
            }
          : undefined
      }
    >
      <div
        className={`text-[10px] font-black tracking-widest uppercase ${
          isFeature ? "text-stone-400" : "text-stone-500"
        }`}
      >
        {label}
      </div>
      <div
        className="display text-3xl mt-2"
        style={{ color: isFeature ? BRAND.yellow : "#0d0d0d" }}
      >
        {value}
      </div>
      {revenue != null && (
        <div className="mt-3 pt-3 border-t border-stone-700 grid grid-cols-2 gap-2">
          <div>
            <div className="text-[9px] font-black tracking-widest text-stone-400 uppercase">
              Revenue
            </div>
            <div className="mono font-bold text-sm text-white mt-0.5">
              {fmt(revenue)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[9px] font-black tracking-widest text-stone-400 uppercase">
              Avg ticket
            </div>
            <div className="mono font-bold text-sm text-white mt-0.5">
              {value > 0 ? fmt(revenue / value) : "—"}
            </div>
          </div>
        </div>
      )}
      {urgency && (
        <div
          className="mt-2 inline-flex items-center gap-1.5 text-[10px] font-black tracking-widest uppercase"
          style={{ color: accent }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: accent }}
          />
          {urgency}
        </div>
      )}
    </button>
  );
}

function Chip({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[12.5px] font-bold transition-colors ${
        active
          ? "bg-stone-900 text-white border-stone-900"
          : "bg-white text-stone-700 border-stone-200 hover:border-stone-400 hover:text-stone-900"
      }`}
    >
      {label}
      <span
        className={`inline-flex items-center justify-center text-[10px] font-black px-1.5 rounded-full leading-tight ${
          active ? "bg-white/15 text-white" : "bg-stone-200 text-stone-500"
        }`}
        style={{ minWidth: 18, height: 16 }}
      >
        {count}
      </span>
    </button>
  );
}
