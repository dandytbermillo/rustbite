"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  DollarSign,
  Monitor,
  ReceiptText,
  RefreshCw,
  ShoppingBag,
} from "lucide-react";
import type {
  AdminDashboardSummary,
  DashboardOperationBucketKey,
  DashboardRangeKey,
} from "@/lib/admin/dashboard/summary";
import { fmt } from "@/lib/pricing";
import {
  DashboardMetricCard,
  EmptyPanel,
  SectionHead,
  TopSellerPanel,
  type DashboardMetric,
} from "@/components/admin/dashboard/DashboardPresentation";
import DashboardOperationsPanel from "@/components/admin/dashboard/DashboardOperationsPanel";
import DashboardOperationPreviewPanel from "@/components/admin/dashboard/DashboardOperationPreviewPanel";
import DashboardDeviceFleetPanel from "@/components/admin/dashboard/DashboardDeviceFleetPanel";
import DashboardAttentionPanel, {
  type DashboardAttentionSummary,
} from "@/components/admin/dashboard/DashboardAttentionPanel";

type AdminAttentionSummary = DashboardAttentionSummary & {
  generatedAt: string;
  outletId: string;
  outletName: string;
};

type OutletVersionDTO = {
  outletId: string;
  revision: number;
  updatedAt: string;
};

const DASHBOARD_ORDER_VERSION_POLL_MS = 5_000;
const DASHBOARD_MENU_VERSION_POLL_MS = 5_000;
const DASHBOARD_DEVICE_REFRESH_MS = 60_000;

const RANGE_LINKS: Array<{ key: DashboardRangeKey; label: string }> = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "This week" },
];

const STATUS_LINKS = [
  {
    key: "awaitingCounterPayment",
    label: "Awaiting payment",
    href: "/admin/orders?status=AWAITING_COUNTER_PAYMENT",
    color: "#166534",
    sub: "Counter cash queue",
  },
  {
    key: "paid",
    label: "Paid / new",
    href: "/admin/orders?status=PAID",
    color: "#b45309",
    sub: "New kitchen tickets",
  },
  {
    key: "inKitchen",
    label: "In kitchen",
    href: "/admin/orders?status=IN_KITCHEN",
    color: "#2563eb",
    sub: "Kitchen display",
  },
  {
    key: "ready",
    label: "Ready",
    href: "/admin/orders?status=READY",
    color: "#dc2626",
    sub: "Pickup queue",
  },
  {
    key: "completedToday",
    label: "Completed today",
    href: "/admin/orders?status=COMPLETED",
    color: "#16a34a",
    sub: "Since midnight",
  },
] as const;

type OperationBucketKey = DashboardOperationBucketKey;

