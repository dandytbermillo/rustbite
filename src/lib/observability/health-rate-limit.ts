// In-memory, best-effort rate limiter for the public health endpoints.
//
// Plan constraint (docs/production-observability-plan-2026-05-14.md):
// "health route rate limiting must not depend on Prisma or the primary
// database. Use provider/edge controls, an in-memory best-effort fallback,
// or another dependency that cannot mask database readiness failures."
//
// This module has NO Prisma / DB / network dependency by construction —
// that is the whole point: a readiness failure must never be masked by the
// limiter's own backend being down. It is a per-process fixed-window
// counter keyed by client IP. It is explicitly best-effort:
//
//   - Per-process only. Multi-instance deployments will allow up to
//     (instances * limit). The PRIMARY control is edge/proxy rate limiting
//     (documented in docs/observability-runbook.md). This is defense in
//     depth, not the system of record.
//   - Bounded memory: the bucket map is swept of stale entries and hard-
//     capped so spoofed/churned `x-forwarded-for` values cannot grow it
//     without bound.
//
// Never throws. If the client IP cannot be determined, all such requests
// share one "unknown" bucket (still bounded).

import type { NextRequest } from "next/server";

const WINDOW_MS = 60_000;
const DEFAULT_MAX_PER_WINDOW = 60; // plan fallback target: 60 req/min/IP
const MAP_HARD_CAP = 10_000; // safety bound on distinct IP buckets

type Bucket = { count: number; windowStart: number };

const buckets = new Map<string, Bucket>();

function maxPerWindow(): number {
  const raw = process.env.HEALTH_RATE_LIMIT_MAX_PER_MIN;
  if (raw !== undefined) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1 && n <= 100_000) return Math.floor(n);
  }
  return DEFAULT_MAX_PER_WINDOW;
}

function firstForwardedIp(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim();
  return first || null;
}

/**
 * Derive an in-process bucket key from the request's client IP. This value
 * is used ONLY as an ephemeral map key and is never logged, emitted, or
 * persisted — so a raw IP is acceptable here (the plan's IP-emission rules
 * govern logs/alerts/telemetry, not in-process limiter keys).
 */
function clientIpKey(req: NextRequest): string {
  const ip =
    firstForwardedIp(req.headers.get("x-forwarded-for")) ??
    req.headers.get("x-real-ip")?.trim() ??
    req.headers.get("cf-connecting-ip")?.trim() ??
    null;
  return ip && ip.length > 0 ? ip : "unknown";
}

/**
 * Sweep entries whose window is two-or-more windows stale, and hard-cap the
 * map size as a last resort. Called opportunistically on each check so
 * there is no background timer to leak.
 */
function sweep(now: number): void {
  if (buckets.size === 0) return;
  const cutoff = now - WINDOW_MS * 2;
  for (const [key, b] of buckets) {
    if (b.windowStart < cutoff) buckets.delete(key);
  }
  if (buckets.size > MAP_HARD_CAP) {
    // Pathological churn (e.g. spoofed XFF). Drop everything; correctness
    // of rate limiting is best-effort and a reset is safer than unbounded
    // memory. Edge limiting remains the primary control.
    buckets.clear();
  }
}

/**
 * Returns `true` if this request should be rate-limited (rejected with
 * 429), `false` if it is within budget. Never throws.
 */
export function healthRateLimited(req: NextRequest): boolean {
  try {
    const now = Date.now();
    sweep(now);
    const key = clientIpKey(req);
    const max = maxPerWindow();
    const existing = buckets.get(key);
    if (!existing || now - existing.windowStart >= WINDOW_MS) {
      buckets.set(key, { count: 1, windowStart: now });
      return false;
    }
    existing.count += 1;
    return existing.count > max;
  } catch {
    // A limiter failure must NEVER take down a health endpoint or, worse,
    // mask a readiness failure. Fail open (allow the request).
    return false;
  }
}

/** Test-only: clear all buckets between cases. No-op in production. */
export function __resetHealthRateLimitForTests(): void {
  if (process.env.NODE_ENV === "production") return;
  buckets.clear();
}
