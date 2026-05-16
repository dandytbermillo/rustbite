import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiPermissionContext } from "@/lib/admin-sessions";
import {
  loadDealHistoryEntries,
  type DealHistoryStatus,
} from "@/lib/deal-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseStatus(value: string | null): "all" | DealHistoryStatus {
  if (
    value === "hidden" ||
    value === "deleted" ||
    value === "historical" ||
    value === "expired"
  ) {
    return value;
  }
  return "all";
}

export async function GET(req: NextRequest) {
  const permission = await requireAdminApiPermissionContext(
    req,
    "admin.dealHistory.read",
  );
  if (!permission.ok) return permission.response;

  const url = new URL(req.url);
  const entries = await loadDealHistoryEntries({
    q: url.searchParams.get("q") ?? "",
    status: parseStatus(url.searchParams.get("status")),
    limit: Number(url.searchParams.get("limit") ?? 50),
    outletId: permission.context.outletId,
  });

  return NextResponse.json({ entries, serverNowIso: new Date().toISOString() });
}
