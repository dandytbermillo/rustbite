import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApiPermission } from "@/lib/admin-sessions";
import { updateOrderStatus } from "@/lib/order-updates";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ALLOWED_STATUSES = [
  "AWAITING_COUNTER_PAYMENT",
  "PAID",
  "IN_KITCHEN",
  "READY",
  "COMPLETED",
  "CANCELLED",
] as const;
type UpdatableStatus = (typeof ALLOWED_STATUSES)[number];

function serialize(
  order:
    | (Awaited<ReturnType<typeof prisma.order.findUnique>> & {
        items: Array<{
          id: string;
          nameSnapshot: string;
          qty: number;
          sizeName: string | null;
          isMeal: boolean;
          addonsJson: unknown;
          upgradeSnapshotJson: unknown;
          lineTotal: unknown;
        }>;
        paymentTransaction?: {
          id: string;
          providerReference: string | null;
          failureMessage: string | null;
        } | null;
      })
    | null
) {
  if (!order) return null;
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
    subtotal: Number(order.subtotal),
    gst: Number(order.gst),
    total: Number(order.total),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    items: order.items.map((item) => ({
      id: item.id,
      nameSnapshot: item.nameSnapshot,
      qty: item.qty,
      sizeName: item.sizeName,
      isMeal: item.isMeal,
      addonsJson: item.addonsJson,
      upgradeSnapshotJson: item.upgradeSnapshotJson,
      lineTotal: Number(item.lineTotal),
    })),
  };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const orderScope = await prisma.order.findUnique({
    where: { id },
    select: { id: true, outletId: true },
  });
  if (!orderScope) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const authError = await requireAdminApiPermission(
    req,
    "admin.orders.updateStatus",
    orderScope.outletId
  );
  if (authError) return authError;

  const body = (await req.json().catch(() => null)) as { status?: string } | null;
  const status = body?.status as UpdatableStatus | undefined;

  if (!status || !ALLOWED_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const order = await updateOrderStatus(id, status);
  if (!order) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(serialize(order));
}
