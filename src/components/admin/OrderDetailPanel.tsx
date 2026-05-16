"use client";

// Shared expanded-order detail panel used by both /admin (dashboard) and
// /admin/orders. The two pages must show identical line items, totals,
// payment block, and action buttons. Drift here would be a visual bug.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BRAND } from "@/lib/brand";
import { fmt } from "@/lib/pricing";
import { formatUpgradeForOrderRead } from "@/lib/order-read";
import { STATUS_DISPLAY_LABELS } from "@/lib/order-status-display";
import { parseAdminOrderAddOnSnapshots } from "@/lib/admin/order-add-on-snapshots";

export type OrderDetailRow = {
  id: string;
  orderNumber: string;
  orderType: string;
  status: string;
  paymentMethod: string | null;
  paymentProvider: string | null;
  paymentStatus: string | null;
  paymentTransactionId: string | null;
  paymentReference: string | null;
  paymentFailureMessage: string | null;
  productionStartedAt: string | null;
  hasQuantityStockRequirements: boolean;
  stockReturnedAutomatically: boolean;
  manualStockReturnCompleted: boolean;
  total: number;
  subtotal: number;
  gst: number;
  createdAt: string;
  items: Array<{
    id: string;
    nameSnapshot: string;
    qty: number;
    sizeName: string | null;
    isMeal: boolean;
    addonsJson: unknown;
    addOnSetSelectionsJson?: unknown;
    upgradeSnapshotJson: unknown;
    lineTotal: number;
  }>;
};

export type OrderDetailActionComplete = {
  orderId: string;
  orderNumber: string;
  message: string;
  nextStatus?: string;
};

function statusActionMessage({
  orderNumber,
  status,
  awaitingCounterPayment,
}: {
  orderNumber: string;
  status: string;
  awaitingCounterPayment: boolean;
}) {
  if (status === "PAID" && awaitingCounterPayment) {
    return `Order #${orderNumber} marked paid`;
  }
  if (status === "CANCELLED") return `Order #${orderNumber} cancelled`;

  const label = STATUS_DISPLAY_LABELS[status]?.toLowerCase() ?? status.toLowerCase();
  return `Order #${orderNumber} moved to ${label}`;
}

