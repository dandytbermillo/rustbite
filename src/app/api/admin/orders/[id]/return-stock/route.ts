import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApiPermissionContext } from "@/lib/admin-sessions";
import {
  parseStockRequirementsJson,
  returnOrderStockRequirements,
} from "@/lib/menu-stock-movements";
import {
  orderHasDealLimitMovements,
  returnOrderDealLimits,
} from "@/lib/deal-selling-limits";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const AUTOMATIC_RESTOCK_REASONS = [
  "ORDER_CANCELLED_RESTOCK",
  "CASH_ORDER_CANCELLED_RESTOCK",
] as const;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const orderScope = await prisma.order.findUnique({
    where: { id },
    select: { id: true, outletId: true },
  });
  if (!orderScope) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const auth = await requireAdminApiPermissionContext(
    req,
    "admin.orders.refund",
    orderScope.outletId
  );
  if (!auth.ok) return auth.response;

  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id },
      include: { paymentTransaction: true },
    });

    if (!order || !order.paymentTransaction) {
      return {
        status: 404,
        body: { error: "Payment transaction not found" },
      } as const;
    }

    const requirements = parseStockRequirementsJson(
      order.paymentTransaction.stockRequirementsJson
    );
    const hasDealLimitMovements = await orderHasDealLimitMovements(tx, {
      outletId: order.outletId,
      orderId: order.id,
    });
    if (requirements.length === 0 && !hasDealLimitMovements) {
      return {
        status: 400,
        body: { error: "This order has no frozen quantity stock to return." },
      } as const;
    }

    const automaticRestockCount = await tx.stockMovement.count({
      where: {
        orderId: order.id,
        reason: { in: [...AUTOMATIC_RESTOCK_REASONS] },
      },
    });
    if (automaticRestockCount > 0) {
      return {
        status: 409,
        body: {
          error:
            "Stock was already returned automatically when this order was cancelled.",
          errorCode: "stock_already_returned_automatically",
        },
      } as const;
    }

    const isAllowedManualReturn =
      order.status === "REFUNDED" ||
      (order.status === "CANCELLED" && Boolean(order.productionStartedAt));
    if (!isAllowedManualReturn) {
      return {
        status: 409,
        body: {
          error:
            "Manual stock return is only available for refunded orders or cancelled orders that had already entered production.",
          errorCode: "stock_return_not_allowed_for_order_state",
        },
      } as const;
    }

    const actor = {
      actorType: "ADMIN_USER",
      actorId: auth.context.actor.userId,
    };
    const stockReturnResult =
      requirements.length > 0
        ? await returnOrderStockRequirements(tx, {
            outletId: order.outletId,
            orderId: order.id,
            requirements,
            actor,
          })
        : { changed: false, returnedItems: [], skippedItems: [] };
    const dealLimitReturnResult = hasDealLimitMovements
      ? await returnOrderDealLimits(tx, {
          outletId: order.outletId,
          orderId: order.id,
          actor,
        })
      : { changed: false, returnedItems: [], skippedItems: [] };
    const returnResult = {
      changed: stockReturnResult.changed || dealLimitReturnResult.changed,
      returnedItems: [
        ...stockReturnResult.returnedItems,
        ...dealLimitReturnResult.returnedItems,
      ],
      skippedItems: [
        ...stockReturnResult.skippedItems,
        ...dealLimitReturnResult.skippedItems,
      ],
    };

    return {
      status: 200,
      body: {
        ok: true,
        ...returnResult,
        alreadyReturned:
          !returnResult.changed && returnResult.skippedItems.length === 0,
      },
    } as const;
  });

  return NextResponse.json(result.body, { status: result.status });
}
