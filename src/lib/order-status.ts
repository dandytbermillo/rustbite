export const ACTIVE_KITCHEN_STATUSES = ["PAID", "IN_KITCHEN"] as const;
export const BOARD_ACTIVE_STATUSES = [
  "AWAITING_COUNTER_PAYMENT",
  "IN_KITCHEN",
  "READY",
] as const;
export const ADMIN_ORDER_STATUSES = [
  "AWAITING_COUNTER_PAYMENT",
  "PAID",
  "IN_KITCHEN",
  "READY",
  "COMPLETED",
  "CANCELLED",
  "REFUNDED",
] as const;

export function isActiveOrderStatus(status: string): boolean {
  return (
    status === "AWAITING_COUNTER_PAYMENT" ||
    status === "PAID" ||
    status === "IN_KITCHEN" ||
    status === "READY"
  );
}
