import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeDeviceApiAccess } from "@/lib/order-api-auth";
import { isTerminalPendingStatus } from "@/lib/payments";
import { syncStripeTerminalPayment } from "@/lib/stripe-terminal";
import type { PaymentSessionSummary, PaymentTransactionStatus } from "@/lib/types";
import { withObservability } from "@/lib/observability/route-context";
import { captureException } from "@/lib/observability/server";

// Customer-facing sanitized message stored in DB AND returned to kiosk
// (same constant as in `/api/payments/sessions/route.ts`). Raw provider
// exception goes through `captureException`. See plan line 343.
const PAYMENT_PROCESSING_FAILED_MESSAGE =
  "Payment processing failed. Please try again or pay at the counter.";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function serializePaymentSession(
  transaction: {
    id: string;
    provider: string;
    status: string;
    paymentMethod: string;
    currency: string;
    subtotal: Prisma.Decimal;
    gst: Prisma.Decimal;
    total: Prisma.Decimal;
    failureCode: string | null;
    failureMessage: string | null;
    orderId: string | null;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }
): PaymentSessionSummary {
  return {
    id: transaction.id,
    provider: transaction.provider as PaymentSessionSummary["provider"],
    status: transaction.status as PaymentTransactionStatus,
    paymentMethod: transaction.paymentMethod as PaymentSessionSummary["paymentMethod"],
    currency: transaction.currency,
    subtotal: Number(transaction.subtotal),
    gst: Number(transaction.gst),
    total: Number(transaction.total),
    failureCode: transaction.failureCode,
    failureMessage: transaction.failureMessage,
    orderId: transaction.orderId,
    completedAt: transaction.completedAt?.toISOString() ?? null,
    createdAt: transaction.createdAt.toISOString(),
    updatedAt: transaction.updatedAt.toISOString(),
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withObservability(req, async (req, _obsCtx) => {
  const auth = await authorizeDeviceApiAccess(req, ["kiosk"]);
  if (auth.response) return auth.response;
  const actor = auth.actor!;

  const { id } = await params;
  let transaction = await prisma.paymentTransaction.findFirst({
    where: {
      id,
      outletId: { in: actor.allowedOutletIds },
    },
  });
  if (!transaction) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (
    transaction.provider === "STRIPE_TERMINAL" &&
    isTerminalPendingStatus(transaction.status as PaymentTransactionStatus) &&
    transaction.providerPaymentIntentId
  ) {
    try {
      const sync = await syncStripeTerminalPayment({
        providerPaymentIntentId: transaction.providerPaymentIntentId,
        providerReaderId: transaction.providerReaderId,
      });

      transaction = await prisma.paymentTransaction.update({
        where: { id: transaction.id },
        data: {
          status: sync.status,
          providerReference: sync.providerReference,
          failureCode: sync.failureCode,
          failureMessage: sync.failureMessage,
          completedAt:
            sync.status === "CAPTURED" || sync.status === "AUTHORIZED"
              ? transaction.completedAt ?? new Date()
              : transaction.completedAt,
          lastSyncedAt: new Date(),
        },
      });
    } catch (err) {
      captureException(err);
      transaction = await prisma.paymentTransaction.update({
        where: { id: transaction.id },
        data: {
          status: "FAILED",
          // Sanitized: raw err goes to observability via captureException;
          // the customer-facing failureMessage is generic per plan line 343.
          failureMessage: PAYMENT_PROCESSING_FAILED_MESSAGE,
          lastSyncedAt: new Date(),
        },
      });
    }
  }

  return NextResponse.json(serializePaymentSession(transaction));
  });
}
