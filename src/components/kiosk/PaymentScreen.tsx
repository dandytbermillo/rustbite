"use client";

import { useState } from "react";
import { Banknote, ChevronRight, CreditCard, Smartphone } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { fmt } from "@/lib/pricing";
import { STORE_CONFIG } from "@/lib/store-config";
import type { PaymentMethod } from "@/lib/types";
import TopBar from "./TopBar";

type Method = { id: PaymentMethod; label: string; sub: string; accent: string; icon: React.ReactNode };

export default function PaymentScreen({
  total,
  onPay,
  onBack,
  error,
  statusText,
}: {
  total: number;
  onPay: (method: PaymentMethod) => Promise<void> | void;
  onBack: () => void;
  error?: string | null;
  statusText?: string | null;
}) {
  const [selected, setSelected] = useState<PaymentMethod | null>(null);
  const [processing, setProcessing] = useState(false);

  const methods: Method[] = ([
    { id: "CARD", label: "Card / Contactless", sub: "Tap or insert", accent: BRAND.red, icon: <CreditCard size={48} strokeWidth={1.8} /> },
    { id: "MOBILE", label: "Mobile Pay", sub: "Apple · Google · Samsung", accent: BRAND.black, icon: <Smartphone size={48} strokeWidth={1.8} /> },
    { id: "CASH", label: "Pay at Counter", sub: "Cash accepted", accent: "#3a7d44", icon: <Banknote size={48} strokeWidth={1.8} /> },
  ] satisfies Method[]).filter((method) =>
    STORE_CONFIG.paymentMethods.includes(method.id)
  );

  const handlePay = async () => {
    if (!selected || processing) return;
    setProcessing(true);
    try {
      await onPay(selected);
    } finally {
      setProcessing(false);
    }
  };

  const isCounterPayment = selected === "CASH";
  const actionLabel = isCounterPayment
    ? "SEND TO COUNTER"
    : STORE_CONFIG.paymentMode === "TERMINAL"
      ? `PAY ${fmt(total)}`
      : "PLACE DEMO ORDER";

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar onBack={onBack} step={4} />
      <div
        className="flex-1 flex flex-col items-center justify-center p-8 fade-up"
        style={{ background: BRAND.gray }}
      >
        <div className="text-center mb-10">
          <div
            className="inline-block px-3 py-1 rounded-full text-xs font-black tracking-widest mb-3"
            style={{ background: BRAND.yellow }}
          >
            {isCounterPayment
              ? "PAY AT COUNTER"
              : STORE_CONFIG.paymentMode === "TERMINAL"
              ? "ALMOST DONE"
              : "DEMO CHECKOUT"}
          </div>
          <h2 className="display text-5xl md:text-6xl mb-4">How will you pay?</h2>
          <div className="display text-6xl md:text-7xl" style={{ color: BRAND.red }}>
            {fmt(total)}
          </div>
        </div>

        {isCounterPayment ? (
          <div
            role="status"
            className="mb-6 px-5 py-3 rounded-xl font-bold text-sm max-w-2xl text-center"
            style={{
              background: "#E4F2E6",
              color: BRAND.black,
              border: "2px solid #3a7d44",
            }}
          >
            Cash orders stay on hold until staff collect payment and mark them
            paid in admin.
          </div>
        ) : STORE_CONFIG.paymentMode !== "TERMINAL" ? (
          <div
            role="status"
            className="mb-6 px-5 py-3 rounded-xl font-bold text-sm max-w-2xl text-center"
            style={{
              background: "#FFF0B8",
              color: BRAND.black,
              border: `2px solid ${BRAND.yellowDark}`,
            }}
          >
            Demo mode is enabled. Orders will be created, but no live payment
            will be captured until a terminal integration is added.
          </div>
        ) : null}

        <div className="grid md:grid-cols-3 gap-4 w-full max-w-5xl mb-8">
          {methods.map((m) => {
            const active = selected === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setSelected(m.id)}
                disabled={processing}
                aria-pressed={active}
                aria-label={m.label}
                className={`btn-press tile-hover p-8 rounded-2xl text-center transition-all ${active ? "scale-105" : ""}`}
                style={{
                  background: active ? m.accent : "white",
                  color: active ? "white" : BRAND.black,
                  boxShadow: active ? "0 8px 0 rgba(0,0,0,0.15)" : "0 4px 0 rgba(0,0,0,0.08)",
                }}
              >
                <div className="mb-4 flex justify-center">{m.icon}</div>
                <div className="display text-2xl mb-1">{m.label.toUpperCase()}</div>
                <div className="text-sm font-bold opacity-70">{m.sub}</div>
                {active && (
                  <div className="mt-4 text-xs font-black tracking-widest">✓ SELECTED</div>
                )}
              </button>
            );
          })}
        </div>

        {error && (
          <div
            role="alert"
            className="mb-6 px-5 py-3 rounded-xl font-bold text-sm"
            style={{ background: "#FFE3E0", color: BRAND.redDark, border: `2px solid ${BRAND.red}` }}
          >
            {error}
          </div>
        )}

        <button
          onClick={handlePay}
          disabled={!selected || processing}
          aria-busy={processing}
          className="btn-press inline-flex items-center gap-3 px-14 py-6 rounded-2xl display text-2xl transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          style={{
            background: BRAND.red,
            color: "white",
            boxShadow: selected ? "0 8px 0 rgba(0,0,0,0.2)" : "none",
          }}
        >
          {processing ? (
            <>
              <div className="w-6 h-6 border-4 border-white border-t-transparent rounded-full animate-spin" />
              {statusText ??
                (isCounterPayment
                  ? "SENDING ORDER…"
                  : STORE_CONFIG.paymentMode === "TERMINAL"
                  ? "PROCESSING…"
                  : "CREATING ORDER…")}
            </>
          ) : (
            <>
              {actionLabel}{" "}
              <ChevronRight size={28} strokeWidth={3} />
            </>
          )}
        </button>

        {statusText && (
          <div className="mt-4 text-sm font-bold opacity-70 text-center">
            {statusText}
          </div>
        )}

        <div className="mt-10 flex gap-6 text-xs font-black tracking-widest opacity-60">
          {isCounterPayment ? (
            <>
              <span>💵 COLLECT AT COUNTER</span>
              <span>🧾 CASH STILL DUE</span>
              <span>👩‍🍳 PREP STARTS AFTER PAYMENT</span>
            </>
          ) : STORE_CONFIG.paymentMode === "TERMINAL" ? (
            <>
              <span>💳 READER READY</span>
              <span>📟 LIVE AUTH</span>
              <span>🧾 PAYMENT CAPTURED</span>
            </>
          ) : (
            <>
              <span>🧪 DEMO MODE</span>
              <span>🚫 NO LIVE CHARGE</span>
              <span>📟 TERMINAL REQUIRED</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