export default function OrderDetailPanel({
  order: o,
  onActionComplete,
  showAddOnSetSnapshots = false,
}: {
  order: OrderDetailRow;
  onActionComplete?: (event: OrderDetailActionComplete) => void | Promise<void>;
  showAddOnSetSnapshots?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const awaitingCounterPayment =
    o.status === "AWAITING_COUNTER_PAYMENT" && o.paymentMethod === "CASH";
  const canReturnStock =
    o.hasQuantityStockRequirements &&
    !o.stockReturnedAutomatically &&
    !o.manualStockReturnCompleted &&
      (o.status === "REFUNDED" ||
      (o.status === "CANCELLED" && Boolean(o.productionStartedAt)));

  const completeAction = async ({
    message,
    nextStatus,
  }: {
    message: string;
    nextStatus?: string;
  }) => {
    if (onActionComplete) {
      await onActionComplete({
        orderId: o.id,
        orderNumber: o.orderNumber,
        message,
        nextStatus,
      });
      return;
    }
    router.refresh();
  };

  const setStatus = async (status: string) => {
    setBusy(true);
    try {
      setError(null);
      const response = await fetch(`/api/admin/orders/${o.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        const json = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(json.error || `HTTP ${response.status}`);
      }
      await completeAction({
        message: statusActionMessage({
          orderNumber: o.orderNumber,
          status,
          awaitingCounterPayment,
        }),
        nextStatus: status,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const refundOrder = async () => {
    setBusy(true);
    try {
      setError(null);
      const response = await fetch(`/api/admin/orders/${o.id}/refund`, {
        method: "POST",
      });
      if (!response.ok) {
        const json = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(json.error || `HTTP ${response.status}`);
      }
      await completeAction({
        message: `Order #${o.orderNumber} refunded`,
        nextStatus: "REFUNDED",
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const returnStock = async () => {
    setBusy(true);
    try {
      setError(null);
      const response = await fetch(`/api/admin/orders/${o.id}/return-stock`, {
        method: "POST",
      });
      if (!response.ok) {
        const json = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(json.error || `HTTP ${response.status}`);
      }
      await completeAction({
        message: `Stock returned for order #${o.orderNumber}`,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="bg-white border border-stone-900 border-t-0 rounded-b-xl shadow-md px-6 py-5"
      style={{
        background: "linear-gradient(180deg, #fff 0%, #FAF9F5 100%)",
      }}
    >
      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-800">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-7">
        <div>
          <div className="text-[10px] font-black tracking-widest text-stone-500 uppercase mb-3">
            Line items
          </div>
          <div className="space-y-1.5">
            {o.items.map((it) => {
              const parsedAddOns = showAddOnSetSnapshots
                ? parseAdminOrderAddOnSnapshots(
                    it.addonsJson,
                    it.addOnSetSelectionsJson,
                  )
                : { itemAddOns: [], addOnSets: [] };
              const legacyAddOns = Array.isArray(it.addonsJson)
                ? (it.addonsJson as Array<{ name?: unknown }>).flatMap((addOn) =>
                    typeof addOn.name === "string" ? [addOn.name] : [],
                  )
                : [];
              const itemAddOns = showAddOnSetSnapshots
                ? parsedAddOns.itemAddOns.map((addOn) => addOn.name)
                : legacyAddOns;
              const upgradeLabel = formatUpgradeForOrderRead(it);
              return (
                <div
                  key={it.id}
                  className="bg-white border border-stone-200 rounded-lg px-3 py-2.5 flex items-start gap-3"
                >
                  <div className="mono font-black text-[13px] text-stone-700 flex-shrink-0 mt-0.5 w-8 text-right">
                    ×{it.qty}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm text-stone-900 flex items-center gap-1.5 flex-wrap">
                      {it.nameSnapshot}
                      {upgradeLabel && (
                        <span
                          className="inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-black tracking-widest border"
                          style={{
                            background: "#FEF3C7",
                            color: "#92400E",
                            borderColor: "rgba(245,158,11,0.3)",
                          }}
                        >
                          {upgradeLabel}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-stone-500 mt-0.5">
                      {it.sizeName && <span>{it.sizeName}</span>}
                      {it.sizeName && itemAddOns.length > 0 && <span> · </span>}
                      {itemAddOns.length > 0 && <span>{itemAddOns.join(", ")}</span>}
                      {!it.sizeName &&
                        itemAddOns.length === 0 &&
                        (!showAddOnSetSnapshots ||
                          parsedAddOns.addOnSets.length === 0) && (
                          <span className="text-stone-400">—</span>
                        )}
                    </div>
                    {showAddOnSetSnapshots &&
                      parsedAddOns.addOnSets.length > 0 && (
                        <div
                          data-testid="workspace-order-add-on-set-snapshots"
                          className="mt-2 space-y-1.5"
                        >
                          {parsedAddOns.addOnSets.map((set) => (
                            <div
                              key={set.name}
                              data-testid="workspace-order-add-on-set-snapshot"
                              className="rounded-md border border-stone-200 bg-stone-50 px-2 py-1.5"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-[9px] font-black tracking-widest text-stone-500 uppercase">
                                    Add-on set
                                  </div>
                                  <div className="truncate text-xs font-black text-stone-900">
                                    {set.name}
                                  </div>
                                </div>
                                <div className="text-right text-[11px] font-bold text-stone-600">
                                  {set.options.length} selected
                                </div>
                              </div>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {set.options.map((option, index) => (
                                  <span
                                    key={`${set.name}-${option.name}-${index}`}
                                    className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-white px-2 py-0.5 text-[11px] font-bold text-stone-700"
                                  >
                                    {option.name}
                                    {option.priceDelta != null && option.priceDelta > 0 && (
                                      <span className="mono text-stone-500">
                                        +{fmt(option.priceDelta)}
                                      </span>
                                    )}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                  </div>
                  <div className="mono font-bold text-[13px] text-stone-700 flex-shrink-0">
                    {fmt(it.lineTotal)}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 pt-4 border-t border-stone-200 grid grid-cols-3 gap-4 text-xs">
            <div>
              <div className="text-[10px] font-black tracking-widest text-stone-500 uppercase">
                Subtotal
              </div>
              <div className="mono font-bold text-sm text-stone-900 mt-1">
                {fmt(o.subtotal)}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-black tracking-widest text-stone-500 uppercase">
                GST
              </div>
              <div className="mono font-bold text-sm text-stone-900 mt-1">
                {fmt(o.gst)}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-black tracking-widest text-stone-500 uppercase">
                Total
              </div>
              <div
                className="mono font-black text-base mt-1"
                style={{ color: BRAND.red }}
              >
                {fmt(o.total)}
              </div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-stone-200">
            <div className="text-[10px] font-black tracking-widest text-stone-500 uppercase mb-2">
              Payment
            </div>
            <div className="text-sm font-bold text-stone-900">
              {o.paymentProvider ?? "—"} · {o.paymentMethod ?? "—"} ·{" "}
              {o.paymentStatus ?? "—"}
            </div>
            {o.paymentTransactionId && (
              <div className="mono text-xs text-stone-500 mt-1">
                Session {o.paymentTransactionId}
              </div>
            )}
            {o.paymentReference && (
              <div className="mono text-xs text-stone-500 mt-0.5">
                Ref {o.paymentReference}
              </div>
            )}
            {o.paymentFailureMessage && (
              <div className="text-red-700 font-bold text-xs mt-2">
                {o.paymentFailureMessage}
              </div>
            )}
            {awaitingCounterPayment && (
              <div
                className="mt-2 text-xs font-bold rounded-md px-2 py-1.5"
                style={{
                  background: "#FEF3C7",
                  color: "#92400E",
                  borderLeft: "3px solid rgba(245,158,11,0.6)",
                }}
              >
                Collect cash first, then mark this order PAID to release it to
                the kitchen.
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-[10px] font-black tracking-widest text-stone-500 uppercase mb-1">
            Actions
          </div>
          {(["PAID", "IN_KITCHEN", "READY", "COMPLETED"] as const).map((s) => (
            <button
              key={s}
              disabled={busy || o.status === s}
              onClick={() => setStatus(s)}
              className="block w-full px-3 py-2 rounded-md text-xs font-black tracking-widest disabled:opacity-40"
              style={{
                background: o.status === s ? BRAND.yellow : BRAND.black,
                color: o.status === s ? BRAND.black : "white",
              }}
            >
              {awaitingCounterPayment && s === "PAID" ? "MARK PAID" : s}
            </button>
          ))}
          <button
            disabled={busy || o.status === "CANCELLED"}
            onClick={() => {
              if (confirm(`Cancel order #${o.orderNumber}?`)) {
                setStatus("CANCELLED");
              }
            }}
            className="block w-full px-3 py-2 rounded-md text-xs font-black tracking-widest disabled:opacity-40"
            style={{ background: "#B03A2E", color: "white" }}
          >
            CANCEL
          </button>
          <button
            disabled={
              busy ||
              o.status === "REFUNDED" ||
              !o.paymentStatus ||
              !["AUTHORIZED", "CAPTURED"].includes(o.paymentStatus)
            }
            onClick={() => {
              if (confirm(`Refund order #${o.orderNumber}?`)) {
                refundOrder();
              }
            }}
            className="block w-full px-3 py-2 rounded-md text-xs font-black tracking-widest disabled:opacity-40"
            style={{ background: "#1F4B99", color: "white" }}
          >
            REFUND PAYMENT
          </button>
          {o.hasQuantityStockRequirements && (
            <button
              disabled={busy || !canReturnStock}
              onClick={() => {
                if (
                  confirm(
                    `Return frozen quantity stock for order #${o.orderNumber}? This should only be used after staff confirms the items were not consumed.`
                  )
                ) {
                  returnStock();
                }
              }}
              className="block w-full px-3 py-2 rounded-md text-xs font-black tracking-widest disabled:opacity-40"
              style={{ background: "#2F6B3A", color: "white" }}
            >
              {o.manualStockReturnCompleted
                ? "STOCK RETURNED"
                : o.stockReturnedAutomatically
                  ? "AUTO-RETURNED"
                  : "RETURN STOCK"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
