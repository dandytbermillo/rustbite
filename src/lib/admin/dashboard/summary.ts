import "server-only";
import { prisma } from "@/lib/db";
import { syntheticExcludeWhere } from "@/lib/observability/synthetic-fixtures";
import {
  adminActorHasPermission,
  type AdminPermissionContext,
} from "@/lib/admin-sessions";
import {
  deriveDevicePresence,
  type DevicePresenceKind,
} from "@/lib/device-presence";
import { parseStockRequirementsJson } from "@/lib/menu-stock-movements";

export type DashboardRangeKey = "today" | "yesterday" | "week" | "custom";

type Ymd = {
  year: number;
  month: number;
  day: number;
};

export type DashboardRange = {
  key: DashboardRangeKey;
  from: string;
  to: string;
  label: string;
  startUtc: Date;
  endUtc: Date;
};

const OPERATION_BUCKET_CONFIG = [
  {
    key: "awaitingCounterPayment",
    status: "AWAITING_COUNTER_PAYMENT",
    lateAfterMinutes: 5,
  },
  { key: "paid", status: "PAID", lateAfterMinutes: 5 },
  { key: "inKitchen", status: "IN_KITCHEN", lateAfterMinutes: 10 },
  { key: "ready", status: "READY", lateAfterMinutes: 3 },
  { key: "completedToday", status: "COMPLETED", lateAfterMinutes: null },
] as const;

export type DashboardOperationBucketKey =
  (typeof OPERATION_BUCKET_CONFIG)[number]["key"];

export type DashboardOperationPreviewOrder = {
  id: string;
  orderNumber: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  ageMinutes: number;
  isLate: boolean;
  firstItemName: string;
  itemCount: number;
  total: number | null;
  subtotal: number | null;
  gst: number | null;
  paymentMethod: string | null;
  paymentStatus: string | null;
  items: Array<{
    id: string;
    nameSnapshot: string;
    qty: number;
    lineTotal: number | null;
  }>;
};

export type DashboardOperationBucket = {
  count: number;
  lateCount: number;
  oldestAgeMinutes: number | null;
  lateAfterMinutes: number | null;
  previewOrders: DashboardOperationPreviewOrder[];
};

export type DashboardDeviceState = "online" | "idle" | "offline" | "disabled";

export type DashboardDeviceActiveOperator = {
  displayName: string;
  roleLabel: string | null;
  signedInAt: string | null;
  lastActivityAt: string | null;
  lastActivityLabel: string | null;
};

export type DashboardDeviceFleetDevice = {
  id: string;
  name: string;
  role: string;
  roleLabel: string;
  state: DashboardDeviceState;
  presenceKind: DevicePresenceKind;
  presenceLabel: string;
  presenceReason: string | null;
  presenceLastLifecycleAt: string | null;
  presenceLastHeartbeatAt: string | null;
  lastSeenAt: string | null;
  lastSeenLabel: string;
  physicalLocation: string | null;
  assignmentLabel: string;
  activeSessionCount: number;
  screen: string | null;
  session: string | null;
  activeOperator: DashboardDeviceActiveOperator | null;
  note: string | null;
};

export type DashboardDeviceFleet = {
  counts: {
    online: number;
    idle: number;
    offline: number;
    disabled: number;
  };
  devices: DashboardDeviceFleetDevice[];
  manageHref: string | null;
};

