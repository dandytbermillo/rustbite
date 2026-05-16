import type {
  PaymentProvider,
  PaymentTransactionStatus,
} from "./types";
import { STORE_CONFIG } from "./store-config";

export const PAYMENT_CURRENCY = (
  process.env.STRIPE_TERMINAL_CURRENCY ?? "cad"
).toLowerCase();

export function getConfiguredPaymentProvider(): PaymentProvider {
  return STORE_CONFIG.paymentMode === "TERMINAL"
    ? "STRIPE_TERMINAL"
    : "MOCK";
}

export function toMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}

export function isSuccessfulPaymentStatus(
  status: PaymentTransactionStatus
): boolean {
  return status === "AUTHORIZED" || status === "CAPTURED";
}

export function isCounterAwaitingPaymentStatus(
  status: PaymentTransactionStatus
): boolean {
  return status === "PENDING_COUNTER_PAYMENT";
}

export function isTerminalPendingStatus(
  status: PaymentTransactionStatus
): boolean {
  return status === "CREATED" || status === "PROCESSING";
}

export function canRefundPaymentStatus(
  status: PaymentTransactionStatus
): boolean {
  return status === "AUTHORIZED" || status === "CAPTURED";
}
