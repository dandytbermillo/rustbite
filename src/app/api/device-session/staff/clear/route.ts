import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getDeviceSessionFromRequest } from "@/lib/device-sessions";
import { getLoginIpHash } from "@/lib/login-rate-limit";
import { requireSameOriginMutation } from "@/lib/production-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: NextRequest) {
  const originError = requireSameOriginMutation(req);
  if (originError) return originError;

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

  // Idempotent: if no active operator was set, still return ok and skip the
  // audit row (nothing happened).
  const hadActiveOperator = Boolean(actor.activeStaffUserId);

  // Clear the operator fields. activeOutletId is intentionally preserved
  // — it is a device-session preference, not part of the operator session
  // (per plan §200-205 / §241-246).
  if (hadActiveOperator) {
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
        eventType: "DEVICE_STAFF_CLEARED",
        actorType: "DEVICE_SESSION",
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
          usedOutletRole: actor.activeStaffRole,
        },
      },
    });
  }

  return NextResponse.json({ ok: true, cleared: hadActiveOperator });
}
