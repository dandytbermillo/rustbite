"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BellOff,
  CheckCircle2,
  Clock3,
  Database,
  MonitorCheck,
  ReceiptText,
  RefreshCw,
  Server,
  ShieldCheck,
  Smartphone,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type {
  WorkspaceSystemStatusSignal,
  WorkspaceSystemStatusState,
  WorkspaceSystemStatusSummary,
} from "@/lib/admin/workspace/system-status-model";

const SYSTEM_STATUS_REFRESH_MS = 60_000;

function displayFetchError(status: number, body: unknown): string {
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof body.error === "string"
  ) {
    return body.error;
  }
  return `workspace_system_status_${status}`;
}

function formatCheckedAt(value: string | null): string {
  if (!value) return "No check history";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function stateCopy(state: WorkspaceSystemStatusState): string {
  if (state === "ready") return "Ready";
  if (state === "degraded") return "Degraded";
  if (state === "action_needed") return "Action needed";
  return "Unknown";
}

function stateClasses(state: WorkspaceSystemStatusState): string {
  if (state === "ready") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }
  if (state === "degraded") {
    return "border-amber-200 bg-amber-50 text-amber-950";
  }
  if (state === "action_needed") {
    return "border-red-200 bg-red-50 text-red-900";
  }
  return "border-stone-200 bg-stone-100 text-stone-700";
}

function heroClasses(state: WorkspaceSystemStatusState): string {
  if (state === "ready") {
    return "border-emerald-200 bg-emerald-50 text-emerald-950";
  }
  if (state === "degraded") {
    return "border-amber-200 bg-amber-50 text-amber-950";
  }
  if (state === "action_needed") {
    return "border-red-200 bg-red-50 text-red-950";
  }
  return "border-stone-200 bg-stone-100 text-stone-800";
}

function stateAccentClasses(state: WorkspaceSystemStatusState): string {
  if (state === "ready") return "bg-emerald-600";
  if (state === "degraded") return "bg-amber-500";
  if (state === "action_needed") return "bg-red-700";
  return "bg-stone-500";
}

function stateIcon(state: WorkspaceSystemStatusState): LucideIcon {
  if (state === "ready") return CheckCircle2;
  if (state === "degraded") return AlertTriangle;
  if (state === "action_needed") return XCircle;
  return Clock3;
}

function signalIcon(id: WorkspaceSystemStatusSignal["id"]): LucideIcon {
  if (id === "database") return Database;
  if (id === "external-monitor") return MonitorCheck;
  if (id === "devices") return Smartphone;
  if (id === "kiosk-client") return MonitorCheck;
  if (id === "orders") return ReceiptText;
  if (id === "payments") return ShieldCheck;
  if (id === "performance") return Clock3;
  if (id === "errors") return AlertTriangle;
  return Server;
}

function summaryCopy(summary: WorkspaceSystemStatusSummary) {
  const actionSignals = summary.signals.filter(
    (signal) => signal.state === "action_needed",
  ).length;
  const degradedSignals = summary.signals.filter(
    (signal) => signal.state === "degraded",
  ).length;
  const unknownSignals = summary.signals.filter(
    (signal) => signal.state === "unknown",
  ).length;

  if (actionSignals > 0) {
    return {
      badge: "Action now",
      customerImpact: "Possible",
      ownerAction: summary.overall.nextAction ?? "Review affected signal rows.",
      engineerContext: "Use request IDs",
    };
  }
  if (degradedSignals > 0) {
    return {
      badge: "Review",
      customerImpact: "Limited",
      ownerAction: summary.overall.nextAction ?? "Review degraded signals.",
      engineerContext: "Check slow/error logs",
    };
  }
  if (unknownSignals > 0) {
    return {
      badge: "Verify",
      customerImpact: "Unknown",
      ownerAction: summary.overall.nextAction ?? "Verify missing monitor history.",
      engineerContext: "Check provider/platform",
    };
  }
  return {
    badge: "Ready",
    customerImpact: "None seen",
    ownerAction: "No action",
    engineerContext: "Request IDs ready",
  };
}

