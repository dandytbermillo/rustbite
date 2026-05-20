export type AdminWorkspaceWidgetId =
  | "dashboard"
  | "status"
  | "orders"
  | "menu"
  | "devices"
  | "attention";

export type AdminWorkspaceWidgetAccess = {
  id: AdminWorkspaceWidgetId;
  canView: boolean;
};

export type AdminWorkspaceLayoutWidget = {
  id: AdminWorkspaceWidgetId;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  collapsed?: boolean;
};

export type AdminWorkspaceLayout = {
  version: 2;
  outletId: string;
  widgets: AdminWorkspaceLayoutWidget[];
  updatedAt: string;
};

export type AdminWorkspaceSizePreset = {
  key: string;
  label: string;
  cols: number;
  rows: number;
  width: number;
  height: number;
};

// Halved from 180 → 90 to give a finer snap grid. All size presets below
// double their cell counts to preserve current visual sizes (e.g., a
// "compact" dashboard was 2x2 cells of 180px = 352px, now 4x4 cells of
// 90px = 352px). Existing saved layouts (24, 204, 384… positions; 712,
// 352… sizes) snap cleanly to the finer grid because every old grid
// coordinate is also a multiple of 90.
export const ADMIN_WORKSPACE_GRID_CELL_SIZE = 90;
export const ADMIN_WORKSPACE_GRID_GAP = 16;
export const ADMIN_WORKSPACE_GRID_OFFSET = 24;
export const ADMIN_WORKSPACE_STORAGE_PREFIX =
  "rushbite:admin-workspace-layout";
export const ADMIN_WORKSPACE_LAYOUT_VERSION = 2;

const PANEL_UNIT = ADMIN_WORKSPACE_GRID_CELL_SIZE - ADMIN_WORKSPACE_GRID_GAP;
// Generous caps — a widget's max pixel size is now 32×90−16 = 2864 wide,
// 24×90−16 = 2144 tall. That's larger than typical viewports, so the cap
// rarely bites; it's still in place to prevent runaway "drag forever"
// gestures from creating monster widgets that are hard to recover from.
const MAX_WIDGET_COLS = 32;
const MAX_WIDGET_ROWS = 24;

function sizeFor(cols: number, rows: number): Pick<
  AdminWorkspaceSizePreset,
  "cols" | "rows" | "width" | "height"
> {
  return {
    cols,
    rows,
    width: PANEL_UNIT * cols + ADMIN_WORKSPACE_GRID_GAP * (cols - 1),
    height: PANEL_UNIT * rows + ADMIN_WORKSPACE_GRID_GAP * (rows - 1),
  };
}

export const ADMIN_WORKSPACE_SIZE_PRESETS: Record<
  AdminWorkspaceWidgetId,
  AdminWorkspaceSizePreset[]
> = {
  // Cell counts doubled (and labels re-stated) so each preset's pixel
  // size stays the same as before the CELL_SIZE halving. e.g. dashboard
  // "compact" 4x4 cells of 90px = same 352x352 px as the old 2x2 of 180px.
  dashboard: [
    { key: "compact", label: "4x4", ...sizeFor(4, 4) },
    { key: "standard", label: "6x4", ...sizeFor(6, 4) },
    { key: "tall", label: "6x6", ...sizeFor(6, 6) },
    { key: "large", label: "8x6", ...sizeFor(8, 6) },
    { key: "wide", label: "10x6", ...sizeFor(10, 6) },
    { key: "max", label: "10x8", ...sizeFor(10, 8) },
  ],
  status: [
    { key: "standard", label: "5x4", ...sizeFor(5, 4) },
    { key: "large", label: "6x5", ...sizeFor(6, 5) },
    { key: "wide", label: "8x5", ...sizeFor(8, 5) },
    { key: "deep", label: "8x7", ...sizeFor(8, 7) },
  ],
  orders: [
    { key: "standard", label: "6x4", ...sizeFor(6, 4) },
    { key: "large", label: "8x6", ...sizeFor(8, 6) },
    { key: "tall", label: "6x6", ...sizeFor(6, 6) },
    { key: "wide", label: "10x6", ...sizeFor(10, 6) },
    { key: "deep", label: "10x8", ...sizeFor(10, 8) },
    { key: "max", label: "12x8", ...sizeFor(12, 8) },
  ],
  menu: [
    { key: "standard", label: "8x6", ...sizeFor(8, 6) },
    { key: "large", label: "10x8", ...sizeFor(10, 8) },
    { key: "square", label: "8x8", ...sizeFor(8, 8) },
    { key: "wide", label: "12x8", ...sizeFor(12, 8) },
    { key: "deep", label: "12x10", ...sizeFor(12, 10) },
    { key: "max", label: "14x10", ...sizeFor(14, 10) },
  ],
  devices: [
    { key: "standard", label: "4x4", ...sizeFor(4, 4) },
    { key: "large", label: "6x4", ...sizeFor(6, 4) },
    { key: "tall", label: "4x6", ...sizeFor(4, 6) },
    { key: "wide", label: "8x4", ...sizeFor(8, 4) },
    { key: "max", label: "8x6", ...sizeFor(8, 6) },
  ],
  attention: [
    { key: "standard", label: "4x4", ...sizeFor(4, 4) },
    { key: "tall", label: "4x6", ...sizeFor(4, 6) },
    { key: "wide", label: "6x4", ...sizeFor(6, 4) },
    { key: "large", label: "6x6", ...sizeFor(6, 6) },
  ],
};

