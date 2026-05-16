import "server-only";
import type { DeviceRole } from "@/lib/device-auth";

// Plan §339-358: surface-specific allowed transitions for counter and
// kitchen device sessions. Other surfaces (kiosk, board) cannot reach
// the order PATCH endpoint via the existing `authorizeOrderApiAccess`
// mapping (only kitchen and counter are allowed to call updateOrder).
//
// The transitions here are checked twice: once before opening the
// transaction (cheap check on the snapshot we read) and once inside
// the transaction against the live row. Stale tabs whose order has
// already moved must fail rather than apply an invalid transition.

const COUNTER_TRANSITIONS: ReadonlyArray<readonly [string, string]> = [
  ["AWAITING_COUNTER_PAYMENT", "PAID"],
  ["AWAITING_COUNTER_PAYMENT", "CANCELLED"],
];

const KITCHEN_TRANSITIONS: ReadonlyArray<readonly [string, string]> = [
  ["PAID", "IN_KITCHEN"],
  ["IN_KITCHEN", "READY"],
  ["PAID", "CANCELLED"],
  ["IN_KITCHEN", "CANCELLED"],
];

function isAllowed(
  table: ReadonlyArray<readonly [string, string]>,
  from: string,
  to: string
): boolean {
  return table.some(([f, t]) => f === from && t === to);
}

export type DeviceTransitionCheck =
  | { ok: true }
  | { ok: false; reason: "transition_not_allowed_for_surface" };

export function checkDeviceTransition(
  deviceRole: DeviceRole,
  fromStatus: string,
  toStatus: string
): DeviceTransitionCheck {
  let allowed = false;
  if (deviceRole === "counter") {
    allowed = isAllowed(COUNTER_TRANSITIONS, fromStatus, toStatus);
  } else if (deviceRole === "kitchen") {
    allowed = isAllowed(KITCHEN_TRANSITIONS, fromStatus, toStatus);
  }
  return allowed
    ? { ok: true }
    : { ok: false, reason: "transition_not_allowed_for_surface" };
}

export function listAllowedTransitionsForSurface(
  deviceRole: DeviceRole
): ReadonlyArray<readonly [string, string]> {
  if (deviceRole === "counter") return COUNTER_TRANSITIONS;
  if (deviceRole === "kitchen") return KITCHEN_TRANSITIONS;
  return [];
}
