"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { lockBodyScroll } from "@/lib/body-scroll-lock";

export default function PreviewOverlay({
  slug,
  onClose,
}: {
  slug: string | null;
  onClose: () => void;
}) {
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const exitButtonRef = useRef<HTMLButtonElement | null>(null);

  // Body scroll lock + focus capture/restore — keyed only on whether the
  // preview is open (`slug != null`). Splitting these from the keyboard
  // handler prevents cleanup/re-run cycles when `onClose` ref changes,
  // which used to leave body.overflow stuck on "hidden" and steal focus
  // mid-session.
  useEffect(() => {
    if (!slug) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const release = lockBodyScroll();
    // Focus the exit button so keyboard users have a clear exit affordance.
    exitButtonRef.current?.focus();
    return () => {
      release();
      previousFocusRef.current?.focus();
    };
  }, [slug]);

  // Esc handler. Cheap to rebind when `onClose` ref changes; never touches
  // body.overflow.
  useEffect(() => {
    if (!slug) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [slug, onClose]);

  if (!slug) return null;

  const url = `/kiosk/preview?category=${encodeURIComponent(slug)}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Kiosk preview"
      className="fixed inset-0 z-50 bg-black"
    >
      <iframe
        key={slug}
        src={url}
        title="Kiosk preview"
        className="w-full h-full border-0"
        sandbox="allow-scripts allow-same-origin allow-forms"
      />
      <button
        ref={exitButtonRef}
        type="button"
        onClick={onClose}
        aria-label="Exit preview"
        className="absolute top-4 right-4 z-10 inline-flex items-center gap-2 rounded-full bg-black/85 px-4 py-2 text-xs font-black tracking-widest text-white shadow-lg ring-1 ring-white/20 hover:bg-black focus:outline-none focus:ring-2 focus:ring-white"
      >
        <X size={16} strokeWidth={3} />
        EXIT PREVIEW
      </button>
    </div>
  );
}
