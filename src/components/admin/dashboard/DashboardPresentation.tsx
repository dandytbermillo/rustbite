"use client";

import Link from "next/link";
import { PackageCheck, type LucideIcon } from "lucide-react";
import { fmt } from "@/lib/pricing";

export type DashboardMetric = {
  label: string;
  value: string;
  caption: string;
  tone: "dark" | "green" | "blue" | "amber" | "red";
  Icon: LucideIcon;
  href?: string;
  live?: boolean;
};

type DashboardSeller = {
  name: string;
  qty: number;
  sales: number | null;
};

function metricToneClasses(tone: DashboardMetric["tone"]): string {
  if (tone === "dark") return "bg-stone-950 text-white border-stone-950";
  if (tone === "green")
    return "bg-emerald-50 border-emerald-200 text-emerald-950";
  if (tone === "blue") return "bg-blue-50 border-blue-200 text-blue-950";
  if (tone === "red") return "bg-red-50 border-red-200 text-red-950";
  return "bg-amber-50 border-amber-200 text-amber-950";
}

export function SectionHead({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="mb-2 mt-6 flex flex-wrap items-baseline justify-between gap-2 first:mt-0">
      <h2 className="m-0 text-[15px] font-black tracking-widest text-stone-950 uppercase">
        {title}
      </h2>
      {desc && <div className="text-sm font-semibold text-stone-500">{desc}</div>}
    </div>
  );
}

export function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-stone-300 bg-white p-5">
      <div className="text-base font-black text-stone-950">{title}</div>
      <div className="mt-2 max-w-xl text-sm font-semibold leading-relaxed text-stone-500">
        {body}
      </div>
    </div>
  );
}

export function DashboardMetricCard({ metric }: { metric: DashboardMetric }) {
  const isDark = metric.tone === "dark";
  const testId = `dashboard-metric-${metric.label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
  const card = (
    <div
      data-testid={testId}
      className={`relative flex min-h-[116px] flex-col gap-1.5 rounded-[14px] border px-4 py-4 shadow-sm ${metricToneClasses(metric.tone)}`}
    >
      {metric.live && (
        <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black tracking-widest text-emerald-700 uppercase">
          <span className="live-dot" aria-hidden />
          Live
        </span>
      )}
      <div className="flex items-center justify-between gap-3">
        <div
          className={`text-[11px] font-black tracking-widest uppercase ${
            isDark ? "text-white/55" : "text-stone-500"
          }`}
        >
          {metric.label}
        </div>
        {!metric.live && (
          <metric.Icon
            size={21}
            strokeWidth={2.4}
            className={isDark ? "text-yellow-300" : "text-stone-500"}
            aria-hidden
          />
        )}
      </div>
      <div className="mono mt-3 text-2xl font-black leading-none sm:text-3xl">
        {metric.value}
      </div>
      <div
        className={`mt-auto text-xs font-bold ${
          isDark ? "text-white/60" : "text-stone-500"
        }`}
      >
        {metric.caption}
      </div>
    </div>
  );

  if (!metric.href) return card;

  return (
    <Link
      href={metric.href}
      className="block rounded-xl focus:outline-none focus:ring-2 focus:ring-stone-900 focus:ring-offset-2"
    >
      {card}
    </Link>
  );
}

export function TopSellerPanel({
  title,
  caption,
  sellers,
  emptyTitle,
  emptyBody,
  salesMode = false,
  getSellerHref,
}: {
  title: string;
  caption: string;
  sellers: DashboardSeller[] | null;
  emptyTitle: string;
  emptyBody: string;
  salesMode?: boolean;
  getSellerHref?: (seller: DashboardSeller) => string | null;
}) {
  const maxValue = Math.max(
    1,
    ...(sellers ?? []).map((seller) =>
      salesMode && seller.sales !== null ? seller.sales : seller.qty,
    ),
  );

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-lg font-black text-stone-950">{title}</div>
          <div className="text-sm font-semibold text-stone-500">{caption}</div>
        </div>
        <PackageCheck size={24} strokeWidth={2.3} className="text-stone-500" />
      </div>
      {sellers && sellers.length > 0 ? (
        <div className="space-y-1">
          {sellers.map((seller, index) => {
            const href = getSellerHref?.(seller) ?? null;
            const primaryValue =
              salesMode && seller.sales !== null ? seller.sales : seller.qty;
            const width = Math.max(
              8,
              Math.round((primaryValue / maxValue) * 100),
            );
            const content = (
              <>
                <div className="mono w-5 shrink-0 text-[12px] font-black text-stone-500">
                  {index + 1}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-stone-950">
                    {seller.name}
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded bg-stone-100">
                    <div
                      className={`h-full rounded ${
                        salesMode ? "bg-red-600" : "bg-yellow-400"
                      }`}
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </div>
                <div className="mono w-24 shrink-0 text-right text-[12px] font-black text-stone-700">
                  <div>
                    {salesMode && seller.sales !== null
                      ? fmt(seller.sales)
                      : `${seller.qty} sold`}
                  </div>
                  <div className="text-[11px] font-bold text-stone-500">
                    {salesMode
                      ? `${seller.qty} sold`
                      : seller.sales === null
                        ? "Sales hidden"
                        : fmt(seller.sales)}
                  </div>
                </div>
              </>
            );

            if (!href) {
              return (
                <div
                  key={`${title}-${seller.name}-${index}`}
                  className="grid grid-cols-[20px_minmax(0,1fr)_96px] items-center gap-3 py-1.5"
                >
                  {content}
                </div>
              );
            }

            return (
              <Link
                key={`${title}-${seller.name}-${index}`}
                href={href}
                className="grid grid-cols-[20px_minmax(0,1fr)_96px] items-center gap-3 rounded-md py-1.5 transition hover:bg-stone-50"
              >
                {content}
              </Link>
            );
          })}
        </div>
      ) : (
        <EmptyPanel title={emptyTitle} body={emptyBody} />
      )}
    </section>
  );
}
