"use client";

import Link from "next/link";
import { Bell, CheckCircle2 } from "lucide-react";

export type DashboardAttentionSeverity = "critical" | "warning" | "info";

export type DashboardAttentionItem = {
  id: string;
  label: string;
  count: number;
  severity: DashboardAttentionSeverity;
  href: string;
};

export type DashboardAttentionGroup = {
  id: "menu" | "orders";
  label: string;
  count: number;
  items: DashboardAttentionItem[];
};

export type DashboardAttentionSelection = {
  group: DashboardAttentionGroup;
  item: DashboardAttentionItem;
};

export type DashboardAttentionSummary = {
  totalCount: number;
  outletName?: string;
  groups: DashboardAttentionGroup[];
};

function attentionToneClasses(severity: DashboardAttentionSeverity): string {
  if (severity === "critical") return "border-red-200 bg-red-50 text-red-900";
  if (severity === "warning")
    return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-sky-200 bg-sky-50 text-sky-900";
}

export default function DashboardAttentionPanel({
  summary,
  outletName,
  isLoading = false,
  error = null,
  onItemSelect,
}: {
  summary: DashboardAttentionSummary | null;
  outletName?: string;
  isLoading?: boolean;
  error?: string | null;
  onItemSelect?: (selection: DashboardAttentionSelection) => boolean | void;
}) {
  const resolvedOutletName = summary?.outletName ?? outletName ?? "this outlet";

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-lg font-black text-stone-950">
            Needs attention
          </div>
          <div className="text-sm font-semibold text-stone-500">
            Operational notices across menu and orders.
          </div>
        </div>
        <Bell size={24} strokeWidth={2.3} className="text-stone-500" />
      </div>

      {isLoading && !summary && (
        <div className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-sm font-bold text-stone-500">
          Loading attention summary...
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
          Attention summary unavailable: {error}
        </div>
      )}

      {!isLoading && !error && summary?.totalCount === 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-4 text-emerald-900">
          <CheckCircle2 size={21} strokeWidth={2.4} aria-hidden />
          <div className="font-black">All clear for {resolvedOutletName}.</div>
        </div>
      )}

      {!error && summary && summary.totalCount > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {summary.groups.map((group) => (
            <div key={group.id}>
              <h4 className="mb-2 text-[12px] font-black tracking-widest text-stone-600 uppercase">
                {group.label}
              </h4>
              <div className="space-y-1.5">
                {group.items.map((item) => (
                  <Link
                    key={`${group.id}-${item.id}`}
                    href={item.href}
                    data-testid={`dashboard-attention-item-${group.id}-${item.id}`}
                    onClick={(event) => {
                      if (!onItemSelect) return;
                      const handled = onItemSelect({ group, item });
                      if (handled !== false) event.preventDefault();
                    }}
                    className={`flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5 text-sm transition hover:brightness-95 ${attentionToneClasses(
                      item.severity,
                    )}`}
                  >
                    <div className="font-bold">{item.label}</div>
                    <div className="mono rounded-full border border-stone-200 bg-white px-2 py-0.5 text-[12px] font-black text-stone-700">
                      {item.count}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
