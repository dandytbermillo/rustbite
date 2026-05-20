"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { AdminWorkspaceDashboardSummary } from "@/lib/admin/workspace/dashboard-summary";
import type { AdminWorkspaceDevicesSummary } from "@/lib/admin/workspace/devices-summary";
import type {
  AdminWorkspaceOrdersSummary,
  WorkspaceOrdersFilterKey,
} from "@/lib/admin/workspace/orders-summary";
import type { AdminWorkspaceMenuSummary } from "@/lib/admin/workspace/menu-summary";
import type { WorkspaceSystemStatusSummary } from "@/lib/admin/workspace/system-status-model";
import type { MenuAttention } from "@/lib/admin/filters/types";
import {
  ADMIN_WORKSPACE_GRID_CELL_SIZE,
  ADMIN_WORKSPACE_GRID_GAP,
  ADMIN_WORKSPACE_GRID_OFFSET,
  adminWorkspaceStorageKey,
  clampAdminWorkspaceSize,
  defaultAdminWorkspaceLayout,
  sanitizeAdminWorkspaceLayout,
  snapAdminWorkspacePosition,
  snapAdminWorkspaceSize,
  type AdminWorkspaceLayout,
  type AdminWorkspaceLayoutWidget,
  type AdminWorkspaceWidgetAccess,
  type AdminWorkspaceWidgetId,
} from "@/lib/admin/workspace/layout";
import type { DashboardAttentionSelection } from "@/components/admin/dashboard/DashboardAttentionPanel";
import AdminWorkspaceWidget from "./AdminWorkspaceWidget";
import type { AdminWorkspaceNotify } from "./AdminWorkspaceToastHost";
import type { AdminWorkspaceDashboardOrdersOpenRequest } from "./AdminWorkspaceDashboardWidget";
import type { AdminWorkspaceOrdersFocusRequest } from "./AdminWorkspaceOrdersWidget";
import type { AdminWorkspaceMenuFocusRequest } from "./AdminWorkspaceMenuWidget";

type DragState = {
  widgetId: AdminWorkspaceWidgetId;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  width: number;
  height: number;
};

type ResizeState = {
  widgetId: AdminWorkspaceWidgetId;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startWidth: number;
  startHeight: number;
};

type WorkspaceViewportState = {
  version: 1;
  activeWidgetId: AdminWorkspaceWidgetId | null;
  scrollLeft: number;
  scrollTop: number;
  updatedAt: string;
};

type WorkspaceViewportRestoreRequest = {
  version: 1;
  href: string;
  updatedAtMs: number;
};

type WorkspaceReturnTarget = {
  sourceWidgetId: AdminWorkspaceWidgetId;
  targetWidgetId: AdminWorkspaceWidgetId;
};

const WORKSPACE_VIEWPORT_STORAGE_VERSION = 1;
const WORKSPACE_VIEWPORT_RESTORE_REQUEST_TTL_MS = 5 * 60 * 1000;
const SCROLL_GUIDANCE_THROTTLE_MS = 3000;
const SCROLL_GUIDANCE_DURATION_MS = 2600;

type ScrollGuidanceKey = "enable-pan" | "disable-pan";

const SCROLL_GUIDANCE_MESSAGES: Record<ScrollGuidanceKey, string> = {
  "enable-pan": "Hold Space bar or use Pan to move around the workspace.",
  "disable-pan": "Turn off Pan to scroll this widget.",
};

function isNoDragTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "button,a,input,textarea,select,[role='button'],[data-no-drag]",
    ),
  );
}

function canElementScrollVertically(el: HTMLElement): boolean {
  return el.scrollHeight > el.clientHeight + 1;
}

function widgetScrollContainerAncestors(
  target: EventTarget | null,
  root: HTMLElement,
): HTMLElement[] {
  if (!(target instanceof Element)) return [];
  // Invariant: Workspace .admin-widget-scroll containers must also use
  // overscroll-contain. Widgets may still nest scroll surfaces, so dead-scroll
  // detection has to consider the nearest widget scroll plus its widget-scroll
  // ancestors before deciding the target is a non-scrollable widget area.
  const scrollContainers: HTMLElement[] = [];
  let current = target.closest<HTMLElement>(".admin-widget-scroll");
  while (current) {
    if (!root.contains(current)) break;
    scrollContainers.push(current);
    current = current.parentElement?.closest<HTMLElement>(
      ".admin-widget-scroll",
    ) ?? null;
  }
  return scrollContainers;
}

function widgetKeyForScrollTarget(scrollTarget: HTMLElement): string | null {
  return (
    scrollTarget.closest<HTMLElement>(
      '[data-testid^="admin-workspace-widget-"]',
    )?.dataset.testid ?? null
  );
}

function rectContainsPoint(rect: DOMRect, clientX: number, clientY: number) {
  return (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  );
}

