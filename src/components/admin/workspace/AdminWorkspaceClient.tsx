"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import AdminFullscreenButton from "@/components/admin/AdminFullscreenButton";
import AdminPanToggleButton from "@/components/admin/AdminPanToggleButton";
import DealHistoryBrowser from "@/components/admin/deals/DealHistoryBrowser";
import SettingsClient from "@/app/admin/settings/SettingsClient";
import MfaClient from "@/app/admin/security/mfa/MfaClient";
import type { AppSettings } from "@/lib/app-settings";
import type { DealHistoryEntry } from "@/lib/deal-history";
import type { AdminWorkspaceDashboardSummary } from "@/lib/admin/workspace/dashboard-summary";
import type { AdminWorkspaceDevicesSummary } from "@/lib/admin/workspace/devices-summary";
import type { AdminWorkspaceOrdersSummary } from "@/lib/admin/workspace/orders-summary";
import type { AdminWorkspaceMenuSummary } from "@/lib/admin/workspace/menu-summary";
import type {
  AdminOutletRow,
  AdminUserRow,
} from "@/lib/admin-user-management";
import {
  ADMIN_WORKSPACE_WIDGET_LABELS,
  adminWorkspaceWidgetFocusHref,
  type AdminWorkspaceWidgetAccess,
  type AdminWorkspaceWidgetId,
} from "@/lib/admin/workspace/layout";
import AdminWorkspaceCanvas from "./AdminWorkspaceCanvas";
import AdminWorkspaceToastHost, {
  type AdminWorkspaceNotify,
  type AdminWorkspaceToast,
} from "./AdminWorkspaceToastHost";
import WorkspaceDevicesPanel from "./WorkspaceDevicesPanel";
import UsersManagementPanel, {
  type UsersManagementPanelData,
} from "@/components/admin/users/UsersManagementPanel";

export type WorkspaceUtilityModal =
  | "dealHistory"
  | "settings"
  | "security"
  | "devices"
  | "users";

export type AdminWorkspaceUsersData = {
  users: AdminUserRow[];
  outlets: AdminOutletRow[];
  passwordPolicy: string;
  canManageSiteAdminAccounts: boolean;
};

function utilityModalSearchValue(modal: WorkspaceUtilityModal): string {
  return modal === "dealHistory" ? "deal-history" : modal;
}

function utilityModalAllowed(
  modal: WorkspaceUtilityModal | null,
  canReadDealHistory: boolean,
  canReadSettings: boolean,
  canReadDevices: boolean,
  canManageUsers: boolean,
): modal is WorkspaceUtilityModal {
  if (!modal) return false;
  if (modal === "dealHistory") return canReadDealHistory;
  if (modal === "settings") return canReadSettings;
  if (modal === "devices") return canReadDevices;
  if (modal === "users") return canManageUsers;
  return true;
}