function StatusPill({ state }: { state: WorkspaceSystemStatusState }) {
  const Icon = stateIcon(state);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${stateClasses(
        state,
      )}`}
    >
      <Icon size={12} strokeWidth={2.5} aria-hidden />
      {stateCopy(state)}
    </span>
  );
}

function SignalRow({ signal }: { signal: WorkspaceSystemStatusSignal }) {
  const Icon = signalIcon(signal.id);
  const content = (
    <>
      <div className="flex min-w-0 items-start gap-2">
        <span
          className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${stateClasses(
            signal.state,
          )}`}
        >
          <Icon size={16} strokeWidth={2.4} aria-hidden />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-black text-stone-950">
              {signal.label}
            </span>
            <StatusPill state={signal.state} />
          </div>
          <p className="mt-1 text-sm font-semibold leading-snug text-stone-600">
            {signal.detail}
          </p>
          {signal.nextAction && (
            <p className="mt-1 text-xs font-black uppercase tracking-widest text-stone-500">
              {signal.nextAction}
            </p>
          )}
        </div>
      </div>
      <div className="text-right text-[11px] font-bold text-stone-500">
        {formatCheckedAt(signal.lastCheckedAt)}
      </div>
    </>
  );

  if (signal.href) {
    return (
      <Link
        href={signal.href}
        className="grid grid-cols-[minmax(0,1fr)_96px] gap-3 rounded-lg border border-stone-200 bg-white p-3 transition hover:border-stone-300 hover:bg-stone-50"
      >
        {content}
      </Link>
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3 rounded-lg border border-stone-200 bg-white p-3">
      {content}
    </div>
  );
}

function EventRow({ signal }: { signal: WorkspaceSystemStatusSignal }) {
  const Icon = signalIcon(signal.id);
  return (
    <div className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-start gap-3 rounded-lg border border-stone-200 bg-white px-3 py-3">
      <span
        className={`mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border ${stateClasses(
          signal.state,
        )}`}
      >
        <Icon size={16} strokeWidth={2.4} aria-hidden />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-black text-stone-950">
            {signal.label}
          </span>
          <StatusPill state={signal.state} />
        </div>
        <p className="mt-1 text-sm font-semibold leading-snug text-stone-600">
          {signal.detail}
        </p>
      </div>
      <span className="whitespace-nowrap text-[11px] font-bold text-stone-500">
        {formatCheckedAt(signal.lastCheckedAt)}
      </span>
    </div>
  );
}

type StatusTab = "overview" | "events" | "runbook";

