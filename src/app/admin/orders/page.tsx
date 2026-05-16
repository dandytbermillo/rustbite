import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { requireAdminPagePermission } from "@/lib/admin-sessions";
import { parseStockRequirementsJson } from "@/lib/menu-stock-movements";
import { classicDeepLinkToWorkspaceTarget } from "@/lib/admin/workspace/deep-links";
import AdminShell from "@/components/admin/Shell";
import OrdersTable from "./OrdersTable";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SearchParams = Promise<{
  status?: string;
  from?: string;
  to?: string;
  order?: string;
  id?: string;
  mode?: string;
}>;

function toUrlSearchParams(params: Awaited<SearchParams>): URLSearchParams {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) next.set(key, value);
  }
  return next;
}

function parseDateBoundary(
  value: string,
  boundary: "start" | "end",
): Date | null {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  if (boundary === "end") date.setHours(23, 59, 59, 999);
  return date;
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const permission = await requireAdminPagePermission("admin.orders.read");
  if (!permission) redirect("/admin/login");
  const outletId = permission.outletId;
  const sp = await searchParams;
  const workspaceTarget = classicDeepLinkToWorkspaceTarget({
    pathname: "/admin/orders",
    searchParams: toUrlSearchParams(sp),
  });
  if (workspaceTarget) redirect(workspaceTarget);

  const filters: {
    outletId: string;
    status?: { in: string[] };
    createdAt?: { gte?: Date; lte?: Date };
  } = { outletId };
  if (sp.status) {
    filters.status = { in: sp.status.split(",") };
  }
  if (sp.from || sp.to) {
    filters.createdAt = {};
    if (sp.from) {
      const fromDate = parseDateBoundary(sp.from, "start");
      if (fromDate) filters.createdAt.gte = fromDate;
    }
    if (sp.to) {
      const toDate = parseDateBoundary(sp.to, "end");
      if (toDate) filters.createdAt.lte = toDate;
    }
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const orderInclude = {
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
  } as const;

  const [orders, todayAgg, activeStatusCounts, completedTodayCount] =
    await Promise.all([
      prisma.order.findMany({
        where: filters,
        orderBy: { createdAt: "desc" },
        take: 200,
        include: orderInclude,
      }),
      prisma.order.aggregate({
        where: { outletId, createdAt: { gte: startOfToday } },
        _count: { _all: true },
        _sum: { total: true },
      }),
      prisma.order.groupBy({
        by: ["status"],
        where: {
          outletId,
          status: { in: ["AWAITING_COUNTER_PAYMENT", "IN_KITCHEN", "READY"] },
        },
        _count: { _all: true },
      }),
      prisma.order.count({
        where: {
          outletId,
          status: "COMPLETED",
          createdAt: { gte: startOfToday },
        },
      }),
    ]);

  const selectedOrderId = sp.order ?? sp.id ?? null;
  let visibleOrders = orders;
  if (selectedOrderId && !orders.some((order) => order.id === selectedOrderId)) {
    const selectedOrder = await prisma.order.findFirst({
      where: { id: selectedOrderId, outletId },
      include: orderInclude,
    });
    if (selectedOrder) {
      visibleOrders = [selectedOrder, ...orders];
    }
  }

  const rows = visibleOrders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    orderType: o.orderType,
    status: o.status,
    paymentMethod: o.paymentMethod,
    paymentProvider: o.paymentProvider,
    paymentStatus: o.paymentStatus,
    paymentTransactionId: o.paymentTransaction?.id ?? null,
    paymentReference: o.paymentTransaction?.providerReference ?? null,
    paymentFailureMessage: o.paymentTransaction?.failureMessage ?? null,
    productionStartedAt: o.productionStartedAt?.toISOString() ?? null,
    hasQuantityStockRequirements:
      parseStockRequirementsJson(o.paymentTransaction?.stockRequirementsJson)
        .length > 0,
    stockReturnedAutomatically: o.stockMovements.some((movement) =>
      ["ORDER_CANCELLED_RESTOCK", "CASH_ORDER_CANCELLED_RESTOCK"].includes(
        movement.reason,
      ),
    ),
    manualStockReturnCompleted: o.stockMovements.some(
      (movement) => movement.reason === "ADMIN_RETURN_STOCK",
    ),
    total: Number(o.total),
    subtotal: Number(o.subtotal),
    gst: Number(o.gst),
    createdAt: o.createdAt.toISOString(),
    items: o.items.map((it) => ({
      id: it.id,
      nameSnapshot: it.nameSnapshot,
      qty: it.qty,
      sizeName: it.sizeName,
      isMeal: it.isMeal,
      addonsJson: it.addonsJson,
      upgradeSnapshotJson: it.upgradeSnapshotJson,
      lineTotal: Number(it.lineTotal),
    })),
  }));

  const findCount = (status: string): number =>
    activeStatusCounts.find((s) => s.status === status)?._count._all ?? 0;

  const stats = {
    todayCount: todayAgg._count._all,
    todayRevenue: Number(todayAgg._sum.total ?? 0),
    awaitingPayment: findCount("AWAITING_COUNTER_PAYMENT"),
    inKitchen: findCount("IN_KITCHEN"),
    ready: findCount("READY"),
    completedToday: completedTodayCount,
  };

  const activeStatusFilter = sp.status ?? null;

  return (
    <AdminShell active="orders">
      <OrdersTable
        orders={rows}
        stats={stats}
        activeStatusFilter={activeStatusFilter}
        dateFrom={sp.from ?? null}
        dateTo={sp.to ?? null}
        initialOpenOrderId={selectedOrderId}
      />
    </AdminShell>
  );
}
