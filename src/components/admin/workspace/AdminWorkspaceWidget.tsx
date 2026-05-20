"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowLeft,
  GripHorizontal,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { BRAND } from "@/lib/brand";
import type { AdminWorkspaceDashboardSummary } from "@/lib/admin/workspace/dashboard-summary";
import type { AdminWorkspaceDevicesSummary } from "@/lib/admin/workspace/devices-summary";
import type { AdminWorkspaceMenuSummary } from "@/lib/admin/workspace/menu-summary";
import type { AdminWorkspaceOrdersSummary } from "@/lib/admin/workspace/orders-summary";
import type { WorkspaceSystemStatusSummary } from "@/lib/admin/workspace/system-status-model";
import {
  ADMIN_WORKSPACE_WIDGET_LABELS,
  type AdminWorkspaceLayoutWidget,
  type AdminWorkspaceWidgetId,
} from "@/lib/admin/workspace/layout";
import DashboardAttentionPanel, {
  type DashboardAttentionSelection,
} from "@/components/admin/dashboard/DashboardAttentionPanel";
import AdminWorkspaceDashboardWidget, {
  type AdminWorkspaceDashboardOrdersOpenRequest,
} from "./AdminWorkspaceDashboardWidget";
import AdminWorkspaceDevicesWidget from "./AdminWorkspaceDevicesWidget";
import AdminWorkspaceMenuWidget, {
  type AdminWorkspaceMenuFocusRequest,
} from "./AdminWorkspaceMenuWidget";
import AdminWorkspaceOrdersWidget, {
  type AdminWorkspaceOrdersFocusRequest,
} from "./AdminWorkspaceOrdersWidget";
import AdminWorkspaceSystemStatusWidget from "./AdminWorkspaceSystemStatusWidget";
import type { AdminWorkspaceNotify } from "./AdminWorkspaceToastHost";