export type AdminDashboardSummary = {
  generatedAt: string;
  outletId: string;
  outletName: string;
  range: Omit<DashboardRange, "startUtc" | "endUtc">;
  permissions: {
    canReadRevenue: boolean;
    canReadOrders: boolean;
    canReadDevices: boolean;
    canReadMenuAttention: boolean;
  };
  kpis: {
    netSales: number | null;
    orderCount: number;
    averageTicket: number | null;
    itemsPerOrder: number | null;
    cashDue: number | null;
  } | null;
  operations: {
    awaitingCounterPayment: number;
    paid: number;
    inKitchen: number;
    ready: number;
  } | null;
  operationsPreview: Record<
    DashboardOperationBucketKey,
    DashboardOperationBucket
  > | null;
  deviceHealth: {
    online: number;
    idle: number;
    offline: number;
    disabled: number;
  } | null;
  deviceHealthHref: string | null;
  deviceFleet: DashboardDeviceFleet | null;
  topSellers: Array<{
    name: string;
    qty: number;
    sales: number | null;
  }> | null;
  topSellersBySales: Array<{
    name: string;
    qty: number;
    sales: number;
  }> | null;
  recentOrders: Array<{
    id: string;
    orderNumber: string;
    orderType: string;
    status: string;
    paymentMethod: string | null;
    paymentProvider: string | null;
    paymentStatus: string | null;
    paymentTransactionId: string | null;
    paymentReference: string | null;
    paymentFailureMessage: string | null;
    productionStartedAt: string | null;
    hasQuantityStockRequirements: boolean;
    stockReturnedAutomatically: boolean;
    manualStockReturnCompleted: boolean;
    total: number | null;
    subtotal: number | null;
    gst: number | null;
    createdAt: string;
    items: Array<{
      id: string;
      nameSnapshot: string;
      qty: number;
      sizeName: string | null;
      isMeal: boolean;
      addonsJson: unknown;
      upgradeSnapshotJson: unknown;
      lineTotal: number | null;
    }>;
  }> | null;
};

export class InvalidDashboardRangeError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "InvalidDashboardRangeError";
  }
}

const SALES_STATUSES = ["PAID", "IN_KITCHEN", "READY", "COMPLETED"] as const;
const ORDER_COUNT_STATUSES = [
  "AWAITING_COUNTER_PAYMENT",
  ...SALES_STATUSES,
] as const;
const OPERATION_STATUSES = [
  "AWAITING_COUNTER_PAYMENT",
  "PAID",
  "IN_KITCHEN",
  "READY",
] as const;
const OPERATION_PREVIEW_TAKE = 3;

const DEVICE_ROLE_LABELS: Record<string, string> = {
  kiosk: "Kiosk",
  counter: "Counter POS",
  kitchen: "Kitchen Display",
  board: "Order Board",
};

const DEVICE_SCREEN_LABELS: Record<string, string> = {
  kiosk: "Kiosk ordering",
  counter: "Counter POS",
  kitchen: "Kitchen display",
  board: "Pickup board",
};

