import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  getDeviceSessionFromRequest,
  type DeviceSessionActor,
} from "@/lib/device-sessions";
import {
  getRequiredSurfaceForDeviceRole,
  isEligibleOperatorAccountType,
  isEligibleOperatorOutletRole,
  type EditableSurface,
  type EligibleOperatorAccountType,
  type EligibleOperatorOutletRole,
} from "@/lib/admin-user-surface-access";
import {
  cascadeClearActiveOperator,
  type ActiveOperatorInvalidateReason,
} from "@/lib/active-operator-cascade";
import { getLoginIpHash } from "@/lib/login-rate-limit";

// Phase 1: pure read-only validator. NO writes, NO transactions, NO side
// effects on the device session row. Phase 3 will add a thin wrapper
// (`requireActiveOperationalOperator`) that calls this evaluator and on
// failure clears `activeStaff*` in a transaction, writes
// `DEVICE_STAFF_INVALIDATED`, and returns a NextResponse 403. Phase 3
// will also be responsible for updating `activeStaffLastActionAt` on
// success at the action's commit point — that update does not belong on
// any read path, so it is intentionally NOT done here.

const DEFAULT_IDLE_MINUTES = 30;

function getIdleMinutes(): number {
  const raw = process.env.DEVICE_ACTIVE_OPERATOR_IDLE_MINUTES?.trim();
  if (!raw) return DEFAULT_IDLE_MINUTES;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_IDLE_MINUTES;
  return Math.min(Math.trunc(parsed), 24 * 60);
}

export type ActiveOperatorFailureReason =
  | "device_session_invalid"
  | "device_role_unsupported"
  | "no_active_operator"
  | "idle_expired"
  | "account_inactive"
  | "account_type_ineligible"
  | "surface_access_missing"
  | "outlet_role_missing"
  | "viewer_role"
  | "outlet_mismatch";

export type ActiveOperatorContext = {
  deviceSessionId: string;
  deviceId: string;
  deviceRole: "counter" | "kitchen";
  surface: EditableSurface;
  userId: string;
  displayName: string;
  accountType: EligibleOperatorAccountType;
  outletId: string;
  outletRole: EligibleOperatorOutletRole;
  verifiedAt: Date;
  lastActionAt: Date | null;
  idleBaseline: Date;
};

export type EvaluateActiveOperatorResult =
  | { ok: true; operator: ActiveOperatorContext }
  | { ok: false; reason: ActiveOperatorFailureReason };

export type EvaluateActiveOperatorOptions = {
  /**
   * The outlet the action targets. For order PATCH this is `order.outletId`.
   * The operator's outlet role must exist for this outlet AND match the
   * device session's `activeStaffOutletId`. Set to null to skip the
   * outlet-mismatch check (read-only callers in Phase 1).
   */
  requiredOutletId?: string | null;
  /**
   * Pre-resolved actor; if omitted the function resolves it from the
   * incoming request. Provided so callers that already loaded the actor
   * don't pay the device-session round-trip twice.
   */
  actor?: DeviceSessionActor | null;
};

/**
 * Read-only evaluation of the active operator on a counter/kitchen
 * device session. Returns either a fully validated operator context or a
 * structured failure reason. Phase 1 callers use this for status display
 * and stale-state detection; Phase 3 will wrap it with mutation behavior.
 */
