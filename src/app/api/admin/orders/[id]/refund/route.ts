import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/db";
import { requireAdminApiPermission } from "@/lib/admin-sessions";
import { bumpOutletOrderVersion } from "@/lib/outlet-order-sync";
import { canRefundPaymentStatus } from "@/lib/payments";
import { refundStripePaymentIntent } from "@/lib/stripe-terminal";
import type { PaymentTransactionStatus } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const order = await prisma.order.findUnique({
    where: { id },
    include: { paymentTransaction: true },
  });

  if (!order || !order.paymentTransaction) {
    return NextResponse.json(
      { error: "Payment transaction not found" },
      { status: 404 }
    );
  }
  const paymentTransaction = order.paymentTransaction;

  const authError = await requireAdminApiPermission(
    req,
    "admin.orders.refund",
    order.outletId
  );
  if (authError) return authError;

  if (order.status === "REFUNDED") {
    return NextResponse.json({ ok: true, alreadyRefunded: true });
  }

  const paymentStatus = order.paymentStatus as PaymentTransactionStatus | null;
  if (!paymentStatus || !canRefundPaymentStatus(paymentStatus)) {
    return NextResponse.json(
      { error: "Payment is not in a refundable state" },
      { status: 400 }
    );
  }

  try {
    let providerReference: string | undefined;

    if (order.paymentProvider === "STRIPE_TERMINAL") {
      if (!paymentTransaction.providerPaymentIntentId) {
        return NextResponse.json(
          { error: "Stripe payment intent reference is missing" },
          { status: 400 }
        );
      }

      const refunded = await refundStripePaymentIntent(
        paymentTransaction.providerPaymentIntentId
      );

      providerReference = refunded.refundId;
    }

    await prisma.$transaction(async (tx) => {
      await tx.paymentTransaction.update({
        where: { id: paymentTransaction.id },
        data: {
          status: "REFUNDED",
          ...(providerReference ? { providerReference } : {}),
          failureCode: null,
          failureMessage: null,
          lastSyncedAt: new Date(),
        },
      });
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: "REFUNDED",
          paymentStatus: "REFUNDED",
        },
      });
      await bumpOutletOrderVersion(tx, order.outletId);
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json(
        { error: "Payment transaction not found" },
        { status: 404 }
      );
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      return NextResponse.json(
        { error: "Refund could not be applied in current state" },
        { status: 400 }
      );
    }
    if (err instanceof Stripe.errors.StripeError) {
      return NextResponse.json(
        { error: "Refund failed with payment provider" },
        { status: 502 }
      );
    }
    return NextResponse.json({ error: "Refund failed" }, { status: 500 });
  }
}
