"use client";

import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { hasLanguage, STORE_CONFIG } from "@/lib/store-config";

export default function WelcomeScreen({ onStart }: { onStart: () => void }) {
  const [time, setTime] = useState<Date | null>(null);
  useEffect(() => {
    setTime(new Date());
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const floatingEmoji = ["🍔", "🍟", "🥤", "🍗", "🍦", "🌯", "🍩", "🧀"];
  const tickerMessages = [
    "🔥 2 FOR $6 MIX & MATCH",
    "🆕 TRY THE NEW POUTINE",
    `⚡ AVERAGE WAIT: ${STORE_CONFIG.prepMinutes} MINUTES`,
    "🎯 FAMILY BUNDLE $29.99",
    STORE_CONFIG.serviceModel === "TABLE_SERVICE"
      ? "💥 FREE REFILLS ON DINE-IN"
      : "📣 WATCH THE BOARD FOR PICKUP",
    "🍟 LARGE FRIES $3.29",
  ];

  return (
    <div
      onClick={onStart}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onStart(); }}
      aria-label="Tap to start order"
      className="min-h-screen relative overflow-hidden cursor-pointer flex flex-col"
      style={{ background: BRAND.red }}
    >
      <div className="absolute inset-0 noise-bg opacity-30" />

      {floatingEmoji.map((e, i) => (
        <div
          key={i}
          className="absolute text-6xl opacity-20 float-slow select-none pointer-events-none"
          style={{
            top: `${10 + (i * 11) % 80}%`,
            left: `${(i * 17) % 90}%`,
            animationDelay: `${i * 0.5}s`,
            animationDuration: `${5 + i}s`,
          }}
        >
          {e}
        </div>
      ))}

      <div className="relative z-10 flex items-center justify-between p-6 text-white">
        <div className="flex items-center gap-2">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-2xl"
            style={{ background: BRAND.yellow, color: BRAND.red }}
          >
            🍔
          </div>
          <div className="display text-2xl">
            {STORE_CONFIG.storeName.toUpperCase()}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={(e) => e.stopPropagation()}
            className="px-3 py-1 rounded-full text-xs font-bold bg-white/20 backdrop-blur-sm"
            aria-label="English"
          >
            EN
          </button>
          {hasLanguage("fr") && (
            <button
              onClick={(e) => e.stopPropagation()}
              className="px-3 py-1 rounded-full text-xs font-bold"
              aria-label="French"
            >
              FR
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center text-center px-8 relative z-10 fade-up">
        <div className="text-6xl mb-6 wiggle">🍔</div>
        <div className="text-white/90 text-xl font-bold tracking-widest mb-4">
          WELCOME TO RUSHBITE
        </div>
        <h1
          className="display text-white text-[8rem] md:text-[14rem] leading-[0.85] mb-6"
          style={{ textShadow: "0 8px 0 rgba(0,0,0,0.15)" }}
        >
          HOT
          <br />
          FRESH
          <br />
          <span style={{ color: BRAND.yellow }}>FAST.</span>
        </h1>
        <button
          onClick={onStart}
          className="pulse-big btn-press inline-flex items-center gap-3 px-16 py-7 rounded-full text-2xl font-black uppercase tracking-wide transition-all"
          style={{ background: BRAND.yellow, color: BRAND.black, boxShadow: "0 8px 0 rgba(0,0,0,0.2)" }}
        >
          Tap to Order <ChevronRight size={28} strokeWidth={3} />
        </button>
      </div>

      <div
        className="relative z-10 py-4 overflow-hidden"
        style={{ background: BRAND.yellow, color: BRAND.black }}
      >
        <div className="flex ticker whitespace-nowrap">
          {[...Array(2)].map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-8 px-4 font-black text-sm tracking-widest"
            >
              {tickerMessages.map((message) => (
                <span key={message}>
                  {message}
                  <span className="mx-8">•</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div
        className="relative z-10 flex items-center justify-between px-6 py-3 text-white text-xs font-bold tracking-widest"
        style={{ background: BRAND.redDark }}
      >
        <span>
          KIOSK #{STORE_CONFIG.kioskId} ·{" "}
          {STORE_CONFIG.storeLocation.toUpperCase()}
        </span>
        <span className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-400" /> OPEN NOW
        </span>
        <span suppressHydrationWarning>
          {time ? time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "--:--"}
        </span>
      </div>
    </div>
  );
}
