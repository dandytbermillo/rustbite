import { NextRequest, NextResponse } from "next/server";
import {
  clearAdminSessionCookie,
  revokeAdminSessionToken,
} from "@/lib/admin-sessions";
import { ADMIN_SESSION_COOKIE, requireSameOriginMutation } from "@/lib/production-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: NextRequest) {
  const originError = requireSameOriginMutation(req);
  if (originError) return originError;

  await revokeAdminSessionToken(req.cookies.get(ADMIN_SESSION_COOKIE)?.value);

  const response = NextResponse.redirect(new URL("/admin/login", req.url));
  clearAdminSessionCookie(response);
  return response;
}
