// GET /api/health — liveness only.
//
// "process is up and can return a response." Deliberately does NOT touch
// the database: this route MUST stay 200 even when the DB is down so an
// external uptime monitor can distinguish "app process unreachable" from
// "app up, DB unhealthy" (the latter is /api/health/ready's job).
//
// Not wrapped with withObservability: health must be ultra-light and must
// not depend on the request-id HMAC machinery (a missing
// INTERNAL_REQUEST_ID_HMAC_SECRET in production would otherwise make the
// liveness probe fail — wrong). No auth (plan: "do not require admin or
// device auth"). No version/SHA/env leakage.

import type { NextRequest } from "next/server";
import { healthRateLimited } from "@/lib/observability/health-rate-limit";
import {
  emptyNoStore,
  jsonNoStore,
  methodNotAllowed,
  tooManyRequests,
} from "@/lib/observability/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest): Promise<Response> {
  if (healthRateLimited(req)) return tooManyRequests();
  return jsonNoStore(
    { status: "ok", generatedAt: new Date().toISOString() },
    200,
  );
}

export async function HEAD(req: NextRequest): Promise<Response> {
  if (healthRateLimited(req)) return emptyNoStore(429);
  return emptyNoStore(200);
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
