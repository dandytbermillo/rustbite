"use client";

import { Sparkles, Star, Flame } from "lucide-react";
import { BRAND } from "@/lib/brand";
import type { Badge } from "@/lib/types";

export default function BadgeChip({ badge }: { badge: Badge }) {
  if (!badge) return null;
  const config: Record<string, { bg: string; fg: string; icon: React.ReactNode }> = {
    NEW:     { bg: BRAND.yellow, fg: BRAND.black,  icon: <Sparkles size={11} strokeWidth={2.5} /> },
    POPULAR: { bg: BRAND.red,    fg: "white",      icon: <Star size={11} strokeWidth={2.5} /> },
    DEAL:    { bg: BRAND.black,  fg: BRAND.yellow, icon: <Flame size={11} strokeWidth={2.5} /> },
    HOT:     { bg: "#FF4500",    fg: "white",      icon: <Flame size={11} strokeWidth={2.5} /> },
  };
  const c = config[badge];
  if (!c) return null;
  return (
    <span
      className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] tracking-widest font-black uppercase rounded-full"
      style={{ background: c.bg, color: c.fg }}
    >
      {c.icon} {badge}
    </span>
  );
}