function PlaceholderBody({
  widget,
  canWriteMenu,
  canManageDevices,
  dashboardSummary,
  systemStatusSummary,
  ordersSummary,
  initialOrdersTargetOrderId,
  ordersFocusRequest,
  menuSummary,
  menuFocusRequest,
  devicesSummary,
  devicesAutoRefresh,
  notify,
  onDevicesSummaryChange,
  onDashboardOrdersOpen,
  onAttentionItemSelect,
  widgetWidth,
  widgetHeight,
}: {
  widget: AdminWorkspaceLayoutWidget;
  canWriteMenu: boolean;
  canManageDevices: boolean;
  dashboardSummary: AdminWorkspaceDashboardSummary;
  systemStatusSummary: WorkspaceSystemStatusSummary;
  ordersSummary: AdminWorkspaceOrdersSummary | null;
  initialOrdersTargetOrderId: string | null;
  ordersFocusRequest: AdminWorkspaceOrdersFocusRequest | null;
  menuSummary: AdminWorkspaceMenuSummary | null;
  menuFocusRequest: AdminWorkspaceMenuFocusRequest | null;
  devicesSummary: AdminWorkspaceDevicesSummary | null;
  devicesAutoRefresh: boolean;
  notify: AdminWorkspaceNotify;
  onDevicesSummaryChange: (summary: AdminWorkspaceDevicesSummary) => void;
  onDashboardOrdersOpen: (
    request: AdminWorkspaceDashboardOrdersOpenRequest,
  ) => void;
  onAttentionItemSelect: (
    selection: DashboardAttentionSelection,
  ) => boolean | void;
  widgetWidth: number;
  widgetHeight: number;
}) {
  if (widget.id === "dashboard") {
    return (
      <AdminWorkspaceDashboardWidget
        summary={dashboardSummary}
        widgetWidth={widgetWidth}
        widgetHeight={widgetHeight}
        onOpenOrders={onDashboardOrdersOpen}
      />
    );
  }

  if (widget.id === "status") {
    return <AdminWorkspaceSystemStatusWidget summary={systemStatusSummary} />;
  }

  if (widget.id === "attention") {
    return (
      <div
        data-testid="workspace-attention-real-data"
        className="admin-widget-scroll grid h-full content-start gap-3 overflow-auto overscroll-contain"
      >
        <DashboardAttentionPanel
          summary={dashboardSummary.attention}
          outletName={dashboardSummary.outletName}
          onItemSelect={onAttentionItemSelect}
        />
      </div>
    );
  }

  if (widget.id === "orders") {
    if (ordersSummary) {
      return (
        <AdminWorkspaceOrdersWidget
          summary={ordersSummary}
          initialTargetOrderId={initialOrdersTargetOrderId}
          focusRequest={ordersFocusRequest}
          notify={notify}
        />
      );
    }

    return (
      <div className="grid h-full content-start gap-3 overflow-hidden">
        <div className="flex flex-wrap gap-2">
          {["All", "Payment", "Kitchen", "Ready"].map((label) => (
            <span
              key={label}
              className="rounded-full border border-stone-200 bg-white px-3 py-1 text-[10px] font-black uppercase tracking-widest text-stone-600"
            >
              {label}
            </span>
          ))}
        </div>
        <div className="grid gap-2">
          {[1, 2, 3].map((index) => (
            <div
              key={index}
              className="grid grid-cols-[92px_minmax(0,1fr)_76px] items-center gap-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2"
            >
              <span className="font-mono text-sm font-black text-stone-950">
                #--
              </span>
              <span className="truncate text-sm font-bold text-stone-500">
                Order row placeholder
              </span>
              <span className="text-right font-mono text-sm font-black text-stone-400">
                --
              </span>
            </div>
          ))}
        </div>
        <p className="text-sm font-semibold text-stone-600">
          Real order rows and target highlighting come in the Orders widget
          slice.
        </p>
      </div>
    );
  }

  if (widget.id === "devices") {
    if (devicesSummary) {
      return (
        <AdminWorkspaceDevicesWidget
          summary={devicesSummary}
          notify={notify}
          autoRefresh={devicesAutoRefresh}
          onSummaryChange={onDevicesSummaryChange}
        />
      );
    }

    return (
      <div className="grid h-full content-start gap-3 overflow-hidden">
        <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
          <div className="text-[10px] font-black uppercase tracking-widest text-stone-500">
            Device health
          </div>
          {dashboardSummary.deviceHealth ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {[
                ["Online", dashboardSummary.deviceHealth.online],
                ["Idle", dashboardSummary.deviceHealth.idle],
                ["Offline", dashboardSummary.deviceHealth.offline],
                ["Disabled", dashboardSummary.deviceHealth.disabled],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md bg-white px-2 py-2">
                  <div className="font-mono text-lg font-black text-stone-950">
                    {value}
                  </div>
                  <div className="text-[9px] font-black uppercase tracking-widest text-stone-500">
                    {label}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-2 text-sm font-semibold text-stone-600">
              This role cannot read device status for this outlet.
            </div>
          )}
        </div>
        <p className="text-sm font-semibold leading-relaxed text-stone-600">
          Device management uses the existing secured device routes and
          permission checks.
        </p>
        {!canManageDevices && (
          <div className="rounded-lg border border-dashed border-stone-300 bg-white px-3 py-2 text-xs font-bold text-stone-500">
            Device management requires device manage permission.
          </div>
        )}
      </div>
    );
  }

  if (widget.id === "menu") {
    if (menuSummary) {
      return (
        <AdminWorkspaceMenuWidget
          summary={menuSummary}
          focusRequest={menuFocusRequest}
          canWriteMenu={canWriteMenu}
          notify={notify}
        />
      );
    }

    return (
      <div className="grid h-full content-start gap-3 overflow-hidden">
        <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
          <div className="text-[10px] font-black uppercase tracking-widest text-stone-500">
            Menu
          </div>
          <div className="mt-2 text-lg font-black text-stone-950">
            No menu access
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid h-full content-start gap-3 overflow-hidden">
      <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
        <div className="text-[10px] font-black uppercase tracking-widest text-stone-500">
          Menu mode
        </div>
        <div className="mt-2 text-lg font-black text-stone-950">
          {canWriteMenu ? "Read/write allowed" : "Read-only"}
        </div>
      </div>
      <div className="grid gap-2">
        {["Categories", "Items", "Attention"].map((label) => (
          <div
            key={label}
            className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-bold text-stone-600"
          >
            {label} placeholder
          </div>
        ))}
      </div>
      <p className="text-sm font-semibold leading-relaxed text-stone-600">
        V1 keeps Menu as a safe placeholder/read-only target. Full editing
        should be embedded only after modal and dirty-state guards exist.
      </p>
    </div>
  );
}

export default function AdminWorkspaceWidget({
  widget,
  active,
  dragging,
  resizing,
  resizePreview,
  canWriteMenu,
  canManageDevices,
  dashboardSummary,
  systemStatusSummary,
  ordersSummary,
  initialOrdersTargetOrderId,
  ordersFocusRequest,
  menuSummary,
  menuFocusRequest,
  devicesSummary,
  devicesAutoRefresh,
  notify,
  onDevicesSummaryChange,
  returnTarget,
  isMaximized,
  onDashboardOrdersOpen,
  onAttentionItemSelect,
  onReturnToWidget,
  onFocus,
  onDragStart,
  onResizeStart,
  onToggleMaximize,
}: {
  widget: AdminWorkspaceLayoutWidget;
  active: boolean;
  dragging: boolean;
  resizing: boolean;
  resizePreview: { width: number; height: number } | null;
  canWriteMenu: boolean;
  canManageDevices: boolean;
  dashboardSummary: AdminWorkspaceDashboardSummary;
  systemStatusSummary: WorkspaceSystemStatusSummary;
  ordersSummary: AdminWorkspaceOrdersSummary | null;
  initialOrdersTargetOrderId: string | null;
  ordersFocusRequest: AdminWorkspaceOrdersFocusRequest | null;
  menuSummary: AdminWorkspaceMenuSummary | null;
  menuFocusRequest: AdminWorkspaceMenuFocusRequest | null;
  devicesSummary: AdminWorkspaceDevicesSummary | null;
  devicesAutoRefresh: boolean;
  notify: AdminWorkspaceNotify;
  onDevicesSummaryChange: (summary: AdminWorkspaceDevicesSummary) => void;
  returnTarget: AdminWorkspaceWidgetId | null;
  isMaximized: boolean;
  onDashboardOrdersOpen: (
    request: AdminWorkspaceDashboardOrdersOpenRequest,
  ) => void;
  onAttentionItemSelect: (
    selection: DashboardAttentionSelection,
  ) => boolean | void;
  onReturnToWidget: (widgetId: AdminWorkspaceWidgetId) => void;
  onFocus: () => void;
  onDragStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onToggleMaximize: () => void;
}) {
  const title = ADMIN_WORKSPACE_WIDGET_LABELS[widget.id];
  // Ghost-resize: the widget keeps its current size during a resize drag.
  // The dashed admin-workspace-resize-preview rectangle (drawn in
  // AdminWorkspaceCanvas) shows the new size; only on pointerup does the
  // widget actually grow/shrink. resizePreview is still accepted as a prop
  // (so callers don't have to know) but is intentionally unused here.
  void resizePreview;
  const displayWidth = widget.width;
  const displayHeight = widget.height;
  const returnLabel = returnTarget
    ? ADMIN_WORKSPACE_WIDGET_LABELS[returnTarget]
    : null;
  const canMaximize = widget.id !== "status";

  // Maximize is implemented by the canvas mutating the widget's actual
  // bounds to viewport size + smooth-scrolling to it (same path as a
  // toolbar reveal). So the widget renders the same whether maximized
  // or not — no special positioning required. isMaximized only changes
  // chrome: button label/icon, header cursor, resize handle visibility.
  return (
    <section
      data-testid={`admin-workspace-widget-${widget.id}`}
      data-active={active ? "true" : "false"}
      data-maximized={isMaximized ? "true" : "false"}
      className={`absolute overflow-hidden rounded-xl border bg-white shadow-lg transition-shadow ${
        active ? "border-yellow-400 ring-2 ring-yellow-300" : "border-stone-200"
      } ${dragging || resizing ? "shadow-2xl" : ""}`}
      style={{
        left: widget.x,
        top: widget.y,
        width: displayWidth,
        height: displayHeight,
        zIndex: widget.zIndex,
      }}
      onPointerDown={onFocus}
    >
      <div
        data-testid={`admin-workspace-widget-header-${widget.id}`}
        className={`flex select-none items-center justify-between gap-3 border-b border-stone-200 bg-stone-50 px-3 py-2 ${
          isMaximized ? "cursor-default" : "cursor-grab active:cursor-grabbing"
        }`}
        onPointerDown={onDragStart}
        onDoubleClick={canMaximize ? onToggleMaximize : undefined}
      >
        <div className="flex min-w-0 items-center gap-2">
          <GripHorizontal
            size={16}
            strokeWidth={2.5}
            className={`shrink-0 ${isMaximized ? "text-stone-300" : "text-stone-400"}`}
            aria-hidden
          />
          <div className="truncate text-sm font-black text-stone-950">
            {title}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2" data-no-drag>
          {returnTarget && returnLabel && (
            <button
              type="button"
              data-testid={`admin-workspace-return-${widget.id}`}
              onClick={() => onReturnToWidget(returnTarget)}
              className="inline-flex items-center gap-1 rounded-full border border-yellow-300 bg-yellow-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-stone-950 hover:border-yellow-400 hover:bg-yellow-100"
            >
              <ArrowLeft size={12} strokeWidth={2.5} aria-hidden />
              Back to {returnLabel}
            </button>
          )}
          {canMaximize && (
            <button
              type="button"
              data-testid={`admin-workspace-maximize-${widget.id}`}
              onClick={onToggleMaximize}
              aria-pressed={isMaximized}
              title={
                isMaximized
                  ? "Restore widget (Esc)"
                  : "Maximize widget (double-click title)"
              }
              className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-stone-700 hover:border-stone-400"
            >
              {isMaximized ? (
                <>
                  <Minimize2 size={12} strokeWidth={2.5} aria-hidden />
                  Restore
                </>
              ) : (
                <>
                  <Maximize2 size={12} strokeWidth={2.5} aria-hidden />
                  Maximize
                </>
              )}
            </button>
          )}
        </div>
      </div>

      <div
        className="admin-widget-scroll h-[calc(100%-49px)] overflow-auto overscroll-contain p-4"
        style={{ borderTop: `3px solid ${BRAND.yellow}` }}
      >
        <PlaceholderBody
          widget={widget}
          canWriteMenu={canWriteMenu}
          canManageDevices={canManageDevices}
          dashboardSummary={dashboardSummary}
          systemStatusSummary={systemStatusSummary}
          ordersSummary={ordersSummary}
          initialOrdersTargetOrderId={initialOrdersTargetOrderId}
          ordersFocusRequest={ordersFocusRequest}
          menuSummary={menuSummary}
          menuFocusRequest={menuFocusRequest}
          devicesSummary={devicesSummary}
          devicesAutoRefresh={devicesAutoRefresh}
          notify={notify}
          onDevicesSummaryChange={onDevicesSummaryChange}
          onDashboardOrdersOpen={onDashboardOrdersOpen}
          onAttentionItemSelect={onAttentionItemSelect}
          widgetWidth={displayWidth}
          widgetHeight={displayHeight}
        />
      </div>
      {!isMaximized && (
        <button
          type="button"
          data-no-drag
          data-testid={`admin-workspace-resize-handle-${widget.id}`}
          className={`absolute bottom-0 right-0 z-20 inline-flex h-9 w-9 cursor-nwse-resize touch-none items-center justify-center rounded-br-xl rounded-tl-lg border-l border-t ${
            resizing
              ? "border-yellow-400 bg-yellow-300 text-stone-950"
              : "border-stone-200 bg-white/92 text-stone-500 hover:border-yellow-300 hover:bg-yellow-50 hover:text-stone-950"
          }`}
          title="Drag to resize widget"
          aria-label={`Resize ${title} widget`}
          onPointerDown={onResizeStart}
        >
          <Maximize2 size={16} strokeWidth={2.5} aria-hidden />
        </button>
      )}
    </section>
  );
}
