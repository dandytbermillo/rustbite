import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSessionPermissionContext } from "@/lib/admin-sessions";
import { buildAdminWorkspaceSystemStatusSummary } from "@/lib/admin/workspace/system-status";
import { withObservability } from "@/lib/observability/route-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonNoStore(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function GET(req: NextRequest) {
  return withObservability(req, async (req, _obsCtx) => {
    const auth = await requireAdminApiSessionPermissionContext(
      req,
      "admin.dashboard.read",
    );
    if (!auth.ok) {
      auth.response.headers.set("cache-control", "no-store");
      return auth.response;
    }

    const summary = await buildAdminWorkspaceSystemStatusSummary({
      context: auth.context,
      cookies: req.cookies,
    });
    return jsonNoStore(summary);
  });
}
