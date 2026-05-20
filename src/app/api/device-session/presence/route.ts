import { NextRequest, NextResponse } from "next/server";
import { getDeviceSessionFromRequest } from "@/lib/device-sessions";
import {
  checkDevicePresenceRateLimit,
  hashDevicePresenceClientSessionId,
  isActiveDevicePresenceEvent,
  readDevicePresencePayload,
  shouldUpdateClientHashForPresenceEvent,
} from "@/lib/device-presence";
import { prisma } from "@/lib/db";
import { withObservability } from "@/lib/observability/route-context";
import {
  requireSameOriginMutation,
  shouldTouchLastSeen,
} from "@/lib/production-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonNoStore(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

function noContent() {
  return new NextResponse(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(req: NextRequest) {
  return withObservability(req, async (req) => {
    const originError = requireSameOriginMutation(req);
    if (originError) return originError;

    const parsed = await readDevicePresencePayload(req);
    if (!parsed.ok) {
      return jsonNoStore(
        { error: parsed.error, errorCode: "invalid_presence_payload" },
        { status: parsed.status },
      );
    }

    const actor = await getDeviceSessionFromRequest(req, {
      touchLastSeen: false,
    });
    if (!actor || actor.isLegacy || !actor.sessionId || !actor.deviceId) {
      return jsonNoStore(
        { error: "No registered device session", errorCode: "no_device_session" },
        { status: 401 },
      );
    }

    const rateLimit = checkDevicePresenceRateLimit({
      req,
      sessionId: actor.sessionId,
    });
    if (!rateLimit.ok) {
      return jsonNoStore(
        { error: "Rate limited", errorCode: "rate_limited" },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
      );
    }

    const { payload } = parsed;
    const now = new Date();
    const clientSessionHash = hashDevicePresenceClientSessionId(
      payload.clientSessionId,
    );
    const activeEvent = isActiveDevicePresenceEvent(payload.event);
    const shouldSetClientHash = shouldUpdateClientHashForPresenceEvent(
      payload.event,
    );

    const existing = await prisma.deviceSession.findUnique({
      where: { id: actor.sessionId },
      select: {
        id: true,
        expiresAt: true,
        revokedAt: true,
        lastSeenAt: true,
        clientSessionHash: true,
        clientSequence: true,
        device: {
          select: {
            id: true,
            lastSeenAt: true,
          },
        },
      },
    });
    if (!existing || existing.revokedAt || existing.expiresAt <= now) {
      return jsonNoStore(
        { error: "No registered device session", errorCode: "no_device_session" },
        { status: 401 },
      );
    }

    const shouldTouchSession = activeEvent
      ? shouldTouchLastSeen(existing.lastSeenAt, now)
      : false;
    const shouldTouchDevice = activeEvent
      ? shouldTouchLastSeen(existing.device.lastSeenAt, now)
      : false;

    const updateData = {
      lastLifecycleAt: now,
      lastLifecycleEvent: payload.event,
      lastVisibilityState: payload.visibilityState ?? null,
      clientSessionHash: shouldSetClientHash ? clientSessionHash : undefined,
      clientSequence: payload.sequence,
      lastHeartbeatAt: activeEvent ? now : undefined,
      lastSeenAt: shouldTouchSession ? now : undefined,
      lastClosedAt:
        payload.event === "clean_close" ? now : activeEvent ? null : undefined,
      lastCloseReason:
        payload.event === "clean_close"
          ? (payload.closeReason ?? "unknown")
          : activeEvent
            ? null
          : undefined,
      lastClientErrorAt:
        payload.event === "client_error" ||
        payload.event === "unhandled_rejection"
          ? now
          : undefined,
      uncleanRecoveryCount:
        payload.event === "recovered_unclean_previous_session"
          ? { increment: 1 }
          : undefined,
    };

    const updateWhere = shouldSetClientHash
      ? {
          id: actor.sessionId,
          revokedAt: null,
          expiresAt: { gt: now },
          OR: [
            { clientSessionHash: null },
            { clientSessionHash: { not: clientSessionHash } },
            { clientSequence: null },
            { clientSequence: { lt: payload.sequence } },
          ],
        }
      : {
          id: actor.sessionId,
          revokedAt: null,
          expiresAt: { gt: now },
          clientSessionHash,
          OR: [
            { clientSequence: null },
            { clientSequence: { lt: payload.sequence } },
          ],
        };

    await prisma.$transaction(async (tx) => {
      const updated = await tx.deviceSession.updateMany({
        where: updateWhere,
        data: updateData,
      });
      if (updated.count === 0) return;
      if (shouldTouchDevice) {
        await tx.device.update({
          where: { id: existing.device.id },
          data: { lastSeenAt: now },
        });
      }
    });

    return noContent();
  });
}
