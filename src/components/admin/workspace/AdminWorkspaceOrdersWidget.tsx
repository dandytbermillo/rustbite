"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, RefreshCw } from "lucide-react";
import type {
  AdminWorkspaceOrdersSummary,
  WorkspaceOrderRow,
  WorkspaceOrdersFilterKey,
} from "@/lib/admin/workspace/orders-summary";
import {
  SEMANTIC_COLORS,
  STATUS_DISPLAY_LABELS,
  STATUS_TO_SEMANTIC,
} from "@/lib/order-status-display";
import { fmt } from "@/lib/pricing";
import OrderDetailPanel, {
  type OrderDetailActionComplete,
} from "@/components/admin/OrderDetailPanel";
import type { AdminWorkspaceNotify } from "./AdminWorkspaceToastHost";

const WORKSPACE_ORDERS_REFRESH_MS = 15_000;

export type AdminWorkspaceOrdersFocusRequest = {
  id: number;
  filter: WorkspaceOrdersFilterKey;
  targetOrderId: string | null;
};

const FILTERS: Array<{
  key: WorkspaceOrdersFilterKey;
  label: string;
  statusHref: string | null;
}> = [
  { key: "all", label: "All", statusHref: null },
  {
    key: "payment",
    label: "Payment",
    statusHref: "AWAITING_COUNTER_PAYMENT",
  },
  { key: "kitchen", label: "Kitchen", statusHref: "PAID,IN_KITCHEN" },
  { key: "ready", label: "Ready", statusHref: "READY" },
];

const FILTER_MATCH_STATUSES: Record<WorkspaceOrdersFilterKey, string[]> = {
  all: ["AWAITING_COUNTER_PAYMENT", "PAID", "IN_KITCHEN", "READY"],
  payment: ["AWAITING_COUNTER_PAYMENT"],
  kitchen: ["PAID", "IN_KITCHEN"],
  ready: ["READY"],
};

function displayFetchError(status: number, body: unknown): string {
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof body.error === "string"
  ) {
    return body.error;
  }
  return `workspace_orders_${status}`;
}

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

function formatGeneratedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "just now";
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function countForFilter(
  summary: AdminWorkspaceOrdersSummary,
  filter: WorkspaceOrdersFilterKey,
): number {
  return summary.counts[filter];
}

function filterQuery(filter: WorkspaceOrdersFilterKey, targetOrderId: string | null) {
  const params = new URLSearchParams({ filter });
  if (targetOrderId) params.set("order", targetOrderId);
  return params.toString();
}

function orderStatusMatchesFilter(
  filter: WorkspaceOrdersFilterKey,
  status: string | undefined,
) {
  return Boolean(status && FILTER_MATCH_STATUSES[filter].includes(status));
}

function OrderRow({
  order,
  open,
  target,
  onToggle,
  onActionComplete,
}: {
  order: WorkspaceOrderRow;
  open: boolean;
  target: boolean;
  onToggle: () => void;
  onActionComplete: (event: OrderDetailActionComplete) => void | Promise<void>;
}) {
  const semantic = STATUS_TO_SEMANTIC[order.status] ?? "cancelled";
  const colors = SEMANTIC_COLORS[semantic];
  const urgent = semantic === "pay-pending" || semantic === "ready";
  const itemCount = order.items.reduce((sum, item) => sum + item.qty, 0);
  const firstItemName = order.items[0]?.nameSnapshot ?? "-";

  return (
    <Fragment>
      <div
        data-testid={target ? "workspace-orders-target-row" : "workspace-orders-row"}
        aria-current={target ? "true" : undefined}
        onClick={onToggle}
        className={`group rounded-xl border bg-white transition-all ${
          open
            ? "border-stone-900 shadow-md"
            : "border-stone-200 hover:border-stone-400"
        } ${target ? "ring-2 ring-yellow-400 ring-offset-2" : ""}`}
        style={
          urgent && !open
            ? { boxShadow: `inset 3px 0 0 ${colors.accent}` }
            : undefined
        }
      >
        <button
          type="button"
          className="grid w-full grid-cols-[82px_92px_minmax(0,1fr)_150px_76px_22px] items-center gap-3 px-3 py-3 text-left"
          aria-expanded={open}
          aria-controls={`workspace-order-detail-${order.id}`}
        >
          <div className="mono text-[13px] font-black text-stone-950">
            <span className="text-stone-400">#</span>
            {order.orderNumber}
          </div>
          <div className="min-w-0">
            <div className="mono text-[12px] font-black text-stone-900">
              {shortTime(order.createdAt)}
            </div>
            <div className="truncate text-[10px] font-semibold text-stone-500">
              {relativeTime(order.createdAt)}
            </div>
          </div>
          <div className="min-w-0 text-[12px] text-stone-600">
            <span className="mono font-black text-stone-300">x{itemCount}</span>{" "}
            <span className="font-black text-stone-900">{firstItemName}</span>
            {order.items.length > 1 && (
              <span className="text-stone-500">
                {" "}
                +{order.items.length - 1} more
              </span>
            )}
          </div>
          <div>
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-black tracking-widest uppercase"
              style={{
                background: colors.bg,
                color: colors.text,
                borderColor: colors.border,
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: colors.dot }}
              />
              {STATUS_DISPLAY_LABELS[order.status] ?? order.status}
            </span>
          </div>
          <div className="mono text-right text-[13px] font-black text-stone-950">
            {fmt(order.total)}
          </div>
          <ChevronDown
            size={16}
            strokeWidth={2.5}
            className="text-stone-400 transition-transform"
            style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
            aria-hidden
          />
        </button>
      </div>
      {open && (
        <div
          id={`workspace-order-detail-${order.id}`}
          data-testid="workspace-order-detail"
          className="overflow-hidden rounded-b-xl"
        >
          <OrderDetailPanel
            order={order}
            onActionComplete={onActionComplete}
            showAddOnSetSnapshots
          />
        </div>
      )}
    </Fragment>
  );
}

