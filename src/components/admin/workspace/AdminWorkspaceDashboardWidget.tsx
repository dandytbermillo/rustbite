"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  DollarSign,
  PackageCheck,
  ReceiptText,
  ShoppingBag,
  type LucideIcon,
} from "lucide-react";
import { fmt } from "@/lib/pricing";
import type { DashboardOperationBucketKey } from "@/lib/admin/dashboard/summary";
import type { AdminWorkspaceDashboardSummary } from "@/lib/admin/workspace/dashboard-summary";
import DashboardOperationsPanel from "@/components/admin/dashboard/DashboardOperationsPanel";
import DashboardOperationPreviewPanel from "@/components/admin/dashboard/DashboardOperationPreviewPanel";

const WORKSPACE_DASHBOARD_REFRESH_MS = 30_000;

const WORKSPACE_OPERATION_STATUSES: Array<{
  key: "awaitingCounterPayment" | "paid" | "inKitchen" | "ready";
  label: string;
  href: string;
  color: string;
  caption: string;
  sub: string;
}> = [
  {
    key: "awaitingCounterPayment",
    label: "Awaiting payment",
    href: "/admin/workspace?widget=orders&status=AWAITING_COUNTER_PAYMENT",
    color: "#15803d",
    caption: "Counter cash queue",
    sub: "Counter cash queue",
  },
  {
    key: "paid",
    label: "Paid / new",
    href: "/admin/workspace?widget=orders&status=PAID",
    color: "#b45309",
    caption: "New kitchen tickets",
    sub: "New kitchen tickets",
  },
  {
    key: "inKitchen",
    label: "In kitchen",
    href: "/admin/workspace?widget=orders&status=IN_KITCHEN",
    color: "#2563eb",
    caption: "Kitchen display",
    sub: "Kitchen display",
  },
  {
    key: "ready",
    label: "Ready",
    href: "/admin/workspace?widget=orders&status=READY",
    color: "#dc2626",
    caption: "Pickup queue",
    sub: "Pickup queue",
  },
] as const;

const WORKSPACE_COMPLETED_STATUS = {
  key: "completedToday",
  label: "Completed today",
  href: "/admin/workspace?widget=orders&status=COMPLETED",
  color: "#047857",
  caption: "Since midnight",
  sub: "Since midnight",
} as const;

export type AdminWorkspaceDashboardOrdersOpenRequest = {
  status: string;
  orderId: string | null;
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
  return `workspace_dashboard_${status}`;
}

function formatGeneratedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "just now";
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function SectionLabel({ title }: { title: string }) {
  return (
    <div className="text-[10px] font-black uppercase tracking-widest text-stone-500">
      {title}
    </div>
  );
}

type KpiEntry = {
  label: string;
  value: string;
  caption: string;
  tone: "dark" | "green" | "blue" | "amber" | "red";
  Icon: LucideIcon;
};

function kpiEntries(summary: AdminWorkspaceDashboardSummary): KpiEntry[] {
  const kpis = summary.kpis;
  const entries: KpiEntry[] = [
    {
      label: "Orders",
      value: kpis ? String(kpis.orderCount) : "Hidden",
      caption: "Accepted today",
      tone: "green",
      Icon: ReceiptText,
    },
    {
      label: "Items / order",
      value:
        kpis?.itemsPerOrder === null || kpis?.itemsPerOrder === undefined
          ? "Hidden"
          : kpis.itemsPerOrder.toFixed(1),
      caption: "Basket depth",
      tone: "amber",
      Icon: ShoppingBag,
    },
  ];

  if (summary.permissions.canReadRevenue) {
    entries.unshift({
      label: "Net sales",
      value: kpis?.netSales == null ? "-" : fmt(kpis.netSales),
      caption: "Today",
      tone: "dark",
      Icon: DollarSign,
    });
    entries.splice(2, 0, {
      label: "Average ticket",
      value: kpis?.averageTicket == null ? "-" : fmt(kpis.averageTicket),
      caption: "Paid orders",
      tone: "blue",
      Icon: BarChart3,
    });
  }

  if (summary.operations) {
    entries.push({
      label: "Active orders",
      value: String(
        summary.operations.awaitingCounterPayment +
          summary.operations.paid +
          summary.operations.inKitchen +
          summary.operations.ready,
      ),
      caption: "In flight now",
      tone: "green",
      Icon: Activity,
    });
  }

  return entries;
}

