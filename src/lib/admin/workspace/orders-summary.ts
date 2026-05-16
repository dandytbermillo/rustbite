import "server-only";

import { prisma } from "@/lib/db";
import type { AdminPermissionContext } from "@/lib/admin-sessions";
import { parseStockRequirementsJson } from "@/lib/menu-stock-movements";

export type WorkspaceOrdersFilterKey = "all" | "payment" | "kitchen" | "ready";

export type WorkspaceOrderRow = {
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
  total: number;
  subtotal: number;
  gst: number;
  createdAt: string;
  items: Array<{
    id: string;
    nameSnapshot: string;
    qty: number;
    sizeName: string | null;
    isMeal: boolean;
    addonsJson: unknown;
    addOnSetSelectionsJson: unknown;
    upgradeSnapshotJson: unknown;
    lineTotal: number;
  }>;
};

export type AdminWorkspaceOrdersSummary = {
  generatedAt: string;
  outletId: string;
  filter: WorkspaceOrdersFilterKey;
  targetOrderId: string | null;
  counts: {
    all: number;
    payment: number;
    kitchen: number;
    ready: number;
  };
  orders: WorkspaceOrderRow[];
  limit: number;
};

const ACTIVE_ORDER_STATUSES = [
  "AWAITING_COUNTER_PAYMENT",
  "PAID",
  "IN_KITCHEN",
  "READY",
] as const;

const FILTER_STATUSES: Record<WorkspaceOrdersFilterKey, string[]> = {
  all: [...ACTIVE_ORDER_STATUSES],
  payment: ["AWAITING_COUNTER_PAYMENT"],
  kitchen: ["PAID", "IN_KITCHEN"],
  ready: ["READY"],
};

const DEFAULT_LIMIT = 50;

export function parseWorkspaceOrdersFilter(
  value: string | null | undefined,
): WorkspaceOrdersFilterKey {
  return value === "payment" || value === "kitchen" || value === "ready"
    ? value
    : "all";
}

export function workspaceOrdersFilterFromStatus(
  value: string | null | undefined,
): WorkspaceOrdersFilterKey {
  if (!value) return "all";
  const statuses = value.split(",").map((status) => status.trim());
  if (
    statuses.length === 1 &&
    statuses[0] === "AWAITING_COUNTER_PAYMENT"
  ) {
    return "payment";
  }
  if (
    statuses.length > 0 &&
    statuses.every((status) => status === "PAID" || status === "IN_KITCHEN")
  ) {
    return "kitchen";
  }
  if (statuses.length === 1 && statuses[0] === "READY") return "ready";
  return "all";
}

function numberValue(value: { toString(): string } | number | null): number {
  if (value == null) return 0;
  return typeof value === "number" ? value : Number(value);
}

function mapOrderRow(order: {
  id: string;
  orderNumber: string;
  orderType: string;
  status: string;
  paymentMethod: string | null;
  paymentProvider: string | null;
  paymentStatus: string | null;
  productionStartedAt: Date | null;
  total: { toString(): string };
  subtotal: { toString(): string };
  gst: { toString(): string };
  createdAt: Date;
  paymentTransaction: {
    id: string;
    providerReference: string | null;
    failureMessage: string | null;
    stockRequirementsJson: unknown;
  } | null;
  stockMovements: Array<{ reason: string }>;
  items: Array<{
    id: string;
    nameSnapshot: string;
    qty: number;
    sizeName: string | null;
    isMeal: boolean;
    addonsJson: unknown;
    addOnSetSelectionsJson: unknown;
    upgradeSnapshotJson: unknown;
    lineTotal: { toString(): string };
  }>;
}): WorkspaceOrderRow {
  return {
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
      parseStockRequirementsJson(order.paymentTransaction?.stockRequirementsJson)
        .length > 0,
    stockReturnedAutomatically: order.stockMovements.some((movement) =>
      ["ORDER_CANCELLED_RESTOCK", "CASH_ORDER_CANCELLED_RESTOCK"].includes(
        movement.reason,
      ),
    ),
    manualStockReturnCompleted: order.stockMovements.some(
      (movement) => movement.reason === "ADMIN_RETURN_STOCK",
    ),
    total: numberValue(order.total),
    subtotal: numberValue(order.subtotal),
    gst: numberValue(order.gst),
    createdAt: order.createdAt.toISOString(),
    items: order.items.map((item) => ({
      id: item.id,
      nameSnapshot: item.nameSnapshot,
      qty: item.qty,
      sizeName: item.sizeName,
      isMeal: item.isMeal,
      addonsJson: item.addonsJson,
      addOnSetSelectionsJson: item.addOnSetSelectionsJson,
      upgradeSnapshotJson: item.upgradeSnapshotJson,
      lineTotal: numberValue(item.lineTotal),
    })),
  };
}

export async function buildAdminWorkspaceOrdersSummary({
  context,
  filter,
  targetOrderId,
  limit = DEFAULT_LIMIT,
  now = new Date(),
}: {
  context: AdminPermissionContext;
  filter: WorkspaceOrdersFilterKey;
  targetOrderId?: string | null;
  limit?: number;
  now?: Date;
}): Promise<AdminWorkspaceOrdersSummary> {
  const take = Math.max(1, Math.min(limit, DEFAULT_LIMIT));
  const orderSelect = {
    id: true,
    orderNumber: true,
    orderType: true,
    status: true,
    paymentMethod: true,
    paymentProvider: true,
    paymentStatus: true,
    productionStartedAt: true,
    total: true,
    subtotal: true,
    gst: true,
    createdAt: true,
    items: {
      select: {
        id: true,
        nameSnapshot: true,
        qty: true,
        sizeName: true,
        isMeal: true,
        addonsJson: true,
        addOnSetSelectionsJson: true,
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
  } as const;

  const [orders, activeStatusCounts] = await Promise.all([
    prisma.order.findMany({
      where: {
        outletId: context.outletId,
        status: { in: FILTER_STATUSES[filter] },
      },
      orderBy: { createdAt: "desc" },
      take,
      select: orderSelect,
    }),
    prisma.order.groupBy({
      by: ["status"],
      where: {
        outletId: context.outletId,
        status: { in: [...ACTIVE_ORDER_STATUSES] },
      },
      _count: { _all: true },
    }),
  ]);

  let visibleOrders = orders;
  if (targetOrderId && !orders.some((order) => order.id === targetOrderId)) {
    const targetOrder = await prisma.order.findFirst({
      where: { id: targetOrderId, outletId: context.outletId },
      select: orderSelect,
    });
    if (targetOrder) {
      visibleOrders = [targetOrder, ...orders];
    }
  }

  const findCount = (status: string): number =>
    activeStatusCounts.find((entry) => entry.status === status)?._count._all ??
    0;
  const payment = findCount("AWAITING_COUNTER_PAYMENT");
  const paid = findCount("PAID");
  const inKitchen = findCount("IN_KITCHEN");
  const ready = findCount("READY");

  return {
    generatedAt: now.toISOString(),
    outletId: context.outletId,
    filter,
    targetOrderId: targetOrderId ?? null,
    counts: {
      all: payment + paid + inKitchen + ready,
      payment,
      kitchen: paid + inKitchen,
      ready,
    },
    orders: visibleOrders.map(mapOrderRow),
    limit: take,
  };
}
