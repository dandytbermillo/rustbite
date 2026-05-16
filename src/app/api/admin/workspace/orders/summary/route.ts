import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSessionPermissionContext } from "@/lib/admin-sessions";
import {
  buildAdminWorkspaceOrdersSummary,
  parseWorkspaceOrdersFilter,
  workspaceOrdersFilterFromStatus,
} from "@/lib/admin/workspace/orders-summary";
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
      "admin.orders.read",
    );
    if (!auth.ok) {
      auth.response.headers.set("cache-control", "no-store");
      return auth.response;
    }

    const filterParam = req.nextUrl.searchParams.get("filter");
    const statusParam = req.nextUrl.searchParams.get("status");
    const filter = filterParam
      ? parseWorkspaceOrdersFilter(filterParam)
      : workspaceOrdersFilterFromStatus(statusParam);
    const targetOrderId =
      req.nextUrl.searchParams.get("order") ??
      req.nextUrl.searchParams.get("id");

    const summary = await buildAdminWorkspaceOrdersSummary({
      context: auth.context,
      filter,
      targetOrderId,
    });
    return jsonNoStore(summary);
  });
}