export async function evaluateActiveOperator(
  req: NextRequest,
  options: EvaluateActiveOperatorOptions = {}
): Promise<EvaluateActiveOperatorResult> {
  const actor = options.actor ?? (await getDeviceSessionFromRequest(req));
  if (!actor || actor.isLegacy || !actor.deviceId || !actor.sessionId) {
    return { ok: false, reason: "device_session_invalid" };
  }
  if (actor.role !== "counter" && actor.role !== "kitchen") {
    return { ok: false, reason: "device_role_unsupported" };
  }
  const surface = getRequiredSurfaceForDeviceRole(actor.role);
  if (!surface) {
    return { ok: false, reason: "device_role_unsupported" };
  }

  if (!actor.activeStaffUserId || !actor.activeStaffOutletId || !actor.activeStaffVerifiedAt) {
    return { ok: false, reason: "no_active_operator" };
  }

  // Idle baseline: lastActionAt if recorded, else verifiedAt. The switch
  // endpoint sets activeStaffLastActionAt=null on success so the verifiedAt
  // fallback is required for the freshly-signed-in case.
  const idleBaseline = actor.activeStaffLastActionAt ?? actor.activeStaffVerifiedAt;
  const idleAgeMs = Date.now() - idleBaseline.getTime();
  if (idleAgeMs > getIdleMinutes() * 60 * 1000) {
    return { ok: false, reason: "idle_expired" };
  }

  if (
    options.requiredOutletId &&
    actor.activeStaffOutletId !== options.requiredOutletId
  ) {
    return { ok: false, reason: "outlet_mismatch" };
  }

  // Live re-read. Plan §554-555: outlet role used for an action is the live
  // role at action time, not the snapshot stored on the session row.
  const user = await prisma.adminUser.findUnique({
    where: { id: actor.activeStaffUserId },
    select: {
      id: true,
      displayName: true,
      accountType: true,
      isActive: true,
      surfaceAccess: { where: { surface }, select: { id: true } },
      outletRoles: {
        where: { outletId: actor.activeStaffOutletId },
        select: { role: true },
      },
    },
  });

  if (!user || !user.isActive) {
    return { ok: false, reason: "account_inactive" };
  }
  if (!isEligibleOperatorAccountType(user.accountType)) {
    return { ok: false, reason: "account_type_ineligible" };
  }
  if (user.surfaceAccess.length === 0) {
    return { ok: false, reason: "surface_access_missing" };
  }
  const liveRole = user.outletRoles[0]?.role;
  if (liveRole === "VIEWER") {
    return { ok: false, reason: "viewer_role" };
  }
  if (!isEligibleOperatorOutletRole(liveRole)) {
    return { ok: false, reason: "outlet_role_missing" };
  }

  return {
    ok: true,
    operator: {
      deviceSessionId: actor.sessionId,
      deviceId: actor.deviceId,
      deviceRole: actor.role,
      surface,
      userId: user.id,
      displayName: user.displayName,
      accountType: user.accountType,
      outletId: actor.activeStaffOutletId,
      outletRole: liveRole,
      verifiedAt: actor.activeStaffVerifiedAt,
      lastActionAt: actor.activeStaffLastActionAt,
      idleBaseline,
    },
  };
}

// Phase 3 mutation wrapper: enforces active operator on order-action paths
// and on failure clears `activeStaff*` and writes the appropriate audit row
// in the same transaction (`DEVICE_STAFF_EXPIRED` for idle, otherwise
// `DEVICE_STAFF_INVALIDATED` with a reason mapped from the failure).
//
// Plan §312-328: this wrapper is the entry point used by `PATCH /api/orders/[id]`
// to gate counter/kitchen mutations.

type FailureClassification =
  | { kind: "block_only"; httpStatus: number; errorCode: string }
  | {
      kind: "expire";
      errorCode: string;
    }
  | {
      kind: "invalidate";
      reason: ActiveOperatorInvalidateReason;
      errorCode: string;
    };

function classifyFailure(
  reason: ActiveOperatorFailureReason
): FailureClassification {
  switch (reason) {
    case "device_session_invalid":
      return { kind: "block_only", httpStatus: 401, errorCode: "device_session_invalid" };
    case "device_role_unsupported":
      return { kind: "block_only", httpStatus: 403, errorCode: "device_role_unsupported" };
    case "no_active_operator":
      return { kind: "block_only", httpStatus: 403, errorCode: "no_active_operator" };
    case "outlet_mismatch":
      return { kind: "block_only", httpStatus: 403, errorCode: "outlet_mismatch" };
    case "idle_expired":
      return { kind: "expire", errorCode: "idle_expired" };
    case "account_inactive":
      return {
        kind: "invalidate",
        reason: "ACCOUNT_DEACTIVATED",
        errorCode: "account_inactive",
      };
    case "account_type_ineligible":
      return {
        kind: "invalidate",
        reason: "ACCOUNT_TYPE_CHANGED",
        errorCode: "account_type_ineligible",
      };
    case "surface_access_missing":
      return {
        kind: "invalidate",
        reason: "SURFACE_ACCESS_REMOVED",
        errorCode: "surface_access_missing",
      };
    case "outlet_role_missing":
    case "viewer_role":
      return {
        kind: "invalidate",
        reason: "ROLE_REVOKED",
        errorCode: reason,
      };
  }
}

export type RequireActiveOperationalOperatorResult =
  | { ok: true; operator: ActiveOperatorContext }
  | { ok: false; response: NextResponse };

