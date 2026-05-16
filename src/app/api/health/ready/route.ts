// GET /api/health/ready — readiness: process + database.
//
// 200 `{ status: "ok", database: "ok" }`  when the single-flight DB probe
//     resolves within HEALTH_READINESS_TIMEOUT_MS.
// 503 `{ status: "down", database: "down" }` on probe failure OR timeout.
//
// No `degraded` in v1 (see health.ts). Single-flight + timeout keep this
// pool-safe under repeated/slow probes. No auth, no caching, no version /
// SHA / env / DB-URL / stack leakage.

import type { NextRequest } from "next/server";
import { healthRateLimited } from "@/lib/observability/health-rate-limit";
import {
  checkReadiness,
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
  const { ok } = await checkReadiness();
  return jsonNoStore(
    {
      status: ok ? "ok" : "down",
      generatedAt: new Date().toISOString(),
      database: ok ? "ok" : "down",
    },
    ok ? 200 : 503,
  );
}

export async function HEAD(req: NextRequest): Promise<Response> {
  if (healthRateLimited(req)) return emptyNoStore(429);
  const { ok } = await checkReadiness();
  return emptyNoStore(ok ? 200 : 503);
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
