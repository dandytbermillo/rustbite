// Shared status pill design tokens for admin order surfaces (dashboard +
// orders list). Keep both pages visually consistent — drift here would be a
// visual bug, not a behavior bug.

export type OrderStatusSemantic =
  | "pay-pending"
  | "kitchen"
  | "ready"
  | "completed"
  | "cancelled";

export const STATUS_TO_SEMANTIC: Record<string, OrderStatusSemantic> = {
  AWAITING_COUNTER_PAYMENT: "pay-pending",
  PAID: "kitchen",
  IN_KITCHEN: "kitchen",
  READY: "ready",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  REFUNDED: "cancelled",
};

export const SEMANTIC_COLORS: Record<
  OrderStatusSemantic,
  { bg: string; text: string; border: string; dot: string; accent: string }
> = {
  "pay-pending": {
    bg: "#FEF3C7",
    text: "#92400E",
    border: "rgba(245,158,11,0.3)",
    dot: "#F59E0B",
    accent: "#F59E0B",
  },
  kitchen: {
    bg: "#DBEAFE",
    text: "#1E3A8A",
    border: "rgba(59,130,246,0.3)",
    dot: "#3B82F6",
    accent: "#3B82F6",
  },
  ready: {
    bg: "#FFF4CC",
    text: "#0d0d0d",
    border: "rgba(245,184,0,0.5)",
    dot: "#0d0d0d",
    accent: "#FFBE0B",
  },
  completed: {
    bg: "#D1FAE5",
    text: "#065F46",
    border: "rgba(16,185,129,0.25)",
    dot: "#10B981",
    accent: "#10B981",
  },
  cancelled: {
    bg: "#ECECEC",
    text: "#8A8A8A",
    border: "#E8E6DF",
    dot: "#8A8A8A",
    accent: "#8A8A8A",
  },
};

export const STATUS_DISPLAY_LABELS: Record<string, string> = {
  AWAITING_COUNTER_PAYMENT: "Awaiting payment",
  PAID: "Paid",
  IN_KITCHEN: "In kitchen",
  READY: "Ready",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};