function kpiToneClass(tone: KpiEntry["tone"]) {
  if (tone === "dark") return "border-stone-950 bg-stone-950 text-white";
  if (tone === "green")
    return "border-emerald-200 bg-emerald-50 text-emerald-950";
  if (tone === "blue") return "border-blue-200 bg-blue-50 text-blue-950";
  if (tone === "red") return "border-red-200 bg-red-50 text-red-950";
  return "border-amber-200 bg-amber-50 text-amber-950";
}

function statusFromOperationHref(href: string): string | null {
  try {
    const url = new URL(href, "http://workspace.local");
    return url.searchParams.get("status");
  } catch {
    return null;
  }
}

function KpiStrip({
  summary,
  compact,
}: {
  summary: AdminWorkspaceDashboardSummary;
  compact: boolean;
}) {
  const entries = kpiEntries(summary);

  return (
    <div
      data-testid="workspace-dashboard-kpis"
      className={`grid gap-2 ${compact ? "grid-cols-2" : "grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5"}`}
    >
      {entries.map((entry) => (
        <div
          key={entry.label}
          className={`min-h-[94px] rounded-xl border px-3 py-3 shadow-sm ${kpiToneClass(entry.tone)}`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="truncate text-[10px] font-black uppercase tracking-widest opacity-65">
              {entry.label}
            </div>
            <entry.Icon
              size={17}
              strokeWidth={2.4}
              className="shrink-0 opacity-70"
            />
          </div>
          <div className="mt-3 truncate font-mono text-2xl font-black leading-none">
            {entry.value}
          </div>
          <div className="mt-2 truncate text-[11px] font-bold opacity-65">
            {entry.caption}
          </div>
        </div>
      ))}
    </div>
  );
}

function AccessNotice({
  summary,
}: {
  summary: AdminWorkspaceDashboardSummary;
}) {
  const hidden: string[] = [];
  if (!summary.permissions.canReadRevenue) hidden.push("revenue metrics");
  if (!summary.permissions.canReadOrders) hidden.push("order activity");
  if (!summary.permissions.canReadDevices) hidden.push("device health");
  if (!summary.permissions.canReadMenuAttention) hidden.push("menu attention");

  if (hidden.length === 0) return null;

  return (
    <div
      data-testid="workspace-dashboard-access-notice"
      className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm font-semibold text-stone-600"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle
          size={16}
          strokeWidth={2.5}
          className="mt-0.5 shrink-0 text-stone-500"
          aria-hidden
        />
        <div>
          <div className="font-black text-stone-900">Role-tailored view</div>
          <div className="mt-0.5 text-xs">
            Hidden for this outlet: {hidden.join(", ")}.
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminWorkspaceDashboardWidget({
  summary: initialSummary,
  widgetWidth,
  widgetHeight,
  onOpenOrders,
}: {
  summary: AdminWorkspaceDashboardSummary;
  widgetWidth: number;
  widgetHeight: number;
  onOpenOrders: (request: AdminWorkspaceDashboardOrdersOpenRequest) => void;
}) {
  const [summary, setSummary] = useState(initialSummary);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [selectedOperationKey, setSelectedOperationKey] =
    useState<DashboardOperationBucketKey | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const refreshRef = useRef<(() => Promise<void>) | null>(null);
  const compactMode = widgetWidth < 560 || widgetHeight < 420;
  const operationStatuses = summary.operationBuckets?.completedToday
    ? [...WORKSPACE_OPERATION_STATUSES, WORKSPACE_COMPLETED_STATUS]
    : WORKSPACE_OPERATION_STATUSES;
  const selectedOperation =
    operationStatuses.find((status) => status.key === selectedOperationKey) ??
    null;
  const selectedOperationBucket =
    selectedOperation && summary.operationBuckets
      ? (summary.operationBuckets[selectedOperation.key] ?? null)
      : null;

  function openOperationQueueInWorkspace(operation: { href: string }) {
    const status = statusFromOperationHref(operation.href);
    if (!status) return;
    onOpenOrders({ status, orderId: null });
  }

  function openOperationOrderInWorkspace(order: {
    id: string;
    status: string;
  }) {
    onOpenOrders({ status: order.status, orderId: order.id });
  }

  useEffect(() => {
    setSummary(initialSummary);
    setRefreshError(null);
  }, [initialSummary]);

  useEffect(() => {
    let closed = false;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let orderEvents: EventSource | null = null;
    let menuEvents: EventSource | null = null;

    async function refresh() {
      if (requestRef.current) return;
      const controller = new AbortController();
      requestRef.current = controller;
      try {
        const response = await fetch(
          "/api/admin/workspace/dashboard/summary?range=today",
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );
        const body = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(displayFetchError(response.status, body));
        if (!closed) {
          setSummary(body as AdminWorkspaceDashboardSummary);
          setRefreshError(null);
        }
      } catch (error) {
        if (!controller.signal.aborted && !closed) {
          setRefreshError((error as Error).message);
        }
      } finally {
        if (requestRef.current === controller) requestRef.current = null;
      }
    }
    refreshRef.current = refresh;

    function refreshWhenVisible() {
      if (document.visibilityState === "hidden") return;
      void refreshRef.current?.();
    }

    pollInterval = setInterval(
      refreshWhenVisible,
      WORKSPACE_DASHBOARD_REFRESH_MS,
    );
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    if (typeof EventSource !== "undefined") {
      orderEvents = new EventSource("/api/admin/dashboard/events");
      orderEvents.addEventListener(
        "dashboard_order_revision",
        refreshWhenVisible,
      );
      orderEvents.addEventListener("auth_expired", () => {
        orderEvents?.close();
        orderEvents = null;
      });
      orderEvents.addEventListener("reconnect", () => {
        orderEvents?.close();
        orderEvents = null;
      });

      if (summary.permissions.canReadMenuAttention) {
        menuEvents = new EventSource(
          `/api/menu/events?outletId=${encodeURIComponent(summary.outletId)}`,
        );
        menuEvents.addEventListener("menu_revision", refreshWhenVisible);
        menuEvents.addEventListener("auth_expired", () => {
          menuEvents?.close();
          menuEvents = null;
        });
      }
    }

    return () => {
      closed = true;
      if (pollInterval) clearInterval(pollInterval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      requestRef.current?.abort();
      requestRef.current = null;
      orderEvents?.close();
      menuEvents?.close();
      if (refreshRef.current === refresh) refreshRef.current = null;
    };
  }, [summary.outletId, summary.permissions.canReadMenuAttention]);

  return (
    <div
      data-testid="workspace-dashboard-real-data"
      className="admin-widget-scroll grid h-full content-start gap-4 overflow-auto overscroll-contain bg-white"
    >
      <div className="rounded-xl border border-stone-200 bg-stone-950 px-4 py-3 text-white shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-yellow-300">
              <Activity size={14} strokeWidth={2.5} aria-hidden />
              Dashboard
            </div>
            <div className="mt-1 truncate text-lg font-black text-white">
              {summary.outletName}
            </div>
            <div className="mt-1 truncate text-xs font-bold text-white/60">
              Today · refreshed {formatGeneratedAt(summary.generatedAt)}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <span className="rounded-full bg-yellow-400 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-stone-950">
              Live
            </span>
            {summary.permissions.canReadOrders && (
              <Link
                href="/admin/workspace?widget=orders"
                className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white/80 hover:bg-white/15"
              >
                Open Orders
              </Link>
            )}
          </div>
        </div>
      </div>

      {refreshError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
          Dashboard refresh failed: {refreshError}
        </div>
      )}

      <AccessNotice summary={summary} />

      <section className="rounded-xl border border-stone-200 bg-white p-3 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <SectionLabel title="Hero KPIs" />
          <span className="text-[10px] font-black uppercase tracking-widest text-stone-400">
            Compact payload
          </span>
        </div>
        <KpiStrip summary={summary} compact={compactMode} />
      </section>

      <DashboardOperationsPanel
        statuses={operationStatuses}
        operations={summary.operations}
        operationBuckets={summary.operationBuckets}
        selectedKey={selectedOperationKey}
        onSelect={setSelectedOperationKey}
        openHref="/admin/workspace?widget=orders"
        openLabel="Open Orders"
        panelTestId="workspace-dashboard-operations-panel"
        getBucketTestId={(key) => `workspace-dashboard-operation-${key}`}
        completedTodayFullWidth
        hiddenSlot={
          <div
            data-testid="workspace-dashboard-operations-hidden"
            className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-3 py-3"
          >
            <div className="text-sm font-black text-stone-950">
              Order operations hidden
            </div>
            <div className="mt-1 text-xs font-semibold text-stone-500">
              This role cannot read order activity for this outlet.
            </div>
          </div>
        }
      >
        {selectedOperation && selectedOperationBucket ? (
          <DashboardOperationPreviewPanel
            bucket={selectedOperationBucket}
            operation={selectedOperation}
            onClose={() => setSelectedOperationKey(null)}
            onOpenQueue={
              selectedOperation.key === "completedToday"
                ? undefined
                : openOperationQueueInWorkspace
            }
            onOpenOrder={openOperationOrderInWorkspace}
          />
        ) : null}
      </DashboardOperationsPanel>

      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-stone-400">
        <PackageCheck size={12} strokeWidth={2.5} aria-hidden />
        Workspace-safe compact summary
      </div>
    </div>
  );
}
