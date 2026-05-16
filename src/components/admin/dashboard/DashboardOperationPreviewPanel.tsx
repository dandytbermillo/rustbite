"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type {
  DashboardOperationBucket,
  DashboardOperationBucketKey,
} from "@/lib/admin/dashboard/summary";
import { STATUS_DISPLAY_LABELS } from "@/lib/order-status-display";
import { fmt } from "@/lib/pricing";

type DashboardOperationPreviewStatus = {
  key: DashboardOperationBucketKey;
  label: string;
  href: string;
  color: string;
};

type DashboardOperationPreviewOrder =
  DashboardOperationBucket["previewOrders"][number];

function formatAgeMinutes(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  if (value < 1) return "<1m";
  if (value < 60) return `${value}m`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
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

function orderDetailHref(orderId: string, status: string): string {
  return buildHref("/admin/orders", {
    status,
    order: orderId,
  });
}

export default function DashboardOperationPreviewPanel({
  bucket,
  operation,
  onClose,
  onOpenQueue,
  onOpenOrder,
}: {
  bucket: DashboardOperationBucket;
  operation: DashboardOperationPreviewStatus;
  onClose: () => void;
  onOpenQueue?: (operation: DashboardOperationPreviewStatus) => void;
  onOpenOrder?: (
    order: DashboardOperationPreviewOrder,
    operation: DashboardOperationPreviewStatus,
  ) => void;
}) {
  return (
    <div
      id="dashboard-operation-preview"
      data-testid="dashboard-operation-preview"
      className="mt-3 rounded-xl border border-stone-200 border-l-yellow-400 bg-stone-50 p-3"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div
            className="text-[12px] font-black tracking-widest uppercase"
            style={{ color: operation.color }}
          >
            {operation.label}
          </div>
          <div className="mt-1 flex flex-wrap items-baseline gap-3">
            <span className="text-xl font-black text-stone-950">
              {bucket.count}{" "}
              {operation.key === "completedToday" ? "completed" : "active"}
            </span>
            {bucket.lateAfterMinutes != null && (
              <span className="mono text-[12px] font-bold text-stone-500">
                aging if &gt; {bucket.lateAfterMinutes}m
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-xs font-black">
            {bucket.oldestAgeMinutes != null && (
              <span className="rounded-full border border-stone-200 bg-white px-2 py-1 text-stone-600">
                oldest {formatAgeMinutes(bucket.oldestAgeMinutes)}
              </span>
            )}
            {bucket.lateCount > 0 && (
              <span className="rounded-full border border-red-200 bg-red-50 px-2 py-1 text-red-700">
                {bucket.lateCount} late
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-white px-4 py-2 text-[12px] font-black tracking-widest text-stone-700 uppercase hover:bg-stone-100"
          >
            Close
          </button>
          {onOpenQueue ? (
            <button
              type="button"
              onClick={() => onOpenQueue(operation)}
              className="rounded-full bg-stone-950 px-4 py-2 text-[12px] font-black tracking-widest text-yellow-300 uppercase"
            >
              Open queue
            </button>
          ) : (
            <Link
              href={operation.href}
              className="rounded-full bg-stone-950 px-4 py-2 text-[12px] font-black tracking-widest text-yellow-300 uppercase"
            >
              Open queue
            </Link>
          )}
        </div>
      </div>

      {bucket.previewOrders.length > 0 ? (
        <div className="mt-3 space-y-2">
          {bucket.previewOrders.map((order) => (
            <div
              key={order.id}
              data-testid="dashboard-operation-preview-row"
              className={`rounded-lg border bg-white p-3 ${
                order.isLate ? "border-red-200" : "border-stone-200"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mono text-base font-black text-stone-950">
                      #{order.orderNumber}
                    </span>
                    <span className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-[10px] font-black tracking-widest text-stone-600 uppercase">
                      {STATUS_DISPLAY_LABELS[order.status] ?? order.status}
                    </span>
                    {order.isLate && (
                      <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-black tracking-widest text-red-700 uppercase">
                        {formatAgeMinutes(order.ageMinutes)} late
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-stone-600">
                    {order.firstItemName}
                    {order.itemCount > 1 ? ` · ${order.itemCount} items` : ""}
                    {order.paymentMethod || order.paymentStatus ? " · " : ""}
                    {[order.paymentMethod, order.paymentStatus]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {order.total != null && (
                    <span className="mono text-sm font-black text-stone-900">
                      {fmt(order.total)}
                    </span>
                  )}
                  {onOpenOrder ? (
                    <button
                      type="button"
                      onClick={() => onOpenOrder(order, operation)}
                      className="inline-flex items-center gap-1 rounded-full border border-stone-200 px-3 py-1.5 text-[10px] font-black tracking-widest text-stone-700 uppercase hover:border-stone-400"
                    >
                      Open in Orders
                      <ExternalLink size={12} strokeWidth={2.5} aria-hidden />
                    </button>
                  ) : (
                    <Link
                      href={orderDetailHref(order.id, order.status)}
                      className="inline-flex items-center gap-1 rounded-full border border-stone-200 px-3 py-1.5 text-[10px] font-black tracking-widest text-stone-700 uppercase hover:border-stone-400"
                    >
                      Open in Orders
                      <ExternalLink size={12} strokeWidth={2.5} aria-hidden />
                    </Link>
                  )}
                </div>
              </div>

              <div className="mt-2 grid gap-1 border-t border-stone-100 pt-2">
                {order.items.slice(0, 3).map((item) => (
                  <div
                    key={item.id}
                    className="grid grid-cols-[42px_minmax(0,1fr)_80px] gap-2 text-xs"
                  >
                    <span className="mono text-right font-black text-stone-500">
                      x{item.qty}
                    </span>
                    <span className="truncate font-bold text-stone-700">
                      {item.nameSnapshot}
                    </span>
                    <span className="mono text-right font-black text-stone-600">
                      {item.lineTotal != null ? fmt(item.lineTotal) : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {bucket.count > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white px-3 py-3">
              <div className="text-sm font-bold text-stone-500">
                {bucket.count > bucket.previewOrders.length
                  ? `Showing ${bucket.previewOrders.length} ${
                      operation.key === "completedToday" ? "latest" : "oldest"
                    } of ${bucket.count}.`
                  : `Showing all ${bucket.count} in this bucket.`}
              </div>
              {onOpenQueue ? (
                <button
                  type="button"
                  onClick={() => onOpenQueue(operation)}
                  className="inline-flex items-center gap-1 rounded-full bg-stone-950 px-4 py-2 text-[10px] font-black tracking-widest text-yellow-300 uppercase"
                >
                  Open all {bucket.count} in Orders
                  <ExternalLink size={12} strokeWidth={2.5} aria-hidden />
                </button>
              ) : (
                <Link
                  href={operation.href}
                  className="inline-flex items-center gap-1 rounded-full bg-stone-950 px-4 py-2 text-[10px] font-black tracking-widest text-yellow-300 uppercase"
                >
                  Open all {bucket.count} in Orders
                  <ExternalLink size={12} strokeWidth={2.5} aria-hidden />
                </Link>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-dashed border-stone-300 bg-white px-3 py-3 text-sm font-bold text-stone-500">
          No orders in this bucket.
        </div>
      )}
    </div>
  );
}
