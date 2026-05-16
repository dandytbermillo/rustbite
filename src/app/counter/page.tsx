"use client";

import { useEffect, useState } from "react";
import { Banknote, CheckCircle2, Package, Utensils, XCircle } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { redirectToDeviceLogin } from "@/lib/device-client-auth";
import { fmt } from "@/lib/pricing";
import { formatOrderTypeLabel } from "@/lib/store-config";
import { formatUpgradeForOrderRead } from "@/lib/order-read";
import type { OrderSummary } from "@/lib/types";
import ActiveOperatorPanel, {
  whyOperatorActionDisabled,
  type ActiveOperator,
} from "@/components/active-operator/ActiveOperatorPanel";

const POLL_MS = 3000;
const COUNTER_STATUS = "AWAITING_COUNTER_PAYMENT";
const DEVICE_NEXT_PATH = "/counter";

function elapsed(iso: string): string {
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  );
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export default function CounterPage() {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [activeOperator, setActiveOperator] = useState<ActiveOperator | null>(
    null
  );
  const [operatorRefreshNonce, setOperatorRefreshNonce] = useState(0);
  const disabledReason = whyOperatorActionDisabled(activeOperator, "COUNTER");

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const response = await fetch(`/api/orders?status=${COUNTER_STATUS}`, {
          cache: "no-store",
        });
        if (response.status === 401) {
          redirectToDeviceLogin(DEVICE_NEXT_PATH);
          return;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = (await response.json()) as { orders: OrderSummary[] };
        if (!alive) return;
        const next = json.orders.sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        setOrders(next);
        setLastUpdated(new Date());
        setError(null);
      } catch (err) {
        if (alive) setError((err as Error).message);
      }
    };

    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const setStatus = async (id: string, status: "PAID" | "CANCELLED") => {
    setBusyId(id);
    try {
      setError(null);
      const response = await fetch(`/api/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (response.status === 401) {
        redirectToDeviceLogin(DEVICE_NEXT_PATH);
        return;
      }
      if (!response.ok) {
        const json = (await response.json().catch(() => ({}))) as {
          error?: string;
          errorCode?: string;
          operatorRequired?: boolean;
        };
        // Active-operator enforcement may have just cleared this device's
        // operator (idle expiry, role revoke, etc.). Re-fetch the panel
        // so it shows the new state and offers Sign in.
        if (json.operatorRequired || (response.status === 403 && json.errorCode)) {
          setOperatorRefreshNonce((n) => n + 1);
          throw new Error(
            json.error ||
              "Active operator required. Sign in again to continue."
          );
        }
        throw new Error(json.error || `HTTP ${response.status}`);
      }
      setOrders((prev) => prev.filter((order) => order.id !== id));
      setLastUpdated(new Date());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const totalDue = orders.reduce((sum, order) => sum + order.total, 0);

  return (
    <main
      className="min-h-screen p-6"
      style={{ background: BRAND.black, color: "white" }}
    >
      <header className="flex flex-col gap-4 mb-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div
            className="display text-3xl px-3 py-1 rounded-lg"
            style={{ background: "#2F6B35", color: "white" }}
          >
            CASH
          </div>
          <div>
            <div className="display text-3xl">COUNTER STATION</div>
            <div className="text-xs font-black tracking-widest opacity-60">
              COLLECT CASH AND RELEASE ORDERS TO THE KITCHEN
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs font-black tracking-widest">
          <span className="opacity-60">
            {orders.length} WAITING · {fmt(totalDue)} DUE
          </span>
          <span className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${error ? "bg-red-500" : "bg-green-400"}`}
            />
            {error ? "OFFLINE" : "LIVE"}
          </span>
          <span suppressHydrationWarning className="mono opacity-60">
            {lastUpdated ? lastUpdated.toLocaleTimeString() : "—"}
          </span>
        </div>
      </header>

      <ActiveOperatorPanel
        surfaceLabel="COUNTER"
        onChange={setActiveOperator}
        refreshKey={operatorRefreshNonce}
      />

      {error && (
        <div
          role="alert"
          className="mb-4 px-4 py-3 rounded-xl text-sm font-bold"
          style={{ background: "#5a0b0b", color: "white" }}
        >
          {error}
        </div>
      )}

      {orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <div className="text-7xl mb-4">💵</div>
          <div className="display text-5xl mb-2">No cash orders waiting</div>
          <div className="text-sm font-bold opacity-60 tracking-widest">
            COUNTER IS CLEAR · POLLING EVERY {POLL_MS / 1000}s
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-4">
          {orders.map((order) => (
            <article
              key={order.id}
              className="rounded-2xl overflow-hidden border border-white/10"
              style={{ background: "#1c1c1c" }}
            >
              <div
                className="flex items-center justify-between px-4 py-3"
                style={{ background: "#2F6B35", color: "white" }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="display px-3 py-1 rounded-lg text-3xl"
                    style={{ background: "rgba(0,0,0,0.3)", color: "#D7F5DA" }}
                  >
                    #{order.orderNumber}
                  </div>
                  <span className="inline-flex items-center gap-1 text-xs font-black tracking-widest uppercase">
                    {order.orderType === "DINE_IN" ? (
                      <>
                        <Utensils size={14} /> {formatOrderTypeLabel(order.orderType)}
                      </>
                    ) : (
                      <>
                        <Package size={14} /> {formatOrderTypeLabel(order.orderType)}
                      </>
                    )}
                  </span>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-black tracking-widest opacity-80">
                    CASH DUE
                  </div>
                  <div className="mono text-sm font-bold">{elapsed(order.createdAt)}</div>
                </div>
              </div>

              <div className="px-4 py-4 border-b border-white/10">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-xs font-black tracking-widest opacity-60 mb-1">
                      TOTAL DUE
                    </div>
                    <div className="display text-4xl" style={{ color: "#B8F2BE" }}>
                      {fmt(order.total)}
                    </div>
                  </div>
                  <div
                    className="px-3 py-2 rounded-xl text-xs font-black tracking-widest"
                    style={{ background: "#223F25", color: "#D7F5DA" }}
                  >
                    <Banknote size={16} className="inline mr-2" />
                    PAY AT COUNTER
                  </div>
                </div>
              </div>

              <div className="px-4 py-4 space-y-2">
                {order.items.map((item) => {
                  const additions = Array.isArray(item.addonsJson)
                    ? item.addonsJson.map((addon) => addon.name)
                    : [];
                  const upgradeLabel = formatUpgradeForOrderRead(item);
                  const modifiers = [
                    item.sizeName,
                    upgradeLabel,
                    additions.length > 0 ? additions.join(", ") : null,
                  ].filter(Boolean);

                  return (
                    <div key={item.id} className="text-white">
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="font-black text-lg leading-tight">
                          <span className="mono mr-2" style={{ color: BRAND.yellow }}>
                            ×{item.qty}
                          </span>
                          {item.nameSnapshot}
                        </div>
                        <div className="mono text-xs opacity-60">
                          {fmt(item.lineTotal)}
                        </div>
                      </div>
                      {modifiers.length > 0 && (
                        <div className="text-xs font-bold opacity-70 pl-6">
                          {modifiers.join(" · ")}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="px-4 py-4 flex gap-2 border-t border-white/10">
                <button
                  disabled={busyId === order.id || disabledReason !== null}
                  onClick={() => setStatus(order.id, "PAID")}
                  title={disabledReason ?? undefined}
                  className="btn-press flex-1 flex items-center justify-center gap-2 py-4 rounded-xl display text-lg disabled:opacity-40"
                  style={{ background: "#2F6B35", color: "white" }}
                >
                  <CheckCircle2 size={20} />
                  MARK CASH RECEIVED
                </button>
                <button
                  disabled={busyId === order.id || disabledReason !== null}
                  onClick={() => setStatus(order.id, "CANCELLED")}
                  title={disabledReason ?? undefined}
                  className="btn-press px-4 rounded-xl text-xs font-black tracking-widest disabled:opacity-40"
                  style={{ background: "#6E1E16", color: "white" }}
                >
                  <XCircle size={18} className="inline mr-2" />
                  CANCEL
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