function numericZIndex(el: HTMLElement): number {
  const raw = el.style.zIndex || window.getComputedStyle(el).zIndex;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function elementDepthWithin(el: HTMLElement, root: HTMLElement): number {
  let depth = 0;
  let current = el.parentElement;
  while (current && current !== root) {
    depth += 1;
    current = current.parentElement;
  }
  return depth;
}

function widgetScrollContainerAtPoint({
  canvas,
  clientX,
  clientY,
}: {
  canvas: HTMLElement;
  clientX: number;
  clientY: number;
}): HTMLElement | null {
  let topWidget: { el: HTMLElement; zIndex: number; index: number } | null =
    null;

  const canvasChildren = Array.from(canvas.children);
  for (let index = 0; index < canvasChildren.length; index += 1) {
    const child = canvasChildren[index];
    if (!(child instanceof HTMLElement)) continue;
    const testId = child.getAttribute("data-testid") ?? "";
    if (!testId.startsWith("admin-workspace-widget-")) continue;
    if (!rectContainsPoint(child.getBoundingClientRect(), clientX, clientY)) {
      continue;
    }
    const zIndex = numericZIndex(child);
    if (
      !topWidget ||
      zIndex > topWidget.zIndex ||
      (zIndex === topWidget.zIndex && index > topWidget.index)
    ) {
      topWidget = { el: child, zIndex, index };
    }
  }

  if (!topWidget) return null;
  const topWidgetEl = topWidget.el;

  let bestScroll: { el: HTMLElement; depth: number; index: number } | null =
    null;
  const scrollContainers = Array.from(
    topWidgetEl.querySelectorAll<HTMLElement>(".admin-widget-scroll"),
  ).filter((el) =>
    rectContainsPoint(el.getBoundingClientRect(), clientX, clientY),
  );
  for (let index = 0; index < scrollContainers.length; index += 1) {
    const el = scrollContainers[index];
    const depth = elementDepthWithin(el, topWidgetEl);
    if (
      !bestScroll ||
      depth > bestScroll.depth ||
      (depth === bestScroll.depth && index > bestScroll.index)
    ) {
      bestScroll = { el, depth, index };
    }
  }

  return bestScroll?.el ?? null;
}

function canvasBounds(widgets: AdminWorkspaceLayoutWidget[]) {
  let right = 1280;
  let bottom = 780;
  for (const widget of widgets) {
    right = Math.max(right, widget.x + widget.width + 360);
    bottom = Math.max(bottom, widget.y + widget.height + 300);
  }
  return { width: right, height: bottom };
}

function initialActiveWidget(
  layout: AdminWorkspaceLayout,
  requestedWidgetId: AdminWorkspaceWidgetId | null,
): AdminWorkspaceWidgetId | null {
  if (
    requestedWidgetId &&
    layout.widgets.some((widget) => widget.id === requestedWidgetId)
  ) {
    return requestedWidgetId;
  }
  return layout.widgets[0]?.id ?? null;
}

function workspaceViewportStorageKey(layoutStorageKey: string): string {
  return `${layoutStorageKey}:viewport:v1`;
}

function workspaceViewportRestoreRequestKey(
  viewportStorageKey: string,
): string {
  return `${viewportStorageKey}:restore-request:v1`;
}

function sanitizeWorkspaceViewportState({
  candidate,
  layout,
}: {
  candidate: unknown;
  layout: AdminWorkspaceLayout;
}): WorkspaceViewportState | null {
  if (!candidate || typeof candidate !== "object") return null;
  const raw = candidate as Partial<WorkspaceViewportState>;
  if (raw.version !== WORKSPACE_VIEWPORT_STORAGE_VERSION) return null;

  const activeWidgetId =
    raw.activeWidgetId &&
    layout.widgets.some((widget) => widget.id === raw.activeWidgetId)
      ? raw.activeWidgetId
      : null;
  const scrollLeft = Number.isFinite(raw.scrollLeft)
    ? Math.max(0, Math.round(Number(raw.scrollLeft)))
    : 0;
  const scrollTop = Number.isFinite(raw.scrollTop)
    ? Math.max(0, Math.round(Number(raw.scrollTop)))
    : 0;

  return {
    version: WORKSPACE_VIEWPORT_STORAGE_VERSION,
    activeWidgetId,
    scrollLeft,
    scrollTop,
    updatedAt:
      typeof raw.updatedAt === "string" && raw.updatedAt
        ? raw.updatedAt
        : new Date().toISOString(),
  };
}

function readWorkspaceViewportState({
  storageKey,
  layout,
}: {
  storageKey: string;
  layout: AdminWorkspaceLayout;
}): WorkspaceViewportState | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    return sanitizeWorkspaceViewportState({
      candidate: JSON.parse(raw),
      layout,
    });
  } catch {
    return null;
  }
}

function writeWorkspaceViewportRestoreRequest(storageKey: string) {
  try {
    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        version: WORKSPACE_VIEWPORT_STORAGE_VERSION,
        href: window.location.href,
        updatedAtMs: Date.now(),
      } satisfies WorkspaceViewportRestoreRequest),
    );
  } catch {
    // SessionStorage is a convenience. URL focus still works without it.
  }
}

function consumeWorkspaceViewportRestoreRequest(storageKey: string) {
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (raw) window.sessionStorage.removeItem(storageKey);
    if (!raw) return false;

    const request = JSON.parse(raw) as Partial<WorkspaceViewportRestoreRequest>;
    if (request.version !== WORKSPACE_VIEWPORT_STORAGE_VERSION) return false;
    if (request.href !== window.location.href) return false;
    if (!Number.isFinite(request.updatedAtMs)) return false;

    return (
      Date.now() - Number(request.updatedAtMs) <=
      WORKSPACE_VIEWPORT_RESTORE_REQUEST_TTL_MS
    );
  } catch {
    return false;
  }
}

function isBrowserReload() {
  try {
    const navigation = window.performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    return navigation?.type === "reload";
  } catch {
    return false;
  }
}

function clampedScrollPosition({
  container,
  scrollLeft,
  scrollTop,
}: {
  container: HTMLDivElement;
  scrollLeft: number;
  scrollTop: number;
}) {
  return {
    left: Math.min(
      Math.max(0, scrollLeft),
      Math.max(0, container.scrollWidth - container.clientWidth),
    ),
    top: Math.min(
      Math.max(0, scrollTop),
      Math.max(0, container.scrollHeight - container.clientHeight),
    ),
  };
}

function ordersFilterFromAttentionHref(
  href: string,
): { filter: WorkspaceOrdersFilterKey; status: string } | null {
  const url = new URL(href, "http://workspace.local");
  const status = url.searchParams.get("status");
  if (status === "AWAITING_COUNTER_PAYMENT") {
    return { filter: "payment", status };
  }
  if (status === "READY") return { filter: "ready", status };
  return null;
}

function ordersFilterFromStatus(status: string): WorkspaceOrdersFilterKey {
  if (status === "AWAITING_COUNTER_PAYMENT") return "payment";
  if (status === "PAID" || status === "IN_KITCHEN") return "kitchen";
  if (status === "READY") return "ready";
  return "all";
}

function menuAttentionFromAttentionHref(href: string): MenuAttention | null {
  const url = new URL(href, "http://workspace.local");
  const attention = url.searchParams.get("attention");
  if (
    attention === "deals" ||
    attention === "inventory-out" ||
    attention === "inventory-low"
  ) {
    return attention;
  }
  return null;
}

function clearOrdersFocusParams(params: URLSearchParams) {
  params.delete("order");
  params.delete("id");
  params.delete("status");
}

function clearMenuFocusParams(params: URLSearchParams) {
  params.delete("attention");
  params.delete("q");
  params.delete("category");
  params.delete("badge");
  params.delete("status");
  params.delete("stock");
  params.delete("item");
  params.delete("id");
}

