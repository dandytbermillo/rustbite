/* eslint-disable no-console */
import assert from "node:assert/strict";
import {
  ADMIN_WORKSPACE_GRID_CELL_SIZE,
  ADMIN_WORKSPACE_GRID_GAP,
  adminWorkspaceStorageKey,
  defaultAdminWorkspaceLayout,
  minimumSizeForWidget,
  sanitizeAdminWorkspaceLayout,
  snapAdminWorkspacePosition,
  snapAdminWorkspaceSize,
  type AdminWorkspaceWidgetAccess,
} from "@/lib/admin/workspace/layout";
import {
  WORKSPACE_MENU_TOOLBAR_PREFERENCE_STORAGE_KEY,
  parseWorkspaceMenuToolbarPreference,
  readWorkspaceMenuToolbarPreference,
  writeWorkspaceMenuToolbarPreference,
} from "@/lib/admin/workspace/menu-toolbar-preference";

// Width/height of a widget that occupies `cells` grid units.
// Mirrors layout.ts: cells * PANEL_UNIT + (cells-1) * GAP, simplified.
const widthForCells = (cells: number) =>
  cells * ADMIN_WORKSPACE_GRID_CELL_SIZE - ADMIN_WORKSPACE_GRID_GAP;

const outletId = "workspace-test-outlet";
const access: AdminWorkspaceWidgetAccess[] = [
  { id: "dashboard", canView: true },
  { id: "status", canView: true },
  { id: "attention", canView: true },
  { id: "orders", canView: true },
  { id: "devices", canView: true },
  { id: "menu", canView: false },
];

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

const throwingStorage = {
  getItem() {
    throw new Error("storage unavailable");
  },
  setItem() {
    throw new Error("storage unavailable");
  },
  removeItem() {
    throw new Error("storage unavailable");
  },
};

function main() {
  const defaultLayout = defaultAdminWorkspaceLayout({
    outletId,
    access,
    now: new Date("2026-05-05T00:00:00.000Z"),
  });
  assert.deepEqual(
    defaultLayout.widgets.map((widget) => widget.id),
    ["dashboard", "status", "attention", "orders", "devices"],
    "default layout should omit unauthorized widgets",
  );

  assert.equal(
    adminWorkspaceStorageKey("user-1", outletId),
    "rushbite:admin-workspace-layout:user-1:workspace-test-outlet:v2",
    "storage key should be scoped to user and outlet",
  );

  assert.equal(
    parseWorkspaceMenuToolbarPreference(
      JSON.stringify({ version: 1, mode: "hidden" }),
    ),
    "hidden",
    "menu toolbar preference should accept stored hidden mode",
  );
  assert.equal(
    parseWorkspaceMenuToolbarPreference(JSON.stringify({ version: 1, mode: "auto" })),
    null,
    "menu toolbar preference should not persist auto mode",
  );
  assert.equal(
    parseWorkspaceMenuToolbarPreference("{not-json"),
    null,
    "menu toolbar preference should ignore corrupt storage",
  );

  const toolbarStorage = new MemoryStorage();
  writeWorkspaceMenuToolbarPreference(toolbarStorage, "hidden");
  assert.equal(
    readWorkspaceMenuToolbarPreference(toolbarStorage),
    "hidden",
    "menu toolbar preference should round-trip hidden mode",
  );
  writeWorkspaceMenuToolbarPreference(toolbarStorage, "open");
  assert.equal(
    readWorkspaceMenuToolbarPreference(toolbarStorage),
    "open",
    "menu toolbar preference should round-trip open mode",
  );
  writeWorkspaceMenuToolbarPreference(toolbarStorage, "auto");
  assert.equal(
    toolbarStorage.getItem(WORKSPACE_MENU_TOOLBAR_PREFERENCE_STORAGE_KEY),
    null,
    "menu toolbar auto mode should clear the persisted explicit preference",
  );
  assert.equal(
    readWorkspaceMenuToolbarPreference(throwingStorage),
    null,
    "menu toolbar preference read should tolerate storage failures",
  );
  assert.doesNotThrow(
    () => writeWorkspaceMenuToolbarPreference(throwingStorage, "hidden"),
    "menu toolbar preference write should tolerate storage failures",
  );

  assert.deepEqual(
    snapAdminWorkspacePosition(-100, -100),
    { x: 24, y: 24 },
    "snap should clamp negative positions to the first grid cell",
  );
  // Pick a cell count comfortably above orders' current minimum so the
  // snap result isn't clamped up. minimumSizeForWidget("orders") returns
  // the first preset's size; we measure that in cells and add headroom.
  const ordersMinForSnap = minimumSizeForWidget("orders");
  const minOrdersCols = Math.round(
    (ordersMinForSnap.width + ADMIN_WORKSPACE_GRID_GAP) /
      ADMIN_WORKSPACE_GRID_CELL_SIZE,
  );
  const minOrdersRows = Math.round(
    (ordersMinForSnap.height + ADMIN_WORKSPACE_GRID_GAP) /
      ADMIN_WORKSPACE_GRID_CELL_SIZE,
  );
  const safeCols = widthForCells(minOrdersCols + 2);
  const safeRows = widthForCells(minOrdersRows + 2);
  assert.deepEqual(
    snapAdminWorkspaceSize({
      id: "orders",
      width: safeCols + 10, // off-snap width; should snap back to safeCols
      height: safeRows, // already on-snap; should pass through unchanged
    }),
    { width: safeCols, height: safeRows },
    "size snap should allow width changes without forcing height changes",
  );
  assert.deepEqual(
    snapAdminWorkspaceSize({
      id: "orders",
      width: safeCols, // already on-snap
      height: safeRows + 10, // off-snap height; should snap back to safeRows
    }),
    { width: safeCols, height: safeRows },
    "size snap should allow height changes without forcing width changes",
  );

  const minOrders = minimumSizeForWidget("orders");
  const sanitized = sanitizeAdminWorkspaceLayout({
    outletId,
    access,
    now: new Date("2026-05-05T00:00:00.000Z"),
    candidate: {
      version: 2,
      outletId,
      updatedAt: "2026-05-05T00:00:00.000Z",
      widgets: [
        {
          id: "orders",
          x: -900,
          y: -100,
          width: 1,
          height: 1,
          zIndex: -20,
          extraOperationalData: "must be dropped",
        },
        {
          id: "menu",
          x: 24,
          y: 24,
          width: 1000,
          height: 1000,
          zIndex: 9,
        },
        {
          id: "attention",
          x: 204,
          y: 204,
          width: 344,
          height: 524,
          zIndex: 4,
        },
        {
          id: "unknown",
          x: 24,
          y: 24,
          width: 500,
          height: 500,
          zIndex: 9,
        },
      ],
    },
  });

  const orders = sanitized.widgets.find((widget) => widget.id === "orders");
  assert(orders, "orders widget should remain after sanitization");
  assert.equal(orders.x, 24, "orders x should be clamped/snapped");
  assert.equal(orders.y, 24, "orders y should be clamped/snapped");
  assert.equal(
    orders.width,
    minOrders.width,
    "orders width should be clamped to minimum",
  );
  assert.equal(
    orders.height,
    minOrders.height,
    "orders height should be clamped to minimum",
  );
  assert.equal(orders.zIndex, 1, "zIndex should be clamped to a positive value");
  assert.equal(
    "extraOperationalData" in orders,
    false,
    "sanitized layout should not retain operational data",
  );
  assert.equal(
    sanitized.widgets.some((widget) => widget.id === "menu"),
    false,
    "sanitize should drop unauthorized menu widget",
  );

  console.log("Admin workspace layout tests passed.");
}

main();