export default function AdminWorkspaceSystemStatusWidget({
  summary: initialSummary,
}: {
  summary: WorkspaceSystemStatusSummary;
}) {
  const [summary, setSummary] =
    useState<WorkspaceSystemStatusSummary>(initialSummary);
  const [activeTab, setActiveTab] = useState<StatusTab>("overview");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const statusCopy = useMemo(() => summaryCopy(summary), [summary]);
  const prioritySignals = useMemo(() => {
    return [...summary.signals].sort((a, b) => {
      const rank: Record<WorkspaceSystemStatusState, number> = {
        action_needed: 0,
        degraded: 1,
        unknown: 2,
        ready: 3,
      };
      return rank[a.state] - rank[b.state];
    });
  }, [summary.signals]);
  const readyCount = summary.signals.filter(
    (signal) => signal.state === "ready",
  ).length;
  const needsReviewCount = summary.signals.length - readyCount;
  const slowRouteGroups = useMemo(
    () =>
      (summary.routePerformance?.groups ?? [])
        .filter((group) => group.slowCount > 0)
        .sort(
          (a, b) =>
            b.slowCount - a.slowCount ||
            b.slowRatio - a.slowRatio ||
            a.label.localeCompare(b.label),
        ),
    [summary.routePerformance],
  );

  useEffect(() => {
    setSummary(initialSummary);
  }, [initialSummary]);

  const refresh = useCallback(async () => {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setRefreshing(true);
    try {
      const response = await fetch("/api/admin/workspace/system-status", {
        cache: "no-store",
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(displayFetchError(response.status, body));
      }
      setSummary(body as WorkspaceSystemStatusSummary);
      setRefreshError(null);
    } catch (error) {
      if (!controller.signal.aborted) {
        setRefreshError((error as Error).message);
      }
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [refresh]);

  useEffect(() => {
    const pollInterval = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void refresh();
    }, SYSTEM_STATUS_REFRESH_MS);

    function refreshWhenVisible() {
      if (document.visibilityState === "hidden") return;
      void refresh();
    }

    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      clearInterval(pollInterval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refresh]);

  return (
    <div
      data-testid="workspace-system-status-real-data"
      className="admin-widget-scroll h-full overflow-auto overscroll-contain bg-stone-50"
    >
      <div
        className="grid min-h-full gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_320px]"
      >
        <section className="grid min-w-0 content-start gap-4">
          <div className={`overflow-hidden rounded-lg border ${heroClasses(summary.overall.state)}`}>
            <div className={`h-2 ${stateAccentClasses(summary.overall.state)}`} />
            <div className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-[11px] font-black uppercase tracking-[0.18em] opacity-70">
                    {summary.outletName}
                  </div>
                  <h2 className="mt-2 text-3xl font-black leading-tight">
                    {summary.overall.title}
                  </h2>
                  <p className="mt-2 max-w-2xl text-base font-bold leading-snug">
                    {summary.overall.detail}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <StatusPill state={summary.overall.state} />
                  <button
                    type="button"
                    onClick={() => void refresh()}
                    disabled={refreshing}
                    className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white/80 px-3 py-2 text-[11px] font-black uppercase tracking-widest text-stone-700 transition hover:border-stone-300 hover:bg-white disabled:opacity-60"
                  >
                    <RefreshCw
                      size={14}
                      strokeWidth={2.5}
                      className={refreshing ? "animate-spin" : ""}
                      aria-hidden
                    />
                    {refreshing ? "Refreshing" : "Refresh"}
                  </button>
                </div>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg bg-white/75 px-4 py-3">
                  <div className="text-[10px] font-black uppercase tracking-widest opacity-60">
                    Last checked
                  </div>
                  <div className="mt-1 text-sm font-black">
                    {formatCheckedAt(summary.generatedAt)}
                  </div>
                </div>
                <div className="rounded-lg bg-white/75 px-4 py-3">
                  <div className="text-[10px] font-black uppercase tracking-widest opacity-60">
                    Signals
                  </div>
                  <div className="mt-1 text-sm font-black">
                    {readyCount} ready / {needsReviewCount} review
                  </div>
                </div>
                <div className="rounded-lg bg-white/75 px-4 py-3">
                  <div className="text-[10px] font-black uppercase tracking-widest opacity-60">
                    External monitor
                  </div>
                  <div className="mt-1 text-sm font-black">Better Stack history</div>
                </div>
                <div className="rounded-lg bg-white/75 px-4 py-3">
                  <div className="text-[10px] font-black uppercase tracking-widest opacity-60">
                    Alerts
                  </div>
                  <div className="mt-1 text-sm font-black">No push channels</div>
                </div>
              </div>
              {summary.overall.nextAction && (
                <div className="mt-4 rounded-lg bg-white/80 px-4 py-3 text-base font-black">
                  {summary.overall.nextAction}
                </div>
              )}
              {refreshError && (
                <div className="mt-4 rounded-lg border border-amber-200 bg-white/80 px-4 py-3 text-sm font-bold text-amber-950">
                  Status refresh failed: {refreshError}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-stone-200 bg-white">
            <div className="flex flex-wrap gap-2 border-b border-stone-200 p-2">
              {(["overview", "events", "runbook"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  aria-pressed={activeTab === tab}
                  onClick={() => setActiveTab(tab)}
                  className={`rounded-full px-4 py-2 text-[12px] font-black uppercase tracking-widest ${
                    activeTab === tab
                      ? "bg-stone-950 text-white"
                      : "text-stone-500 hover:bg-stone-100 hover:text-stone-950"
                  }`}
                >
                  {tab === "overview"
                    ? "Overview"
                    : tab === "events"
                      ? "Recent events"
                      : "Runbook"}
                </button>
              ))}
            </div>

            {activeTab === "overview" && (
              <div className="grid gap-3 p-3">
                {prioritySignals.map((signal) => (
                  <SignalRow key={signal.id} signal={signal} />
                ))}
              </div>
            )}

            {activeTab === "events" && (
              <div className="grid gap-3 p-3">
                {prioritySignals.map((signal) => (
                  <EventRow key={signal.id} signal={signal} />
                ))}
              </div>
            )}

            {activeTab === "runbook" && (
              <div className="grid gap-3 p-3">
                <div className="rounded-lg border border-stone-200 bg-stone-50 p-4">
                  <div className="text-[11px] font-black uppercase tracking-widest text-stone-500">
                    Owner action
                  </div>
                  <p className="mt-2 text-base font-black text-stone-950">
                    {statusCopy.ownerAction}
                  </p>
                </div>
                <div className="rounded-lg border border-stone-200 bg-stone-50 p-4">
                  <div className="text-[11px] font-black uppercase tracking-widest text-stone-500">
                    Operator lookup
                  </div>
                  <p className="mt-2 text-sm font-semibold leading-snug text-stone-600">
                    Search platform logs by request id, route pattern, local
                    payment transaction id, or job id. Owners should use this
                    page first; raw logs are operator-only.
                  </p>
                </div>
                {summary.operatorDetail && (
                  <div className="rounded-lg border border-stone-200 bg-white p-4">
                    <div className="text-[11px] font-black uppercase tracking-widest text-stone-500">
                      Source notes
                    </div>
                    <ul className="mt-2 grid gap-2 text-sm font-semibold leading-snug text-stone-600">
                      {summary.operatorDetail.sourceNotes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {summary.operatorDetail &&
                  summary.serverIssues &&
                  summary.serverIssues.totalCount > 0 && (
                    <div className="rounded-lg border border-stone-200 bg-white p-4">
                      <div className="text-[11px] font-black uppercase tracking-widest text-stone-500">
                        Recent server issue references
                      </div>
                      <div className="mt-3 grid gap-2">
                        {summary.serverIssues.groups.map((issue) => (
                          <div
                            key={`${issue.surface}:${issue.routePattern}`}
                            className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-sm font-black text-stone-950">
                                {issue.routePattern}
                              </span>
                              <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black uppercase tracking-widest text-stone-500">
                                {issue.surface} · {issue.count}
                              </span>
                            </div>
                            <p className="mt-1 text-xs font-bold text-stone-600">
                              Latest request id:{" "}
                              {issue.latestRequestId ?? "not available"}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                {summary.operatorDetail && slowRouteGroups.length > 0 && (
                  <div className="rounded-lg border border-stone-200 bg-white p-4">
                    <div className="text-[11px] font-black uppercase tracking-widest text-stone-500">
                      Recent slow route references
                    </div>
                    <div className="mt-3 grid gap-2">
                      {slowRouteGroups.map((route) => (
                        <div
                          key={route.routeId}
                          className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm font-black text-stone-950">
                              {route.label}
                            </span>
                            <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black uppercase tracking-widest text-stone-500">
                              {route.slowCount}/{route.sampleCount} slow
                            </span>
                          </div>
                          <p className="mt-1 text-xs font-bold text-stone-600">
                            {route.method} {route.routePattern} · latest request
                            id: {route.latestRequestId ?? "not available"}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <aside className="grid min-w-0 content-start gap-4">
          <div className="rounded-lg border border-stone-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-black text-stone-950">Owner summary</h3>
              <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-stone-600">
                {statusCopy.badge}
              </span>
            </div>
            <div className="mt-4 grid gap-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-bold text-stone-500">Owner action</span>
                <span className="text-right text-sm font-black text-stone-950">
                  {statusCopy.ownerAction}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-bold text-stone-500">Customer impact</span>
                <span className="text-sm font-black text-stone-950">
                  {statusCopy.customerImpact}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-bold text-stone-500">Engineer context</span>
                <span className="text-sm font-black text-stone-950">
                  {statusCopy.engineerContext}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-stone-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-black text-stone-950">
                <MonitorCheck size={16} strokeWidth={2.5} aria-hidden />
                Better Stack checks
              </div>
              <span className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-stone-600">
                <BellOff size={12} strokeWidth={2.5} aria-hidden />
                No push alerts
              </span>
            </div>
            <div className="mt-3 grid gap-2">
              {summary.uptimeChecks.map((check) => (
                <div
                  key={check.id}
                  className="grid grid-cols-[minmax(0,1fr)_82px] items-center gap-2 rounded-md bg-stone-50 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black text-stone-900">
                      {check.label}
                    </div>
                    <div className="truncate font-mono text-[11px] font-bold text-stone-500">
                      {check.path}
                    </div>
                  </div>
                  <StatusPill state={check.state} />
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-stone-200 bg-white p-4">
            <div className="text-[11px] font-black uppercase tracking-widest text-stone-500">
              Shared status rule
            </div>
            <p className="mt-2 text-sm font-semibold leading-snug text-stone-600">
              Owners and operators see the same health truth here. Extra
              operator context is sanitized; secrets, raw logs, stack traces,
              headers, IPs, user agents, and customer/payment data stay hidden.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
