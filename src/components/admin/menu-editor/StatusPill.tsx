"use client";

import { BRAND } from "@/lib/brand";

type Tone = "live" | "hidden" | "oos";

const TONES: Record<Tone, { bg: string; fg: string; dot?: boolean }> = {
  live:   { bg: BRAND.black,    fg: BRAND.yellow, dot: true },
  hidden: { bg: "#ececea",      fg: "#44403c" },
  oos:    { bg: BRAND.red,      fg: "white" },
};

export default function StatusPill({
  tone,
  children,
}: {
  tone: Tone;
  children: React.ReactNode;
}) {
  const { bg, fg, dot } = TONES[tone];
  return (
    <span
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-black tracking-widest uppercase"
      style={{ background: bg, color: fg }}
    >
      {dot && <span className="live-dot" aria-hidden />}
      {children}
    </span>
  );
}

export function MetaChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-stone-100 border border-stone-200 text-xs text-stone-700">
      {children}
    </span>
  );
}