export default function AdminWorkspaceCanvas({
  outletId,
  userId,
  access,
  canWriteMenu,
  canManageDevices,
  initialFocusWidgetId,
  visibleWidgetCount,
  dashboardSummary,
  systemStatusSummary,
  ordersSummary,
  initialOrdersTargetOrderId,
  menuSummary,
  devicesSummary,
  devicesWidgetAutoRefresh,
  notify,
  onDevicesSummaryChange,
  panActivation,
  setPanActivation,
  toolbarFocusRequest,
  menuUtilityRequest,
  onToolbarFocusCommitted,
}: {
  outletId: string;
  userId: string;
  access: AdminWorkspaceWidgetAccess[];
  canWriteMenu: boolean;
  canManageDevices: boolean;
  initialFocusWidgetId: AdminWorkspaceWidgetId | null;
  visibleWidgetCount: number;
  dashboardSummary: AdminWorkspaceDashboardSummary;
  systemStatusSummary: WorkspaceSystemStatusSummary;
  ordersSummary: AdminWorkspaceOrdersSummary | null;
  initialOrdersTargetOrderId: string | null;
  menuSummary: AdminWorkspaceMenuSummary | null;
  devicesSummary: AdminWorkspaceDevicesSummary | null;
  devicesWidgetAutoRefresh?: boolean;
  notify: AdminWorkspaceNotify;
  onDevicesSummaryChange: (summary: AdminWorkspaceDevicesSummary) => void;
  /** Pan-mode activation state — owned by AdminWorkspaceClient so the
   *  header button and the canvas's keyboard listener can both update it
   *  through one source of truth. See plan v1.3 step 3a. */
  panActivation: "space" | "button" | null;
  setPanActivation: React.Dispatch<
    React.SetStateAction<"space" | "button" | null>
  >;
  /** Toolbar widget-focus jump-bar request. The client emits a request
   *  with a monotonic id; the canvas honors it on next render via the
   *  effect below and calls onToolbarFocusCommitted on success. URL/pan/
   *  dropdown side effects in the client are gated on that callback —
   *  drag/resize busy or RBAC-removed widgets drop the request silently
   *  with no orphan side effects. See toolbar-widget-focus plan. */
  toolbarFocusRequest:
    | { id: AdminWorkspaceWidgetId; requestId: number }
    | null;
  menuUtilityRequest:
    | {
        id: number;
        action: NonNullable<AdminWorkspaceMenuFocusRequest["action"]>;
      }
    | null;
  onToolbarFocusCommitted: (id: AdminWorkspaceWidgetId) => void;
}) {
  const isPanMode = panActivation !== null;
  const defaultLayout = useMemo(
    () => defaultAdminWorkspaceLayout({ outletId, access }),
    [access, outletId],
  );
  const storageKey = useMemo(
    () => adminWorkspaceStorageKey(userId, outletId),
    [outletId, userId],
  );
  const viewportStorageKey = useMemo(
    () => workspaceViewportStorageKey(storageKey),
    [storageKey],
  );
  const restoreRequestStorageKey = useMemo(
    () => workspaceViewportRestoreRequestKey(viewportStorageKey),
    [viewportStorageKey],
  );
  const [layout, setLayout] = useState<AdminWorkspaceLayout>(defaultLayout);
  const [hydrated, setHydrated] = useState(false);
  const [activeWidgetId, setActiveWidgetId] =
    useState<AdminWorkspaceWidgetId | null>(
      initialActiveWidget(defaultLayout, initialFocusWidgetId),
    );
  const [ordersFocusRequest, setOrdersFocusRequest] =
    useState<AdminWorkspaceOrdersFocusRequest | null>(null);
  const ordersFocusRequestIdRef = useRef(0);
  const [menuFocusRequest, setMenuFocusRequest] =
    useState<AdminWorkspaceMenuFocusRequest | null>(null);
  const menuFocusRequestIdRef = useRef(0);
  // Tracks the last toolbar widget-focus request id we processed (handled
  // OR explicitly dropped). Both successful focus AND drop-on-busy mark
  // the request with this ref so the same request never fires twice and
  // we never get a delayed surprise focus when drag/resize ends.
  const lastToolbarFocusRequestIdRef = useRef<number | null>(null);
  const lastMenuUtilityRequestIdRef = useRef<number | null>(null);
  // Widget maximize state. Ephemeral (no localStorage). When set, the
  // matching widget renders with position:fixed filling the canvas
  // viewport (below the workspace header), while its saved x/y/width/
  // height in `layout` is preserved for restore. See proposal at
  // docs/proposal/widget-maximize-toggle.html.
  const [maximizedWidgetId, setMaximizedWidgetId] =
    useState<AdminWorkspaceWidgetId | null>(null);
  // The widget's bounds at the moment of maximize, so Restore (button,
  // Esc, double-click, or maximize-another-widget) can write them back.
  // Maximize itself mutates the widget's layout bounds to viewport size
  // — same code path as a normal resize — so the rendering and pan logic
  // need zero special-cases. The persist effect skips writing while
  // maximizedWidgetId is set, so the temporary maximized size never
  // reaches localStorage.
  const [maximizedPrev, setMaximizedPrev] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [returnTarget, setReturnTarget] =
    useState<WorkspaceReturnTarget | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const activeWidgetIdRef = useRef<AdminWorkspaceWidgetId | null>(
    activeWidgetId,
  );
  const layoutWidgetsRef = useRef<AdminWorkspaceLayoutWidget[]>(
    defaultLayout.widgets,
  );
  const pendingViewportRestoreRef = useRef<WorkspaceViewportState | null>(null);
  const pendingRevealWidgetRef = useRef<AdminWorkspaceWidgetId | null>(null);
  const viewportReadyRef = useRef(false);
  const viewportPersistTimerRef = useRef<number | null>(null);
  const panActivationRef = useRef(panActivation);
  const scrollGuidanceRef = useRef<{
    key: ScrollGuidanceKey;
    shownAt: number;
  } | null>(null);
  const enablePanGuidedWidgetKeysRef = useRef<Set<string>>(new Set());
  const disablePanGuidedWidgetKeysRef = useRef<Set<string>>(new Set());
  panActivationRef.current = panActivation;
  const [dragState, setDragState] = useState<DragState | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);
  const resizeStateRef = useRef<ResizeState | null>(null);
  const [snapPreview, setSnapPreview] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [resizePreview, setResizePreview] = useState<{
    widgetId: AdminWorkspaceWidgetId;
    width: number;
    height: number;
  } | null>(null);
  const resizePreviewRef = useRef<typeof resizePreview>(null);

  const bounds = useMemo(
    () =>
      canvasBounds(
        layout.widgets.map((widget) =>
          resizePreview?.widgetId === widget.id
            ? {
                ...widget,
                width: resizePreview.width,
                height: resizePreview.height,
              }
            : widget,
        ),
      ),
    [layout.widgets, resizePreview],
  );

  useEffect(() => {
    dragStateRef.current = dragState;
  }, [dragState]);

  useEffect(() => {
    resizeStateRef.current = resizeState;
  }, [resizeState]);

  // ====================================================================
  // Pan tool — see docs/admin-workspace-pan-and-scroll-plan-2026-05-09.md
  // (v1.3). Activation lives in AdminWorkspaceClient as `panActivation`;
  // this component owns the in-progress drag tracking AND the keyboard
  // listener (because the listener needs access to dragStateRef /
  // resizeStateRef to suppress Space mid-widget-drag).
  // ====================================================================
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startScrollLeft: number;
    startScrollTop: number;
  } | null>(null);

  useEffect(() => {
    if (panActivation === null) {
      disablePanGuidedWidgetKeysRef.current.clear();
    } else {
      enablePanGuidedWidgetKeysRef.current.clear();
    }
  }, [panActivation]);

  const notifyScrollGuidance = useCallback(
    (key: ScrollGuidanceKey) => {
      const now = Date.now();
      const previous = scrollGuidanceRef.current;
      if (
        previous?.key === key &&
        now - previous.shownAt < SCROLL_GUIDANCE_THROTTLE_MS
      ) {
        return false;
      }
      scrollGuidanceRef.current = { key, shownAt: now };
      notify({
        message: SCROLL_GUIDANCE_MESSAGES[key],
        tone: "info",
        durationMs: SCROLL_GUIDANCE_DURATION_MS,
      });
      return true;
    },
    [notify],
  );

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const wheelContainer = container;

    function onWheel(event: WheelEvent) {
      if (event.deltaY === 0) return;
      if (
        event.target instanceof Element &&
        event.target.closest('[role="dialog"][aria-modal="true"]')
      ) {
        return;
      }

      const isCurrentlyPanMode = panActivationRef.current !== null;
      if (!isCurrentlyPanMode) {
        const scrollTargets = widgetScrollContainerAncestors(
          event.target,
          wheelContainer,
        );
        if (scrollTargets.length === 0) return;
        const hasScrollableWidgetContent = scrollTargets.some((scrollTarget) =>
          canElementScrollVertically(scrollTarget),
        );
        if (!hasScrollableWidgetContent) {
          const widgetKey = widgetKeyForScrollTarget(scrollTargets[0]);
          if (
            widgetKey &&
            enablePanGuidedWidgetKeysRef.current.has(widgetKey)
          ) {
            return;
          }
          const didNotify = notifyScrollGuidance("enable-pan");
          if (didNotify && widgetKey) {
            enablePanGuidedWidgetKeysRef.current.add(widgetKey);
          }
        }
        return;
      }

      const canvas = wheelContainer.querySelector<HTMLElement>(
        '[data-testid="admin-workspace-canvas"]',
      );
      if (!canvas) return;
      const scrollTarget = widgetScrollContainerAtPoint({
        canvas,
        clientX: event.clientX,
        clientY: event.clientY,
      });
      if (scrollTarget && canElementScrollVertically(scrollTarget)) {
        const widgetKey = widgetKeyForScrollTarget(scrollTarget);
        if (
          widgetKey &&
          disablePanGuidedWidgetKeysRef.current.has(widgetKey)
        ) {
          return;
        }
        const didNotify = notifyScrollGuidance("disable-pan");
        if (didNotify && widgetKey) {
          disablePanGuidedWidgetKeysRef.current.add(widgetKey);
        }
      }
    }

    wheelContainer.addEventListener("wheel", onWheel, {
      passive: true,
      capture: true,
    });
    return () => {
      wheelContainer.removeEventListener("wheel", onWheel, { capture: true });
    };
  }, [notifyScrollGuidance]);

  useEffect(() => {
    function shouldSkipSpace(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      if (
        target.matches(
          'input, textarea, select, button, a, [role="button"], [data-no-drag]',
        )
      )
        return true;
      if (target.closest('[role="dialog"][aria-modal="true"]')) return true;
      return false;
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== "Space") return;
      if (e.repeat) return;
      if (shouldSkipSpace(e.target)) return;
      if (dragStateRef.current || resizeStateRef.current) return;
      const modalOpen = !!document.querySelector(
        '[role="dialog"][aria-modal="true"]',
      );
      if (modalOpen) return;
      e.preventDefault();
      setPanActivation((prev) => {
        if (prev !== null) return prev; // button-toggled, leave alone
        return "space";
      });
    }

    function onKeyUp(e: KeyboardEvent) {
      if (e.code !== "Space") return;
      setPanActivation((prev) => (prev === "space" ? null : prev));
    }

    function clearSpaceActivation() {
      setPanActivation((prev) => (prev === "space" ? null : prev));
    }
    function onVisibilityChange() {
      if (document.hidden) clearSpaceActivation();
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clearSpaceActivation);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearSpaceActivation);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [setPanActivation]);

  function onCanvasPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!isPanMode) return;
    if (e.button !== 0) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    panStartRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startScrollLeft: container.scrollLeft,
      startScrollTop: container.scrollTop,
    };
    setIsPanning(true);
  }

  function onCanvasPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const start = panStartRef.current;
    if (!start || start.pointerId !== e.pointerId) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const dx = e.clientX - start.startClientX;
    const dy = e.clientY - start.startClientY;
    container.scrollLeft = start.startScrollLeft - dx;
    container.scrollTop = start.startScrollTop - dy;
  }

  function onCanvasPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (panStartRef.current?.pointerId !== e.pointerId) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    panStartRef.current = null;
    setIsPanning(false);
  }

  useEffect(() => {
    resizePreviewRef.current = resizePreview;
  }, [resizePreview]);

  useEffect(() => {
    activeWidgetIdRef.current = activeWidgetId;
  }, [activeWidgetId]);

  useEffect(() => {
    layoutWidgetsRef.current = layout.widgets;
  }, [layout.widgets]);

  useEffect(() => {
    return () => {
      if (viewportPersistTimerRef.current != null) {
        window.clearTimeout(viewportPersistTimerRef.current);
        viewportPersistTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    viewportReadyRef.current = false;
    pendingViewportRestoreRef.current = null;
    pendingRevealWidgetRef.current = null;
    if (viewportPersistTimerRef.current != null) {
      window.clearTimeout(viewportPersistTimerRef.current);
      viewportPersistTimerRef.current = null;
    }
    setLayout(defaultLayout);
    setActiveWidgetId(initialActiveWidget(defaultLayout, initialFocusWidgetId));
    setReturnTarget(null);
    setHydrated(false);
  }, [defaultLayout, initialFocusWidgetId, storageKey]);

  useEffect(() => {
    let nextLayout = defaultLayout;
    let nextActiveWidgetId = initialActiveWidget(
      defaultLayout,
      initialFocusWidgetId,
    );

    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const sanitized = sanitizeAdminWorkspaceLayout({
          candidate: JSON.parse(raw),
          outletId,
          access,
        });
        // Cap any legacy zIndex values from prior versions (before the
        // focusWidget renormalize). Without this, layouts saved when
        // the focus-bump was unbounded carry zIndex > 100 forward,
        // which makes the workspace header's dropdown panel paint
        // behind those widgets.
        const orderedIds = [...sanitized.widgets]
          .sort((a, b) => a.zIndex - b.zIndex)
          .map((widget) => widget.id);
        nextLayout = {
          ...sanitized,
          widgets: sanitized.widgets.map((widget) => ({
            ...widget,
            zIndex: orderedIds.indexOf(widget.id) + 1,
          })),
        };
        nextActiveWidgetId = initialActiveWidget(
          nextLayout,
          initialFocusWidgetId,
        );
      }

      const savedViewport = readWorkspaceViewportState({
        storageKey: viewportStorageKey,
        layout: nextLayout,
      });
      const hasRestoreRequest =
        Boolean(savedViewport) &&
        consumeWorkspaceViewportRestoreRequest(restoreRequestStorageKey);
      const savedViewportMatchesRequestedWidget =
        Boolean(initialFocusWidgetId) &&
        savedViewport?.activeWidgetId === initialFocusWidgetId;
      const shouldRestoreReloadViewport =
        Boolean(savedViewport) &&
        (isBrowserReload() || hasRestoreRequest) &&
        (!initialFocusWidgetId || savedViewportMatchesRequestedWidget);

      if (initialFocusWidgetId && !shouldRestoreReloadViewport) {
        pendingViewportRestoreRef.current = null;
        pendingRevealWidgetRef.current = nextActiveWidgetId;
      } else {
        pendingViewportRestoreRef.current = savedViewport;
        pendingRevealWidgetRef.current = null;
        if (savedViewport?.activeWidgetId) {
          nextActiveWidgetId = savedViewport.activeWidgetId;
        }
      }

      setLayout(nextLayout);
      setActiveWidgetId(nextActiveWidgetId);
    } catch {
      setLayout(defaultLayout);
      setActiveWidgetId(nextActiveWidgetId);
      pendingViewportRestoreRef.current = null;
      pendingRevealWidgetRef.current = initialFocusWidgetId
        ? nextActiveWidgetId
        : null;
    } finally {
      setHydrated(true);
    }
  }, [
    access,
    defaultLayout,
    initialFocusWidgetId,
    outletId,
    restoreRequestStorageKey,
    storageKey,
    viewportStorageKey,
  ]);

  useEffect(() => {
    if (!hydrated) return;
    // Skip persisting while a widget is maximized. Maximize temporarily
    // resizes the widget to viewport bounds; we don't want those bounds
    // saved to localStorage (next reload would load a "stuck-huge"
    // widget). The maximize toggle restores the previous bounds before
    // clearing maximizedWidgetId, so the post-restore persist runs and
    // captures the correct (pre-maximize) layout.
    if (maximizedWidgetId) return;
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({ ...layout, updatedAt: new Date().toISOString() }),
      );
    } catch {
      // LocalStorage is a convenience. The workspace remains usable in-memory.
    }
  }, [hydrated, layout, storageKey, maximizedWidgetId]);

  function persistViewportState() {
    if (!hydrated || !viewportReadyRef.current) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    const allowedWidgetIds = new Set(
      layoutWidgetsRef.current.map((widget) => widget.id),
    );
    const activeWidgetId = activeWidgetIdRef.current;
    const safeActiveWidgetId =
      activeWidgetId && allowedWidgetIds.has(activeWidgetId)
        ? activeWidgetId
        : (layoutWidgetsRef.current[0]?.id ?? null);

    try {
      window.localStorage.setItem(
        viewportStorageKey,
        JSON.stringify({
          version: WORKSPACE_VIEWPORT_STORAGE_VERSION,
          activeWidgetId: safeActiveWidgetId,
          scrollLeft: Math.max(0, Math.round(container.scrollLeft)),
          scrollTop: Math.max(0, Math.round(container.scrollTop)),
          updatedAt: new Date().toISOString(),
        } satisfies WorkspaceViewportState),
      );
    } catch {
      // Viewport persistence is a convenience. The workspace remains usable.
    }
  }

  function scheduleViewportPersist() {
    if (!hydrated || !viewportReadyRef.current) return;
    if (viewportPersistTimerRef.current != null) {
      window.clearTimeout(viewportPersistTimerRef.current);
    }
    viewportPersistTimerRef.current = window.setTimeout(() => {
      viewportPersistTimerRef.current = null;
      persistViewportState();
    }, 160);
  }

  useEffect(() => {
    if (!hydrated) return;

    const restore = pendingViewportRestoreRef.current;
    const revealWidgetId = pendingRevealWidgetRef.current;
    pendingViewportRestoreRef.current = null;
    pendingRevealWidgetRef.current = null;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const container = scrollContainerRef.current;
        if (!container) {
          viewportReadyRef.current = true;
          return;
        }

        if (revealWidgetId) {
          const widget = layout.widgets.find(
            (entry) => entry.id === revealWidgetId,
          );
          if (widget) {
            container.scrollTo({
              left: Math.max(0, widget.x - 24),
              top: Math.max(0, widget.y - 24),
            });
          }
        } else if (restore) {
          const nextScroll = clampedScrollPosition({
            container,
            scrollLeft: restore.scrollLeft,
            scrollTop: restore.scrollTop,
          });
          container.scrollTo(nextScroll);
        }

        viewportReadyRef.current = true;
        persistViewportState();
      });
    });
  }, [hydrated, layout.widgets]);

  useEffect(() => {
    scheduleViewportPersist();
  }, [activeWidgetId]);

  useEffect(() => {
    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = previousScrollRestoration;
    };
  }, []);

  useEffect(() => {
    function flushViewportPersist() {
      if (viewportPersistTimerRef.current != null) {
        window.clearTimeout(viewportPersistTimerRef.current);
        viewportPersistTimerRef.current = null;
      }
      persistViewportState();
      writeWorkspaceViewportRestoreRequest(restoreRequestStorageKey);
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") flushViewportPersist();
    }

    window.addEventListener("pagehide", flushViewportPersist);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flushViewportPersist);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  });

  function updateWidget(
    widgetId: AdminWorkspaceWidgetId,
    updater: (
      widget: AdminWorkspaceLayoutWidget,
      widgets: AdminWorkspaceLayoutWidget[],
    ) => AdminWorkspaceLayoutWidget,
  ) {
    setLayout((current) => ({
      ...current,
      widgets: current.widgets.map((widget) =>
        widget.id === widgetId ? updater(widget, current.widgets) : widget,
      ),
      updatedAt: new Date().toISOString(),
    }));
  }

  function revealWidget(widgetId: AdminWorkspaceWidgetId) {
    const widget = layout.widgets.find((entry) => entry.id === widgetId);
    if (!widget) return;

    requestAnimationFrame(() => {
      scrollContainerRef.current?.scrollTo({
        left: Math.max(0, widget.x - 24),
        top: Math.max(0, widget.y - 24),
        behavior: "smooth",
      });
    });
  }

  function focusWidget(
    widgetId: AdminWorkspaceWidgetId,
    options: { reveal?: boolean } = {},
  ) {
    setActiveWidgetId(widgetId);
    // Renormalize zIndex on every focus instead of unbounded +1 bump.
    // The focused widget gets the top slot (= widgets.length); the
    // rest get 1..N-1 in their existing relative order. Without this
    // the bump grows across sessions (persisted to localStorage) and
    // eventually exceeds the workspace header's z-index, making toolbar
    // dropdowns (e.g. "Widgets ⋯") render behind widgets.
    setLayout((current) => {
      const others = current.widgets
        .filter((widget) => widget.id !== widgetId)
        .sort((a, b) => a.zIndex - b.zIndex);
      const otherRankById = new Map(
        others.map((widget, index) => [widget.id, index + 1]),
      );
      return {
        ...current,
        widgets: current.widgets.map((widget) =>
          widget.id === widgetId
            ? { ...widget, zIndex: current.widgets.length }
            : { ...widget, zIndex: otherRankById.get(widget.id) ?? widget.zIndex },
        ),
        updatedAt: new Date().toISOString(),
      };
    });
    if (options.reveal) revealWidget(widgetId);
  }

  // Restore the currently maximized widget's bounds. Pulled out so Esc,
  // double-click, the Restore button, and "maximize a different widget"
  // all share the same path.
  function restoreMaximizedWidget(
    targetId: AdminWorkspaceWidgetId,
    prev: { x: number; y: number; width: number; height: number },
  ) {
    updateWidget(targetId, (widget) => ({
      ...widget,
      x: prev.x,
      y: prev.y,
      width: prev.width,
      height: prev.height,
    }));
    setMaximizedPrev(null);
    setMaximizedWidgetId(null);
  }

  // Maximize = "make this widget viewport-sized at its current canvas
  // position, then smooth-scroll the canvas so it fills the viewport."
  // Same mental model as the toolbar Dashboard/Attention/Orders/Menu
  // buttons (which already reveal-scroll to a widget) — just with a
  // resize layered in. The widget is a plain canvas child the whole time;
  // pan, focus, and rendering work without any special-case code paths.
  // Only one widget maximized at a time — clicking maximize on a second
  // widget restores the current one first.
  function toggleMaximize(widgetId: AdminWorkspaceWidgetId) {
    // Same widget → restore.
    if (maximizedWidgetId === widgetId) {
      if (maximizedPrev) restoreMaximizedWidget(widgetId, maximizedPrev);
      return;
    }
    // Different widget while another is maximized → restore the old one
    // first so its bounds aren't left in the maximized state.
    if (maximizedWidgetId && maximizedPrev) {
      restoreMaximizedWidget(maximizedWidgetId, maximizedPrev);
    }

    const widget = layout.widgets.find((entry) => entry.id === widgetId);
    if (!widget) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    setMaximizedPrev({
      x: widget.x,
      y: widget.y,
      width: widget.width,
      height: widget.height,
    });

    // Snap the maximize size to the grid so the widget's right/bottom
    // edges land exactly one grid gap away from the next grid cell.
    // Otherwise adjacent widgets show as touching (no gap) or oddly
    // misaligned when the user pans next to the maximized widget.
    // Formula: each cell occupies CELL_SIZE = panel + GAP, so the
    // largest grid-aligned size that fits inside `available` pixels is
    // `cells * CELL_SIZE - GAP`, where cells = floor((available + GAP) /
    // CELL_SIZE). +GAP because the last cell in a run doesn't include a
    // trailing gap.
    const cellsX = Math.max(
      1,
      Math.floor(
        (container.clientWidth + ADMIN_WORKSPACE_GRID_GAP) /
          ADMIN_WORKSPACE_GRID_CELL_SIZE,
      ),
    );
    const cellsY = Math.max(
      1,
      Math.floor(
        (container.clientHeight + ADMIN_WORKSPACE_GRID_GAP) /
          ADMIN_WORKSPACE_GRID_CELL_SIZE,
      ),
    );
    const snappedWidth =
      cellsX * ADMIN_WORKSPACE_GRID_CELL_SIZE - ADMIN_WORKSPACE_GRID_GAP;
    const snappedHeight =
      cellsY * ADMIN_WORKSPACE_GRID_CELL_SIZE - ADMIN_WORKSPACE_GRID_GAP;

    updateWidget(widgetId, (entry) => ({
      ...entry,
      width: snappedWidth,
      height: snappedHeight,
    }));

    // Auto-exit pan mode (calling with null is a safe no-op when off).
    setPanActivation(null);
    // Focus + bump zIndex so the active border/ring follows the
    // maximized widget.
    focusWidget(widgetId);
    setMaximizedWidgetId(widgetId);

    // Smooth-scroll to widget origin (no -24 margin: maximize wants an
    // exact fill of the viewport, not a padded reveal).
    requestAnimationFrame(() => {
      scrollContainerRef.current?.scrollTo({
        left: widget.x,
        top: widget.y,
        behavior: "smooth",
      });
    });
  }

  // Esc restores the currently maximized widget. Ignores key presses
  // inside text inputs / contenteditable / modal scopes so we don't
  // hijack typing.
  useEffect(() => {
    if (!maximizedWidgetId) return;
    const currentId = maximizedWidgetId;
    const currentPrev = maximizedPrev;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const target = e.target;
      if (target instanceof HTMLElement) {
        if (target.isContentEditable) return;
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (target.closest('[role="dialog"][aria-modal="true"]')) return;
      }
      if (currentPrev) {
        restoreMaximizedWidget(currentId, currentPrev);
      } else {
        // Defensive: should not happen — prev is set whenever
        // maximizedWidgetId is. Clear state if we hit it anyway.
        setMaximizedWidgetId(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [maximizedWidgetId, maximizedPrev]);

  // Toolbar widget-focus dispatch. Plan contract:
  // - Skip if no request, or request id already handled.
  // - Drag/resize busy → mark handled, return early (no commit callback).
  //   Marking handled is essential: prevents a delayed surprise focus
  //   when the busy state ends regardless of effect dep array.
  // - Widget not in layout (RBAC removed) → mark handled, return early.
  // - Otherwise focus + reveal + commit callback (URL/pan/dropdown).
  useEffect(() => {
    if (!toolbarFocusRequest) return;
    if (lastToolbarFocusRequestIdRef.current === toolbarFocusRequest.requestId)
      return;
    if (dragStateRef.current || resizeStateRef.current) {
      lastToolbarFocusRequestIdRef.current = toolbarFocusRequest.requestId;
      return;
    }
    if (
      !layout.widgets.some((widget) => widget.id === toolbarFocusRequest.id)
    ) {
      lastToolbarFocusRequestIdRef.current = toolbarFocusRequest.requestId;
      return;
    }
    lastToolbarFocusRequestIdRef.current = toolbarFocusRequest.requestId;
    focusWidget(toolbarFocusRequest.id, { reveal: true });
    onToolbarFocusCommitted(toolbarFocusRequest.id);
  }, [toolbarFocusRequest, layout.widgets, onToolbarFocusCommitted]);

  useEffect(() => {
    if (!menuUtilityRequest) return;
    if (lastMenuUtilityRequestIdRef.current === menuUtilityRequest.id) return;
    if (dragStateRef.current || resizeStateRef.current) {
      lastMenuUtilityRequestIdRef.current = menuUtilityRequest.id;
      return;
    }
    if (!layout.widgets.some((widget) => widget.id === "menu")) {
      lastMenuUtilityRequestIdRef.current = menuUtilityRequest.id;
      return;
    }

    lastMenuUtilityRequestIdRef.current = menuUtilityRequest.id;
    focusWidget("menu", { reveal: true });
    setMenuFocusRequest({
      id: ++menuFocusRequestIdRef.current,
      attention: null,
      query: "",
      category: null,
      targetItemId: null,
      action: menuUtilityRequest.action,
    });

    const params = new URLSearchParams(window.location.search);
    params.set("widget", "menu");
    clearOrdersFocusParams(params);
    clearMenuFocusParams(params);
    window.history.replaceState(null, "", `/admin/workspace?${params.toString()}`);
  }, [menuUtilityRequest, layout.widgets]);

  function setWidgetReturnTarget({
    sourceWidgetId,
    targetWidgetId,
  }: WorkspaceReturnTarget) {
    if (sourceWidgetId === targetWidgetId) {
      setReturnTarget(null);
      return;
    }
    setReturnTarget({ sourceWidgetId, targetWidgetId });
  }

  function returnToWidget(widgetId: AdminWorkspaceWidgetId) {
    focusWidget(widgetId, { reveal: true });
    setReturnTarget(null);

    const params = new URLSearchParams(window.location.search);
    params.set("widget", widgetId);
    clearOrdersFocusParams(params);
    clearMenuFocusParams(params);
    window.history.replaceState(
      null,
      "",
      `/admin/workspace?${params.toString()}`,
    );
  }

  function handleDashboardOrdersOpen({
    status,
    orderId,
  }: AdminWorkspaceDashboardOrdersOpenRequest) {
    const filter = ordersFilterFromStatus(status);

    setWidgetReturnTarget({
      sourceWidgetId: "dashboard",
      targetWidgetId: "orders",
    });
    focusWidget("orders", { reveal: true });
    setOrdersFocusRequest({
      id: ++ordersFocusRequestIdRef.current,
      filter,
      targetOrderId: orderId,
    });

    const params = new URLSearchParams(window.location.search);
    params.set("widget", "orders");
    clearOrdersFocusParams(params);
    clearMenuFocusParams(params);
    params.set("status", status);
    if (orderId) params.set("order", orderId);
    window.history.replaceState(
      null,
      "",
      `/admin/workspace?${params.toString()}`,
    );
  }

  function handleAttentionItemSelect({
    group,
    item,
  }: DashboardAttentionSelection): boolean {
    if (group.id === "orders") {
      const target = ordersFilterFromAttentionHref(item.href);
      if (!target) return false;

      setWidgetReturnTarget({
        sourceWidgetId: "attention",
        targetWidgetId: "orders",
      });
      focusWidget("orders", { reveal: true });
      setOrdersFocusRequest({
        id: ++ordersFocusRequestIdRef.current,
        filter: target.filter,
        targetOrderId: null,
      });

      const params = new URLSearchParams(window.location.search);
      params.set("widget", "orders");
      clearOrdersFocusParams(params);
      clearMenuFocusParams(params);
      params.set("status", target.status);
      window.history.replaceState(
        null,
        "",
        `/admin/workspace?${params.toString()}`,
      );
      return true;
    }

    if (group.id === "menu") {
      const attention = menuAttentionFromAttentionHref(item.href);
      if (!attention) return false;

      setWidgetReturnTarget({
        sourceWidgetId: "attention",
        targetWidgetId: "menu",
      });
      focusWidget("menu", { reveal: true });
      setMenuFocusRequest({
        id: ++menuFocusRequestIdRef.current,
        attention,
        query: "",
        category: null,
        targetItemId: null,
      });

      const params = new URLSearchParams(window.location.search);
      params.set("widget", "menu");
      clearOrdersFocusParams(params);
      clearMenuFocusParams(params);
      params.set("attention", attention);
      window.history.replaceState(
        null,
        "",
        `/admin/workspace?${params.toString()}`,
      );
      return true;
    }

    return false;
  }

  function resetLayout() {
    try {
      window.localStorage.removeItem(viewportStorageKey);
      window.sessionStorage.removeItem(restoreRequestStorageKey);
    } catch {
      // LocalStorage is a convenience. The workspace remains usable in-memory.
    }
    viewportReadyRef.current = false;
    setLayout(defaultLayout);
    setActiveWidgetId(defaultLayout.widgets[0]?.id ?? null);
    setSnapPreview(null);
    setDragState(null);
    setResizePreview(null);
    setResizeState(null);
    setReturnTarget(null);
    requestAnimationFrame(() => {
      scrollContainerRef.current?.scrollTo({ left: 0, top: 0 });
      viewportReadyRef.current = true;
    });
  }

  function startDrag(
    event: ReactPointerEvent<HTMLDivElement>,
    widget: AdminWorkspaceLayoutWidget,
  ) {
    if (isPanMode) return;
    // Disable drag while any widget is maximized. The drag handle still
    // appears (so the title bar still looks like a normal widget), but
    // pointerdown is a no-op — drag-to-reposition makes no sense for a
    // viewport-filling widget.
    if (maximizedWidgetId) return;
    if (resizeState || event.button !== 0 || isNoDragTarget(event.target))
      return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    focusWidget(widget.id);
    const nextDragState: DragState = {
      widgetId: widget.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: widget.x,
      startY: widget.y,
      width: widget.width,
      height: widget.height,
    };
    setDragState(nextDragState);
    setSnapPreview({
      ...snapAdminWorkspacePosition(widget.x, widget.y),
      width: widget.width,
      height: widget.height,
    });
  }

  function startResize(
    event: ReactPointerEvent<HTMLButtonElement>,
    widget: AdminWorkspaceLayoutWidget,
  ) {
    if (isPanMode) return;
    if (maximizedWidgetId) return;
    if (dragState || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    focusWidget(widget.id);
    const nextResizeState: ResizeState = {
      widgetId: widget.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWidth: widget.width,
      startHeight: widget.height,
    };
    setResizeState(nextResizeState);
    setResizePreview({
      widgetId: widget.id,
      width: widget.width,
      height: widget.height,
    });
  }

  useEffect(() => {
    if (!dragState) return;

    function handlePointerMove(event: PointerEvent) {
      const activeDrag = dragStateRef.current;
      if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;

      // Ghost-drag: only update the snap preview rectangle. The widget
      // itself stays at its starting position until pointerup commits the
      // move. Avoids the "widget follows the cursor in real time" feedback
      // loop and matches the resize preview model.
      const nextX = Math.max(
        0,
        Math.round(activeDrag.startX + event.clientX - activeDrag.startClientX),
      );
      const nextY = Math.max(
        0,
        Math.round(activeDrag.startY + event.clientY - activeDrag.startClientY),
      );
      // Shift-bypass: hold Shift while dragging to escape grid snap and
      // place the widget at sub-cell precision. Common convention in
      // Figma, Sketch, and most layout tools.
      const target = event.shiftKey
        ? { x: nextX, y: nextY }
        : snapAdminWorkspacePosition(nextX, nextY);
      setSnapPreview({
        x: target.x,
        y: target.y,
        width: activeDrag.width,
        height: activeDrag.height,
      });
    }

    function handlePointerUp(event: PointerEvent) {
      const activeDrag = dragStateRef.current;
      if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
      const snapped = snapPreview
        ? { x: snapPreview.x, y: snapPreview.y }
        : snapAdminWorkspacePosition(activeDrag.startX, activeDrag.startY);
      // Commit on release: snap to nearest grid cell from the preview.
      updateWidget(activeDrag.widgetId, (widget) => ({
        ...widget,
        x: snapped.x,
        y: snapped.y,
      }));
      setDragState(null);
      setSnapPreview(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [dragState, snapPreview]);

  useEffect(() => {
    if (!resizeState) return;

    function handlePointerMove(event: PointerEvent) {
      const activeResize = resizeStateRef.current;
      if (!activeResize || event.pointerId !== activeResize.pointerId) return;
      const nextWidth =
        activeResize.startWidth + event.clientX - activeResize.startClientX;
      const nextHeight =
        activeResize.startHeight + event.clientY - activeResize.startClientY;
      // Shift-bypass: clamp to min/max but skip grid snapping so the user
      // can resize to sub-cell precision. Convention from Figma/Sketch.
      const target = event.shiftKey
        ? clampAdminWorkspaceSize({
            id: activeResize.widgetId,
            width: nextWidth,
            height: nextHeight,
          })
        : snapAdminWorkspaceSize({
            id: activeResize.widgetId,
            width: nextWidth,
            height: nextHeight,
          });
      setResizePreview({
        widgetId: activeResize.widgetId,
        width: target.width,
        height: target.height,
      });
    }

    function handlePointerUp(event: PointerEvent) {
      const activeResize = resizeStateRef.current;
      if (!activeResize || event.pointerId !== activeResize.pointerId) return;
      const activePreview = resizePreviewRef.current;
      const nextSize =
        activePreview?.widgetId === activeResize.widgetId
          ? activePreview
          : snapAdminWorkspaceSize({
              id: activeResize.widgetId,
              width: activeResize.startWidth,
              height: activeResize.startHeight,
            });
      updateWidget(activeResize.widgetId, (widget) => ({
        ...widget,
        width: nextSize.width,
        height: nextSize.height,
      }));
      setResizeState(null);
      setResizePreview(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [resizeState]);

  return (
    <div className="relative h-full overflow-hidden bg-stone-950">
      {/* Floating canvas overlay toolbar (widget count, "Drag headers"
          hint, Reset layout button) intentionally removed for now. It
          overlapped maximized widgets and added visual noise; the
          reset button is the only behavior loss — recovery is now via
          `localStorage.removeItem('rushbite:admin-workspace-layout:*')`
          in DevTools. `resetLayout` is still defined for the once-the-
          UI-returns case; it's currently unreferenced. */}

      {/* Canvas is always wheel-scrollable. Scroll over a widget is
          absorbed by that widget's overscroll-contain (so widget interior
          scrolls but doesn't bubble); scroll over empty canvas space
          falls through here and moves the canvas. Pan tool is still
          required for click-and-drag panning. Scrollbars hidden via
          no-scrollbar to dodge the widget z-index obscuring issue.
          Yellow inset border (rendered as a separate overlay below) only
          when pan mode is on. */}
      <div
        ref={scrollContainerRef}
        data-testid="admin-workspace-scroll-container"
        className={`relative h-full bg-stone-950 no-scrollbar overflow-auto ${
          isPanMode
            ? `admin-workspace-pan-mode ${isPanning ? "cursor-grabbing" : "cursor-grab"}`
            : ""
        }`}
        onScroll={scheduleViewportPersist}
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onCanvasPointerMove}
        onPointerUp={onCanvasPointerUp}
        onPointerCancel={onCanvasPointerUp}
      >
        <div
          data-testid="admin-workspace-canvas"
          className="relative"
          style={{
            width: bounds.width,
            height: bounds.height,
            background: `
              radial-gradient(circle at 380px 220px, rgba(250, 204, 21, 0.12), transparent 34%),
              linear-gradient(rgba(255, 255, 255, 0.045) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255, 255, 255, 0.045) 1px, transparent 1px),
              #141414
            `,
            backgroundSize: `100% 100%, ${ADMIN_WORKSPACE_GRID_CELL_SIZE}px ${ADMIN_WORKSPACE_GRID_CELL_SIZE}px, ${ADMIN_WORKSPACE_GRID_CELL_SIZE}px ${ADMIN_WORKSPACE_GRID_CELL_SIZE}px, 100% 100%`,
            backgroundPosition: `0 0, ${ADMIN_WORKSPACE_GRID_OFFSET}px ${ADMIN_WORKSPACE_GRID_OFFSET}px, ${ADMIN_WORKSPACE_GRID_OFFSET}px ${ADMIN_WORKSPACE_GRID_OFFSET}px, 0 0`,
          }}
        >
          {(dragState || resizeState) && (
            <div
              className="pointer-events-none absolute inset-0 z-[1]"
              style={{
                backgroundImage: `
                  linear-gradient(to right, rgba(250, 204, 21, 0.16) 1px, transparent 1px),
                  linear-gradient(to bottom, rgba(250, 204, 21, 0.16) 1px, transparent 1px)
                `,
                backgroundSize: `${ADMIN_WORKSPACE_GRID_CELL_SIZE}px ${ADMIN_WORKSPACE_GRID_CELL_SIZE}px`,
                backgroundPosition: `${ADMIN_WORKSPACE_GRID_OFFSET}px ${ADMIN_WORKSPACE_GRID_OFFSET}px`,
              }}
            />
          )}

          {snapPreview &&
            (() => {
              // Preview must paint above the dragged widget; pick zIndex
              // from the active widget +1 so the dashed outline is always
              // visible — even when resizing inward (preview is smaller
              // than and contained within the widget).
              const activeId = dragState?.widgetId;
              const activeWidget = activeId
                ? layout.widgets.find((widget) => widget.id === activeId)
                : null;
              const previewZIndex = (activeWidget?.zIndex ?? 0) + 1;
              return (
                <div
                  data-testid="admin-workspace-snap-preview"
                  className="pointer-events-none absolute rounded-xl border-2 border-dashed border-yellow-300 bg-yellow-300/10"
                  style={{
                    left: snapPreview.x,
                    top: snapPreview.y,
                    width: snapPreview.width,
                    height: snapPreview.height,
                    zIndex: previewZIndex,
                  }}
                />
              );
            })()}

          {resizePreview &&
            (() => {
              const activeWidget = layout.widgets.find(
                (widget) => widget.id === resizePreview.widgetId,
              );
              const previewZIndex = (activeWidget?.zIndex ?? 0) + 1;
              return (
                <div
                  data-testid="admin-workspace-resize-preview"
                  className="pointer-events-none absolute rounded-xl border-2 border-dashed border-yellow-300 bg-yellow-300/10"
                  style={{
                    left: activeWidget?.x ?? 0,
                    top: activeWidget?.y ?? 0,
                    width: resizePreview.width,
                    height: resizePreview.height,
                    zIndex: previewZIndex,
                  }}
                />
              );
            })()}

          {layout.widgets.map((widget) => (
            <AdminWorkspaceWidget
              key={widget.id}
              widget={widget}
              active={activeWidgetId === widget.id}
              dragging={dragState?.widgetId === widget.id}
              resizing={resizeState?.widgetId === widget.id}
              resizePreview={
                resizePreview?.widgetId === widget.id
                  ? {
                      width: resizePreview.width,
                      height: resizePreview.height,
                    }
                  : null
              }
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
              devicesAutoRefresh={devicesWidgetAutoRefresh ?? true}
              notify={notify}
              onDevicesSummaryChange={onDevicesSummaryChange}
              returnTarget={
                returnTarget?.targetWidgetId === widget.id
                  ? returnTarget.sourceWidgetId
                  : null
              }
              onDashboardOrdersOpen={handleDashboardOrdersOpen}
              onAttentionItemSelect={handleAttentionItemSelect}
              onReturnToWidget={returnToWidget}
              onFocus={() => focusWidget(widget.id)}
              onDragStart={(event) => startDrag(event, widget)}
              onResizeStart={(event) => startResize(event, widget)}
              isMaximized={maximizedWidgetId === widget.id}
              onToggleMaximize={() => toggleMaximize(widget.id)}
            />
          ))}
        </div>
      </div>
      {isPanMode && (
        <div
          aria-hidden
          data-testid="admin-workspace-pan-mode-border"
          className="pointer-events-none absolute inset-0 z-30 ring-4 ring-inset ring-yellow-400/60"
        />
      )}
    </div>
  );
}
