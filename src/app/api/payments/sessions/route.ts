import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import {
  assertExpectedTotalMatches,
  buildCheckoutSnapshot,
  CheckoutContractError,
  isCounterPaymentMethod,
  validateCheckoutRequest,
} from "@/lib/checkout";
import { prisma } from "@/lib/db";
import { authorizeDeviceApiAccess } from "@/lib/order-api-auth";
import { getConfiguredPaymentProvider, PAYMENT_CURRENCY } from "@/lib/payments";
import {
  createAndProcessStripeTerminalPayment,
  isStripeTerminalConfigured,
} from "@/lib/stripe-terminal";
import { hasQuantityStockRequirements } from "@/lib/menu-stock-movements";
import { checkoutSnapshotHasDealLines } from "@/lib/deal-selling-limits";
import type {
  PaymentSessionErrorResponse,
  PaymentSessionSummary,
  PaymentTransactionStatus,
} from "@/lib/types";
import { withObservability } from "@/lib/observability/route-context";
import { captureException } from "@/lib/observability/server";
import {
  createPaymentTransactionWithSyncEvent,
  updatePaymentTransactionWithSyncEvent,
} from "@/lib/supabase-sync/outbox";

// Customer-facing sanitized message stored in DB AND returned to kiosk.
// The raw provider/config exception is sent through `captureException` so
// operators retain full detail in observability without leaking provider
// internals (Stripe error codes, config diagnostics, etc.) to the customer
// screen. Per docs/production-observability-plan-2026-05-14.md line 343:
// "do not return raw provider/configuration exception messages to kiosk
// customers; emit a safe error code/message and capture the redacted
// details server-side."
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

