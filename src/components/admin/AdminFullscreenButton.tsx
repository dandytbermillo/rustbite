"use client";

import { useEffect, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";

/**
 * Toggles browser fullscreen via the Fullscreen API. Hides the address bar,
 * tabs, and bookmarks bar so the admin app gets the entire viewport. ESC
 * exits (browser default).
 *
 * Why a separate client component: AdminShell is an async server component
 * and cannot use useState/useEffect directly.
 *
 * Why feature-detect: older browsers and some embedded webviews don't
 * implement requestFullscreen on documentElement; rendering the button when
 * it can't work is just user-hostile noise.
 */
export default function AdminFullscreenButton() {
  const [supported, setSupported] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const el = document.documentElement;
    setSupported(typeof el.requestFullscreen === "function");

    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    onChange();
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  if (!supported) return null;

  const toggle = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void document.documentElement.requestFullscreen();
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      data-testid="admin-fullscreen-toggle"
      aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
      aria-pressed={isFullscreen}
      title={isFullscreen ? "Exit fullscreen (Esc)" : "Enter fullscreen"}
      className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/10 px-3 py-2 text-[12px] font-black text-white/88 hover:bg-white/15"
    >
      {isFullscreen ? (
        <Minimize2 size={14} strokeWidth={2.5} aria-hidden />
      ) : (
        <Maximize2 size={14} strokeWidth={2.5} aria-hidden />
      )}
      <span>{isFullscreen ? "Exit" : "Fullscreen"}</span>
    </button>
  );
}
