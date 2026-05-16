"use client";

import { useEffect, useState } from "react";
import { Type } from "lucide-react";

const CLASS = "text-lg-boost";
const KEY = "rb.largeText";

export default function LargeTextToggle() {
  const [on, setOn] = useState(false);

  useEffect(() => {
    const stored = typeof window !== "undefined" && window.localStorage.getItem(KEY) === "1";
    if (stored) {
      document.documentElement.classList.add(CLASS);
      setOn(true);
    }
  }, []);

  const toggle = () => {
    const next = !on;
    setOn(next);
    if (next) document.documentElement.classList.add(CLASS);
    else document.documentElement.classList.remove(CLASS);
    try {
      window.localStorage.setItem(KEY, next ? "1" : "0");
    } catch {}
  };

  return (
    <button
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? "Turn off larger text" : "Turn on larger text"}
      className="fixed bottom-4 right-4 z-50 btn-press flex items-center gap-2 px-4 py-3 rounded-full text-xs font-black tracking-widest shadow-lg min-h-[48px]"
      style={{
        background: on ? "#141414" : "white",
        color: on ? "#FFBE0B" : "#141414",
        border: "2px solid #141414",
      }}
    >
      <Type size={16} strokeWidth={3} />
      {on ? "LARGER TEXT: ON" : "LARGER TEXT"}
    </button>
  );
}
