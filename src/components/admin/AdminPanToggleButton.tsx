"use client";

import { Hand } from "lucide-react";

/**
 * Workspace canvas pan-mode toggle. When ON, the user can drag anywhere on
 * the canvas to pan it (widgets are non-interactive while pan is active so
 * the drag falls through to the canvas).
 *
 * Sticky activation — clicking pins pan ON until clicked again. Hold-Space
 * is the transient alternative (handled inside AdminWorkspaceCanvas, not
 * here).
 *
 * State (`isPanMode`) lives in AdminWorkspaceClient so the button and the
 * canvas's keyboard listener share a single source of truth. The toggle
 * function is also passed in because the modal-open guard runs inside it.
 *
 * See docs/admin-workspace-pan-and-scroll-plan-2026-05-09.md (v1.3).
 */
export default function AdminPanToggleButton({
  isPanMode,
  onToggle,
}: {
  isPanMode: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      data-testid="admin-pan-toggle"
      aria-label={isPanMode ? "Exit pan mode" : "Enter pan mode (or hold Space)"}
      aria-pressed={isPanMode}
      title={isPanMode ? "Exit pan mode" : "Pan mode (hold Space, or click)"}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-[12px] font-black ${
        isPanMode
          ? "border-yellow-400 bg-yellow-400 text-stone-950"
          : "border-white/10 bg-white/10 text-white/88 hover:bg-white/15"
      }`}
    >
      <Hand size={14} strokeWidth={2.5} aria-hidden />
      <span>{isPanMode ? "Pan ON" : "Pan"}</span>
    </button>
  );
}
