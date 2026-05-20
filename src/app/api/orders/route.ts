import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { buildOrderItemCreates } from "@/lib/checkout";
import { prisma } from "@/lib/db";
import { authorizeOrderApiAccess } from "@/lib/order-api-auth";
import { formatDisplayOrderNumber, getBusinessDate } from "@/lib/outlets";
import {
  isCounterAwaitingPaymentStatus,
  isSuccessfulPaymentStatus,
} from "@/lib/payments";
import {
  decrementOrderStockRequirements,
  MenuStockUnavailableError,
  parseStockRequirementsJson,
} from "@/lib/menu-stock-movements";
import {
  DealLimitUnavailableError,
  decrementOrderDealLimits,
} from "@/lib/deal-selling-limits";
import { bumpOutletOrderVersion } from "@/lib/outlet-order-sync";
import type {
  CheckoutSnapshot,
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentTransactionStatus,
} from "@/lib/types";
import { withObservability } from "@/lib/observability/route-context";
import { captureException } from "@/lib/observability/server";
import {
  createOrderSyncEvent,
  updatePaymentTransactionWithSyncEvent,
} from "@/lib/supabase-sync/outbox";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PostBody = {
  paymentSessionId?: string;
};

type OrderResponseShape = {
  id: string;
  orderNumber: string;
  orderType: string;
  status: string;
  subtotal: Prisma.Decimal;
  gst: Prisma.Decimal;
  total: Prisma.Decimal;
  paymentMethod: string | null;
  paymentProvider: string | null;
  paymentStatus: string | null;
  createdAt: Date;
};

function validate(body: unknown): PostBody {
  if (!body || typeof body !== "object") throw new Error("Invalid body");
  const b = body as Partial<PostBody>;
  if (typeof b.paymentSessionId !== "string" || !b.paymentSessionId) {
    throw new Error("paymentSessionId is required");
  }
  return b as PostBody;
}

function serializeOrder(order: OrderResponseShape) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    orderType: order.orderType,
    status: order.status,
    subtotal: Number(order.subtotal),
    gst: Number(order.gst),
    total: Number(order.total),
    paymentMethod: order.paymentMethod as PaymentMethod | null,
    paymentProvider: order.paymentProvider as PaymentProvider | null,
    paymentStatus: order.paymentStatus as PaymentTransactionStatus | null,
    createdAt: order.createdAt.toISOString(),
  };
}

async function allocateOrderNumber(
  tx: Prisma.TransactionClient,
  outletId: string,
  now: Date
) {
  const outlet = await tx.outlet.findUnique({
    where: { id: outletId },
    select: {
      orderPrefix: true,
      site: { select: { timezone: true } },
    },
  });

  if (!outlet) {
    throw new Error("Order outlet is not configured.");
  }

  const businessDate = getBusinessDate(now, {
    timeZone: outlet.site.timezone,
  });
  const sequence = await tx.outletDailyOrderSequence.upsert({
    where: { outletId_businessDate: { outletId, businessDate } },
    create: {
      outletId,
      businessDate,
      nextSequence: 2,
    },
    update: {
      nextSequence: { increment: 1 },
    },
  });
  const sequenceNumber = sequence.nextSequence - 1;
  const displayOrderNumber = formatDisplayOrderNumber(
    outlet.orderPrefix,
    sequenceNumber
  );

  return { businessDate, sequenceNumber, displayOrderNumber };
}

