import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_ACTIVE_OUTLET_COOKIE,
  resolveAdminActiveOutlet,
} from "@/lib/admin-active-outlet";
import { getAdminSessionFromRequest } from "@/lib/admin-sessions";
import { requireSameOriginMutation } from "@/lib/production-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeReturnTo(req: NextRequest, value: FormDataEntryValue | null): URL {
  const fallback = new URL("/admin", req.url);
  if (typeof value !== "string" || !value.startsWith("/admin")) return fallback;
  return new URL(value, req.url);
}

export async function POST(req: NextRequest) {
  const originError = requireSameOriginMutation(req);
  if (originError) return originError;

  const session = await getAdminSessionFromRequest(req);
  if (!session) {
    return NextResponse.redirect(new URL("/admin/login", req.url));
  }
  if (session.mfaEnrollmentRequired) {
    return NextResponse.redirect(new URL("/admin/security/mfa", req.url));
  }

  const formData = await req.formData();
  const outletId = formData.get("outletId")?.toString().trim() || "";
  const returnTo = safeReturnTo(req, formData.get("returnTo"));

  const resolution = await resolveAdminActiveOutlet(session, undefined, outletId);
  if (resolution.status !== "active" || resolution.outletId !== outletId) {
    return NextResponse.redirect(new URL("/admin/forbidden", req.url));
  }

  const response = NextResponse.redirect(returnTo);
  response.cookies.set({
    name: ADMIN_ACTIVE_OUTLET_COOKIE,
    value: outletId,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    // API routes need this cookie too; SameSite + HttpOnly keep it scoped safely.
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return response;
}
