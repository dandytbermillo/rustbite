"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { lockBodyScroll } from "@/lib/body-scroll-lock";

type Props = {
  titleNode: ReactNode;
  subtitle?: string;
  headerMeta?: ReactNode;
  body: ReactNode;
  footer: ReactNode;
  onClose: () => void;
  ariaLabel?: string;
  maxWidthClassName?: string;
  bodyClassName?: string;
};

// Shared modal chrome: header (with close), scrollable body, sticky footer.
// Body content drives layout (the editors render their own two-column grid).
export default function ModalShell({
  titleNode,
  subtitle,
  headerMeta,
  body,
  footer,
  onClose,
  ariaLabel,
  maxWidthClassName = "max-w-[1240px]",
  bodyClassName = "flex-1 min-h-0 overflow-y-auto",
}: Props) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Body scroll lock — runs once on mount via the shared ref-counted lock
  // so stacked overlays (modal + picker, modal + kiosk preview) don't leave
  // body.overflow stuck on "hidden" when they close out-of-order.
  useEffect(() => lockBodyScroll(), []);

  // Capture previous focus, focus first autofocus target, restore on unmount.
  // Mount-only — focus restoration must NOT re-fire when onClose changes,
  // otherwise focus jumps every parent render.
  useEffect(() => {
    if (!mounted) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current
      ?.querySelector<HTMLElement>("[data-modal-autofocus]")
      ?.focus();
    return () => {
      previousFocusRef.current?.focus();
    };
  }, [mounted]);

  // Esc-to-close. Re-binds when onClose changes; this is cheap (no DOM
  // mutation) and never touches body.overflow.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const modal = (
    <div
      className="fixed inset-0 z-[260] flex items-center justify-center p-4 sm:p-6"
      style={{ background: "rgba(20,20,20,0.45)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className={`w-full ${maxWidthClassName} max-h-[calc(100vh-32px)] flex flex-col bg-white rounded-3xl shadow-2xl overflow-hidden`}
      >
        <header className="flex items-start justify-between gap-6 px-8 py-2.5 border-b border-stone-100">
          <div className="min-w-0 flex-1">
            <div className="flex items-end gap-3 flex-wrap">
              <div className="min-w-0">{titleNode}</div>
              {headerMeta && (
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {headerMeta}
                </div>
              )}
            </div>
            {subtitle && (
              <p className="mt-1 text-sm text-stone-500">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex items-center justify-center w-10 h-10 rounded-full text-stone-700 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2"
            style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
          >
            <X size={20} strokeWidth={2.5} />
          </button>
        </header>

        <div className={bodyClassName}>{body}</div>

        <footer className="flex flex-wrap items-center justify-between gap-4 px-8 py-4 border-t border-stone-100 bg-white">
          {footer}
        </footer>
      </div>
    </div>
  );

  if (!mounted) return null;
  return createPortal(modal, document.body);
}