export async function POST(req: NextRequest) {
  return withObservability(req, async (req, obsCtx) => {
    const auth = await authorizeOrderApiAccess(req, "createOrder");
    if (auth.response) return auth.response;
    const actor = auth.actor!;
    if (actor.deviceId) obsCtx.deviceId = actor.deviceId;
    const contextOutletId = actor.allowedOutletIds[0] ?? actor.outletId;
    if (contextOutletId) obsCtx.outletId = contextOutletId;
    const syncContext = {
      clientType: actor.role,
      deviceId: actor.deviceId,
      requestId: obsCtx.requestId,
    };

    let body: PostBody;
    try {
      body = validate(await req.json());
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }

    if (actor.allowedOutletIds.length === 0) {
      return NextResponse.json(
        { error: "Device outlet is not configured." },
        { status: 403 }
      );
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM "PaymentTransaction"
          WHERE id = ${body.paymentSessionId}
            AND "outletId" IN (${Prisma.join(actor.allowedOutletIds)})
          FOR UPDATE
        `;

        if (lockedRows.length === 0) {
          return { status: 404 as const, error: "Payment session not found" };
        }

        const transaction = await tx.paymentTransaction.findUnique({
          where: { id: body.paymentSessionId },
          include: { order: true },
        });

        if (!transaction) {
          return { status: 404 as const, error: "Payment session not found" };
        }

        if (transaction.order) {
          return {
            status: 200 as const,
            order: transaction.order,
          };
        }

        if (transaction.finalizedOrderId) {
          const finalizedOrder = await tx.order.findUnique({
            where: { id: transaction.finalizedOrderId },
          });
          if (finalizedOrder) {
            return {
              status: 200 as const,
              order: finalizedOrder,
            };
          }
        }

        const transactionStatus = transaction.status as PaymentTransactionStatus;
        const isCounterAwaitingPayment =
          isCounterAwaitingPaymentStatus(transactionStatus);

        if (
          !isSuccessfulPaymentStatus(transactionStatus) &&
          !isCounterAwaitingPayment
        ) {
          return {
            status: 400 as const,
            error: "Payment has not been authorized yet",
          };
        }

        const snapshot = transaction.cartSnapshot as unknown as CheckoutSnapshot;
        const lines = buildOrderItemCreates(snapshot);
        const orderStatus: OrderStatus = isCounterAwaitingPayment
          ? "AWAITING_COUNTER_PAYMENT"
          : "PAID";
        const now = new Date();
        const { businessDate, sequenceNumber, displayOrderNumber } =
          await allocateOrderNumber(tx, transaction.outletId, now);

        const created = await tx.order.create({
          data: {
            orderNumber: displayOrderNumber,
            outletId: transaction.outletId,
            businessDate,
            sequenceNumber,
            displayOrderNumber,
            kioskId: snapshot.kioskId,
            orderType: snapshot.orderType,
            status: orderStatus,
            paymentMethod: snapshot.paymentMethod,
            paymentProvider: transaction.provider,
            paymentStatus: transactionStatus,
            subtotal: new Prisma.Decimal(snapshot.subtotal),
            gst: new Prisma.Decimal(snapshot.gst),
            total: new Prisma.Decimal(snapshot.total),
            items: { create: lines },
          },
        });

        await decrementOrderStockRequirements(tx, {
          outletId: transaction.outletId,
          orderId: created.id,
          requirements: parseStockRequirementsJson(
            transaction.stockRequirementsJson
          ),
          now,
        });
        await decrementOrderDealLimits(tx, {
          outletId: transaction.outletId,
          orderId: created.id,
          snapshot: transaction.cartSnapshot,
          now,
        });

        await updatePaymentTransactionWithSyncEvent(tx, {
          id: transaction.id,
          data: {
            orderId: created.id,
            finalizedOrderId: created.id,
            finalizedAt: transaction.finalizedAt ?? now,
            completedAt:
              transaction.completedAt ?? (isCounterAwaitingPayment ? null : now),
          },
          context: syncContext,
        });

        const version = await bumpOutletOrderVersion(tx, transaction.outletId);
        const syncedOrder = await tx.order.findUniqueOrThrow({
          where: { id: created.id },
          include: { items: true, paymentTransaction: true },
        });
        await createOrderSyncEvent(tx, {
          eventType: "order.created",
          order: syncedOrder,
          idempotencyKey: `order:${created.id}:created:rev:${version.revision}`,
          sourceRevision: version.revision,
          nextStatus: created.status,
          context: syncContext,
        });

        return {
          status: 201 as const,
          order: syncedOrder,
        };
      });

      if ("error" in result) {
        return NextResponse.json(
          { error: result.error },
          { status: result.status }
        );
      }

      return NextResponse.json(serializeOrder(result.order), {
        status: result.status,
      });
    } catch (err) {
      if (
        err instanceof MenuStockUnavailableError ||
        err instanceof DealLimitUnavailableError
      ) {
        return NextResponse.json(
          {
            errorCode: err.code,
            error: err.message,
            items: err.items,
          },
          { status: 409 }
        );
      }
      captureException(err);
      console.error("Order finalization failed", err);
      return NextResponse.json(
        {
          error:
            "We could not create the order. Please try again or ask staff for help.",
        },
        { status: 500 }
      );
    }
  });
}

export async function GET(req: NextRequest) {
  return withObservability(req, async (req, obsCtx) => {
    const auth = await authorizeOrderApiAccess(req, "readOrderFeed");
    if (auth.response) return auth.response;
    const actor = auth.actor!;
    if (actor.deviceId) obsCtx.deviceId = actor.deviceId;
    const contextOutletId = actor.allowedOutletIds[0] ?? actor.outletId;
    if (contextOutletId) obsCtx.outletId = contextOutletId;

    const url = new URL(req.url);
    const statusParam = url.searchParams.get("status");
    const since = url.searchParams.get("since");
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "200"), 500);

    const where: Prisma.OrderWhereInput = {
      outletId: { in: actor.allowedOutletIds },
    };
    if (statusParam) {
      const statuses = statusParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (statuses.length) where.status = { in: statuses };
    }
    if (since) {
      const d = new Date(since);
      if (!Number.isNaN(d.getTime())) where.createdAt = { gte: d };
    }

    const orders = await prisma.order.findMany({
      where,
      orderBy: { createdAt: "asc" },
      take: limit,
      include: { items: true, paymentTransaction: true },
    });

    return NextResponse.json({
      orders: orders.map((o) => ({
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
      })),
    });
  });
}
