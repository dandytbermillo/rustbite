import { NextRequest, NextResponse } from "next/server";
import { resolveAuthorizedMenuVersion } from "@/lib/menu-version-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const requestedOutletId = req.nextUrl.searchParams.get("outletId") ?? undefined;
  const result = await resolveAuthorizedMenuVersion(req, requestedOutletId);
  if (!result.ok) return result.response;

  return NextResponse.json(result.version, {
    headers: { "Cache-Control": "no-store" },
  });
}