export async function requireActiveOperationalOperator(
  req: NextRequest,
  options: EvaluateActiveOperatorOptions = {}
): Promise<RequireActiveOperationalOperatorResult> {
  const evaluation = await evaluateActiveOperator(req, options);
  if (evaluation.ok) {
    return { ok: true, operator: evaluation.operator };
  }

  const classification = classifyFailure(evaluation.reason);

  // Resolve the actor for the failure side. evaluateActiveOperator already
  // resolved it for the read; if the caller passed it in, reuse to avoid
  // a duplicate device-session round-trip.
  const actor = options.actor ?? (await getDeviceSessionFromRequest(req));

  if (classification.kind === "expire" && actor?.sessionId) {
    // Idle expiry: clear active operator and write DEVICE_STAFF_EXPIRED.
    // Mirrors the GET status route's idle-expired handling.
    const baseline =
      actor.activeStaffLastActionAt ?? actor.activeStaffVerifiedAt;
    await prisma.$transaction(async (tx) => {
      await tx.deviceSession.update({
        where: { id: actor.sessionId! },
        data: {
          activeStaffUserId: null,
          activeStaffOutletId: null,
          activeStaffRole: null,
          activeStaffVerifiedAt: null,
          activeStaffLastActionAt: null,
        },
      });
      await tx.authAuditLog.create({
        data: {
          eventType: "DEVICE_STAFF_EXPIRED",
          actorType: "SYSTEM",
          actorId: actor.sessionId,
          actorLabel: actor.name,
          targetType: "ADMIN_USER",
          targetId: actor.activeStaffUserId,
          targetLabel: actor.activeStaffDisplayName,
          outletId: actor.activeStaffOutletId,
          ipHash: getLoginIpHash(req),
          userAgent: req.headers.get("user-agent") ?? null,
          metadata: {
            deviceId: actor.deviceId,
            deviceRole: actor.role,
            idleBaseline: baseline?.toISOString() ?? null,
          },
        },
      });
    });
  } else if (classification.kind === "invalidate" && actor?.sessionId) {
    // Cascade clear with the mapped reason. The cascade helper writes
    // DEVICE_STAFF_INVALIDATED with metadata.reason.
    await prisma.$transaction(async (tx) => {
      await cascadeClearActiveOperator(tx, {
        filter: {
          kind: "user",
          // We know activeStaffUserId is set because the failure reasons
          // that reach this branch all imply an existing active operator.
          userId: actor.activeStaffUserId!,
        },
        reason: classification.reason,
        actor: {
          type: "SYSTEM",
          id: actor.sessionId,
          label: actor.name,
        },
        extraMetadata: {
          triggeredBy: "order_action",
          evaluatorReason: evaluation.reason,
        },
      });
    });
  }

  const status =
    classification.kind === "block_only" ? classification.httpStatus : 403;
  const errorCode = classification.errorCode;

  return {
    ok: false,
    response: NextResponse.json(
      {
        error: "Active operator required for this action",
        errorCode,
        // Echo a stable shape so the UI can show "Sign in" again
        // immediately when a 403 comes back from a stale session.
        operatorRequired: true,
      },
      { status }
    ),
  };
}

/**
 * Atomically verifies that the device session still has the EXACT active
 * operator we authorized with, then bumps `activeStaffLastActionAt`. Must
 * be called inside the caller's order-mutation transaction.
 *
 * Returns `true` when the session still matches and the bump committed.
 * Returns `false` when any of (`activeStaffUserId`, `activeStaffOutletId`,
 * `activeStaffRole`, `revokedAt IS NULL`) changed between authorization
 * and commit — typically because a parallel cascade (admin PIN reset,
 * surface revocation, role revoke, deactivation, idle expiry) cleared the
 * operator state. The caller MUST abort the transaction in that case so
 * the order is not mutated under stale operator authority.
 */
export async function recordActiveOperatorAction(
  tx: Parameters<typeof cascadeClearActiveOperator>[0],
  operator: Pick<
    ActiveOperatorContext,
    "deviceSessionId" | "userId" | "outletId" | "outletRole"
  >
): Promise<boolean> {
  const updated = await tx.deviceSession.updateMany({
    where: {
      id: operator.deviceSessionId,
      activeStaffUserId: operator.userId,
      activeStaffOutletId: operator.outletId,
      activeStaffRole: operator.outletRole,
      revokedAt: null,
    },
    data: { activeStaffLastActionAt: new Date() },
  });
  return updated.count === 1;
}