export default function AdminWorkspaceOrdersWidget({
  summary: initialSummary,
  initialTargetOrderId,
  focusRequest,
  notify,
}: {
  summary: AdminWorkspaceOrdersSummary;
  initialTargetOrderId: string | null;
  focusRequest: AdminWorkspaceOrdersFocusRequest | null;
  notify: AdminWorkspaceNotify;
}) {
  const [summary, setSummary] = useState(initialSummary);
  const [selectedFilter, setSelectedFilter] =
    useState<WorkspaceOrdersFilterKey>(initialSummary.filter);
  const [openOrderId, setOpenOrderId] = useState<string | null>(
    initialTargetOrderId,
  );
  const [hydrated, setHydrated] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const selectedFilterRef = useRef<WorkspaceOrdersFilterKey>(
    initialSummary.filter,
  );
  const openOrderIdRef = useRef<string | null>(initialTargetOrderId);
  const refreshRef = useRef<
    ((
      filter?: WorkspaceOrdersFilterKey,
      targetOrderId?: string | null,
    ) => Promise<void>) | null
  >(null);
  const handledFocusRequestRef = useRef<number | null>(null);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    setSummary(initialSummary);
    setSelectedFilter(initialSummary.filter);
    setOpenOrderId(initialTargetOrderId);
    selectedFilterRef.current = initialSummary.filter;
    openOrderIdRef.current = initialTargetOrderId;
    setRefreshError(null);
  }, [initialSummary, initialTargetOrderId]);

  useEffect(() => {
    let closed = false;

    async function refresh(
      filter = selectedFilterRef.current,
      targetOrderId = openOrderIdRef.current,
    ) {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      setRefreshing(true);
      try {
        const response = await fetch(
          `/api/admin/workspace/orders/summary?${filterQuery(
            filter,
            targetOrderId,
          )}`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(displayFetchError(response.status, body));
        }
        if (!closed) {
          setSummary(body as AdminWorkspaceOrdersSummary);
          setRefreshError(null);
        }
      } catch (error) {
        if (!controller.signal.aborted && !closed) {
          setRefreshError((error as Error).message);
        }
      } finally {
        if (requestRef.current === controller) {
          requestRef.current = null;
          if (!closed) setRefreshing(false);
        }
      }
    }

    refreshRef.current = refresh;
    return () => {
      closed = true;
      requestRef.current?.abort();
      requestRef.current = null;
      if (refreshRef.current === refresh) refreshRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!focusRequest) return;
    if (handledFocusRequestRef.current === focusRequest.id) return;

    handledFocusRequestRef.current = focusRequest.id;
    selectedFilterRef.current = focusRequest.filter;
    openOrderIdRef.current = focusRequest.targetOrderId;
    setSelectedFilter(focusRequest.filter);
    setOpenOrderId(focusRequest.targetOrderId);
    void refreshRef.current?.(focusRequest.filter, focusRequest.targetOrderId);
  }, [focusRequest]);

  useEffect(() => {
    const pollInterval = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void refreshRef.current?.();
    }, WORKSPACE_ORDERS_REFRESH_MS);

    let orderEvents: EventSource | null = null;
    function refreshWhenVisible() {
      if (document.visibilityState === "hidden") return;
      void refreshRef.current?.();
    }

    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    if (typeof EventSource !== "undefined") {
      orderEvents = new EventSource("/api/admin/dashboard/events");
      orderEvents.addEventListener("dashboard_order_revision", refreshWhenVisible);
      orderEvents.addEventListener("auth_expired", () => {
        orderEvents?.close();
        orderEvents = null;
      });
      orderEvents.addEventListener("reconnect", () => {
        orderEvents?.close();
        orderEvents = null;
      });
    }

    return () => {
      clearInterval(pollInterval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      orderEvents?.close();
    };
  }, []);

  function selectFilter(filter: WorkspaceOrdersFilterKey) {
    selectedFilterRef.current = filter;
    openOrderIdRef.current = null;
    setSelectedFilter(filter);
    setOpenOrderId(null);
    void refreshRef.current?.(filter, null);
  }

  function toggleOrder(orderId: string) {
    const nextOrderId = openOrderIdRef.current === orderId ? null : orderId;
    openOrderIdRef.current = nextOrderId;
    setOpenOrderId(nextOrderId);
  }

  async function handleOrderActionComplete(event: OrderDetailActionComplete) {
    const currentFilter = selectedFilterRef.current;
    const nextOpenOrderId = event.nextStatus
      ? orderStatusMatchesFilter(currentFilter, event.nextStatus)
        ? event.orderId
        : null
      : openOrderIdRef.current;

    openOrderIdRef.current = nextOpenOrderId;
    setOpenOrderId(nextOpenOrderId);
    notify({ message: event.message });
    await refreshRef.current?.(currentFilter, nextOpenOrderId);
  }

  return (
    <div
      data-testid="workspace-orders-real-data"
      data-hydrated={hydrated ? "true" : "false"}
      className="grid h-full content-start gap-3 overflow-auto bg-white"
    >
      <section className="rounded-xl border border-stone-200 bg-white p-3 shadow-sm">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-stone-500">
              Active orders
            </div>
            <div className="mt-1 text-xs font-semibold text-stone-500">
              {summary.counts.all} active · refreshed{" "}
              {formatGeneratedAt(summary.generatedAt)}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void refreshRef.current?.()}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-stone-700 hover:border-stone-400 disabled:opacity-60"
          >
            <RefreshCw
              size={12}
              strokeWidth={2.5}
              className={refreshing ? "animate-spin" : ""}
              aria-hidden
            />
            Refresh
          </button>
        </div>

        <div className="mb-3 flex flex-wrap gap-2">
          {FILTERS.map((filter) => {
            const active = selectedFilter === filter.key;
            return (
              <button
                key={filter.key}
                type="button"
                onClick={() => selectFilter(filter.key)}
                data-testid={`workspace-orders-filter-${filter.key}`}
                aria-pressed={active}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-black uppercase tracking-widest transition-colors ${
                  active
                    ? "border-stone-900 bg-stone-900 text-white"
                    : "border-stone-200 bg-white text-stone-700 hover:border-stone-400"
                }`}
              >
                {filter.label}
                <span
                  className={`inline-flex h-4 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] ${
                    active
                      ? "bg-white/15 text-white"
                      : "bg-stone-100 text-stone-500"
                  }`}
                >
                  {countForFilter(summary, filter.key)}
                </span>
              </button>
            );
          })}
        </div>

        {refreshError && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
            <AlertTriangle
              size={14}
              strokeWidth={2.5}
              className="mt-0.5 shrink-0"
              aria-hidden
            />
            <span>Orders refresh failed: {refreshError}</span>
          </div>
        )}

        {summary.orders.length > 0 ? (
          <div className="overflow-x-auto">
            <div className="min-w-[760px] space-y-2">
              {summary.orders.map((order) => (
                <OrderRow
                  key={order.id}
                  order={order}
                  open={openOrderId === order.id}
                  target={summary.targetOrderId === order.id}
                  onToggle={() => toggleOrder(order.id)}
                  onActionComplete={handleOrderActionComplete}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-3 py-6 text-center">
            <div className="text-sm font-black text-stone-950">
              No active orders
            </div>
            <div className="mt-1 text-xs font-semibold text-stone-500">
              New kiosk and counter orders will appear here.
            </div>
          </div>
        )}

        <div className="mt-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
          <div className="text-xs font-bold text-stone-500">
            Showing {summary.orders.length} of {countForFilter(summary, selectedFilter)}.
          </div>
        </div>
      </section>
    </div>
  );
}
