import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getDeviceSessionFromRequest } from "@/lib/device-sessions";
import {
  getRequiredSurfaceForDeviceRole,
  isEligibleOperatorAccountType,
  isEligibleOperatorOutletRole,
} from "@/lib/admin-user-surface-access";
import {
  parseOperationalPin,
  verifyOperationalPin,
} from "@/lib/operational-pin";
import {
  checkOperatorSwitchAllowed,
  recordOperatorSwitchFailure,
  recordOperatorSwitchSuccess,
} from "@/lib/operator-switch-rate-limit";
import { getLoginIpHash } from "@/lib/login-rate-limit";
import { requireSameOriginMutation } from "@/lib/production-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type SwitchBody = {
  staffUserId?: unknown;
  pin?: unknown;
  outletId?: unknown;
};

function genericInvalid(): NextResponse {
  // One-shape error for all credential/eligibility failures so the response
  // does not leak whether the user exists, has a PIN, has a role, or has a
  // surface grant. Plan §561-567.
  return NextResponse.json(
    {
      error: "Operator credentials are invalid or the operator is not eligible.",
      errorCode: "invalid_credential",
    },
    { status: 401 }
  );
}

async function writeSwitchFailedAudit(args: {
  req: NextRequest;
  deviceSessionId: string;
  deviceId: string;
  deviceName: string;
  deviceRole: string;
  outletId: string | null;
  reason: "invalid_credential" | "rate_limited" | "ineligible_selection";
}): Promise<void> {
  // Per plan §561-567: failed-switch audit must not disclose whether the
  // selected user exists, has a PIN, is active, or has an outlet role.
  // We deliberately omit any attempted-user identifier from this row.
  // The rate-limiter's LoginAttempt rows carry the per-(user, deviceSession)
  // signal needed for backoff; that table is not a public audit trail.
  await prisma.authAuditLog.create({
    data: {
      eventType: "DEVICE_STAFF_SWITCH_FAILED",
      actorType: "DEVICE_SESSION",
      actorId: args.deviceSessionId,
      actorLabel: args.deviceName,
      targetType: "DEVICE_SESSION",
      targetId: args.deviceSessionId,
      targetLabel: args.deviceName,
      outletId: args.outletId,
      ipHash: getLoginIpHash(args.req),
      userAgent: args.req.headers.get("user-agent") ?? null,
      metadata: {
        deviceId: args.deviceId,
        deviceRole: args.deviceRole,
        reason: args.reason,
      },
    },
  });
}

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

  const body = (await req.json().catch(() => null)) as SwitchBody | null;
  const staffUserId =
    typeof body?.staffUserId === "string" ? body.staffUserId.trim() : "";
  const rawPin = body?.pin;
  const requestedOutletId =
    typeof body?.outletId === "string" ? body.outletId.trim() : "";

  if (!staffUserId || typeof rawPin !== "string") {
    return NextResponse.json(
      { error: "staffUserId and pin are required", errorCode: "bad_request" },
      { status: 400 }
    );
  }

  // Resolve targetOutletId WITHOUT persisting yet. activeOutletId is only
  // written on a successful switch. Failed PIN attempts must not leave a
  // stale outlet selection.
  let targetOutletId: string | null = null;
  if (actor.isSharedAcrossOutlets) {
    if (actor.activeOutletId) {
      if (
        requestedOutletId &&
        requestedOutletId !== actor.activeOutletId
      ) {
        return NextResponse.json(
          {
            error:
              "Active outlet is already set on this device. Clear active operator before switching outlet.",
            errorCode: "outlet_locked",
          },
          { status: 409 }
        );
      }
      targetOutletId = actor.activeOutletId;
    } else if (requestedOutletId) {
      if (!actor.allowedOutletIds.includes(requestedOutletId)) {
        return NextResponse.json(
          {
            error: "Outlet is not assigned to this device",
            errorCode: "outlet_not_allowed",
          },
          { status: 403 }
        );
      }
      targetOutletId = requestedOutletId;
    } else {
      return NextResponse.json(
        {
          error:
            "Shared device requires an outlet selection before switching operator.",
          errorCode: "active_outlet_required",
        },
        { status: 400 }
      );
    }
  } else {
    if (!actor.outletId) {
      return NextResponse.json(
        { error: "Device has no outlet assignment", errorCode: "device_misconfigured" },
        { status: 500 }
      );
    }
    if (requestedOutletId && requestedOutletId !== actor.outletId) {
      return NextResponse.json(
        { error: "Outlet does not match device assignment", errorCode: "outlet_mismatch" },
        { status: 403 }
      );
    }
    targetOutletId = actor.outletId;
  }

  const rateLimitInput = {
    userId: staffUserId,
    deviceId: actor.deviceId,
    deviceSessionId: actor.sessionId,
    req,
  };

  const rateLimit = await checkOperatorSwitchAllowed(rateLimitInput);
  if (!rateLimit.ok) {
    await writeSwitchFailedAudit({
      req,
      deviceSessionId: actor.sessionId,
      deviceId: actor.deviceId,
      deviceName: actor.name,
      deviceRole: actor.role,
      outletId: targetOutletId,
      reason: "rate_limited",
    });
    return NextResponse.json(
      {
        error: "Too many attempts. Try again later.",
        errorCode: "rate_limited",
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      }
    );
  }

  // Parse the PIN format here purely so callers see "bad_request" for
  // obviously-malformed bodies. The actual verify still runs sentinel
  // timing for everything else, so the PIN-format check does not leak
  // information about whether the selected user exists or has a PIN.
  const parsedPin = parseOperationalPin(rawPin);

  // Step 1: read candidate user OUTSIDE any transaction. We must NOT hold
  // a transaction across the slow Argon2 verify.
  const candidate = await prisma.adminUser.findUnique({
    where: { id: staffUserId },
    select: {
      id: true,
      operationalPinHash: true,
      isActive: true,
      accountType: true,
    },
  });

  // Step 2: run verify outside transaction. Sentinel branch fires when
  // candidate or PIN hash is missing so timing stays constant.
  const pinForVerify = parsedPin.ok ? parsedPin.pin : "(invalid)";
  const verifyOk = await verifyOperationalPin(
    candidate?.operationalPinHash ?? null,
    pinForVerify
  );

  if (
    !parsedPin.ok ||
    !candidate ||
    !candidate.isActive ||
    !candidate.operationalPinHash ||
    !verifyOk
  ) {
    await recordOperatorSwitchFailure(rateLimitInput, {
      reason: "invalid_credential",
    });
    await writeSwitchFailedAudit({
      req,
      deviceSessionId: actor.sessionId,
      deviceId: actor.deviceId,
      deviceName: actor.name,
      deviceRole: actor.role,
      outletId: targetOutletId,
      reason: "invalid_credential",
    });
    return genericInvalid();
  }

  if (!isEligibleOperatorAccountType(candidate.accountType)) {
    await recordOperatorSwitchFailure(rateLimitInput, {
      reason: "ineligible_selection",
    });
    await writeSwitchFailedAudit({
      req,
      deviceSessionId: actor.sessionId,
      deviceId: actor.deviceId,
      deviceName: actor.name,
      deviceRole: actor.role,
      outletId: targetOutletId,
      reason: "ineligible_selection",
    });
    return genericInvalid();
  }

  // Step 3: short transaction — re-read live, validate eligibility, write
  // active operator fields, write audit. NO Argon2 in here.
  type SwitchSuccess = {
    displayName: string;
    accountType: string;
    role: string;
  };

  const txResult: SwitchSuccess | { failed: true } = await prisma.$transaction(
    async (tx) => {
      const liveUser = await tx.adminUser.findUnique({
        where: { id: staffUserId },
        select: {
          id: true,
          displayName: true,
          accountType: true,
          isActive: true,
          operationalPinHash: true,
          surfaceAccess: { where: { surface }, select: { id: true } },
          outletRoles: {
            where: { outletId: targetOutletId! },
            select: { role: true },
          },
        },
      });

      if (
        !liveUser ||
        !liveUser.isActive ||
        !liveUser.operationalPinHash ||
        !isEligibleOperatorAccountType(liveUser.accountType) ||
        liveUser.surfaceAccess.length === 0
      ) {
        return { failed: true };
      }
      const liveRole = liveUser.outletRoles[0]?.role;
      if (!isEligibleOperatorOutletRole(liveRole)) {
        return { failed: true };
      }

      const now = new Date();
      await tx.deviceSession.update({
        where: { id: actor.sessionId! },
        data: {
          activeOutletId: targetOutletId,
          activeStaffUserId: liveUser.id,
          activeStaffOutletId: targetOutletId,
          activeStaffRole: liveRole,
          activeStaffVerifiedAt: now,
          activeStaffLastActionAt: null,
        },
      });
      await tx.authAuditLog.create({
        data: {
          eventType: "DEVICE_STAFF_SWITCHED",
          actorType: "OPERATOR_ON_DEVICE",
          actorId: liveUser.id,
          actorLabel: liveUser.displayName,
          targetType: "DEVICE_SESSION",
          targetId: actor.sessionId,
          targetLabel: actor.name,
          outletId: targetOutletId,
          ipHash: getLoginIpHash(req),
          userAgent: req.headers.get("user-agent") ?? null,
          metadata: {
            deviceId: actor.deviceId,
            deviceRole: actor.role,
            usedSurface: surface,
            usedOutletRole: liveRole,
            accountType: liveUser.accountType,
            verifiedAt: now.toISOString(),
          },
        },
      });
      return {
        displayName: liveUser.displayName,
        accountType: liveUser.accountType,
        role: liveRole,
      };
    }
  );

  if ("failed" in txResult) {
    await recordOperatorSwitchFailure(rateLimitInput, {
      reason: "ineligible_selection",
    });
    await writeSwitchFailedAudit({
      req,
      deviceSessionId: actor.sessionId,
      deviceId: actor.deviceId,
      deviceName: actor.name,
      deviceRole: actor.role,
      outletId: targetOutletId,
      reason: "ineligible_selection",
    });
    return genericInvalid();
  }

  await recordOperatorSwitchSuccess(rateLimitInput);

  return NextResponse.json({
    ok: true,
    activeOperator: {
      id: candidate.id,
      displayName: txResult.displayName,
      accountType: txResult.accountType,
      outletId: targetOutletId,
      outletRole: txResult.role,
      grantedSurface: surface,
    },
  });
}
