// Shared helpers for the public health endpoints (`/api/health`,
// `/api/health/ready`).
//
// Readiness semantics (locked before implementation per the plan):
//   - `ok`   → the DB probe resolved within HEALTH_READINESS_TIMEOUT_MS.
//              HTTP 200, body `database: "ok"`.
//   - `down` → the probe rejected OR exceeded the timeout. HTTP 503, body
//              `database: "down"`.
//   - `degraded` is intentionally OMITTED from v1. The plan permits
//     omission unless a documented threshold + status-code policy exists;
//     none is needed for pilot, so v1 is strictly `ok | down`.
//
// Pool safety: the readiness probe is single-flight. At most ONE DB query
// is in flight regardless of concurrent health-check volume, so repeated
// probes against a slow DB cannot exhaust the Prisma connection pool. The
// per-request 1500 ms deadline bounds the *response* (Promise.race), while
// single-flight bounds *connection usage*. No result caching — caching
// would mask a DB recovering or failing between checks.
//
// Probe is injectable via a test seam so readiness can be unit-tested
// (success / failure / timeout / single-flight) without a live database.
// The seam is a no-op in production.
//
// Info-leak rule: responses expose ONLY `status`, `generatedAt`, and (on
// readiness) `database`. No version, git SHA, package version, DB URL,
// env name, or stack ever appears in a health response.

import { prisma } from "@/lib/db";

export const HEALTH_READINESS_TIMEOUT_MS = 1_500;

function noStoreHeaders(extra?: Record<string, string>): Headers {
  const h = new Headers(extra);
  h.set("cache-control", "no-store");
  h.set("content-type", "application/json; charset=utf-8");
  return h;
}

export function jsonNoStore(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: noStoreHeaders(),
  });
}

export function emptyNoStore(status: number): Response {
  const h = noStoreHeaders();
  h.delete("content-type"); // no body → no content-type
  return new Response(null, { status, headers: h });
}

/** 405 for any method other than GET/HEAD. Explicit + unit-testable. */
export function methodNotAllowed(): Response {
  const h = noStoreHeaders({ allow: "GET, HEAD" });
  return new Response(JSON.stringify({ status: "method_not_allowed" }), {
    status: 405,
    headers: h,
  });
}

/** 429 when the in-memory limiter rejects. Generic, cache-disabled. */
export function tooManyRequests(): Response {
  return jsonNoStore({ status: "rate_limited" }, 429);
}

// --- Readiness probe (single-flight + injectable) ------------------------

type ReadinessProbe = () => Promise<void>;

const defaultProbe: ReadinessProbe = async () => {
  // Cheap liveness-of-DB query. NOTE: `SELECT 1` proves the connection and
  // that the DB answers — it does NOT prove critical-table presence,
  // migration state, or replication lag. Documented in the runbook.
  await prisma.$queryRaw`SELECT 1`;
};

let activeProbe: ReadinessProbe = defaultProbe;
let inFlight: Promise<boolean> | null = null;

function runSharedProbe(): Promise<boolean> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      await activeProbe();
      return true;
    } catch {
      return false;
    } finally {
      // Cleared on settle so the NEXT request starts a fresh probe rather
      // than reusing a stale result.
      inFlight = null;
    }
  })();
  return inFlight;
}

function withTimeout(p: Promise<boolean>, ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(false);
      },
    );
  });
}

/**
 * Returns `{ ok }` where `ok` is true iff the (single-flight) DB probe
 * resolved within HEALTH_READINESS_TIMEOUT_MS. Never throws.
 */
export async function checkReadiness(): Promise<{ ok: boolean }> {
  const ok = await withTimeout(runSharedProbe(), HEALTH_READINESS_TIMEOUT_MS);
  return { ok };
}

// --- Test seam (no-op in production) -------------------------------------

export function __setReadinessProbeForTests(probe: ReadinessProbe | null): void {
  if (process.env.NODE_ENV === "production") return;
  activeProbe = probe ?? defaultProbe;
  inFlight = null;
}
