"use client";

import { useEffect, useRef, useState } from "react";
import DevicePresenceReporter from "@/components/device/DevicePresenceReporter";
import { BRAND } from "@/lib/brand";
import { redirectToDeviceLogin } from "@/lib/device-client-auth";
import { ACTIVE_KITCHEN_STATUSES } from "@/lib/order-status";
import type { OrderStatus, OrderSummary } from "@/lib/types";
import OrderCard from "@/components/kitchen/OrderCard";
import ActiveOperatorPanel, {
  whyOperatorActionDisabled,
  type ActiveOperator,
} from "@/components/active-operator/ActiveOperatorPanel";

const POLL_MS = 3000; // TODO: upgrade to SSE or WebSocket if latency becomes an issue.
const DEVICE_NEXT_PATH = "/kitchen";

export default function KitchenPage() {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  const [activeOperator, setActiveOperator] = useState<ActiveOperator | null>(
    null
  );
  const [operatorRefreshNonce, setOperatorRefreshNonce] = useState(0);
  const disabledReason = whyOperatorActionDisabled(activeOperator, "KITCHEN");

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(
          `/api/orders?status=${ACTIVE_KITCHEN_STATUSES.join(",")}`,
          { cache: "no-store" }
        );
        if (r.status === 401) {
          redirectToDeviceLogin(DEVICE_NEXT_PATH);
          return;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as { orders: OrderSummary[] };
        if (!alive) return;
        const fresh = j.orders.sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        const fresh_ids = new Set(fresh.map((o) => o.id));
        const flash = new Set<string>();
        for (const o of fresh) {
          if (!seenRef.current.has(o.id)) flash.add(o.id);
        }
        seenRef.current = fresh_ids;
        setOrders(fresh);
        if (flash.size) {
          setFlashIds(flash);
          setTimeout(() => setFlashIds(new Set()), 1000);
        }
        setLastUpdated(new Date());
        setError(null);
      } catch (err) {
        if (alive) setError((err as Error).message);
      }
    };
    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const advance = async (id: string, next: OrderStatus) => {
    // Snapshot the order before applying optimistic UI so we can roll
    // back if the backend rejects (e.g., operator was just invalidated by
    // a parallel cascade). Polling would eventually reconcile, but the
    // brief flash of an unauthorized transition is misleading to operators.
    const previousOrder = orders.find((o) => o.id === id) ?? null;
    setOrders((prev) =>
      next === "READY" || next === "CANCELLED"
        ? prev.filter((o) => o.id !== id)
        : prev.map((o) => (o.id === id ? { ...o, status: next } : o))
    );

    const rollback = () => {
      if (!previousOrder) return;
      setOrders((prev) => {
        if (prev.some((o) => o.id === id)) {
          return prev.map((o) => (o.id === id ? previousOrder : o));
        }
        return [...prev, previousOrder].sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
      });
    };

    try {
      const r = await fetch(`/api/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (r.status === 401) {
        rollback();
        redirectToDeviceLogin(DEVICE_NEXT_PATH);
        return;
      }
      if (!r.ok) {
        rollback();
        const json = (await r.json().catch(() => ({}))) as {
          error?: string;
          errorCode?: string;
          operatorRequired?: boolean;
        };
        if (json.operatorRequired || (r.status === 403 && json.errorCode)) {
          setOperatorRefreshNonce((n) => n + 1);
          throw new Error(
            json.error || "Active operator required. Sign in again."
          );
        }
        throw new Error(json.error || `Update failed: ${r.status}`);
      }
    } catch (err) {
      // rollback() may have already run above; if the throw came from a
      // network error, restore the previous state too.
      if (orders.some((o) => o.id === id) === false && previousOrder) {
        rollback();
      }
      setError((err as Error).message);
    }
  };

  return (
    <main className="min-h-screen p-6" style={{ background: BRAND.black, color: "white" }}>
      <DevicePresenceReporter surface="kitchen" />
      <header className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div
            className="display text-3xl px-3 py-1 rounded-lg"
            style={{ background: BRAND.red, color: "white" }}
          >
            KDS
          </div>
          <div className="display text-3xl">KITCHEN DISPLAY</div>
        </div>
        <div className="flex items-center gap-4 text-xs font-black tracking-widest">
          <span className="opacity-60">
            {orders.length} ACTIVE · {orders.filter((o) => o.status === "PAID").length} NEW
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
        surfaceLabel="KITCHEN"
        onChange={setActiveOperator}
        refreshKey={operatorRefreshNonce}
      />

      {error && (
        <div
          className="mb-4 px-4 py-3 rounded-xl text-sm font-bold"
          style={{ background: "#5a0b0b", color: "white" }}
          role="alert"
        >
          {error}
        </div>
      )}

      {orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <div className="text-7xl mb-4">🎉</div>
          <div className="display text-5xl mb-2">All caught up</div>
          <div className="text-sm font-bold opacity-60 tracking-widest">
            WAITING FOR ORDERS · POLLING EVERY {POLL_MS / 1000}s
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
          {orders.map((o) => (
            <OrderCard
              key={o.id}
              order={o}
              isNew={flashIds.has(o.id)}
              onAdvance={advance}
              disabledReason={disabledReason}
            />
          ))}
        </div>
      )}
    </main>
  );
}