function formatGeneratedAt(value: string): string {
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDecimal(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return value.toFixed(1);
}

function displayFetchError(responseStatus: number, body: unknown): string {
  const json = body as { error?: string; reason?: string };
  if (json?.reason) return json.reason;
  if (json?.error) return json.error;
  return `HTTP ${responseStatus}`;
}

function buildHref(
  path: string,
  params: Record<string, string | null | undefined>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  const qs = query.toString();
  return qs ? `${path}?${qs}` : path;
}

function ordersRangeHref(summary: AdminDashboardSummary): string {
  return buildHref("/admin/orders", {
    from: summary.range.from,
    to: summary.range.to,
  });
}

function menuSearchHref(query: string): string {
  return buildHref("/admin/menu", { q: query });
}

function buildMetrics(summary: AdminDashboardSummary): DashboardMetric[] {
  const kpis = summary.kpis;
  const rangeHref = summary.permissions.canReadOrders
    ? ordersRangeHref(summary)
    : undefined;
  const metrics: DashboardMetric[] = [
    {
      label: "Orders",
      value: kpis ? String(kpis.orderCount) : "Hidden",
      caption: "Accepted orders in range",
      tone: "green",
      Icon: ReceiptText,
      href: rangeHref,
    },
    {
      label: "Items / order",
      value: formatDecimal(kpis?.itemsPerOrder),
      caption: "Basket depth",
      tone: "amber",
      Icon: ShoppingBag,
      href: rangeHref,
    },
  ];

  if (summary.permissions.canReadRevenue) {
    metrics.unshift({
      label: "Net sales",
      value: kpis?.netSales != null ? fmt(kpis.netSales) : "-",
      caption: summary.range.label,
      tone: "dark",
      Icon: DollarSign,
      href: rangeHref,
    });
    metrics.splice(2, 0, {
      label: "Average ticket",
      value: kpis?.averageTicket != null ? fmt(kpis.averageTicket) : "-",
      caption: "Paid sales orders only",
      tone: "blue",
      Icon: BarChart3,
      href: rangeHref,
    });
    if (kpis?.cashDue && kpis.cashDue > 0) {
      metrics.push({
        label: "Cash due",
        value: fmt(kpis.cashDue),
        caption: "Awaiting counter payment",
        tone: "red",
        Icon: DollarSign,
        href: summary.permissions.canReadOrders
          ? "/admin/orders?status=AWAITING_COUNTER_PAYMENT"
          : undefined,
      });
    }
  }

  if (summary.operations) {
    const activeOrders =
      summary.operations.awaitingCounterPayment +
      summary.operations.paid +
      summary.operations.inKitchen +
      summary.operations.ready;
    metrics.push({
      label: "Active orders",
      value: String(activeOrders),
      caption: "In flight right now",
      tone: "green",
      Icon: Activity,
      href: summary.permissions.canReadOrders
        ? "/admin/orders?status=active"
        : undefined,
      live: true,
    });
  }

  return metrics;
}

function DashboardAccessNotice({
  summary,
}: {
  summary: AdminDashboardSummary;
}) {
  const notices: string[] = [];
  if (!summary.permissions.canReadRevenue) notices.push("revenue metrics");
  if (!summary.permissions.canReadOrders) notices.push("order details");
  if (!summary.permissions.canReadDevices) notices.push("device health");
  if (!summary.permissions.canReadMenuAttention) notices.push("menu attention");

  if (notices.length === 0) return null;

  return (
    <section className="mb-5 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm font-semibold text-stone-600">
      <div className="flex items-start gap-3">
        <AlertTriangle
          size={18}
          strokeWidth={2.5}
          className="mt-0.5 shrink-0 text-stone-500"
          aria-hidden
        />
        <div>
          <div className="font-black text-stone-900">Role-tailored view</div>
          <div className="mt-1">
            This account cannot view {notices.join(", ")} for the active outlet.
          </div>
        </div>
      </div>
    </section>
  );
}

async function fetchDashboardSummary(
  query: string,
): Promise<AdminDashboardSummary> {
  const response = await fetch(`/api/admin/dashboard/summary${query}`, {
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(displayFetchError(response.status, body));
  }
  return body as AdminDashboardSummary;
}

async function fetchAttentionSummary(): Promise<AdminAttentionSummary> {
  const response = await fetch("/api/admin/attention/summary", {
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(displayFetchError(response.status, body));
  }
  return body as AdminAttentionSummary;
}

async function fetchDashboardOrderVersion(): Promise<OutletVersionDTO> {
  const response = await fetch("/api/admin/dashboard/version", {
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(displayFetchError(response.status, body));
  }
  return body as OutletVersionDTO;
}

async function fetchMenuVersion(outletId: string): Promise<OutletVersionDTO> {
  const response = await fetch(
    `/api/menu/version?outletId=${encodeURIComponent(outletId)}`,
    { cache: "no-store" },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(displayFetchError(response.status, body));
  }
  return body as OutletVersionDTO;
}

export default function AdminDashboardClient({
  initialSummary,
  initialRangeError,
}: {
  initialSummary: AdminDashboardSummary;
  initialRangeError: string | null;
}) {
  const [summary, setSummary] = useState(initialSummary);
  const [attentionSummary, setAttentionSummary] =
    useState<AdminAttentionSummary | null>(null);
  const [customFrom, setCustomFrom] = useState(initialSummary.range.from);
  const [customTo, setCustomTo] = useState(initialSummary.range.to);
  const [dashboardError, setDashboardError] = useState<string | null>(
    initialRangeError,
  );
  const [attentionError, setAttentionError] = useState<string | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [attentionLoading, setAttentionLoading] = useState(false);
  const [selectedOperationKey, setSelectedOperationKey] =
    useState<OperationBucketKey | null>(null);
  const orderRevisionRef = useRef<number | null>(null);
  const menuRevisionRef = useRef<number | null>(null);
  const refreshDashboardRef = useRef<
    ((query: string, options?: { pushUrl?: boolean }) => Promise<void>) | null
  >(null);
  const refreshAttentionRef = useRef<(() => Promise<void>) | null>(null);
  const refreshCurrentViewRef = useRef<(() => Promise<void>) | null>(null);

  const metrics = useMemo(() => buildMetrics(summary), [summary]);
  const operationLinks = summary.operationsPreview
    ? STATUS_LINKS
    : STATUS_LINKS.filter((status) => status.key !== "completedToday");
  const selectedOperation =
    operationLinks.find((status) => status.key === selectedOperationKey) ??
    null;
  const selectedOperationBucket =
    selectedOperationKey && selectedOperation
      ? (summary.operationsPreview?.[selectedOperation.key] ?? null)
      : null;
  const selectedOperationCount =
    selectedOperation && selectedOperationBucket
      ? selectedOperationBucket.count
      : selectedOperation && selectedOperation.key !== "completedToday"
        ? (summary.operations?.[selectedOperation.key] ?? 0)
        : 0;

  async function refreshAttention() {
    setAttentionLoading(true);
    try {
      setAttentionError(null);
      setAttentionSummary(await fetchAttentionSummary());
    } catch (error) {
      setAttentionError((error as Error).message);
    } finally {
      setAttentionLoading(false);
    }
  }
  refreshAttentionRef.current = refreshAttention;

  async function refreshDashboard(
    query: string,
    options: { pushUrl?: boolean } = {},
  ) {
    setDashboardLoading(true);
    try {
      setDashboardError(null);
      const nextSummary = await fetchDashboardSummary(query);
      setSummary(nextSummary);
      setCustomFrom(nextSummary.range.from);
      setCustomTo(nextSummary.range.to);
      if (options.pushUrl) {
        window.history.pushState(null, "", `/admin${query}`);
      }
    } catch (error) {
      setDashboardError((error as Error).message);
    } finally {
      setDashboardLoading(false);
    }
  }
  refreshDashboardRef.current = refreshDashboard;

  async function refreshCurrentView() {
    const query = window.location.search || `?range=${summary.range.key}`;
    await Promise.all([refreshDashboard(query), refreshAttention()]);
  }
  refreshCurrentViewRef.current = refreshCurrentView;

  function loadRange(range: DashboardRangeKey) {
    void refreshDashboard(`?range=${range}`, { pushUrl: true });
  }

  function submitCustomRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = `?range=custom&from=${encodeURIComponent(
      customFrom,
    )}&to=${encodeURIComponent(customTo)}`;
    void refreshDashboard(query, { pushUrl: true });
  }

  useEffect(() => {
    void refreshAttention();
  }, []);

  useEffect(() => {
    orderRevisionRef.current = null;
    menuRevisionRef.current = null;
  }, [summary.outletId]);

  useEffect(() => {
    let closed = false;
    let eventSource: EventSource | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    function applyOrderVersion(version: OutletVersionDTO) {
      if (closed) return;
      const previousRevision = orderRevisionRef.current;
      orderRevisionRef.current = version.revision;
      if (previousRevision !== null && version.revision > previousRevision) {
        void refreshCurrentViewRef.current?.();
      }
    }

    async function checkOrderVersion(force = false) {
      if (!force && document.visibilityState === "hidden") return;
      try {
        applyOrderVersion(await fetchDashboardOrderVersion());
      } catch {
        // Polling is a freshness hint; the visible UI keeps its last safe data.
      }
    }

    void checkOrderVersion(true);
    pollInterval = setInterval(
      () => void checkOrderVersion(),
      DASHBOARD_ORDER_VERSION_POLL_MS,
    );

    if (typeof EventSource !== "undefined") {
      eventSource = new EventSource("/api/admin/dashboard/events");
      eventSource.addEventListener("dashboard_order_revision", (event) => {
        try {
          applyOrderVersion(JSON.parse((event as MessageEvent).data));
        } catch {
          // Ignore malformed event payloads; polling remains active.
        }
      });
      eventSource.addEventListener("auth_expired", () => {
        eventSource?.close();
        eventSource = null;
      });
      eventSource.addEventListener("reconnect", () => {
        eventSource?.close();
        eventSource = null;
      });
    }

    return () => {
      closed = true;
      if (pollInterval) clearInterval(pollInterval);
      eventSource?.close();
    };
  }, [summary.outletId]);

  useEffect(() => {
    let closed = false;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    async function checkMenuVersion(force = false) {
      if (!force && document.visibilityState === "hidden") return;
      try {
        const version = await fetchMenuVersion(summary.outletId);
        if (closed) return;
        const previousRevision = menuRevisionRef.current;
        menuRevisionRef.current = version.revision;
        if (previousRevision !== null && version.revision > previousRevision) {
          void refreshAttentionRef.current?.();
        }
      } catch {
        // Menu freshness is already enforced on /admin/menu; dashboard attention
        // can wait for the next poll if this lightweight check fails.
      }
    }

    void checkMenuVersion(true);
    pollInterval = setInterval(
      () => void checkMenuVersion(),
      DASHBOARD_MENU_VERSION_POLL_MS,
    );

    return () => {
      closed = true;
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [summary.outletId]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      const query = window.location.search || "?range=today";
      void refreshDashboardRef.current?.(query);
    }, DASHBOARD_DEVICE_REFRESH_MS);

    function handleFocusOrVisibility() {
      if (document.visibilityState === "hidden") return;
      void refreshCurrentViewRef.current?.();
    }

    window.addEventListener("focus", handleFocusOrVisibility);
    document.addEventListener("visibilitychange", handleFocusOrVisibility);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", handleFocusOrVisibility);
      document.removeEventListener("visibilitychange", handleFocusOrVisibility);
    };
  }, []);

  useEffect(() => {
    function handlePopState() {
      void refreshDashboard(window.location.search || "?range=today");
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  return (
    <>
      <div className="mb-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-black leading-none tracking-normal text-stone-950">
                Dashboard
              </h1>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-black tracking-widest text-emerald-800 uppercase">
                <span className="live-dot" aria-hidden />
                Live
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-stone-600">
              <span className="font-black text-stone-950">
                {summary.outletName}
              </span>
              <span className="text-stone-300">·</span>
              <span>{summary.range.label}</span>
              <span className="text-stone-300">·</span>
              <span>
                {summary.range.from}
                {summary.range.from !== summary.range.to
                  ? ` to ${summary.range.to}`
                  : ""}
              </span>
              <span className="text-stone-300">·</span>
              <span>refreshed {formatGeneratedAt(summary.generatedAt)}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void refreshCurrentView()}
            disabled={dashboardLoading || attentionLoading}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-stone-200 bg-white px-3 text-[10px] font-black tracking-widest text-stone-700 uppercase hover:border-stone-400 disabled:opacity-60"
          >
            <RefreshCw
              size={14}
              strokeWidth={2.5}
              className={
                dashboardLoading || attentionLoading ? "animate-spin" : ""
              }
              aria-hidden
            />
            Refresh
          </button>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-stone-200 bg-white p-3 shadow-sm">
          <div className="flex flex-wrap gap-2">
            {RANGE_LINKS.map((range) => (
              <button
                key={range.key}
                type="button"
                onClick={() => loadRange(range.key)}
                disabled={dashboardLoading}
                className={`h-9 rounded-md border px-3 text-[10px] font-black tracking-widest uppercase transition disabled:opacity-60 ${
                  summary.range.key === range.key && !dashboardError
                    ? "border-stone-950 bg-stone-950 text-white"
                    : "border-stone-200 bg-white text-stone-600 hover:border-stone-400"
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>

          <form onSubmit={submitCustomRange} className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-[9px] font-black tracking-widest text-stone-500 uppercase">
                Custom from
              </label>
              <input
                type="date"
                value={customFrom}
                onChange={(event) => setCustomFrom(event.target.value)}
                className="h-9 rounded-md border border-stone-200 bg-white px-2 text-xs font-bold"
              />
            </div>
            <div>
              <label className="mb-1 block text-[9px] font-black tracking-widest text-stone-500 uppercase">
                Custom to
              </label>
              <input
                type="date"
                value={customTo}
                onChange={(event) => setCustomTo(event.target.value)}
                className="h-9 rounded-md border border-stone-200 bg-white px-2 text-xs font-bold"
              />
            </div>
            <button className="h-9 rounded-md bg-stone-950 px-3 text-[10px] font-black tracking-widest text-white uppercase">
              Apply
            </button>
          </form>
        </div>
      </div>

      {dashboardError && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-800">
          <AlertTriangle
            size={18}
            strokeWidth={2.5}
            className="mt-0.5 shrink-0"
          />
          <span>Dashboard could not refresh: {dashboardError}</span>
        </div>
      )}

      {dashboardLoading && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-black text-amber-900">
          Loading dashboard data...
        </div>
      )}

      <DashboardAccessNotice summary={summary} />

      <SectionHead title="Hero KPIs" desc={summary.range.label} />
      <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {metrics.map((metric) => (
          <DashboardMetricCard key={metric.label} metric={metric} />
        ))}
      </section>

      <SectionHead
        title="Real-time operations"
        desc="Always live · period selector ignored"
      />
      <div className="mb-5 grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.9fr)]">
        <DashboardOperationsPanel
          statuses={operationLinks}
          operations={summary.operations}
          operationBuckets={summary.operationsPreview}
          deviceFleet={summary.deviceFleet}
          selectedKey={selectedOperationKey}
          onSelect={setSelectedOperationKey}
          openHref="/admin/orders"
          openLabel="Open orders"
          panelTestId="dashboard-operations"
          getBucketTestId={(key) => `dashboard-operation-bucket-${key}`}
          hiddenSlot={
            <EmptyPanel
              title="Order operations hidden"
              body="This account can open the dashboard, but cannot read order activity for the active outlet."
            />
          }
        >
          {selectedOperation && selectedOperationBucket ? (
            <DashboardOperationPreviewPanel
              bucket={selectedOperationBucket}
              operation={selectedOperation}
              onClose={() => setSelectedOperationKey(null)}
            />
          ) : selectedOperation ? (
            <div className="mt-3 rounded-xl border border-stone-200 border-l-yellow-400 bg-stone-50 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div
                    className="text-[12px] font-black tracking-widest uppercase"
                    style={{ color: selectedOperation.color }}
                  >
                    {selectedOperation.label}
                  </div>
                  <div className="mt-1 text-xl font-black text-stone-950">
                    {selectedOperationCount} active
                  </div>
                  <div className="text-sm font-semibold text-stone-600">
                    No scoped preview rows are available for this bucket.
                  </div>
                </div>
                <Link
                  href={selectedOperation.href}
                  className="rounded-full bg-stone-950 px-4 py-2 text-[12px] font-black tracking-widest text-yellow-300 uppercase"
                >
                  Open queue
                </Link>
              </div>
              <div className="mt-3 rounded-lg border border-dashed border-stone-300 bg-white px-3 py-3 text-sm font-bold text-stone-500">
                Open the queue in Orders to inspect the full list.
              </div>
            </div>
          ) : null}
        </DashboardOperationsPanel>

        <section
          data-testid="dashboard-device-health"
          className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-[12px] font-black tracking-widest text-stone-700 uppercase">
                Connected devices · {summary.outletName}
              </div>
              <div className="text-sm font-semibold text-stone-500">
                Fleet health by last-seen state.
              </div>
            </div>
            <Monitor size={24} strokeWidth={2.3} className="text-stone-500" />
          </div>
          {summary.deviceHealth ? (
            <DashboardDeviceFleetPanel
              deviceHealth={summary.deviceHealth}
              href={summary.deviceHealthHref}
              deviceFleet={summary.deviceFleet}
            />
          ) : (
            <EmptyPanel
              title="Device health hidden"
              body="This account cannot read device status for the active outlet."
            />
          )}
        </section>
      </div>

      <SectionHead title="Attention" />
      <div className="mb-5">
        <DashboardAttentionPanel
          summary={attentionSummary}
          isLoading={attentionLoading}
          error={attentionError}
        />
      </div>

      <SectionHead title="Top sellers" desc={summary.range.label} />
      <div className="mb-5 grid gap-5 xl:grid-cols-2">
        <TopSellerPanel
          title="Top sellers"
          caption="Ranked by quantity sold in the selected period."
          sellers={summary.topSellers}
          emptyTitle="No sellers yet"
          emptyBody={`Paid sales in ${summary.range.label.toLowerCase()} will appear here after orders are placed.`}
          getSellerHref={
            summary.permissions.canReadMenuAttention
              ? (seller) => menuSearchHref(seller.name)
              : undefined
          }
        />

        {summary.topSellersBySales && (
          <TopSellerPanel
            title="Top by sales"
            caption="Revenue-ranked items for accounts allowed to see sales."
            sellers={summary.topSellersBySales}
            emptyTitle="No sales yet"
            emptyBody={`Revenue-ranked items in ${summary.range.label.toLowerCase()} will appear here after paid orders are placed.`}
            salesMode
            getSellerHref={
              summary.permissions.canReadMenuAttention
                ? (seller) => menuSearchHref(seller.name)
                : undefined
            }
          />
        )}
      </div>
    </>
  );
}
