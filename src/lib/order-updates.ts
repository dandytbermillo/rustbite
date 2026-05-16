import { prisma } from "./db";
import {
  parseStockRequirementsJson,
  restockCancelledOrderStockRequirements,
} from "./menu-stock-movements";
import { restockCancelledOrderDealLimits } from "./deal-selling-limits";
import { bumpOutletOrderVersion } from "./outlet-order-sync";
import {
  createOrderSyncEvent,
  updatePaymentTransactionWithSyncEvent,
} from "./supabase-sync/outbox";
import type { OrderStatus, PaymentTransactionStatus } from "./types";

function getCounterPaymentStatusUpdate(
  currentStatus: string,
  paymentMethod: string | null,
  nextStatus: OrderStatus
): PaymentTransactionStatus | null {
  if (
    currentStatus !== "AWAITING_COUNTER_PAYMENT" ||
    paymentMethod !== "CASH"
  ) {
    return null;
  }

  if (nextStatus === "PAID") return "CAPTURED";
  if (nextStatus === "CANCELLED") return "CANCELLED";
  return null;
}

function isProductionStatus(status: OrderStatus): boolean {
  return status === "IN_KITCHEN" || status === "READY" || status === "COMPLETED";
}

export async function updateOrderStatus(
  id: string,
  status: OrderStatus,
  options?: { outletIds?: string[] }
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.order.findFirst({
      where: {
        id,
        ...(options?.outletIds?.length
          ? { outletId: { in: options.outletIds } }
          : {}),
      },
      include: { items: true, paymentTransaction: true },
    });

    if (!existing) return null;
    if (existing.status === status) return existing;

    const paymentStatus = getCounterPaymentStatusUpdate(
      existing.status,
      existing.paymentMethod,
      status
    );
    const now = new Date();

    if (paymentStatus && existing.paymentTransaction) {
      await updatePaymentTransactionWithSyncEvent(tx, {
        id: existing.paymentTransaction.id,
        data: {
          status: paymentStatus,
          failureCode: null,
          failureMessage: null,
          completedAt:
            paymentStatus === "CAPTURED"
              ? existing.paymentTransaction.completedAt ?? now
              : existing.paymentTransaction.completedAt,
          lastSyncedAt: now,
        },
      });
    }

    const updated = await tx.order.update({
      where: { id },
      data: {
        status,
        ...(paymentStatus ? { paymentStatus } : {}),
        ...(isProductionStatus(status) && !existing.productionStartedAt
          ? { productionStartedAt: now }
          : {}),
      },
      include: { items: true, paymentTransaction: true },
    });

    await restockCancelledOrderStockRequirements(tx, {
      outletId: existing.outletId,
      orderId: existing.id,
      previousStatus: existing.status,
      nextStatus: status,
      productionStartedAt: existing.productionStartedAt,
      requirements: parseStockRequirementsJson(
        existing.paymentTransaction?.stockRequirementsJson
      ),
      now,
    });
    await restockCancelledOrderDealLimits(tx, {
      outletId: existing.outletId,
      orderId: existing.id,
      previousStatus: existing.status,
      nextStatus: status,
      productionStartedAt: existing.productionStartedAt,
      now,
    });

    const version = await bumpOutletOrderVersion(tx, existing.outletId);
    await createOrderSyncEvent(tx, {
      eventType: "order.status_updated",
      order: updated,
      idempotencyKey: `order:${updated.id}:status:${existing.status}->${status}:rev:${version.revision}`,
      sourceRevision: version.revision,
      previousStatus: existing.status,
      nextStatus: status,
    });

    return updated;
  });
}
