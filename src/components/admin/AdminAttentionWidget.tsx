"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Bell, CheckCircle2, X } from "lucide-react";

const ATTENTION_SUMMARY_POLL_MS = 30_000;
const ATTENTION_SUMMARY_FAILURE_POLL_MS = 120_000;

type AdminAttentionSeverity = "critical" | "warning" | "info";

type AdminAttentionSummary = {
  generatedAt: string;
  outletId: string;
  outletName: string;
  totalCount: number;
  groups: Array<{
    id: "menu" | "orders";
    label: string;
    count: number;
    items: Array<{
      id: string;
      label: string;
      count: number;
      severity: AdminAttentionSeverity;
      href: string;
    }>;
  }>;
};

function severityClass(severity: AdminAttentionSeverity): string {
  if (severity === "critical") return "text-red-200 bg-red-500/15";
  if (severity === "warning") return "text-amber-100 bg-amber-400/15";
  return "text-sky-100 bg-sky-400/15";
}

export default function AdminAttentionWidget({
  outletId,
  scopeKey,
  variant = "sidebar",
}: {
  outletId: string;
  scopeKey: string;
  variant?: "sidebar" | "pill";
}) {
  const [summary, setSummary] = useState<AdminAttentionSummary | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [hasError, setHasError] = useState(false);
  const failureCountRef = useRef(0);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const requestRef = useRef<{
    controller: AbortController;
    scopeKey: string;
  } | null>(null);
  const refreshRef = useRef<
    ((options?: { force?: boolean }) => Promise<void>) | null
  >(null);

  useEffect(() => {
    setSummary(null);
    setHasError(false);
    failureCountRef.current = 0;
  }, [scopeKey]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    async function refresh({ force = false }: { force?: boolean } = {}) {
      if (document.visibilityState === "hidden" && !force) return;
      if (requestRef.current) return;

      const controller = new AbortController();
      requestRef.current = { controller, scopeKey };
      try {
        const response = await fetch("/api/admin/attention/summary", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`summary_${response.status}`);
        const nextSummary = (await response.json()) as AdminAttentionSummary;
        if (cancelled || requestRef.current?.scopeKey !== scopeKey) return;
        setSummary(nextSummary);
        setHasError(false);
        failureCountRef.current = 0;
      } catch (error) {
        if (controller.signal.aborted || cancelled) return;
        setHasError(true);
        failureCountRef.current += 1;
      } finally {
        if (requestRef.current?.controller === controller) {
          requestRef.current = null;
        }
      }
    }
    refreshRef.current = refresh;

    function scheduleNext() {
      if (cancelled) return;
      const delayMs =
        failureCountRef.current >= 2
          ? ATTENTION_SUMMARY_FAILURE_POLL_MS
          : ATTENTION_SUMMARY_POLL_MS;
      timeoutId = setTimeout(async () => {
        await refresh();
        scheduleNext();
      }, delayMs);
    }

    function handleFocus() {
      void refresh({ force: true });
    }

    function handleVisibility() {
      if (document.visibilityState === "visible") {
        void refresh({ force: true });
      }
    }

    void refresh({ force: true });
    scheduleNext();
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
      requestRef.current?.controller.abort();
      requestRef.current = null;
      if (refreshRef.current === refresh) refreshRef.current = null;
    };
  }, [scopeKey]);

  const canReadMenuAttention =
    summary?.groups.some((group) => group.id === "menu") ?? false;

  useEffect(() => {
    if (!canReadMenuAttention || typeof EventSource === "undefined") return;

    let closed = false;
    let hasSeenInitialRevision = false;
    const eventSource = new EventSource(
      `/api/menu/events?outletId=${encodeURIComponent(outletId)}`,
    );

    const handleMenuRevision = () => {
      if (closed) return;
      if (!hasSeenInitialRevision) {
        hasSeenInitialRevision = true;
        return;
      }
      void refreshRef.current?.();
    };
    const closeStream = () => {
      closed = true;
      eventSource.close();
    };

    eventSource.addEventListener("menu_revision", handleMenuRevision);
    eventSource.addEventListener("auth_expired", closeStream);

    return () => {
      closed = true;
      eventSource.removeEventListener("menu_revision", handleMenuRevision);
      eventSource.removeEventListener("auth_expired", closeStream);
      eventSource.close();
    };
  }, [canReadMenuAttention, outletId, scopeKey]);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (!panelRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const totalCount = summary?.totalCount ?? 0;
  const label = hasError
    ? "Attention unavailable"
    : totalCount > 0
      ? `Needs attention ${totalCount}`
      : "All clear";

  return (
    <div
      className={`relative ${variant === "pill" ? "" : "mb-4"}`}
      ref={panelRef}
    >
      <button
        type="button"
        data-testid={variant === "pill" ? "admin-attention-pill" : undefined}
        onClick={() => setIsOpen((open) => !open)}
        className={
          variant === "pill"
            ? "inline-flex h-9 items-center gap-2 rounded-full border border-yellow-400/35 bg-yellow-400/10 px-4 text-[12px] font-black tracking-wide text-yellow-300 hover:bg-yellow-400/15"
            : `flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-[11px] font-black ${
                hasError
                  ? "border-amber-300/30 bg-amber-400/10 text-amber-100"
                  : totalCount > 0
                    ? "border-red-300/30 bg-red-500/15 text-red-100"
                    : "border-emerald-300/20 bg-emerald-400/10 text-emerald-100"
              }`
        }
        aria-expanded={isOpen}
        aria-label={`Admin attention summary, ${totalCount} items`}
      >
        <span className="flex items-center gap-2">
          {hasError ? (
            <AlertTriangle size={16} strokeWidth={2.5} aria-hidden />
          ) : totalCount > 0 ? (
            <Bell size={16} strokeWidth={2.5} aria-hidden />
          ) : (
            <CheckCircle2 size={16} strokeWidth={2.5} aria-hidden />
          )}
          <span>{label}</span>
        </span>
        {variant !== "pill" && <span className="text-sm">{isOpen ? "−" : "+"}</span>}
      </button>

      {isOpen && (
        <div
          className={`absolute z-30 mt-2 rounded-xl border border-white/10 bg-neutral-950 p-3 shadow-2xl ${
            variant === "pill" ? "right-0 w-[340px] max-w-[calc(100vw-32px)]" : "left-0 right-0"
          }`}
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-black tracking-widest text-white/45">
                GLOBAL ATTENTION
              </div>
              <div className="mt-1 text-xs font-black text-white">
                {summary?.outletName ?? "Active outlet"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded-md p-1 text-white/50 hover:bg-white/10 hover:text-white"
              aria-label="Close attention summary"
            >
              <X size={16} aria-hidden />
            </button>
          </div>

          {hasError && (
            <div className="rounded-lg bg-amber-400/10 px-3 py-2 text-[11px] font-bold leading-relaxed text-amber-100">
              Attention unavailable. Admin navigation still works.
            </div>
          )}

          {!hasError && totalCount === 0 && (
            <div className="rounded-lg bg-emerald-400/10 px-3 py-2 text-[11px] font-bold text-emerald-100">
              All clear for this outlet.
            </div>
          )}

          {!hasError && summary?.groups.map((group) => (
            <div key={group.id} className="mb-3 last:mb-0">
              <div className="mb-2 flex items-center justify-between text-[10px] font-black tracking-widest text-white/45">
                <span>{group.label}</span>
                <span>{group.count}</span>
              </div>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <Link
                    key={`${group.id}-${item.id}`}
                    href={item.href}
                    onClick={() => setIsOpen(false)}
                    className={`flex items-center justify-between rounded-lg px-3 py-2 text-[11px] font-black hover:bg-white/10 ${severityClass(
                      item.severity,
                    )}`}
                  >
                    <span>{item.label}</span>
                    <span>{item.count}</span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