type PeriodOrderRow = {
  id: string;
  status: string;
  total: number | null;
  items: Array<{
    nameSnapshot: string;
    qty: number;
    lineTotal: number | null;
  }>;
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatYmd(ymd: Ymd): string {
  return `${ymd.year}-${pad2(ymd.month)}-${pad2(ymd.day)}`;
}

function parseYmd(value: string | null): Ymd | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function compareYmd(a: Ymd, b: Ymd): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

function addDays(ymd: Ymd, days: number): Ymd {
  const date = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function daysBetween(start: Ymd, endExclusive: Ymd): number {
  const startMs = Date.UTC(start.year, start.month - 1, start.day);
  const endMs = Date.UTC(
    endExclusive.year,
    endExclusive.month - 1,
    endExclusive.day,
  );
  return Math.round((endMs - startMs) / 86_400_000);
}

function localYmd(date: Date, timeZone: string): Ymd {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function localWeekday(date: Date, timeZone: string): number {
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(label);
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  const localAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return localAsUtc - date.getTime();
}

function localStartToUtc(ymd: Ymd, timeZone: string): Date {
  const utcGuess = Date.UTC(ymd.year, ymd.month - 1, ymd.day);
  const first = new Date(
    utcGuess - timeZoneOffsetMs(new Date(utcGuess), timeZone),
  );
  const second = new Date(utcGuess - timeZoneOffsetMs(first, timeZone));
  return second;
}

export function parseDashboardRange(
  params: URLSearchParams,
  timeZone: string,
  now = new Date(),
): DashboardRange {
  const today = localYmd(now, timeZone);
  const key = (params.get("range") || "today") as DashboardRangeKey;
  let from: Ymd;
  let to: Ymd;
  let label: string;

  if (key === "today") {
    from = today;
    to = today;
    label = "Today";
  } else if (key === "yesterday") {
    from = addDays(today, -1);
    to = from;
    label = "Yesterday";
  } else if (key === "week") {
    const weekday = localWeekday(now, timeZone);
    const daysSinceMonday = (weekday + 6) % 7;
    from = addDays(today, -daysSinceMonday);
    to = today;
    label = "This week";
  } else if (key === "custom") {
    const rawFrom = parseYmd(params.get("from"));
    const rawTo = parseYmd(params.get("to"));
    if (!rawFrom || !rawTo) {
      throw new InvalidDashboardRangeError(
        "custom range requires valid from and to dates",
      );
    }
    if (compareYmd(rawFrom, today) > 0) {
      throw new InvalidDashboardRangeError("from date cannot be in the future");
    }
    from = rawFrom;
    to = compareYmd(rawTo, today) > 0 ? today : rawTo;
    label = `${formatYmd(from)} to ${formatYmd(to)}`;
  } else {
    throw new InvalidDashboardRangeError("unsupported range");
  }

  if (compareYmd(from, to) > 0) {
    throw new InvalidDashboardRangeError(
      "from date must be on or before to date",
    );
  }

  const endExclusive = addDays(to, 1);
  if (daysBetween(from, endExclusive) > 90) {
    throw new InvalidDashboardRangeError("range cannot exceed 90 days");
  }

  return {
    key,
    from: formatYmd(from),
    to: formatYmd(to),
    label,
    startUtc: localStartToUtc(from, timeZone),
    endUtc: localStartToUtc(endExclusive, timeZone),
  };
}

function money(value: unknown): number {
  return Number(value ?? 0);
}

function ageMinutes(now: Date, value: Date): number {
  return Math.max(0, Math.floor((now.getTime() - value.getTime()) / 60_000));
}

function normalizeDeviceRole(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function deviceRoleLabel(value: string): string {
  return DEVICE_ROLE_LABELS[value] ?? "Device";
}

function adminRoleLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatRelativeActivity(now: Date, value: Date | null): string | null {
  if (!value) return null;
  const minutes = ageMinutes(now, value);
  if (minutes < 1) return "Active <1m ago";
  if (minutes < 60) return `Active ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0
    ? `Active ${hours}h ${remainingMinutes}m ago`
    : `Active ${hours}h ago`;
}

function totalItemQty(items: Array<{ qty: number }>): number {
  return items.reduce((sum, item) => sum + item.qty, 0);
}

async function buildDeviceFleet({
  outletId,
  canManageDevices,
  now,
}: {
  outletId: string;
  canManageDevices: boolean;
  now: Date;
}): Promise<DashboardDeviceFleet> {
  const devices = await prisma.device.findMany({
    where: {
      ...syntheticExcludeWhere(),
      OR: [
        { outletId },
        { outletAccess: { some: { outletId } } },
      ],
    },
    orderBy: [{ isActive: "desc" }, { lastSeenAt: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      physicalLocation: true,
      role: true,
      isActive: true,
      isSharedAcrossOutlets: true,
      outletId: true,
      lastSeenAt: true,
      outlet: {
        select: {
          name: true,
        },
      },
      outletAccess: {
        orderBy: { outlet: { name: "asc" } },
        select: {
          outletId: true,
          outlet: {
            select: {
              name: true,
            },
          },
        },
      },
      sessions: {
        where: {
          revokedAt: null,
          expiresAt: { gt: now },
        },
        select: {
          id: true,
          lastSeenAt: true,
          lastHeartbeatAt: true,
          lastLifecycleAt: true,
          lastLifecycleEvent: true,
          lastVisibilityState: true,
          lastClosedAt: true,
          activeOutletId: true,
          activeStaffOutletId: true,
          activeStaffRole: true,
          activeStaffVerifiedAt: true,
          activeStaffLastActionAt: true,
          activeStaffUser: {
            select: {
              displayName: true,
            },
          },
        },
      },
    },
  });

  const counts: DashboardDeviceFleet["counts"] = {
    online: 0,
    idle: 0,
    offline: 0,
    disabled: 0,
  };
  const fleetDevices: DashboardDeviceFleetDevice[] = [];

  for (const device of devices) {
    const presence = deriveDevicePresence({
      now,
      isActive: device.isActive,
      lastSeenAt: device.lastSeenAt,
      sessions: device.sessions,
    });
    const state = presence.state;
    counts[state] += 1;
    const role = normalizeDeviceRole(device.role);
    const outletNames = device.outletAccess.map((row) => row.outlet.name);
    const assignmentLabel =
      device.isSharedAcrossOutlets && outletNames.length > 0
        ? `Shared with ${outletNames.join(", ")}`
        : (device.outlet?.name ?? "Unassigned");
    const outletScopedSessions = device.isSharedAcrossOutlets
      ? device.sessions.filter(
          (session) =>
            session.activeOutletId === outletId ||
            session.activeStaffOutletId === outletId,
        )
      : device.sessions;
    const activeSessions = outletScopedSessions.length;
    const activeOperatorSession =
      outletScopedSessions
        .filter(
          (session) =>
            session.activeStaffOutletId === outletId &&
            session.activeStaffUser?.displayName,
        )
        .sort((a, b) => {
          const aTime = (
            a.activeStaffLastActionAt ??
            a.activeStaffVerifiedAt ??
            new Date(0)
          ).getTime();
          const bTime = (
            b.activeStaffLastActionAt ??
            b.activeStaffVerifiedAt ??
            new Date(0)
          ).getTime();
          return bTime - aTime;
        })[0] ?? null;
    const activeOperatorActivityAt =
      activeOperatorSession?.activeStaffLastActionAt ??
      activeOperatorSession?.activeStaffVerifiedAt ??
      null;

    fleetDevices.push({
      id: device.id,
      name: device.name,
      role,
      roleLabel: deviceRoleLabel(role),
      state,
      presenceKind: presence.presenceKind,
      presenceLabel: presence.presenceLabel,
      presenceReason: presence.presenceReason,
      presenceLastLifecycleAt: presence.presenceLastLifecycleAt,
      presenceLastHeartbeatAt: presence.presenceLastHeartbeatAt,
      lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
      lastSeenLabel: presence.lastSeenLabel,
      physicalLocation: device.physicalLocation,
      assignmentLabel,
      activeSessionCount: activeSessions,
      screen: DEVICE_SCREEN_LABELS[role] ?? null,
      session:
        activeSessions > 0
          ? `${activeSessions} active session${activeSessions === 1 ? "" : "s"}`
          : "No active session",
      activeOperator: activeOperatorSession?.activeStaffUser?.displayName
        ? {
            displayName: activeOperatorSession.activeStaffUser.displayName,
            roleLabel: adminRoleLabel(activeOperatorSession.activeStaffRole),
            signedInAt:
              activeOperatorSession.activeStaffVerifiedAt?.toISOString() ??
              null,
            lastActivityAt: activeOperatorActivityAt?.toISOString() ?? null,
            lastActivityLabel: formatRelativeActivity(
              now,
              activeOperatorActivityAt,
            ),
          }
        : null,
      note:
        presence.presenceReason ??
        (state === "offline"
          ? "Device has not checked in recently."
          : state === "disabled"
            ? "Device is disabled in admin."
            : device.physicalLocation
              ? device.physicalLocation
              : null),
    });
  }

  return {
    counts,
    devices: fleetDevices,
    manageHref: canManageDevices ? "/admin/devices" : null,
  };
}

async function buildOperationsPreview({
  outletId,
  canReadRevenue,
  todayRange,
  now,
}: {
  outletId: string;
  canReadRevenue: boolean;
  todayRange: DashboardRange;
  now: Date;
}): Promise<Record<DashboardOperationBucketKey, DashboardOperationBucket>> {
  const entries = await Promise.all(
    OPERATION_BUCKET_CONFIG.map(async (bucket) => {
      const isCompletedToday = bucket.key === "completedToday";
      const where = {
        outletId,
        status: bucket.status,
        ...(isCompletedToday
          ? { updatedAt: { gte: todayRange.startUtc, lt: todayRange.endUtc } }
          : {}),
      };
      const lateCutoff =
        bucket.lateAfterMinutes == null
          ? null
          : new Date(now.getTime() - bucket.lateAfterMinutes * 60_000);

      const [count, lateCount, previewOrders] = await Promise.all([
        prisma.order.count({ where }),
        lateCutoff
          ? prisma.order.count({
              where: { ...where, updatedAt: { lt: lateCutoff } },
            })
          : Promise.resolve(0),
        canReadRevenue
          ? prisma.order.findMany({
              where,
              orderBy: { updatedAt: isCompletedToday ? "desc" : "asc" },
              take: OPERATION_PREVIEW_TAKE,
              select: {
                id: true,
                orderNumber: true,
                status: true,
                createdAt: true,
                updatedAt: true,
                total: true,
                subtotal: true,
                gst: true,
                paymentMethod: true,
                paymentStatus: true,
                items: {
                  orderBy: { id: "asc" },
                  select: {
                    id: true,
                    nameSnapshot: true,
                    qty: true,
                    lineTotal: true,
                  },
                },
              },
            })
          : prisma.order.findMany({
              where,
              orderBy: { updatedAt: isCompletedToday ? "desc" : "asc" },
              take: OPERATION_PREVIEW_TAKE,
              select: {
                id: true,
                orderNumber: true,
                status: true,
                createdAt: true,
                updatedAt: true,
                paymentMethod: true,
                paymentStatus: true,
                items: {
                  orderBy: { id: "asc" },
                  select: {
                    id: true,
                    nameSnapshot: true,
                    qty: true,
                  },
                },
              },
            }),
      ]);

      const lateAfterMinutes = bucket.lateAfterMinutes;
      const mappedOrders = previewOrders.map((order) => {
        const currentAgeMinutes = ageMinutes(now, order.updatedAt);
        const items = order.items.map((item) => ({
          id: item.id,
          nameSnapshot: item.nameSnapshot,
          qty: item.qty,
          lineTotal: "lineTotal" in item ? money(item.lineTotal) : null,
        }));

        return {
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          createdAt: order.createdAt.toISOString(),
          updatedAt: order.updatedAt.toISOString(),
          ageMinutes: currentAgeMinutes,
          isLate:
            lateAfterMinutes != null && currentAgeMinutes >= lateAfterMinutes,
          firstItemName: items[0]?.nameSnapshot ?? "No items",
          itemCount: totalItemQty(items),
          total: "total" in order ? money(order.total) : null,
          subtotal: "subtotal" in order ? money(order.subtotal) : null,
          gst: "gst" in order ? money(order.gst) : null,
          paymentMethod: order.paymentMethod,
          paymentStatus: order.paymentStatus,
          items,
        };
      });

      return [
        bucket.key,
        {
          count,
          lateCount,
          oldestAgeMinutes: isCompletedToday
            ? null
            : (mappedOrders[0]?.ageMinutes ?? null),
          lateAfterMinutes,
          previewOrders: mappedOrders,
        },
      ] as const;
    }),
  );

  return Object.fromEntries(entries) as Record<
    DashboardOperationBucketKey,
    DashboardOperationBucket
  >;
}

export async function buildAdminDashboardSummary({
  context,
  searchParams,
  now = new Date(),
}: {
  context: AdminPermissionContext;
  searchParams: URLSearchParams;
  now?: Date;
}): Promise<AdminDashboardSummary> {
  const outlet = await prisma.outlet.findUniqueOrThrow({
    where: { id: context.outletId },
    select: {
      id: true,
      name: true,
      site: { select: { timezone: true } },
    },
  });
  const timeZone = outlet.site.timezone || "America/Edmonton";
  const range = parseDashboardRange(searchParams, timeZone, now);

  const [
    canReadRevenue,
    canReadOrders,
    canReadDevices,
    canReadMenuAttention,
    canManageDevices,
  ] = await Promise.all([
    adminActorHasPermission(
      context.actor,
      "admin.dashboard.revenue.read",
      context.outletId,
    ),
    adminActorHasPermission(
      context.actor,
      "admin.orders.read",
      context.outletId,
    ),
    adminActorHasPermission(
      context.actor,
      "admin.devices.read",
      context.outletId,
    ),
    adminActorHasPermission(context.actor, "admin.menu.read", context.outletId),
    adminActorHasPermission(
      context.actor,
      "admin.auth.devices.manage",
      context.outletId,
    ),
  ]);

  const permissions = {
    canReadRevenue,
    canReadOrders,
    canReadDevices,
    canReadMenuAttention,
  };

  let kpis: AdminDashboardSummary["kpis"] = null;
  let operations: AdminDashboardSummary["operations"] = null;
  let operationsPreview: AdminDashboardSummary["operationsPreview"] = null;
  let topSellers: AdminDashboardSummary["topSellers"] = null;
  let topSellersBySales: AdminDashboardSummary["topSellersBySales"] = null;
  let recentOrders: AdminDashboardSummary["recentOrders"] = null;

  if (canReadOrders) {
    let periodOrders: PeriodOrderRow[];
    if (canReadRevenue) {
      const rows = await prisma.order.findMany({
        where: {
          outletId: context.outletId,
          createdAt: { gte: range.startUtc, lt: range.endUtc },
          status: { in: [...ORDER_COUNT_STATUSES] },
        },
        select: {
          id: true,
          status: true,
          total: true,
          items: {
            select: {
              nameSnapshot: true,
              qty: true,
              lineTotal: true,
            },
          },
        },
      });
      periodOrders = rows.map((order) => ({
        id: order.id,
        status: order.status,
        total: money(order.total),
        items: order.items.map((item) => ({
          nameSnapshot: item.nameSnapshot,
          qty: item.qty,
          lineTotal: money(item.lineTotal),
        })),
      }));
    } else {
      const rows = await prisma.order.findMany({
        where: {
          outletId: context.outletId,
          createdAt: { gte: range.startUtc, lt: range.endUtc },
          status: { in: [...ORDER_COUNT_STATUSES] },
        },
        select: {
          id: true,
          status: true,
          items: {
            select: {
              nameSnapshot: true,
              qty: true,
            },
          },
        },
      });
      periodOrders = rows.map((order) => ({
        id: order.id,
        status: order.status,
        total: null,
        items: order.items.map((item) => ({
          nameSnapshot: item.nameSnapshot,
          qty: item.qty,
          lineTotal: null,
        })),
      }));
    }

    const operationCounts = await prisma.order.groupBy({
      by: ["status"],
      where: {
        outletId: context.outletId,
        status: { in: [...OPERATION_STATUSES] },
      },
      _count: { _all: true },
    });

    const salesOrders = periodOrders.filter((order) =>
      (SALES_STATUSES as readonly string[]).includes(order.status),
    );
    const awaitingCounterPaymentOrders = periodOrders.filter(
      (order) => order.status === "AWAITING_COUNTER_PAYMENT",
    );
    const netSales = canReadRevenue
      ? salesOrders.reduce((sum, order) => sum + money(order.total), 0)
      : 0;
    const cashDue = awaitingCounterPaymentOrders.reduce(
      (sum, order) => sum + (canReadRevenue ? money(order.total) : 0),
      0,
    );
    const itemQty = salesOrders.reduce(
      (sum, order) =>
        sum + order.items.reduce((itemSum, item) => itemSum + item.qty, 0),
      0,
    );
    const sellerMap = new Map<
      string,
      { name: string; qty: number; sales: number }
    >();
    for (const order of salesOrders) {
      for (const item of order.items) {
        const current = sellerMap.get(item.nameSnapshot) ?? {
          name: item.nameSnapshot,
          qty: 0,
          sales: 0,
        };
        current.qty += item.qty;
        current.sales += canReadRevenue ? money(item.lineTotal) : 0;
        sellerMap.set(item.nameSnapshot, current);
      }
    }

    kpis = {
      netSales: canReadRevenue ? netSales : null,
      orderCount: periodOrders.length,
      averageTicket:
        canReadRevenue && salesOrders.length > 0
          ? netSales / salesOrders.length
          : null,
      itemsPerOrder:
        salesOrders.length > 0 ? itemQty / salesOrders.length : null,
      cashDue: canReadRevenue ? cashDue : null,
    };

    const findOperationCount = (status: string) =>
      operationCounts.find((row) => row.status === status)?._count._all ?? 0;
    operations = {
      awaitingCounterPayment: findOperationCount("AWAITING_COUNTER_PAYMENT"),
      paid: findOperationCount("PAID"),
      inKitchen: findOperationCount("IN_KITCHEN"),
      ready: findOperationCount("READY"),
    };
    operationsPreview = await buildOperationsPreview({
      outletId: context.outletId,
      canReadRevenue,
      todayRange: parseDashboardRange(
        new URLSearchParams({ range: "today" }),
        timeZone,
        now,
      ),
      now,
    });

    topSellers = [...sellerMap.values()]
      .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name))
      .slice(0, 5)
      .map((seller) => ({
        name: seller.name,
        qty: seller.qty,
        sales: canReadRevenue ? seller.sales : null,
      }));
    topSellersBySales = canReadRevenue
      ? [...sellerMap.values()]
          .sort(
            (a, b) =>
              b.sales - a.sales ||
              b.qty - a.qty ||
              a.name.localeCompare(b.name),
          )
          .slice(0, 5)
          .map((seller) => ({
            name: seller.name,
            qty: seller.qty,
            sales: seller.sales,
          }))
      : null;

    if (canReadRevenue) {
      const recent = await prisma.order.findMany({
        where: { outletId: context.outletId },
        orderBy: { createdAt: "desc" },
        take: 10,
        include: {
          items: {
            select: {
              id: true,
              nameSnapshot: true,
              qty: true,
              sizeName: true,
              isMeal: true,
              addonsJson: true,
              upgradeSnapshotJson: true,
              lineTotal: true,
            },
          },
          paymentTransaction: {
            select: {
              id: true,
              providerReference: true,
              failureMessage: true,
              stockRequirementsJson: true,
            },
          },
          stockMovements: {
            select: {
              reason: true,
            },
          },
        },
      });
      recentOrders = recent.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        orderType: order.orderType,
        status: order.status,
        paymentMethod: order.paymentMethod,
        paymentProvider: order.paymentProvider,
        paymentStatus: order.paymentStatus,
        paymentTransactionId: order.paymentTransaction?.id ?? null,
        paymentReference: order.paymentTransaction?.providerReference ?? null,
        paymentFailureMessage: order.paymentTransaction?.failureMessage ?? null,
        productionStartedAt: order.productionStartedAt?.toISOString() ?? null,
        hasQuantityStockRequirements:
          parseStockRequirementsJson(
            order.paymentTransaction?.stockRequirementsJson,
          ).length > 0,
        stockReturnedAutomatically: order.stockMovements.some((movement) =>
          ["ORDER_CANCELLED_RESTOCK", "CASH_ORDER_CANCELLED_RESTOCK"].includes(
            movement.reason,
          ),
        ),
        manualStockReturnCompleted: order.stockMovements.some(
          (movement) => movement.reason === "ADMIN_RETURN_STOCK",
        ),
        total: money(order.total),
        subtotal: money(order.subtotal),
        gst: money(order.gst),
        createdAt: order.createdAt.toISOString(),
        items: order.items.map((item) => ({
          id: item.id,
          nameSnapshot: item.nameSnapshot,
          qty: item.qty,
          sizeName: item.sizeName,
          isMeal: item.isMeal,
          addonsJson: item.addonsJson,
          upgradeSnapshotJson: item.upgradeSnapshotJson,
          lineTotal: money(item.lineTotal),
        })),
      }));
    } else {
      const recent = await prisma.order.findMany({
        where: { outletId: context.outletId },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          orderNumber: true,
          orderType: true,
          status: true,
          paymentMethod: true,
          paymentStatus: true,
          createdAt: true,
          items: {
            select: {
              id: true,
              nameSnapshot: true,
              qty: true,
              sizeName: true,
              isMeal: true,
            },
          },
        },
      });
      recentOrders = recent.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        orderType: order.orderType,
        status: order.status,
        paymentMethod: order.paymentMethod,
        paymentProvider: null,
        paymentStatus: order.paymentStatus,
        paymentTransactionId: null,
        paymentReference: null,
        paymentFailureMessage: null,
        productionStartedAt: null,
        hasQuantityStockRequirements: false,
        stockReturnedAutomatically: false,
        manualStockReturnCompleted: false,
        total: null,
        subtotal: null,
        gst: null,
        createdAt: order.createdAt.toISOString(),
        items: order.items.map((item) => ({
          id: item.id,
          nameSnapshot: item.nameSnapshot,
          qty: item.qty,
          sizeName: item.sizeName,
          isMeal: item.isMeal,
          addonsJson: null,
          upgradeSnapshotJson: null,
          lineTotal: null,
        })),
      }));
    }
  }

  let deviceHealth: AdminDashboardSummary["deviceHealth"] = null;
  let deviceFleet: AdminDashboardSummary["deviceFleet"] = null;
  if (canReadDevices) {
    deviceFleet = await buildDeviceFleet({
      outletId: context.outletId,
      canManageDevices,
      now,
    });
    deviceHealth = deviceFleet.counts;
  }

  return {
    generatedAt: now.toISOString(),
    outletId: outlet.id,
    outletName: outlet.name,
    range: {
      key: range.key,
      from: range.from,
      to: range.to,
      label: range.label,
    },
    permissions,
    kpis,
    operations,
    operationsPreview,
    deviceHealth,
    deviceHealthHref: canManageDevices ? "/admin/devices" : null,
    deviceFleet,
    topSellers,
    topSellersBySales,
    recentOrders,
  };
}
