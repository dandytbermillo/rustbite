import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSessionPermissionContext } from "@/lib/admin-sessions";
import {
  buildAdminDashboardSummary,
  InvalidDashboardRangeError,
} from "@/lib/admin/dashboard/summary";

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
    "admin.dashboard.read"
  );
  if (!auth.ok) {
    auth.response.headers.set("cache-control", "no-store");
    return auth.response;
  }

  try {
    const summary = await buildAdminDashboardSummary({
      context: auth.context,
      searchParams: req.nextUrl.searchParams,
    });
    return jsonNoStore(summary);
  } catch (error) {
    if (error instanceof InvalidDashboardRangeError) {
      return jsonNoStore(
        { error: "invalid_range", reason: error.reason },
        { status: 400 }
      );
    }
    throw error;
  }
}