export const ADMIN_WORKSPACE_WIDGET_LABELS: Record<
  AdminWorkspaceWidgetId,
  string
> = {
  dashboard: "Dashboard",
  status: "System status",
  orders: "Orders",
  menu: "Menu",
  devices: "Devices",
  attention: "Attention",
};

export const ADMIN_WORKSPACE_CLASSIC_HREFS: Record<
  AdminWorkspaceWidgetId,
  string
> = {
  dashboard: "/admin?mode=classic",
  status: "/admin/workspace?widget=status",
  orders: "/admin/orders",
  menu: "/admin/menu",
  devices: "/admin/devices",
  attention: "/admin?mode=classic",
};

export function adminWorkspaceWidgetFocusHref(
  id: AdminWorkspaceWidgetId,
): string {
  return `/admin/workspace?widget=${encodeURIComponent(id)}`;
}

export function adminWorkspaceStorageKey(
  userId: string,
  outletId: string,
): string {
  return `${ADMIN_WORKSPACE_STORAGE_PREFIX}:${userId}:${outletId}:v2`;
}

export function snapAdminWorkspacePosition(
  x: number,
  y: number,
): { x: number; y: number } {
  const col = Math.max(
    0,
    Math.round((x - ADMIN_WORKSPACE_GRID_OFFSET) / ADMIN_WORKSPACE_GRID_CELL_SIZE),
  );
  const row = Math.max(
    0,
    Math.round((y - ADMIN_WORKSPACE_GRID_OFFSET) / ADMIN_WORKSPACE_GRID_CELL_SIZE),
  );

  return {
    x: col * ADMIN_WORKSPACE_GRID_CELL_SIZE + ADMIN_WORKSPACE_GRID_OFFSET,
    y: row * ADMIN_WORKSPACE_GRID_CELL_SIZE + ADMIN_WORKSPACE_GRID_OFFSET,
  };
}

export function minimumSizeForWidget(
  id: AdminWorkspaceWidgetId,
): Pick<AdminWorkspaceSizePreset, "width" | "height"> {
  const first = ADMIN_WORKSPACE_SIZE_PRESETS[id][0];
  return { width: first.width, height: first.height };
}

/**
 * Bypass-snap counterpart to {@link snapAdminWorkspaceSize}. Enforces the
 * per-widget minimum and global maximum but keeps the input width/height
 * at sub-cell precision. Intended for the Shift-held drag/resize paths.
 */
export function clampAdminWorkspaceSize({
  id,
  width,
  height,
}: {
  id: AdminWorkspaceWidgetId;
  width: number;
  height: number;
}): Pick<AdminWorkspaceSizePreset, "width" | "height"> {
  const minimum = minimumSizeForWidget(id);
  const maxWidth =
    MAX_WIDGET_COLS * ADMIN_WORKSPACE_GRID_CELL_SIZE -
    ADMIN_WORKSPACE_GRID_GAP;
  const maxHeight =
    MAX_WIDGET_ROWS * ADMIN_WORKSPACE_GRID_CELL_SIZE -
    ADMIN_WORKSPACE_GRID_GAP;
  return {
    width: Math.min(maxWidth, Math.max(minimum.width, Math.round(width))),
    height: Math.min(maxHeight, Math.max(minimum.height, Math.round(height))),
  };
}

