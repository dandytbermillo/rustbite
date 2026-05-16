import "server-only";
import { Prisma } from "@prisma/client";
import type { AuthAuditActor } from "@/lib/admin-user-management";

// Cascade clears for active-operator state on device sessions.
//
// Phase 2 wires admin-side actions (PIN reset, account deactivation,
// account-type change, outlet-role revoke, surface-access removal) to
// IMMEDIATELY drop active operator state on any DeviceSession that
// would otherwise carry stale authority. Each clear is paired with a
// `DEVICE_STAFF_INVALIDATED` audit row whose `metadata.reason` records
// why the clear happened — so forensics can distinguish a normal
// idle-expiry from an admin-driven invalidation.
//
// Plan §572-575 (audit reason enum) and §647-661 (cascade is in the
// same transaction as the admin change).

type Tx = Prisma.TransactionClient;

export type ActiveOperatorInvalidateReason =
  | "ROLE_REVOKED"
  | "ACCOUNT_DEACTIVATED"
  | "ACCOUNT_TYPE_CHANGED"
  | "PIN_RESET"
  | "SURFACE_ACCESS_REMOVED"
  | "OUTLET_REMOVED"
  | "ACTIVE_OUTLET_CHANGED";

export type ActiveOperatorCascadeFilter =
  /** Any active-operator session for the given user. Use for PIN reset,
   *  account deactivation, account-type change away from STAFF/ADMIN. */
  | { kind: "user"; userId: string }
  /** Active-operator sessions where the user is acting at this outlet —
   *  use when an outlet role at this outlet is removed/downgraded. */
  | { kind: "user-outlet"; userId: string; outletId: string }
  /** Active-operator sessions for the user on devices whose required
   *  surface matches — use when COUNTER or KITCHEN access is revoked. */
  | { kind: "user-surface"; userId: string; surface: "COUNTER" | "KITCHEN" }
  /** Any active-operator session targeting a specific outlet — use when
   *  an outlet is being removed from the device's allowed list, or when
   *  the active outlet on a shared device changes. */
  | { kind: "outlet"; outletId: string };

export type ActiveOperatorCascadeResult = {
  clearedSessionIds: string[];
};

const SURFACE_TO_DEVICE_ROLE: Record<"COUNTER" | "KITCHEN", string> = {
  COUNTER: "counter",
  KITCHEN: "kitchen",
};

/**
 * Clear active-operator state on every DeviceSession that matches the
 * filter and write `DEVICE_STAFF_INVALIDATED` audit rows.
 *
 * Caller MUST run this inside the same transaction as the admin change
 * that triggered the cascade. Otherwise the cascade can race against
 * the order-PATCH path (Phase 3) and an order-action could complete
 * with stale operator authority.
 *
 * `activeOutletId` is intentionally preserved — that field is a device
 * preference (selected outlet for shared devices), not a property of the
 * operator session, and the operator can sign in again on the same
 * outlet without re-selecting it.
 */
export async function cascadeClearActiveOperator(
  tx: Tx,
  args: {
    filter: ActiveOperatorCascadeFilter;
    reason: ActiveOperatorInvalidateReason;
    actor: AuthAuditActor;
    extraMetadata?: Record<string, unknown>;
  }
): Promise<ActiveOperatorCascadeResult> {
  const where: Prisma.DeviceSessionWhereInput = {
    revokedAt: null,
    activeStaffUserId: { not: null },
  };

  switch (args.filter.kind) {
    case "user":
      where.activeStaffUserId = args.filter.userId;
      break;
    case "user-outlet":
      where.activeStaffUserId = args.filter.userId;
      where.activeStaffOutletId = args.filter.outletId;
      break;
    case "user-surface":
      where.activeStaffUserId = args.filter.userId;
      where.device = { role: SURFACE_TO_DEVICE_ROLE[args.filter.surface] };
      break;
    case "outlet":
      where.activeStaffOutletId = args.filter.outletId;
      break;
  }

  const sessions = await tx.deviceSession.findMany({
    where,
    select: {
      id: true,
      deviceId: true,
      activeStaffUserId: true,
      activeStaffOutletId: true,
      activeStaffRole: true,
      device: {
        select: {
          id: true,
          name: true,
          role: true,
          siteId: true,
        },
      },
    },
  });

  if (sessions.length === 0) return { clearedSessionIds: [] };

  await tx.deviceSession.updateMany({
    where: { id: { in: sessions.map((session) => session.id) } },
    data: {
      activeStaffUserId: null,
      activeStaffOutletId: null,
      activeStaffRole: null,
      activeStaffVerifiedAt: null,
      activeStaffLastActionAt: null,
    },
  });

  const extraMetadata = args.extraMetadata ?? {};
  await tx.authAuditLog.createMany({
    data: sessions.map((session) => ({
      eventType: "DEVICE_STAFF_INVALIDATED",
      actorType: args.actor.type,
      actorId: args.actor.id ?? null,
      actorLabel: args.actor.label ?? null,
      targetType: "DEVICE_SESSION",
      targetId: session.id,
      targetLabel: session.device.name,
      siteId: session.device.siteId,
      outletId: session.activeStaffOutletId,
      metadata: {
        reason: args.reason,
        deviceId: session.deviceId,
        deviceRole: session.device.role,
        // affectedUserId tells forensics WHICH user lost their session.
        // This is OK to log here — the user's identity is already known
        // to the admin who triggered the cascade (it's the row they
        // edited). Only failed-LOGIN-style audit rows must avoid leaking
        // attempted-user info to the public audit log; cascade rows
        // record an authoritative admin action.
        affectedUserId: session.activeStaffUserId,
        usedOutletRole: session.activeStaffRole,
        ...extraMetadata,
      } as Prisma.InputJsonObject,
    })),
  });

  return { clearedSessionIds: sessions.map((session) => session.id) };
}
