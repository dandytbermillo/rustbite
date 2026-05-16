"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type {
  AdminDashboardSummary,
  DashboardOperationBucketKey,
} from "@/lib/admin/dashboard/summary";

export type DashboardOperationPanelStatus = {
  key: DashboardOperationBucketKey;
  label: string;
  href: string;
  color: string;
  sub: string;
};

export type DashboardOperationPanelBucket = {
  count: number;
  lateCount: number;
  oldestAgeMinutes: number | null;
  lateAfterMinutes: number | null;
};

function operationSubLabel({
  key,
  fallback,
  deviceFleet,
}: {
  key: DashboardOperationBucketKey;
  fallback: string;
  deviceFleet?: AdminDashboardSummary["deviceFleet"];
}): string {
  const roleByBucket: Partial<Record<DashboardOperationBucketKey, string>> = {
    awaitingCounterPayment: "counter",
    paid: "kitchen",
    inKitchen: "kitchen",
    ready: "board",
  };
  const labelByRole: Record<string, string> = {
    counter: "Counter POS",
    kitchen: "Kitchen display",
    board: "Pickup board",
  };
  const role = roleByBucket[key];
  if (!role || !deviceFleet) return fallback;
  const device =
    deviceFleet.devices.find(
      (candidate) => candidate.role === role && candidate.state !== "disabled",
    ) ??
    deviceFleet.devices.find((candidate) => candidate.role === role) ??
    null;
  return device ? `${labelByRole[role]}: ${device.name}` : fallback;
}

function operationCount({
  key,
  operations,
  operationBuckets,
}: {
  key: DashboardOperationBucketKey;
  operations: AdminDashboardSummary["operations"];
  operationBuckets:
    | Partial<Record<DashboardOperationBucketKey, DashboardOperationPanelBucket>>
    | null;
}): number {
  const bucketCount = operationBuckets?.[key]?.count;
  if (typeof bucketCount === "number") return bucketCount;
  if (key === "completedToday") return 0;
  return operations?.[key] ?? 0;
}

export default function DashboardOperationsPanel({
  statuses,
  operations,
  operationBuckets,
  deviceFleet,
  selectedKey,
  onSelect,
  openHref,
  openLabel,
  panelTestId,
  getBucketTestId,
  hiddenSlot,
  children,
  completedTodayFullWidth = false,
}: {
  statuses: readonly DashboardOperationPanelStatus[];
  operations: AdminDashboardSummary["operations"];
  operationBuckets:
    | Partial<Record<DashboardOperationBucketKey, DashboardOperationPanelBucket>>
    | null;
  deviceFleet?: AdminDashboardSummary["deviceFleet"];
  selectedKey?: DashboardOperationBucketKey | null;
  onSelect?: (key: DashboardOperationBucketKey) => void;
  openHref: string;
  openLabel: string;
  panelTestId: string;
  getBucketTestId: (key: DashboardOperationBucketKey) => string;
  hiddenSlot: ReactNode;
  children?: ReactNode;
  completedTodayFullWidth?: boolean;
}) {
  return (
    <section
      data-testid={panelTestId}
      className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[12px] font-black tracking-widest text-stone-700 uppercase">
            Real-time operations
          </div>
          <div className="text-sm font-semibold text-stone-500">
            Active orders by status.
          </div>
        </div>
        <Link
          href={openHref}
          className="rounded-md border border-stone-200 px-3 py-2 text-[10px] font-black tracking-widest text-stone-700 uppercase hover:border-stone-400"
        >
          {openLabel}
        </Link>
      </div>

      {operations ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {statuses.map((status) => {
              const previewBucket = operationBuckets?.[status.key] ?? null;
              const count = operationCount({
                key: status.key,
                operations,
                operationBuckets,
              });
              const isSelected = selectedKey === status.key;
              const isCompletedBar =
                completedTodayFullWidth && status.key === "completedToday";
              const className = `${
                isCompletedBar ? "sm:col-span-2 xl:col-span-5" : ""
              } flex min-h-[112px] flex-col gap-1 rounded-[10px] border px-3 py-2.5 text-left transition ${
                onSelect || status.href
                  ? "hover:-translate-y-px hover:border-stone-300 hover:bg-stone-100"
                  : ""
              } ${
                isSelected
                  ? "border-yellow-400 bg-yellow-50 shadow-[0_0_0_3px_rgba(255,190,11,0.18)]"
                  : isCompletedBar
                    ? "border-emerald-200 bg-emerald-50"
                    : "border-stone-200 bg-stone-50"
              }`;
              const content = (
                <>
                  <div
                    className={`text-[12px] font-black tracking-widest uppercase ${
                      isCompletedBar ? "text-emerald-800" : "text-stone-600"
                    }`}
                  >
                    {status.label}
                  </div>
                  <div
                    className="mono mt-1 text-3xl font-black leading-none"
                    style={{ color: status.color }}
                  >
                    {count}
                  </div>
                  <div className="mt-auto text-[12px] font-semibold text-stone-500">
                    {operationSubLabel({
                      key: status.key,
                      fallback: status.sub,
                      deviceFleet,
                    })}
                  </div>
                  {previewBucket && previewBucket.lateCount > 0 && (
                    <div className="mt-1 inline-flex w-fit rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-black tracking-widest text-red-700 uppercase">
                      {previewBucket.lateCount} late
                    </div>
                  )}
                </>
              );

              if (!onSelect) {
                return (
                  <Link
                    key={status.key}
                    href={status.href}
                    data-testid={getBucketTestId(status.key)}
                    className={className}
                    aria-label={`Open ${status.label} orders`}
                  >
                    {content}
                  </Link>
                );
              }

              return (
                <button
                  key={status.key}
                  type="button"
                  onClick={() => onSelect(status.key)}
                  data-testid={getBucketTestId(status.key)}
                  aria-expanded={isSelected}
                  aria-controls="dashboard-operation-preview"
                  className={className}
                >
                  {content}
                </button>
              );
            })}
          </div>
          {children}
        </>
      ) : (
        hiddenSlot
      )}
    </section>
  );
}
