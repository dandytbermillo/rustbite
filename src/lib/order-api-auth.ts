import { NextRequest, NextResponse } from "next/server";
import {
  getDeviceSessionFromRequest,
  type DeviceSessionActor,
} from "./device-sessions";
import { type DeviceRole } from "./device-auth";

type OrderApiCapability =
  | "createOrder"
  | "readOrderFeed"
  | "readOrderDetail"
  | "updateOrder";

const CAPABILITY_ROLES: Record<OrderApiCapability, DeviceRole[]> = {
  createOrder: ["kiosk"],
  readOrderFeed: ["kitchen", "board", "counter"],
  readOrderDetail: ["kitchen", "counter"],
  updateOrder: ["kitchen", "counter"],
};

export async function authorizeDeviceApiAccess(
  req: NextRequest,
  roles: DeviceRole[]
): Promise<{ actor: DeviceSessionActor | null; response: NextResponse | null }> {
  const actor = await getDeviceSessionFromRequest(req);
  if (actor && roles.includes(actor.role)) {
    return { actor, response: null };
  }

  return {
    actor: null,
    response: NextResponse.json(
      { error: "Unauthorized", errorCode: "unauthorized" },
      { status: 401 }
    ),
  };
}

export async function authorizeOrderApiAccess(
  req: NextRequest,
  capability: OrderApiCapability
): Promise<{ actor: DeviceSessionActor | null; response: NextResponse | null }> {
  return authorizeDeviceApiAccess(req, CAPABILITY_ROLES[capability]);
}