export default function AdminWorkspaceClient({
  outletId,
  outletName,
  userId,
  userName,
  roleLabel,
  access,
  canWriteMenu,
  canManageUsers,
  canManageDevices,
  canReadDevices,
  canReadDealHistory,
  canReadSettings,
  initialFocusWidgetId,
  initialUtilityModal,
  initialDevicesModalDeviceId,
  dashboardSummary,
  ordersSummary,
  initialOrdersTargetOrderId,
  menuSummary,
  devicesSummary,
  usersData,
}: {
  outletId: string;
  outletName: string;
  userId: string;
  userName: string;
  roleLabel: string;
  access: AdminWorkspaceWidgetAccess[];
  canWriteMenu: boolean;
  canManageUsers: boolean;
  canManageDevices: boolean;
  canReadDevices: boolean;
  canReadDealHistory: boolean;
  canReadSettings: boolean;
  initialFocusWidgetId: AdminWorkspaceWidgetId | null;
  initialUtilityModal: WorkspaceUtilityModal | null;
  initialDevicesModalDeviceId: string | null;
  dashboardSummary: AdminWorkspaceDashboardSummary;
  ordersSummary: AdminWorkspaceOrdersSummary | null;
  initialOrdersTargetOrderId: string | null;
  menuSummary: AdminWorkspaceMenuSummary | null;
  devicesSummary: AdminWorkspaceDevicesSummary | null;
  usersData: AdminWorkspaceUsersData | null;
}) {
  const visibleCount = access.filter((entry) => entry.canView).length;
  const [currentDevicesSummary, setCurrentDevicesSummary] =
    useState(devicesSummary);
  const [currentUsersData, setCurrentUsersData] = useState(usersData);

  useEffect(() => {
    setCurrentDevicesSummary(devicesSummary);
  }, [devicesSummary]);

  useEffect(() => {
    setCurrentUsersData(usersData);
  }, [usersData]);

  const handleDevicesSummaryChange = useCallback(
    (nextSummary: AdminWorkspaceDevicesSummary) => {
      setCurrentDevicesSummary(nextSummary);
    },
    [],
  );

  const handleUsersChange = useCallback(
    (data: UsersManagementPanelData) => {
      setCurrentUsersData((current) =>
        current
          ? { ...current, users: data.users, outlets: data.outlets }
          : null,
      );
    },
    [],
  );

  // Pan-mode activation state. The button toggles "button" mode here; the
  // canvas's keyboard listener toggles "space" mode through setPanActivation.
  // See plan v1.3 step 3a for the state-ownership rationale.
  const [panActivation, setPanActivation] = useState<
    "space" | "button" | null
  >(null);
  const isPanMode = panActivation !== null;

  function togglePanFromButton() {
    // v1.3: capture modal-open state BEFORE setState updater (purity).
    const modalOpen = !!document.querySelector(
      '[role="dialog"][aria-modal="true"]',
    );
    setPanActivation((prev) => {
      if (prev === "button") return null; // exit always allowed
      if (modalOpen) return prev; // can't enter while modal open
      return "button";
    });
  }

  // Adaptive overflow detection for the workspace toolbar. When the inline
  // widget nav doesn't fit on a single row, collapse it into a "More ⋯"
  // dropdown. Hysteresis prevents oscillation: re-expand only when the
  // container has grown ~80px past the width at which it collapsed.
  const headerInnerRef = useRef<HTMLDivElement | null>(null);
  const collapseWidthRef = useRef<number | null>(null);
  const [navCollapsed, setNavCollapsed] = useState(false);

  // Toolbar widget-focus jump bar. Click → in-page focus + reveal of the
  // target widget; URL/pan/dropdown side effects fire only after the canvas
  // commits the request via onToolbarFocusCommitted. See plan in
  // docs/admin-workspace-toolbar-widget-focus-plan-2026-05-10.md.
  const [toolbarFocusRequest, setToolbarFocusRequest] = useState<{
    id: AdminWorkspaceWidgetId;
    requestId: number;
  } | null>(null);
  const toolbarFocusRequestIdRef = useRef(0);
  const navOverflowDetailsRef = useRef<HTMLDetailsElement | null>(null);
  // Pending "close on mouse-leave" timer for the More overflow menu.
  // The dropdown panel sits 8 px below the summary (mt-2), so a naïve
  // close-on-mouseleave would snap shut mid-traversal as the cursor
  // crosses that gap. A small delay lets mouseenter on the panel cancel
  // the close before it fires.
  const overflowCloseTimerRef = useRef<number | null>(null);
  const [activeUtilityModal, setActiveUtilityModal] =
    useState<WorkspaceUtilityModal | null>(
      utilityModalAllowed(
        initialUtilityModal,
        canReadDealHistory,
        canReadSettings,
        canReadDevices,
        canManageUsers,
      )
        ? initialUtilityModal
        : null,
    );
  const [menuUtilityRequest, setMenuUtilityRequest] = useState<{
    id: number;
    action:
      | { type: "openDealHistory" }
      | { type: "restoreDealFromHistory"; entry: DealHistoryEntry };
  } | null>(null);
  const menuUtilityRequestIdRef = useRef(0);
  const [toasts, setToasts] = useState<AdminWorkspaceToast[]>([]);
  const toastIdRef = useRef(0);
  const toastTimersRef = useRef<Map<number, number>>(new Map());

  const dismissToast = useCallback((id: number) => {
    const timer = toastTimersRef.current.get(id);
    if (timer) window.clearTimeout(timer);
    toastTimersRef.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback<AdminWorkspaceNotify>(
    ({ message, tone = "success", durationMs }) => {
      const id = ++toastIdRef.current;
      setToasts((current) => [
        ...current.filter((toast) => toast.message !== message).slice(-2),
        { id, message, tone },
      ]);

      const timer = window.setTimeout(
        () => dismissToast(id),
        durationMs ?? (tone === "error" ? 6000 : 3200),
      );
      toastTimersRef.current.set(id, timer);
    },
    [dismissToast],
  );

  function openOverflowMenu() {
    if (overflowCloseTimerRef.current !== null) {
      window.clearTimeout(overflowCloseTimerRef.current);
      overflowCloseTimerRef.current = null;
    }
    // setAttribute is a no-op when already open, so this is safe to
    // call from every mouseenter (e.g. re-entries through the dropdown
    // panel after a brief mouseleave on the summary).
    navOverflowDetailsRef.current?.setAttribute("open", "");
  }

  function scheduleOverflowClose() {
    if (overflowCloseTimerRef.current !== null) {
      window.clearTimeout(overflowCloseTimerRef.current);
    }
    overflowCloseTimerRef.current = window.setTimeout(() => {
      navOverflowDetailsRef.current?.removeAttribute("open");
      overflowCloseTimerRef.current = null;
    }, 250);
  }

  function closeOverflowMenuNow() {
    if (overflowCloseTimerRef.current !== null) {
      window.clearTimeout(overflowCloseTimerRef.current);
      overflowCloseTimerRef.current = null;
    }
    navOverflowDetailsRef.current?.removeAttribute("open");
  }

  function replaceWorkspaceModalParam(modal: WorkspaceUtilityModal | null): void {
    const url = new URL(window.location.href);
    if (modal) {
      url.searchParams.set("modal", utilityModalSearchValue(modal));
      if (modal !== "devices") url.searchParams.delete("device");
    } else {
      url.searchParams.delete("modal");
      url.searchParams.delete("device");
    }
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  // Clear any pending close-timer on unmount so it doesn't fire after
  // the component is gone and touch a stale ref.
  useEffect(() => {
    return () => {
      if (overflowCloseTimerRef.current !== null) {
        window.clearTimeout(overflowCloseTimerRef.current);
      }
      for (const timer of toastTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      toastTimersRef.current.clear();
    };
  }, []);

  function requestWidgetFocus(id: AdminWorkspaceWidgetId): void {
    // Modal-open: silent no-op (matches togglePanFromButton precedent).
    // Caught here in addition to canvas-side guards because if a modal is
    // open we don't want pan/URL/dropdown to change either, and the canvas
    // effect doesn't know about modals.
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    setToolbarFocusRequest({
      id,
      requestId: ++toolbarFocusRequestIdRef.current,
    });
    // No URL update / pan exit / dropdown close here — those happen only
    // when the canvas accepts the request (see onToolbarFocusCommitted).
  }

  function openUtilityModal(modal: WorkspaceUtilityModal): void {
    if (
      !utilityModalAllowed(
        modal,
        canReadDealHistory,
        canReadSettings,
        canReadDevices,
        canManageUsers,
      )
    ) {
      return;
    }
    setPanActivation(null);
    closeOverflowMenuNow();
    setActiveUtilityModal(modal);
    replaceWorkspaceModalParam(modal);
  }

  function closeUtilityModal(): void {
    setActiveUtilityModal(null);
    replaceWorkspaceModalParam(null);
  }

  function restoreDealFromHistoryInWorkspace(entry: DealHistoryEntry): void {
    setPanActivation(null);
    setActiveUtilityModal(null);
    replaceWorkspaceModalParam(null);
    setMenuUtilityRequest({
      id: ++menuUtilityRequestIdRef.current,
      action: { type: "restoreDealFromHistory", entry },
    });
  }

  function onToolbarFocusCommitted(id: AdminWorkspaceWidgetId): void {
    // Auto-exit sticky pan mode so the focused widget is interactive.
    setPanActivation(null);
    // Soft URL update — no Next routing, no server work.
    window.history.replaceState(null, "", adminWorkspaceWidgetFocusHref(id));
    // Defer dropdown close to next frame to avoid interrupting any React
    // event-batching inside the canvas's commit pathway.
    requestAnimationFrame(() => {
      navOverflowDetailsRef.current?.removeAttribute("open");
    });
  }

  useEffect(() => {
    const el = headerInnerRef.current;
    if (!el) return;

    const decide = () => {
      if (!el) return;
      const overflowing = el.scrollWidth > el.clientWidth + 1;
      const currentWidth = el.clientWidth;
      setNavCollapsed((prev) => {
        if (prev) {
          const collapseAt = collapseWidthRef.current;
          if (collapseAt !== null && currentWidth > collapseAt + 80) {
            collapseWidthRef.current = null;
            return false;
          }
          return true;
        }
        if (overflowing) {
          collapseWidthRef.current = currentWidth;
          return true;
        }
        return false;
      });
    };

    decide();
    const ro = new ResizeObserver(decide);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const visibleWidgetAccess = access.filter((entry) => entry.canView);

  return (
    <div className="h-screen overflow-hidden bg-stone-950">
      <header
        data-testid="admin-workspace-header"
        // High z so the header (and any dropdown panels inside it like
        // "More ⋯") always paint above the canvas widgets, even if
        // localStorage has a legacy widget zIndex above the previous
        // header z-40. New focuses are bounded by the canvas's
        // focusWidget renormalize, but persisted state from before that
        // fix can be anything.
        className="sticky top-0 z-[100] border-b-4 px-5 py-3 text-white shadow-sm"
        style={{ background: BRAND.black, borderColor: BRAND.yellow }}
      >
        <div
          ref={headerInnerRef}
          // overflow-x-clip (not overflow-hidden): clip horizontal so
          // the responsive ResizeObserver collapse detection still
          // triggers when content gets too wide, but leave vertical
          // overflow visible so the "More ⋯" dropdown panel — which
          // renders position:absolute below the summary, inside this
          // div — isn't clipped at the header's bottom edge.
          className="flex flex-nowrap items-center gap-3 overflow-x-clip"
        >
          <Link
            href="/admin/workspace"
            className="shrink-0 text-xl font-black tracking-tight"
            style={{ color: BRAND.yellow }}
          >
            RushBite
          </Link>
          <Link
            href="/admin/select-outlet"
            data-testid="admin-workspace-active-outlet"
            className="shrink-0 rounded-full border border-white/12 bg-white/10 px-3 py-2 text-[13px] font-black text-white/88 hover:bg-white/15 whitespace-nowrap"
          >
            {outletName}
          </Link>
          {!navCollapsed ? (
            <nav
              className="flex flex-nowrap items-center gap-1 rounded-full border border-white/10 bg-white/5 p-1"
              aria-label="Workspace quick links"
            >
              {visibleWidgetAccess.map((entry) => (
                <a
                  key={entry.id}
                  // href preserved so middle/Cmd/Ctrl/Shift/Alt-click still
                  // open the deep-link in a new tab via the browser default;
                  // the onClick below intercepts only normal left-click.
                  href={adminWorkspaceWidgetFocusHref(entry.id)}
                  data-testid={`admin-workspace-link-${entry.id}`}
                  onClick={(event) => {
                    if (
                      event.button !== 0 ||
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey
                    )
                      return;
                    event.preventDefault();
                    requestWidgetFocus(entry.id);
                  }}
                  className="rounded-full px-4 py-2 text-[13px] font-black text-white/72 hover:bg-white/10 hover:text-white whitespace-nowrap"
                >
                  {ADMIN_WORKSPACE_WIDGET_LABELS[entry.id]}
                </a>
              ))}
              <WorkspaceMoreMenu
                canReadDealHistory={canReadDealHistory}
                canReadSettings={canReadSettings}
                canReadDevices={canReadDevices}
                canManageUsers={canManageUsers}
                onOpenUtility={openUtilityModal}
              />
            </nav>
          ) : (
            <details
              ref={navOverflowDetailsRef}
              className="group relative shrink-0"
              data-testid="admin-workspace-nav-overflow"
              // Hover-to-open: fire on cursor entry (mouseenter, not
              // mousemove — we only want a one-shot open trigger), and
              // schedule a delayed close on exit so the cursor can
              // cross the 8 px gap between summary and dropdown panel.
              // Native click-to-toggle still works alongside this.
              onMouseEnter={openOverflowMenu}
              onMouseLeave={scheduleOverflowClose}
            >
              <summary
                aria-label="Workspace menu"
                className="cursor-pointer list-none inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[13px] font-black text-white/72 hover:bg-white/10 hover:text-white whitespace-nowrap"
              >
                <span>More</span>
                <span aria-hidden className="text-[14px] leading-none">⋯</span>
              </summary>
              <div className="absolute left-0 z-50 mt-2 grid min-w-44 gap-1 rounded-xl border border-white/10 bg-neutral-950 p-2 shadow-2xl">
                {visibleWidgetAccess.map((entry) => (
                  <a
                    key={entry.id}
                    href={adminWorkspaceWidgetFocusHref(entry.id)}
                    data-testid={`admin-workspace-link-${entry.id}`}
                    onClick={(event) => {
                      if (
                        event.button !== 0 ||
                        event.metaKey ||
                        event.ctrlKey ||
                        event.shiftKey ||
                        event.altKey
                      )
                        return;
                      event.preventDefault();
                      requestWidgetFocus(entry.id);
                    }}
                    className="rounded-full px-4 py-2 text-[13px] font-black text-white/72 hover:bg-white/10 hover:text-white whitespace-nowrap"
                  >
                    {ADMIN_WORKSPACE_WIDGET_LABELS[entry.id]}
                  </a>
                ))}
                <div className="mt-1 border-t border-white/10 pt-1">
                  <WorkspaceMoreLinks
                    canReadDealHistory={canReadDealHistory}
                    canReadSettings={canReadSettings}
                    canReadDevices={canReadDevices}
                    canManageUsers={canManageUsers}
                    onOpenUtility={openUtilityModal}
                    compact
                  />
                </div>
              </div>
            </details>
          )}
          <div className="flex-1 min-w-0" />
          <div className="shrink-0">
            <AdminPanToggleButton
              isPanMode={isPanMode}
              onToggle={togglePanFromButton}
            />
          </div>
          <div className="shrink-0">
            <AdminFullscreenButton />
          </div>
          <span className="shrink-0 rounded-full bg-yellow-400/20 px-3 py-1 text-[12px] font-black tracking-widest text-yellow-300">
            V1
          </span>
          <span
            data-testid="admin-workspace-user-pill"
            className="shrink-0 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-2 text-[13px] font-black text-white/90"
          >
            {userName}
            <span
              data-testid="admin-workspace-role-pill"
              className="rounded-full px-2 py-0.5 text-[11px] font-black tracking-widest"
              style={{ background: BRAND.yellow, color: BRAND.black }}
            >
              {roleLabel.toUpperCase()}
            </span>
          </span>
        </div>
      </header>

      <main className="h-[calc(100vh-76px)] overflow-hidden">
        <AdminWorkspaceCanvas
          outletId={outletId}
          userId={userId}
          access={access}
          canWriteMenu={canWriteMenu}
          canManageDevices={canManageDevices}
          initialFocusWidgetId={initialFocusWidgetId}
          visibleWidgetCount={visibleCount}
          dashboardSummary={dashboardSummary}
          ordersSummary={ordersSummary}
          initialOrdersTargetOrderId={initialOrdersTargetOrderId}
          menuSummary={menuSummary}
          devicesSummary={currentDevicesSummary}
          devicesWidgetAutoRefresh={activeUtilityModal !== "devices"}
          notify={notify}
          onDevicesSummaryChange={handleDevicesSummaryChange}
          panActivation={panActivation}
          setPanActivation={setPanActivation}
          toolbarFocusRequest={toolbarFocusRequest}
          menuUtilityRequest={menuUtilityRequest}
          onToolbarFocusCommitted={onToolbarFocusCommitted}
        />
      </main>
      {activeUtilityModal && (
        <WorkspaceUtilityDialog
          modal={activeUtilityModal}
          canWriteMenu={canWriteMenu}
          canManageDevices={canManageDevices}
          devicesSummary={currentDevicesSummary}
          usersData={currentUsersData}
          initialDevicesModalDeviceId={initialDevicesModalDeviceId}
          notify={notify}
          onDevicesSummaryChange={handleDevicesSummaryChange}
          onUsersChange={handleUsersChange}
          onRestoreDeal={restoreDealFromHistoryInWorkspace}
          onClose={closeUtilityModal}
        />
      )}
      <AdminWorkspaceToastHost toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

function WorkspaceMoreMenu({
  canReadDealHistory,
  canReadSettings,
  canReadDevices,
  canManageUsers,
  onOpenUtility,
}: {
  canReadDealHistory: boolean;
  canReadSettings: boolean;
  canReadDevices: boolean;
  canManageUsers: boolean;
  onOpenUtility: (modal: WorkspaceUtilityModal) => void;
}) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    function closeIfOutside(event: MouseEvent | FocusEvent) {
      const details = detailsRef.current;
      const target = event.target;
      if (!details?.open || !(target instanceof Node)) return;
      if (!details.contains(target)) details.removeAttribute("open");
    }

    document.addEventListener("mousedown", closeIfOutside);
    document.addEventListener("focusin", closeIfOutside);
    return () => {
      document.removeEventListener("mousedown", closeIfOutside);
      document.removeEventListener("focusin", closeIfOutside);
    };
  }, []);

  return (
    <details
      ref={detailsRef}
      data-testid="admin-workspace-more-menu"
      className="group relative shrink-0"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.currentTarget.removeAttribute("open");
        event.currentTarget.querySelector("summary")?.focus();
      }}
    >
      <summary
        data-testid="admin-workspace-more-trigger"
        className="cursor-pointer list-none rounded-full px-4 py-2 text-[13px] font-black text-white/72 hover:bg-white/10 hover:text-white whitespace-nowrap"
      >
        More
      </summary>
      <div
        data-testid="admin-workspace-more-menu-panel"
        className="absolute left-0 z-50 mt-2 grid min-w-56 gap-2 rounded-[22px] border border-white/10 bg-neutral-950 p-3 shadow-2xl"
      >
        <WorkspaceMoreLinks
          canReadDealHistory={canReadDealHistory}
          canReadSettings={canReadSettings}
          canReadDevices={canReadDevices}
          canManageUsers={canManageUsers}
          onOpenUtility={(modal) => {
            detailsRef.current?.removeAttribute("open");
            onOpenUtility(modal);
          }}
        />
      </div>
    </details>
  );
}

function WorkspaceMoreLinks({
  canReadDealHistory,
  canReadSettings,
  canReadDevices,
  canManageUsers,
  onOpenUtility,
  compact = false,
}: {
  canReadDealHistory: boolean;
  canReadSettings: boolean;
  canReadDevices: boolean;
  canManageUsers: boolean;
  onOpenUtility: (modal: WorkspaceUtilityModal) => void;
  compact?: boolean;
}) {
  const actions = [
    ...(canReadDealHistory
      ? [
          {
            modal: "dealHistory" as const,
            label: "Deal history",
            testId: "deal-history",
          },
        ]
      : []),
    ...(canReadDevices
      ? [
          {
            modal: "devices" as const,
            label: "Manage devices",
            testId: "manage-devices",
          },
        ]
      : []),
    ...(canManageUsers
      ? [
          {
            modal: "users" as const,
            label: "Manage users",
            testId: "manage-users",
          },
        ]
      : []),
    ...(canReadSettings
      ? [
          {
            modal: "settings" as const,
            label: "Settings",
            testId: "settings",
          },
        ]
      : []),
    { modal: "security" as const, label: "Security", testId: "security" },
  ];
  const actionClass = compact
    ? "w-full rounded-full px-4 py-2 text-left text-[13px] font-black text-white/72 hover:bg-white/10 hover:text-white whitespace-nowrap"
    : "w-full rounded-[18px] px-5 py-3 text-left text-[15px] font-black text-white hover:bg-white/10";
  const buttonClass = compact
    ? "w-full rounded-full px-4 py-2 text-left text-[13px] font-black text-white/72 hover:bg-white/10 hover:text-white whitespace-nowrap"
    : "w-full rounded-[18px] px-5 py-3 text-left text-[15px] font-black text-white hover:bg-white/10";

  return (
    <>
      {actions.map((action, index) => (
        <button
          key={action.modal}
          type="button"
          onClick={() => onOpenUtility(action.modal)}
          data-testid={`admin-workspace-more-${action.testId}`}
          className={`${actionClass} ${!compact && index === 0 ? "bg-white/10" : ""}`}
        >
          {action.label}
        </button>
      ))}
      <form action="/api/admin/auth/logout" method="POST">
        <button data-testid="admin-workspace-more-sign-out" className={buttonClass}>
          Sign out
        </button>
      </form>
    </>
  );
}

function WorkspaceUtilityDialog({
  modal,
  canWriteMenu,
  canManageDevices,
  devicesSummary,
  usersData,
  initialDevicesModalDeviceId,
  notify,
  onDevicesSummaryChange,
  onUsersChange,
  onRestoreDeal,
  onClose,
}: {
  modal: WorkspaceUtilityModal;
  canWriteMenu: boolean;
  canManageDevices: boolean;
  devicesSummary: AdminWorkspaceDevicesSummary | null;
  usersData: AdminWorkspaceUsersData | null;
  initialDevicesModalDeviceId: string | null;
  notify: AdminWorkspaceNotify;
  onDevicesSummaryChange: (summary: AdminWorkspaceDevicesSummary) => void;
  onUsersChange: (data: UsersManagementPanelData) => void;
  onRestoreDeal: (entry: DealHistoryEntry) => void;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [devicesDirty, setDevicesDirty] = useState(false);
  const [usersDirty, setUsersDirty] = useState(false);
  const title =
    modal === "dealHistory"
      ? "Deal history"
      : modal === "settings"
        ? "Settings"
        : modal === "devices"
          ? "Devices"
          : modal === "users"
            ? "Users"
            : "Security";

  const requestClose = useCallback(() => {
    if (
      modal === "devices" &&
      devicesDirty &&
      !window.confirm(
        "Discard unsaved device changes? Your changes will not be saved.",
      )
    ) {
      return;
    }
    if (
      modal === "users" &&
      usersDirty &&
      !window.confirm(
        "Discard unsaved user changes? Your changes will not be saved.",
      )
    ) {
      return;
    }
    onClose();
  }, [devicesDirty, modal, onClose, usersDirty]);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") requestClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [requestClose]);

  useEffect(() => {
    setDevicesDirty(false);
    setUsersDirty(false);
  }, [modal]);

  return (
    <div
      className="fixed inset-0 z-[240] bg-black/55 p-4 backdrop-blur-sm sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-utility-dialog-title"
        data-testid={`admin-workspace-${modal}-modal`}
        className="mx-auto flex h-full max-h-[calc(100vh-2rem)] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-stone-200 bg-stone-50 text-stone-950 shadow-2xl sm:max-h-[calc(100vh-3rem)]"
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-stone-200 bg-white px-6 py-5">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.22em] text-stone-500">
              Workspace
            </div>
            <h2
              id="workspace-utility-dialog-title"
              className="mt-1 text-3xl font-black tracking-tight"
            >
              {title}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={requestClose}
            data-testid="admin-workspace-utility-modal-close"
            className="rounded-full border border-stone-300 bg-white px-5 py-3 text-xs font-black uppercase tracking-widest text-stone-800 hover:border-stone-950 hover:bg-stone-950 hover:text-white"
          >
            Close
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {modal === "dealHistory" ? (
            <WorkspaceDealHistoryPanel
              canWriteMenu={canWriteMenu}
              onRestoreDeal={onRestoreDeal}
            />
          ) : modal === "settings" ? (
            <WorkspaceSettingsPanel />
          ) : modal === "devices" ? (
            devicesSummary ? (
              <WorkspaceDevicesPanel
                initialSummary={devicesSummary}
                notify={notify}
                variant="modal"
                autoRefresh
                initialDeviceId={initialDevicesModalDeviceId}
                canManageDevices={canManageDevices}
                onDirtyChange={setDevicesDirty}
                onSummaryChange={onDevicesSummaryChange}
              />
            ) : (
              <WorkspaceUtilityError message="Device summary is not available for this role." />
            )
          ) : modal === "users" ? (
            usersData ? (
              <UsersManagementPanel
                initialUsers={usersData.users}
                initialOutlets={usersData.outlets}
                passwordPolicy={usersData.passwordPolicy}
                canManageSiteAdminAccounts={usersData.canManageSiteAdminAccounts}
                variant="workspace-modal"
                notify={notify}
                onDirtyChange={setUsersDirty}
                onUsersChange={onUsersChange}
              />
            ) : (
              <WorkspaceUtilityError message="User management is not available for this role." />
            )
          ) : (
            <MfaClient showHeader={false} />
          )}
        </div>
      </section>
    </div>
  );
}

function WorkspaceDealHistoryPanel({
  canWriteMenu,
  onRestoreDeal,
}: {
  canWriteMenu: boolean;
  onRestoreDeal: (entry: DealHistoryEntry) => void;
}) {
  const [entries, setEntries] = useState<DealHistoryEntry[] | null>(null);
  const [serverNowIso, setServerNowIso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    fetch("/api/admin/deals/history?limit=100", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body?.error ?? "Could not load deal history.");
        }
        return response.json() as Promise<{
          entries: DealHistoryEntry[];
          serverNowIso: string;
        }>;
      })
      .then((body) => {
        setEntries(body.entries);
        setServerNowIso(body.serverNowIso);
      })
      .catch((err) => {
        if ((err as Error).name === "AbortError") return;
        setError((err as Error).message);
      });
    return () => controller.abort();
  }, []);

  if (error) return <WorkspaceUtilityError message={error} />;
  if (!entries || !serverNowIso) return <WorkspaceUtilityLoading label="deal history" />;

  return (
    <DealHistoryBrowser
      entries={entries}
      serverNowIso={serverNowIso}
      canWriteMenu={canWriteMenu}
      title="Deal history"
      subtitle="Choose a previous setup and restore it as an editable Workspace draft."
      showTitle={false}
      useAgainLabel="Restore as draft"
      onUseAgain={canWriteMenu ? onRestoreDeal : undefined}
    />
  );
}

function WorkspaceSettingsPanel() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    fetch("/api/admin/settings", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body?.error ?? "Could not load settings.");
        }
        return response.json() as Promise<{ settings: AppSettings }>;
      })
      .then((body) => setSettings(body.settings))
      .catch((err) => {
        if ((err as Error).name === "AbortError") return;
        setError((err as Error).message);
      });
    return () => controller.abort();
  }, []);

  if (error) return <WorkspaceUtilityError message={error} />;
  if (!settings) return <WorkspaceUtilityLoading label="settings" />;

  return <SettingsClient initialSettings={settings} showHeader={false} />;
}

function WorkspaceUtilityLoading({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-8 text-sm font-black text-stone-600">
      Loading {label}...
    </div>
  );
}

function WorkspaceUtilityError({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-sm font-black text-red-700">
      {message}
    </div>
  );
}