export function snapAdminWorkspaceSize({
  id,
  width,
  height,
}: {
  id: AdminWorkspaceWidgetId;
  width: number;
  height: number;
}): Pick<AdminWorkspaceSizePreset, "width" | "height"> {
  const minimum = minimumSizeForWidget(id);
  const minCols = Math.max(
    1,
    Math.round(
      (minimum.width + ADMIN_WORKSPACE_GRID_GAP) /
        ADMIN_WORKSPACE_GRID_CELL_SIZE,
    ),
  );
  const minRows = Math.max(
    1,
    Math.round(
      (minimum.height + ADMIN_WORKSPACE_GRID_GAP) /
        ADMIN_WORKSPACE_GRID_CELL_SIZE,
    ),
  );
  const cols = Math.min(
    MAX_WIDGET_COLS,
    Math.max(
      minCols,
      Math.round(
        (Math.max(0, width) + ADMIN_WORKSPACE_GRID_GAP) /
          ADMIN_WORKSPACE_GRID_CELL_SIZE,
      ),
    ),
  );
  const rows = Math.min(
    MAX_WIDGET_ROWS,
    Math.max(
      minRows,
      Math.round(
        (Math.max(0, height) + ADMIN_WORKSPACE_GRID_GAP) /
          ADMIN_WORKSPACE_GRID_CELL_SIZE,
      ),
    ),
  );

  const size = sizeFor(cols, rows);
  return { width: size.width, height: size.height };
}

export function defaultAdminWorkspaceLayout({
  outletId,
  access,
  now = new Date(),
}: {
  outletId: string;
  access: AdminWorkspaceWidgetAccess[];
  now?: Date;
}): AdminWorkspaceLayout {
  const allowed = new Set(
    access.filter((entry) => entry.canView).map((entry) => entry.id),
  );
  const dashboard =
    ADMIN_WORKSPACE_SIZE_PRESETS.dashboard.find(
      (preset) => preset.key === "large",
    ) ?? ADMIN_WORKSPACE_SIZE_PRESETS.dashboard[3];
  const status =
    ADMIN_WORKSPACE_SIZE_PRESETS.status.find(
      (preset) => preset.key === "large",
    ) ?? ADMIN_WORKSPACE_SIZE_PRESETS.status[1];
  const orders =
    ADMIN_WORKSPACE_SIZE_PRESETS.orders.find(
      (preset) => preset.key === "large",
    ) ?? ADMIN_WORKSPACE_SIZE_PRESETS.orders[1];
  const menu =
    ADMIN_WORKSPACE_SIZE_PRESETS.menu.find((preset) => preset.key === "large") ??
    ADMIN_WORKSPACE_SIZE_PRESETS.menu[1];
  const devices =
    ADMIN_WORKSPACE_SIZE_PRESETS.devices.find(
      (preset) => preset.key === "large",
    ) ?? ADMIN_WORKSPACE_SIZE_PRESETS.devices[1];
  const attention =
    ADMIN_WORKSPACE_SIZE_PRESETS.attention.find(
      (preset) => preset.key === "tall",
    ) ?? ADMIN_WORKSPACE_SIZE_PRESETS.attention[1];
  const defaults: AdminWorkspaceLayoutWidget[] = [
    {
      id: "dashboard",
      x: ADMIN_WORKSPACE_GRID_OFFSET,
      y: ADMIN_WORKSPACE_GRID_OFFSET,
      width: dashboard.width,
      height: dashboard.height,
      zIndex: 1,
    },
    {
      id: "status",
      x:
        ADMIN_WORKSPACE_GRID_OFFSET +
        dashboard.width +
        ADMIN_WORKSPACE_GRID_GAP,
      y: ADMIN_WORKSPACE_GRID_OFFSET,
      width: status.width,
      height: status.height,
      zIndex: 2,
    },
    {
      id: "attention",
      x: ADMIN_WORKSPACE_GRID_OFFSET,
      y:
        ADMIN_WORKSPACE_GRID_OFFSET +
        dashboard.height +
        ADMIN_WORKSPACE_GRID_GAP,
      width: attention.width,
      height: attention.height,
      zIndex: 3,
    },
    {
      id: "orders",
      x:
        ADMIN_WORKSPACE_GRID_OFFSET +
        dashboard.width +
        status.width +
        ADMIN_WORKSPACE_GRID_GAP +
        ADMIN_WORKSPACE_GRID_GAP,
      y: ADMIN_WORKSPACE_GRID_OFFSET,
      width: orders.width,
      height: orders.height,
      zIndex: 4,
    },
    {
      id: "devices",
      x:
        ADMIN_WORKSPACE_GRID_OFFSET +
        dashboard.width +
        status.width +
        ADMIN_WORKSPACE_GRID_GAP +
        ADMIN_WORKSPACE_GRID_GAP,
      y:
        ADMIN_WORKSPACE_GRID_OFFSET +
        orders.height +
        ADMIN_WORKSPACE_GRID_GAP,
      width: devices.width,
      height: devices.height,
      zIndex: 5,
    },
    {
      id: "menu",
      x: ADMIN_WORKSPACE_GRID_OFFSET,
      y:
        ADMIN_WORKSPACE_GRID_OFFSET +
        orders.height +
        devices.height +
        ADMIN_WORKSPACE_GRID_GAP +
        ADMIN_WORKSPACE_GRID_GAP,
      width: menu.width,
      height: menu.height,
      zIndex: 6,
    },
  ];

  return {
    version: ADMIN_WORKSPACE_LAYOUT_VERSION,
    outletId,
    widgets: defaults.filter((widget) => allowed.has(widget.id)),
    updatedAt: now.toISOString(),
  };
}

