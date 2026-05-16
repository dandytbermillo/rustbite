import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_MODE_COOKIE,
  isSafeAdminModeRedirect,
  parseAdminMode,
} from "@/lib/admin/mode-preference";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function redirectUrl(req: NextRequest, next: string): URL {
  const host = req.headers.get("host") ?? req.nextUrl.host;
  const proto =
    req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  return new URL(next, `${proto}://${host}`);
}

export async function GET(req: NextRequest) {
  const mode = parseAdminMode(req.nextUrl.searchParams.get("mode"));
  const requestedNext = req.nextUrl.searchParams.get("next");
  const next = isSafeAdminModeRedirect(requestedNext)
    ? requestedNext
    : mode === "workspace"
      ? "/admin/workspace"
      : "/admin?mode=classic";

  if (!mode) {
    return NextResponse.redirect(redirectUrl(req, next));
  }

  const response = NextResponse.redirect(redirectUrl(req, next));
  response.cookies.set({
    name: ADMIN_MODE_COOKIE,
    value: mode,
    httpOnly: true,
    sameSite: "strict",
    path: "/admin",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}
