import Stripe from "stripe";
import { PAYMENT_CURRENCY, toMinorUnits } from "./payments";
import type {
  CheckoutSnapshot,
  PaymentMethod,
  PaymentTransactionStatus,
} from "./types";

const globalForStripe = globalThis as unknown as { stripe?: Stripe };

function createStripeClient(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }

  return new Stripe(secretKey);
}

export function getStripeClient(): Stripe {
  if (globalForStripe.stripe) return globalForStripe.stripe;
  const client = createStripeClient();
  if (process.env.NODE_ENV !== "production") {
    globalForStripe.stripe = client;
  }
  return client;
}

export function isStripeTerminalConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_TERMINAL_READER_ID;
}

function getReaderId(): string {
  const readerId = process.env.STRIPE_TERMINAL_READER_ID;
  if (!readerId) {
    throw new Error("STRIPE_TERMINAL_READER_ID is not configured");
  }
  return readerId;
}

function getPaymentMethodTypes(): Array<"card_present" | "interac_present"> {
  return PAYMENT_CURRENCY === "cad"
    ? ["card_present", "interac_present"]
    : ["card_present"];
}

export async function createAndProcessStripeTerminalPayment(args: {
  sessionId: string;
  paymentMethod: PaymentMethod;
  snapshot: CheckoutSnapshot;
}): Promise<{
  providerPaymentIntentId: string;
  providerReaderId: string;
  providerReference: string | null;
  status: PaymentTransactionStatus;
}> {
  const stripe = getStripeClient();
  const paymentIntent = await stripe.paymentIntents.create({
    amount: toMinorUnits(args.snapshot.total),
    currency: PAYMENT_CURRENCY,
    capture_method: "automatic",
    payment_method_types: getPaymentMethodTypes(),
    metadata: {
      kiosk_id: args.snapshot.kioskId,
      order_type: args.snapshot.orderType,
      payment_method: args.paymentMethod,
      payment_session_id: args.sessionId,
    },
  });

  const reader = await stripe.terminal.readers.processPaymentIntent(getReaderId(), {
    payment_intent: paymentIntent.id,
    process_config: {
      enable_customer_cancellation: true,
      skip_tipping: true,
    },
  });

  return {
    providerPaymentIntentId: paymentIntent.id,
    providerReaderId: reader.id,
    providerReference: getPaymentIntentReference(paymentIntent),
    status:
      reader.action?.status === "failed"
        ? "FAILED"
        : paymentIntent.status === "succeeded"
        ? "CAPTURED"
        : "PROCESSING",
  };
}

function getPaymentIntentReference(
  paymentIntent: Stripe.PaymentIntent
): string | null {
  if (!paymentIntent.latest_charge) return null;
  return typeof paymentIntent.latest_charge === "string"
    ? paymentIntent.latest_charge
    : paymentIntent.latest_charge.id;
}

function mapStripeIntentStatus(
  status: Stripe.PaymentIntent.Status,
  hasLastError: boolean
): PaymentTransactionStatus {
  switch (status) {
    case "succeeded":
      return "CAPTURED";
    case "requires_capture":
      return "AUTHORIZED";
    case "canceled":
      return "CANCELLED";
    case "requires_payment_method":
      return hasLastError ? "FAILED" : "PROCESSING";
    case "requires_confirmation":
    case "requires_action":
    case "processing":
      return "PROCESSING";
    default:
      return "PROCESSING";
  }
}

export async function syncStripeTerminalPayment(args: {
  providerPaymentIntentId: string;
  providerReaderId?: string | null;
}): Promise<{
  status: PaymentTransactionStatus;
  providerReference: string | null;
  failureCode: string | null;
  failureMessage: string | null;
}> {
  const stripe = getStripeClient();
  const paymentIntent = await stripe.paymentIntents.retrieve(
    args.providerPaymentIntentId
  );

  let failureCode = paymentIntent.last_payment_error?.code
    ? String(paymentIntent.last_payment_error.code)
    : null;
  let failureMessage = paymentIntent.last_payment_error?.message ?? null;
  let status = mapStripeIntentStatus(
    paymentIntent.status,
    !!paymentIntent.last_payment_error
  );

  if (args.providerReaderId) {
    const reader = await stripe.terminal.readers.retrieve(args.providerReaderId);
    if ("action" in reader) {
      const action = reader.action;
      const actionIntentId =
        action?.type === "process_payment_intent"
          ? action.process_payment_intent?.payment_intent
          : null;

      if (action && actionIntentId === args.providerPaymentIntentId) {
        if (action.status === "failed") {
          status = "FAILED";
          failureCode = action.failure_code ? String(action.failure_code) : failureCode;
          failureMessage = action.failure_message ?? failureMessage;
        } else if (action.status === "in_progress" && status === "PROCESSING") {
          status = "PROCESSING";
        }
      }
    }
  }

  return {
    status,
    providerReference: getPaymentIntentReference(paymentIntent),
    failureCode,
    failureMessage,
  };
}

export async function refundStripePaymentIntent(
  providerPaymentIntentId: string
): Promise<{ refundId: string }> {
  const stripe = getStripeClient();
  const refund = await stripe.refunds.create({
    payment_intent: providerPaymentIntentId,
    reason: "requested_by_customer",
  });

  return { refundId: refund.id };
}
