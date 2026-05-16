import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getDeviceSessionFromRequest } from "@/lib/device-sessions";
import {
  getRequiredSurfaceForDeviceRole,
  listEligibleOperatorsForDevice,
} from "@/lib/admin-user-surface-access";
import { getLoginIpHash } from "@/lib/login-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const DEFAULT_IDLE_MINUTES = 30;

function getIdleMinutes(): number {
  const raw = process.env.DEVICE_ACTIVE_OPERATOR_IDLE_MINUTES?.trim();
  if (!raw) return DEFAULT_IDLE_MINUTES;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_IDLE_MINUTES;
  return Math.min(Math.trunc(parsed), 24 * 60);
}

export async function GET(req: NextRequest) {
  const actor = await getDeviceSessionFromRequest(req);
  if (!actor) {
    return NextResponse.json(
      { error: "No device session", errorCode: "no_device_session" },
      { status: 401 }
    );
  }
  if (actor.isLegacy) {
    return NextResponse.json(
      {
        error: "Legacy device sessions are not allowed for active operator",
        errorCode: "legacy_device_session",
      },
      { status: 403 }
    );
  }
  if (actor.role !== "counter" && actor.role !== "kitchen") {
    return NextResponse.json(
      {
        error: "Active operator is only available for counter/kitchen devices",
        errorCode: "device_role_unsupported",
      },
      { status: 403 }
    );
  }
  if (!actor.sessionId || !actor.deviceId) {
    return NextResponse.json(
      { error: "Invalid device session", errorCode: "invalid_device_session" },
      { status: 401 }
    );
  }

  const surface = getRequiredSurfaceForDeviceRole(actor.role);
  if (!surface) {
    return NextResponse.json(
      {
        error: "Active operator is only available for counter/kitchen devices",
        errorCode: "device_role_unsupported",
      },
      { status: 403 }
    );
  }

  // Resolve which outlet the eligible-operator query is scoped to.
  // - single-outlet device: derive from device assignment
  // - shared device: requires DeviceSession.activeOutletId to be set
  let scopedOutletId: string | null;
  let requiresActiveOutlet = false;
  if (actor.isSharedAcrossOutlets) {
    if (actor.activeOutletId && actor.allowedOutletIds.includes(actor.activeOutletId)) {
      scopedOutletId = actor.activeOutletId;
    } else {
      scopedOutletId = null;
      requiresActiveOutlet = true;
    }
  } else {
    scopedOutletId = actor.outletId ?? null;
  }

  // Idle-expired detection: if active operator is set but the idle baseline
  // is older than the idle window, clear active staff fields and write a
  // DEVICE_STAFF_EXPIRED audit. This is the ONLY mutation this read path
  // performs, and it leaves the session row in a clean "no active operator"
  // state for the rest of this response.
  let idleExpired = false;
  if (
    actor.activeStaffUserId &&
    actor.activeStaffVerifiedAt
  ) {
    const baseline =
      actor.activeStaffLastActionAt ?? actor.activeStaffVerifiedAt;
    const idleMs = Date.now() - baseline.getTime();
    if (idleMs > getIdleMinutes() * 60 * 1000) {
      idleExpired = true;
      await prisma.deviceSession.update({
        where: { id: actor.sessionId },
        data: {
          activeStaffUserId: null,
          activeStaffOutletId: null,
          activeStaffRole: null,
          activeStaffVerifiedAt: null,
          activeStaffLastActionAt: null,
        },
      });
      await prisma.authAuditLog.create({
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
            idleMinutes: getIdleMinutes(),
            idleBaseline: baseline.toISOString(),
          },
        },
      });
    }
  }

  // After possible idle clear, derive what the response says about the
  // current active operator. If we cleared above, treat as none.
  const showActiveOperator =
    !idleExpired && actor.activeStaffUserId && actor.activeStaffVerifiedAt;

  const eligibleOperators = scopedOutletId
    ? await listEligibleOperatorsForDevice({
        deviceRole: actor.role,
        outletId: scopedOutletId,
      })
    : [];

  return NextResponse.json({
    device: {
      id: actor.deviceId,
      name: actor.name,
      role: actor.role,
      isSharedAcrossOutlets: actor.isSharedAcrossOutlets,
      primaryOutletId: actor.outletId,
      activeOutletId: actor.activeOutletId,
      allowedOutletIds: actor.allowedOutletIds,
      requiredSurface: surface,
    },
    requiresActiveOutlet,
    activeOperator: showActiveOperator
      ? {
          id: actor.activeStaffUserId,
          displayName: actor.activeStaffDisplayName,
          accountType: actor.activeStaffAccountType,
          outletId: actor.activeStaffOutletId,
          outletRole: actor.activeStaffRole,
          grantedSurface: surface,
          verifiedAt: actor.activeStaffVerifiedAt?.toISOString() ?? null,
          lastActionAt:
            actor.activeStaffLastActionAt?.toISOString() ?? null,
        }
      : null,
    eligibleOperators,
  });
}
