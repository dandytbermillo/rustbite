"use client";

import { useEffect, useRef, useState } from "react";
import DevicePresenceReporter from "@/components/device/DevicePresenceReporter";
import { BRAND } from "@/lib/brand";
import { redirectToDeviceLogin } from "@/lib/device-client-auth";
import { BOARD_ACTIVE_STATUSES } from "@/lib/order-status";
import type { OrderSummary } from "@/lib/types";

const POLL_MS = 3000; // TODO: upgrade to SSE or WebSocket if latency becomes an issue.
const DEVICE_NEXT_PATH = "/board";

function playChime() {
  try {
    const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [660, 990].forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, now + i * 0.18);
      g.gain.linearRampToValueAtTime(0.18, now + i * 0.18 + 0.02);
      g.gain.linearRampToValueAtTime(0, now + i * 0.18 + 0.45);
      o.connect(g).connect(ctx.destination);
      o.start(now + i * 0.18);
      o.stop(now + i * 0.18 + 0.5);
    });
  } catch {
    /* ignore — audio is a nice-to-have */
  }
}

export default function BoardPage() {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const readyRef = useRef<Set<string>>(new Set());
  const primedRef = useRef(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(
          `/api/orders?status=${BOARD_ACTIVE_STATUSES.join(",")}`,
          { cache: "no-store" }
        );
        if (r.status === 401) {
          redirectToDeviceLogin(DEVICE_NEXT_PATH);
          return;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as { orders: OrderSummary[] };
        if (!alive) return;
        const next = j.orders;

        const newlyReady = new Set<string>();
        for (const o of next) {
          if (o.status === "READY" && !readyRef.current.has(o.id)) newlyReady.add(o.id);
        }
        if (primedRef.current && newlyReady.size > 0) playChime();
        readyRef.current = new Set(next.filter((o) => o.status === "READY").map((o) => o.id));
        primedRef.current = true;

        setOrders(next);
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

  const awaitingPayment = orders.filter(
    (o) => o.status === "AWAITING_COUNTER_PAYMENT"
  );
  const preparing = orders.filter((o) => o.status === "IN_KITCHEN");
  const ready = orders.filter((o) => o.status === "READY");

  const kioskId = process.env.NEXT_PUBLIC_KIOSK_ID ?? "01";
  const storeName = process.env.NEXT_PUBLIC_STORE_NAME ?? "Rushbite";

  return (
    <main className="min-h-screen flex flex-col" style={{ background: BRAND.black, color: "white" }}>
      <DevicePresenceReporter surface="board" />
      <header
        className="flex items-center justify-between px-8 py-4 border-b-4"
        style={{ background: BRAND.redDark, borderColor: BRAND.yellow }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center text-3xl"
            style={{ background: BRAND.yellow, color: BRAND.red }}
          >
            🍔
          </div>
          <div>
            <div className="display text-3xl">{storeName.toUpperCase()}</div>
            <div className="text-xs font-black tracking-widest opacity-70">
              ORDER STATUS · KIOSK #{kioskId}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs font-black tracking-widest">
          <span
            className={`w-2.5 h-2.5 rounded-full ${error ? "bg-red-500" : "bg-green-400"}`}
          />
          {error ? "RECONNECTING…" : "LIVE"}
        </div>
      </header>

      <div className="flex-1 grid md:grid-cols-3 gap-0">
        <section className="flex flex-col">
          <div
            className="px-8 py-4 text-center"
            style={{ background: "#2F6B35", color: "white" }}
          >
            <div className="display text-4xl md:text-5xl">AWAITING PAYMENT</div>
            <div className="text-xs font-black tracking-widest opacity-90">
              PLEASE PAY AT THE COUNTER
            </div>
          </div>
          <div className="flex-1 p-8">
            {awaitingPayment.length === 0 ? (
              <div className="display text-4xl opacity-20 text-center mt-12">—</div>
            ) : (
              <div className="grid grid-cols-2 gap-6">
                {awaitingPayment.map((o) => (
                  <div
                    key={o.id}
                    className="display rounded-2xl py-8 text-center fade-up"
                    style={{
                      background: "#1f3f23",
                      color: "#B8F2BE",
                      fontSize: "clamp(4rem, 8vw, 8rem)",
                      lineHeight: 1,
                      boxShadow: "0 10px 0 rgba(0,0,0,0.35)",
                    }}
                  >
                    {o.orderNumber}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="flex flex-col">
          <div
            className="px-8 py-4 text-center"
            style={{ background: BRAND.yellow, color: BRAND.black }}
          >
            <div className="display text-4xl md:text-5xl">PREPARING</div>
            <div className="text-xs font-black tracking-widest opacity-70">YOUR ORDER IS BEING MADE</div>
          </div>
          <div className="flex-1 p-8">
            {preparing.length === 0 ? (
              <div className="display text-4xl opacity-20 text-center mt-12">—</div>
            ) : (
              <div className="grid grid-cols-2 gap-6">
                {preparing.map((o) => (
                  <div
                    key={o.id}
                    className="display rounded-2xl py-8 text-center fade-up"
                    style={{
                      background: "#2a2a2a",
                      color: BRAND.yellow,
                      fontSize: "clamp(4rem, 8vw, 8rem)",
                      lineHeight: 1,
                    }}
                  >
                    {o.orderNumber}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="flex flex-col">
          <div
            className="px-8 py-4 text-center"
            style={{ background: BRAND.red, color: "white" }}
          >
            <div className="display text-4xl md:text-5xl">READY FOR PICKUP</div>
            <div className="text-xs font-black tracking-widest opacity-90">COME GET IT!</div>
          </div>
          <div className="flex-1 p-8">
            {ready.length === 0 ? (
              <div className="display text-4xl opacity-20 text-center mt-12">—</div>
            ) : (
              <div className="grid grid-cols-2 gap-6">
                {ready.map((o) => (
                  <div
                    key={o.id}
                    className="display rounded-2xl py-8 text-center pulse-ready fade-up"
                    style={{
                      background: BRAND.yellow,
                      color: BRAND.red,
                      fontSize: "clamp(4rem, 8vw, 8rem)",
                      lineHeight: 1,
                      boxShadow: "0 10px 0 rgba(0,0,0,0.35)",
                    }}
                  >
                    {o.orderNumber}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      <footer
        className="py-3 px-8 text-center text-xs font-black tracking-widest"
        style={{ background: BRAND.redDark, color: "white" }}
      >
        HOT · FRESH · FAST · ENJOY YOUR MEAL
      </footer>
    </main>
  );
}
