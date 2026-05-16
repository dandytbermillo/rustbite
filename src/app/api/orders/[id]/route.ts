import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { updateOrderStatus } from "@/lib/order-updates";
import { authorizeOrderApiAccess } from "@/lib/order-api-auth";
import {
  recordActiveOperatorAction,
  requireActiveOperationalOperator,
} from "@/lib/active-operator-authz";
import {
  parseStockRequirementsJson,
  restockCancelledOrderStockRequirements,
} from "@/lib/menu-stock-movements";
import { restockCancelledOrderDealLimits } from "@/lib/deal-selling-limits";
import { bumpOutletOrderVersion } from "@/lib/outlet-order-sync";
import { checkDeviceTransition } from "@/lib/order-status-transitions";
import { getLoginIpHash } from "@/lib/login-rate-limit";
import type { DeviceSessionActor } from "@/lib/device-sessions";
import {
  createOrderSyncEvent,
  updatePaymentTransactionWithSyncEvent,
} from "@/lib/supabase-sync/outbox";

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

function isProductionStatus(status: UpdatableStatus): boolean {
  return status === "IN_KITCHEN" || status === "READY" || status === "COMPLETED";
}

function serialize(
  o:
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
  if (!o) return null;
  return {
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
    subtotal: Number(o.subtotal),
    gst: Number(o.gst),
    total: Number(o.total),
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
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
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeOrderApiAccess(_req, "readOrderDetail");
  if (auth.response) return auth.response;
  const actor = auth.actor!;

  const { id } = await params;
  const order = await prisma.order.findFirst({
    where: {
      id,
      outletId: { in: actor.allowedOutletIds },
    },
    include: { items: true, paymentTransaction: true },
  });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(serialize(order));
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeOrderApiAccess(req, "updateOrder");
  if (auth.response) return auth.response;
  const actor = auth.actor!;

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { status?: string } | null;
  const status = body?.status as UpdatableStatus | undefined;
  if (!status || !ALLOWED_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  // Phase 3: enforce active operator on non-legacy counter/kitchen sessions.
  // Legacy device sessions continue on the existing pass-through path until
  // Phase 5 explicitly retires them. This preserves dev/test workflows that
  // use legacy device cookies (e.g. test-cash-order-flow).
  const enforceActiveOperator =
    !actor.isLegacy &&
    (actor.role === "counter" || actor.role === "kitchen");

  if (enforceActiveOperator) {
    return handleDeviceOperatorOrderUpdate(req, id, status, actor);
  }

  const order = await updateOrderStatus(id, status, {
    outletIds: actor.allowedOutletIds,
  });
  if (!order) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(serialize(order));
}

async function handleDeviceOperatorOrderUpdate(
  req: NextRequest,
  orderId: string,
  nextStatus: UpdatableStatus,
  actor: DeviceSessionActor
): Promise<NextResponse> {
  // Cheap pre-checks BEFORE we run the (slower) live operator re-check.
  const existing = await prisma.order.findFirst({
    where: { id: orderId, outletId: { in: actor.allowedOutletIds } },
    select: { id: true, outletId: true, status: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const transition = checkDeviceTransition(actor.role, existing.status, nextStatus);
  if (!transition.ok) {
    return NextResponse.json(
      {
        error: `${actor.role} surface cannot transition ${existing.status} → ${nextStatus}`,
        errorCode: transition.reason,
      },
      { status: 409 }
    );
  }

  // Live operator authorization: account active, account type eligible,
  // surface granted, outlet role MANAGER/OPERATOR at the order's outlet,
  // not idle-expired. On failure, the wrapper has already cleared
  // active-operator state and written DEVICE_STAFF_EXPIRED or
  // DEVICE_STAFF_INVALIDATED.
  const auth = await requireActiveOperationalOperator(req, {
    requiredOutletId: existing.outletId,
    actor,
  });
  if (!auth.ok) return auth.response;
  const operator = auth.operator;

  // Single transaction: re-read live status, re-check transition (so a
  // stale tab can't apply an invalid update after another device has
  // already moved the order), apply update, update payment-side rows
  // for cash counter payments, ATOMICALLY revalidate active operator
  // (so a cascade between auth and commit cannot let a stale operator
  // mutate the order), write the ORDER_STATUS_UPDATED_BY_DEVICE_STAFF
  // audit row.
  const result = await prisma.$transaction(async (tx) => {
    const live = await tx.order.findFirst({
      where: { id: orderId, outletId: { in: actor.allowedOutletIds } },
      include: { paymentTransaction: true },
    });
    if (!live) return { kind: "not_found" as const };

    const liveTransition = checkDeviceTransition(
      actor.role,
      live.status,
      nextStatus
    );
    if (!liveTransition.ok) {
      return {
        kind: "transition_conflict" as const,
        currentStatus: live.status,
      };
    }

    // Race-safe: atomically confirm the device session still carries the
    // SAME active operator we authorized with, then bump lastActionAt.
    // If any cascade (PIN reset, role revoke, surface revoke, account
    // deactivation, idle expiry) cleared activeStaff* between our auth
    // read and this point, this returns false and we abort BEFORE
    // mutating the order. Plan §647-661.
    const stillAuthorized = await recordActiveOperatorAction(tx, operator);
    if (!stillAuthorized) {
      return { kind: "operator_invalidated" as const };
    }

    // Cash counter capture: when transitioning AWAITING_COUNTER_PAYMENT →
    // PAID/CANCELLED for a CASH order, mirror the same payment-side update
    // the legacy `updateOrderStatus` performs.
    const now = new Date();
    if (
      live.status === "AWAITING_COUNTER_PAYMENT" &&
      live.paymentMethod === "CASH" &&
      live.paymentTransaction
    ) {
      const nextPaymentStatus =
        nextStatus === "PAID"
          ? "CAPTURED"
          : nextStatus === "CANCELLED"
            ? "CANCELLED"
            : null;
      if (nextPaymentStatus) {
        await updatePaymentTransactionWithSyncEvent(tx, {
          id: live.paymentTransaction.id,
          data: {
            status: nextPaymentStatus,
            failureCode: null,
            failureMessage: null,
            completedAt:
              nextPaymentStatus === "CAPTURED"
                ? live.paymentTransaction.completedAt ?? now
                : live.paymentTransaction.completedAt,
            lastSyncedAt: now,
          },
          context: {
            clientType: actor.role,
            deviceId: actor.deviceId,
          },
        });
      }
    }

    const updated = await tx.order.update({
      where: { id: orderId },
      data: {
        status: nextStatus,
        ...(live.status === "AWAITING_COUNTER_PAYMENT" &&
        live.paymentMethod === "CASH"
          ? {
              paymentStatus:
                nextStatus === "PAID"
                  ? "CAPTURED"
                  : nextStatus === "CANCELLED"
                    ? "CANCELLED"
                  : live.paymentStatus,
            }
          : {}),
        ...(isProductionStatus(nextStatus) && !live.productionStartedAt
          ? { productionStartedAt: now }
          : {}),
      },
      include: { items: true, paymentTransaction: true },
    });

    await restockCancelledOrderStockRequirements(tx, {
      outletId: live.outletId,
      orderId: live.id,
      previousStatus: live.status,
      nextStatus,
      productionStartedAt: live.productionStartedAt,
      requirements: parseStockRequirementsJson(
        live.paymentTransaction?.stockRequirementsJson
      ),
      now,
    });
    await restockCancelledOrderDealLimits(tx, {
      outletId: live.outletId,
      orderId: live.id,
      previousStatus: live.status,
      nextStatus,
      productionStartedAt: live.productionStartedAt,
      now,
    });

    const version = await bumpOutletOrderVersion(tx, live.outletId);
    await createOrderSyncEvent(tx, {
      eventType: "order.status_updated",
      order: updated,
      idempotencyKey: `order:${updated.id}:status:${live.status}->${nextStatus}:rev:${version.revision}`,
      sourceRevision: version.revision,
      previousStatus: live.status,
      nextStatus,
      context: {
        clientType: actor.role,
        deviceId: actor.deviceId,
      },
    });

    await tx.authAuditLog.create({
      data: {
        eventType: "ORDER_STATUS_UPDATED_BY_DEVICE_STAFF",
        actorType: "OPERATOR_ON_DEVICE",
        actorId: operator.userId,
        actorLabel: operator.displayName,
        targetType: "ORDER",
        targetId: orderId,
        targetLabel: live.orderNumber,
        outletId: live.outletId,
        ipHash: getLoginIpHash(req),
        userAgent: req.headers.get("user-agent") ?? null,
        metadata: {
          deviceId: operator.deviceId,
          deviceRole: operator.deviceRole,
          usedSurface: operator.surface,
          usedOutletRole: operator.outletRole,
          accountType: operator.accountType,
          previousStatus: live.status,
          nextStatus,
        } as Prisma.InputJsonObject,
      },
    });

    return { kind: "ok" as const, order: updated };
  });

  if (result.kind === "not_found") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (result.kind === "transition_conflict") {
    return NextResponse.json(
      {
        error: `Order is in status ${result.currentStatus}; transition no longer valid for ${actor.role}.`,
        errorCode: "stale_transition",
        currentStatus: result.currentStatus,
      },
      { status: 409 }
    );
  }
  if (result.kind === "operator_invalidated") {
    return NextResponse.json(
      {
        error:
          "Active operator state changed during this action. Sign in again to continue.",
        errorCode: "operator_invalidated",
        operatorRequired: true,
      },
      { status: 409 }
    );
  }

  return NextResponse.json(serialize(result.order));
}
