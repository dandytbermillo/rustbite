import { NextRequest, NextResponse } from "next/server";
import { getAdminSessionFromRequest } from "@/lib/admin-sessions";
import { loadAdminAttentionSummary } from "@/lib/admin/attention-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonNoStore(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function GET(req: NextRequest) {
  const session = await getAdminSessionFromRequest(req);
  if (!session) {
    return jsonNoStore(
      { error: "Unauthorized", errorCode: "unauthorized" },
      { status: 401 },
    );
  }

  if (session.mfaEnrollmentRequired) {
    return jsonNoStore(
      {
        error: "MFA enrollment is required before using admin tools.",
        errorCode: "mfa_enrollment_required",
      },
      { status: 428 },
    );
  }

  const result = await loadAdminAttentionSummary({
    session,
    cookies: req.cookies,
  });
  if (!result.ok) {
    return jsonNoStore(result.body, { status: result.status });
  }

  return jsonNoStore(result.summary);
}
