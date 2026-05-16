"use client";

import { useEffect } from "react";
import { Check, ChevronRight, Clock } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { fmt } from "@/lib/pricing";
import { getConfirmationMessage, STORE_CONFIG } from "@/lib/store-config";
import type { OrderStatus, OrderType, PaymentMethod } from "@/lib/types";

export default function ConfirmationScreen({
  orderNumber,
  total,
  orderType,
  orderStatus,
  paymentMethod,
  onDone,
}: {
  orderNumber: string;
  total: number;
  orderType: OrderType;
  orderStatus: OrderStatus;
  paymentMethod: PaymentMethod | null;
  onDone: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onDone, STORE_CONFIG.orderResetSeconds * 1000);
    return () => clearTimeout(t);
  }, [onDone]);

  const awaitingCounterPayment =
    paymentMethod === "CASH" && orderStatus === "AWAITING_COUNTER_PAYMENT";
  const heading = awaitingCounterPayment
    ? "PAY AT THE COUNTER"
    : "ENJOY YOUR MEAL!";
  const message = awaitingCounterPayment
    ? "Please pay at the counter. We'll start preparing after payment is collected."
    : getConfirmationMessage(orderType);
  const amountLabel = awaitingCounterPayment
    ? "TOTAL DUE AT COUNTER"
    : STORE_CONFIG.paymentMode === "TERMINAL"
      ? "TOTAL PAID"
      : "ORDER TOTAL";
  const footer = awaitingCounterPayment
    ? "PAYMENT STILL REQUIRED AT COUNTER"
    : STORE_CONFIG.paymentMode !== "TERMINAL"
      ? "DEMO MODE · PAYMENT NOT CAPTURED"
      : null;

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden p-8"
      style={{ background: BRAND.red }}
    >
      <div className="absolute inset-0 noise-bg opacity-30" />

      {["🎉", "🍔", "🍟", "🥤", "✨", "🎊"].map((e, i) => (
        <div
          key={i}
          className="absolute text-6xl float-slow opacity-30 select-none pointer-events-none"
          style={{
            top: `${15 + (i * 15) % 70}%`,
            left: `${(i * 19) % 85}%`,
            animationDelay: `${i * 0.4}s`,
          }}
        >
          {e}
        </div>
      ))}

      <div className="relative z-10 text-center px-4 fade-up">
        <div
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full mb-6"
          style={{ background: BRAND.yellow, color: BRAND.black }}
        >
          <Check size={18} strokeWidth={3} />
          <span className="text-sm font-black tracking-widest">
            {awaitingCounterPayment ? "ORDER CREATED" : "ORDER CONFIRMED"}
          </span>
        </div>

        <h2 className="display text-5xl md:text-7xl text-white mb-3">{heading}</h2>
        <p className="text-xl text-white/90 mb-10 font-bold">{message}</p>

        <div
          className="inline-block bg-white rounded-3xl p-8 md:p-10 mb-8"
          style={{ boxShadow: "0 20px 0 rgba(0,0,0,0.2)" }}
        >
          <div className="text-xs font-black tracking-widest opacity-60 mb-3">
            YOUR ORDER NUMBER
          </div>
          <div
            className="display text-[7rem] md:text-[12rem] leading-none mb-4"
            style={{ color: BRAND.red, textShadow: `6px 6px 0 ${BRAND.yellow}` }}
          >
            {orderNumber}
          </div>
          <div className="flex items-center justify-center gap-2 text-lg font-black">
            <Clock size={20} strokeWidth={3} />
            <span>
              {awaitingCounterPayment
                ? "PAY AT COUNTER TO START PREP"
                : `READY IN ~${STORE_CONFIG.prepMinutes} MIN`}
            </span>
          </div>
          <div className="mt-4 pt-4 border-t-2 border-dashed border-stone-300">
            <div className="text-xs font-black tracking-widest opacity-60 mb-1">{amountLabel}</div>
            <div className="display text-3xl">{fmt(total)}</div>
          </div>
        </div>

        <button
          onClick={onDone}
          className="btn-press inline-flex items-center gap-2 px-8 py-4 rounded-full display text-lg"
          style={{ background: BRAND.yellow, color: BRAND.black, boxShadow: "0 6px 0 rgba(0,0,0,0.2)" }}
        >
          NEW ORDER <ChevronRight size={20} strokeWidth={3} />
        </button>

        <div className="mt-6 text-white/70 text-xs font-bold tracking-widest">
          AUTO-RESET IN {STORE_CONFIG.orderResetSeconds} SECONDS
        </div>
        {footer && (
          <div className="mt-3 text-white/70 text-xs font-bold tracking-widest">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