export function sanitizeAdminWorkspaceLayout({
  candidate,
  outletId,
  access,
  now = new Date(),
}: {
  candidate: unknown;
  outletId: string;
  access: AdminWorkspaceWidgetAccess[];
  now?: Date;
}): AdminWorkspaceLayout {
  const fallback = defaultAdminWorkspaceLayout({ outletId, access, now });
  if (!candidate || typeof candidate !== "object") return fallback;

  const raw = candidate as Partial<AdminWorkspaceLayout>;
  if (raw.version !== ADMIN_WORKSPACE_LAYOUT_VERSION || raw.outletId !== outletId) {
    return fallback;
  }
  if (!Array.isArray(raw.widgets)) return fallback;

  const allowed = new Set(
    access.filter((entry) => entry.canView).map((entry) => entry.id),
  );
  const seen = new Set<string>();
  const widgets: AdminWorkspaceLayoutWidget[] = [];

  for (const rawWidget of raw.widgets) {
    if (!rawWidget || typeof rawWidget !== "object") continue;
    const widget = rawWidget as Partial<AdminWorkspaceLayoutWidget>;
    if (!widget.id || !allowed.has(widget.id) || seen.has(widget.id)) continue;

    const snapped = snapAdminWorkspacePosition(
      Number.isFinite(widget.x) ? Number(widget.x) : ADMIN_WORKSPACE_GRID_OFFSET,
      Number.isFinite(widget.y) ? Number(widget.y) : ADMIN_WORKSPACE_GRID_OFFSET,
    );
    const size = snapAdminWorkspaceSize({
      id: widget.id,
      width: Number.isFinite(widget.width) ? Number(widget.width) : 0,
      height: Number.isFinite(widget.height) ? Number(widget.height) : 0,
    });

    widgets.push({
      id: widget.id,
      x: snapped.x,
      y: snapped.y,
      width: size.width,
      height: size.height,
      zIndex: Math.max(1, Math.round(Number(widget.zIndex) || 1)),
      collapsed: widget.collapsed === true,
    });
    seen.add(widget.id);
  }

  for (const defaultWidget of fallback.widgets) {
    if (!seen.has(defaultWidget.id)) widgets.push(defaultWidget);
  }

  return {
    version: ADMIN_WORKSPACE_LAYOUT_VERSION,
    outletId,
    widgets,
    updatedAt:
      typeof raw.updatedAt === "string" && raw.updatedAt
        ? raw.updatedAt
        : now.toISOString(),
  };
}
