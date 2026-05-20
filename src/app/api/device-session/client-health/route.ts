import { NextRequest, NextResponse } from "next/server";
import {
  checkDeviceClientHealthRateLimit,
  readDeviceClientHealthPayload,
  recordDeviceClientHealthEvent,
} from "@/lib/device-client-health";
import { getDeviceSessionFromRequest } from "@/lib/device-sessions";
import { withObservability } from "@/lib/observability/route-context";
import { requireSameOriginMutation } from "@/lib/production-auth";

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
    if (originError) {
      originError.headers.set("cache-control", "no-store");
      return originError;
    }

    const parsed = await readDeviceClientHealthPayload(req);
    if (!parsed.ok) {
      return jsonNoStore(
        { error: parsed.error, errorCode: "invalid_client_health_payload" },
        { status: parsed.status },
      );
    }

    const actor = await getDeviceSessionFromRequest(req, {
      touchLastSeen: false,
    });
    if (
      !actor ||
      actor.isLegacy ||
      !actor.sessionId ||
      !actor.deviceId ||
      actor.role !== "kiosk"
    ) {
      return jsonNoStore(
        { error: "No registered kiosk session", errorCode: "no_device_session" },
        { status: 401 },
      );
    }

    const rateLimit = checkDeviceClientHealthRateLimit({
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

    recordDeviceClientHealthEvent({
      payload: parsed.payload,
      outletId: actor.outletId,
      deviceId: actor.deviceId,
      deviceName: actor.name,
    });

    return noContent();
  });
}
