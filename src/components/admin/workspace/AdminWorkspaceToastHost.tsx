"use client";

import { X } from "lucide-react";

export type AdminWorkspaceToastTone = "success" | "error" | "info";

export type AdminWorkspaceToastInput = {
  message: string;
  tone?: AdminWorkspaceToastTone;
  durationMs?: number;
};

export type AdminWorkspaceToast = Required<
  Pick<AdminWorkspaceToastInput, "message" | "tone">
> & {
  id: number;
};

export type AdminWorkspaceNotify = (toast: AdminWorkspaceToastInput) => void;

function toastClasses(tone: AdminWorkspaceToastTone) {
  if (tone === "error") {
    return "border-red-200 bg-red-50 text-red-900";
  }
  if (tone === "info") {
    return "border-blue-200 bg-blue-50 text-blue-900";
  }
  return "border-emerald-200 bg-emerald-50 text-emerald-900";
}

function toneLabel(tone: AdminWorkspaceToastTone) {
  if (tone === "error") return "Error";
  if (tone === "info") return "Notice";
  return "Done";
}

export default function AdminWorkspaceToastHost({
  toasts,
  onDismiss,
}: {
  toasts: AdminWorkspaceToast[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div
      data-testid="admin-workspace-toast-region"
      className="pointer-events-none fixed bottom-5 left-1/2 z-[2147483647] grid w-[min(92vw,520px)] -translate-x-1/2 gap-2"
      aria-live="polite"
      aria-relevant="additions text"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          data-testid="admin-workspace-toast"
          role={toast.tone === "error" ? "alert" : "status"}
          className={`pointer-events-none flex items-center justify-between gap-3 rounded-full border px-4 py-3 shadow-2xl ${toastClasses(
            toast.tone,
          )}`}
        >
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-widest opacity-70">
              {toneLabel(toast.tone)}
            </div>
            <div className="truncate text-sm font-black">{toast.message}</div>
          </div>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            className="pointer-events-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-black/5"
            aria-label="Dismiss notification"
          >
            <X size={15} strokeWidth={2.5} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
