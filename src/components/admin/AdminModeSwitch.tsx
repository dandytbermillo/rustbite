import Link from "next/link";
import {
  adminModePreferenceHref,
  type AdminMode,
} from "@/lib/admin/mode-preference";

function segmentClass(active: boolean) {
  return `rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-widest transition ${
    active
      ? "bg-yellow-400 text-stone-950"
      : "text-white/72 hover:bg-white/10 hover:text-white"
  }`;
}

export default function AdminModeSwitch({
  mode,
  workspaceNext = "/admin/workspace",
  classicNext = "/admin?mode=classic",
}: {
  mode: AdminMode;
  workspaceNext?: string;
  classicNext?: string;
}) {
  return (
    <nav
      data-testid="admin-mode-switch"
      className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 p-1"
      aria-label="Admin mode"
    >
      <Link
        href={adminModePreferenceHref({
          mode: "workspace",
          next: workspaceNext,
        })}
        data-testid="admin-mode-workspace"
        className={segmentClass(mode === "workspace")}
      >
        Workspace
      </Link>
      <Link
        href={adminModePreferenceHref({
          mode: "classic",
          next: classicNext,
        })}
        data-testid="admin-mode-classic"
        className={segmentClass(mode === "classic")}
      >
        Classic
      </Link>
    </nav>
  );
}