function paymentSessionError(
  error: string,
  status: number,
  errorCode?: PaymentSessionErrorResponse["errorCode"],
  items?: PaymentSessionErrorResponse["items"]
) {
  const body: PaymentSessionErrorResponse = errorCode
    ? { error, errorCode, ...(items ? { items } : {}) }
    : { error };
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest) {
  return withObservability(req, async (req, obsCtx) => {
    const auth = await authorizeDeviceApiAccess(req, ["kiosk"]);
    if (auth.response) return auth.response;
    const actor = auth.actor!;
    const syncContext = {
      clientType: actor.role,
      deviceId: actor.deviceId,
      requestId: obsCtx.requestId,
    };
    const outletId = actor.allowedOutletIds[0] ?? actor.outletId;
    if (!outletId) {
      return paymentSessionError("Device outlet is not configured.", 403);
    }

    let body;
    try {
      body = validateCheckoutRequest(await req.json());
    } catch (err) {
      return paymentSessionError((err as Error).message, 400);
    }

    try {
      const snapshot = await buildCheckoutSnapshot(body, outletId);
      const { stockRequirements = [], ...cartSnapshot } = snapshot;
      assertExpectedTotalMatches(snapshot, body.expectedTotal);
      const provider = isCounterPaymentMethod(snapshot.paymentMethod)
        ? "COUNTER"
        : getConfiguredPaymentProvider();
      if (
        provider === "STRIPE_TERMINAL" &&
        (hasQuantityStockRequirements(stockRequirements) ||
          checkoutSnapshotHasDealLines(cartSnapshot))
      ) {
        return paymentSessionError(
          "Deals and quantity-tracked items cannot use card/mobile checkout yet. Please choose pay at counter.",
          409,
          "MENU_STOCK_EXTERNAL_PAYMENT_UNSUPPORTED"
        );
      }
      const isCounterPayment = provider === "COUNTER";
      const isMockPayment = provider === "MOCK";
      const transaction = await prisma.$transaction((tx) =>
        createPaymentTransactionWithSyncEvent(tx, {
          data: {
            outletId,
            kioskId: snapshot.kioskId,
            orderType: snapshot.orderType,
            paymentMethod: snapshot.paymentMethod,
            provider,
            status: isCounterPayment
              ? "PENDING_COUNTER_PAYMENT"
              : isMockPayment
                ? "CAPTURED"
                : "CREATED",
            currency: PAYMENT_CURRENCY,
            subtotal: new Prisma.Decimal(snapshot.subtotal),
            gst: new Prisma.Decimal(snapshot.gst),
            total: new Prisma.Decimal(snapshot.total),
            cartSnapshot,
            ...(stockRequirements.length > 0
              ? {
                  stockRequirementsJson:
                    stockRequirements as unknown as Prisma.InputJsonValue,
                }
              : {}),
            providerReference: isCounterPayment
              ? `counter_${Date.now()}`
              : isMockPayment
                ? `mock_${Date.now()}`
                : null,
            completedAt: isMockPayment ? new Date() : null,
            lastSyncedAt: isCounterPayment || isMockPayment ? new Date() : null,
          },
          context: syncContext,
        })
      );

      if (isCounterPayment || isMockPayment) {
        return NextResponse.json(serializePaymentSession(transaction), { status: 201 });
      }

      if (!isStripeTerminalConfigured()) {
        // Config-level misconfiguration on the server. The previous code
        // returned the literal env-var names to the kiosk customer, which
        // both leaks deployment internals (which provider, which env vars)
        // and is useless to the user. Route it through observability so
        // ops sees the misconfig, and store + return the generic constant.
        captureException(
          new Error(
            "Stripe Terminal is not configured. Required env vars: STRIPE_SECRET_KEY, STRIPE_TERMINAL_READER_ID.",
          ),
        );
        await prisma.$transaction((tx) =>
          updatePaymentTransactionWithSyncEvent(tx, {
            id: transaction.id,
            data: {
              status: "FAILED",
              failureMessage: PAYMENT_PROCESSING_FAILED_MESSAGE,
              lastSyncedAt: new Date(),
            },
            context: syncContext,
          })
        );
        return paymentSessionError(PAYMENT_PROCESSING_FAILED_MESSAGE, 500);
      }

      try {
        const processed = await createAndProcessStripeTerminalPayment({
          sessionId: transaction.id,
          paymentMethod: snapshot.paymentMethod,
          snapshot,
        });

        const updated = await prisma.$transaction((tx) =>
          updatePaymentTransactionWithSyncEvent(tx, {
            id: transaction.id,
            data: {
              status: processed.status,
              providerPaymentIntentId: processed.providerPaymentIntentId,
              providerReaderId: processed.providerReaderId,
              providerReference: processed.providerReference,
              completedAt:
                processed.status === "CAPTURED" || processed.status === "AUTHORIZED"
                  ? new Date()
                  : null,
              lastSyncedAt: new Date(),
            },
            context: syncContext,
          })
        );

        return NextResponse.json(serializePaymentSession(updated), { status: 201 });
      } catch (err) {
        captureException(err);
        const failed = await prisma.$transaction((tx) =>
          updatePaymentTransactionWithSyncEvent(tx, {
            id: transaction.id,
            data: {
              status: "FAILED",
              // Sanitized: see PAYMENT_PROCESSING_FAILED_MESSAGE comment above.
              // The raw `err` is in observability via captureException; the
              // customer sees only the generic string.
              failureMessage: PAYMENT_PROCESSING_FAILED_MESSAGE,
              lastSyncedAt: new Date(),
            },
            context: syncContext,
          })
        );
        return NextResponse.json(serializePaymentSession(failed), { status: 502 });
      }
    } catch (err) {
      if (err instanceof CheckoutContractError) {
        // Known business conflict — the message is by design surfaced to
        // the client so the kiosk can show a useful "items unavailable"
        // hint. Status 409 reflects "conflict with current state".
        return paymentSessionError(err.message, 409, err.code, err.items);
      }
      // Anything else hitting this broad catch is an unexpected server
      // failure (snapshot build error, provider-config mismatch, DB error,
      // a downstream throw escaping the inner Stripe try/catch). Per the
      // observability plan, such 500-class failures must be reported AND
      // returned with a sanitized response so we don't leak Prisma error
      // shapes, internal config names, or stack-derived information to
      // the kiosk customer.
      captureException(err);
      return paymentSessionError(PAYMENT_PROCESSING_FAILED_MESSAGE, 500);
    }
  });
}
