import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSessionPermissionContext } from "@/lib/admin-sessions";
import {
  buildAdminWorkspaceDevicesSummary,
} from "@/lib/admin/workspace/devices-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonNoStore(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function GET(req: NextRequest) {
  const auth = await requireAdminApiSessionPermissionContext(
    req,
    "admin.devices.read",
  );
  if (!auth.ok) {
    auth.response.headers.set("cache-control", "no-store");
    return auth.response;
  }

  const summary = await buildAdminWorkspaceDevicesSummary({
    context: auth.context,
  });
  return jsonNoStore(summary);
}
