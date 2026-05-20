import "server-only";

import type { NextRequest } from "next/server";
import { getLoginIpHash } from "@/lib/login-rate-limit";
import {
  isDeviceClientHealthCheckoutOutcome,
  isDeviceClientHealthDurationBucket,
  isDeviceClientHealthErrorBucket,
  isDeviceClientHealthEvent,
  type DeviceClientHealthEvent,
  type DeviceClientHealthPayload,
  type LocalDeviceClientHealthSummary,
} from "@/lib/device-client-health-shared";

type DeviceClientHealthEventRecord = {
  event: DeviceClientHealthEvent;
  asOf: string;
  outletId: string | null;
  deviceId: string;
  deviceName: string;
  durationBucket: DeviceClientHealthPayload["durationBucket"] | null;
  checkoutOutcome: DeviceClientHealthPayload["checkoutOutcome"] | null;
};

type RateBucket = {
  windowStartedAt: number;
  count: number;
};

const CLIENT_HEALTH_BODY_LIMIT_BYTES = 1024;
const CLIENT_HEALTH_WINDOW_MS = 15 * 60_000;
const CLIENT_HEALTH_RETENTION_MS = 60 * 60_000;
const CLIENT_HEALTH_MAX_EVENTS = 500;
const CLIENT_HEALTH_RATE_WINDOW_MS = 60_000;
const DEFAULT_SESSION_RATE_MAX = 60;
const DEFAULT_IP_RATE_MAX = 600;
const ALLOWED_PAYLOAD_KEYS = new Set([
  "event",
  "sequence",
  "errorBucket",
  "durationBucket",
  "checkoutOutcome",
]);

let events: DeviceClientHealthEventRecord[] = [];
const sessionRateBuckets = new Map<string, RateBucket>();
const ipRateBuckets = new Map<string, RateBucket>();

function invalid(error: string) {
  return { ok: false as const, error };
}

function envInt(name: string, fallback: number, input: { min: number; max: number }) {
  const raw = process.env[name];
  if (!raw?.trim()) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(input.min, Math.min(Math.trunc(parsed), input.max));
}

function rateLimitMax(kind: "session" | "ip") {
  return kind === "session"
    ? envInt("DEVICE_CLIENT_HEALTH_RATE_LIMIT_SESSION_MAX", DEFAULT_SESSION_RATE_MAX, {
        min: 1,
        max: 10_000,
      })
    : envInt("DEVICE_CLIENT_HEALTH_RATE_LIMIT_IP_MAX", DEFAULT_IP_RATE_MAX, {
        min: 1,
        max: 100_000,
      });
}

function checkBucket(
  buckets: Map<string, RateBucket>,
  key: string,
  max: number,
  nowMs: number,
) {
  const existing = buckets.get(key);
  if (!existing || nowMs - existing.windowStartedAt >= CLIENT_HEALTH_RATE_WINDOW_MS) {
    buckets.set(key, { windowStartedAt: nowMs, count: 1 });
    return { ok: true as const, retryAfterSeconds: 0 };
  }

  if (existing.count >= max) {
    const retryAfterMs =
      existing.windowStartedAt + CLIENT_HEALTH_RATE_WINDOW_MS - nowMs;
    return {
      ok: false as const,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  existing.count += 1;
  return { ok: true as const, retryAfterSeconds: 0 };
}

export function checkDeviceClientHealthRateLimit(input: {
  req: NextRequest;
  sessionId: string;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const sessionLimit = checkBucket(
    sessionRateBuckets,
    input.sessionId,
    rateLimitMax("session"),
    nowMs,
  );
  if (!sessionLimit.ok) return sessionLimit;

  const ipHash = getLoginIpHash(input.req);
  if (!ipHash) return { ok: true as const, retryAfterSeconds: 0 };
  return checkBucket(ipRateBuckets, ipHash, rateLimitMax("ip"), nowMs);
}

export async function readDeviceClientHealthPayload(
  req: NextRequest,
): Promise<
  | { ok: true; payload: DeviceClientHealthPayload; rawBytes: number }
  | { ok: false; error: string; status: number }
> {
  const text = await req.text();
  const rawBytes = Buffer.byteLength(text, "utf8");
  if (rawBytes > CLIENT_HEALTH_BODY_LIMIT_BYTES) {
    return { ok: false, error: "Payload too large", status: 413 };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text || "{}");
  } catch {
    return { ok: false, error: "Invalid JSON", status: 400 };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "Invalid payload", status: 400 };
  }

  const payload = validateDeviceClientHealthPayload(
    parsed as Record<string, unknown>,
  );
  if (!payload.ok) return { ok: false, error: payload.error, status: 400 };
  return { ok: true, payload: payload.value, rawBytes };
}

export function validateDeviceClientHealthPayload(
  input: Record<string, unknown>,
):
  | { ok: true; value: DeviceClientHealthPayload }
  | { ok: false; error: string } {
  for (const key of Object.keys(input)) {
    if (!ALLOWED_PAYLOAD_KEYS.has(key)) return invalid("Invalid payload field");
  }

  if (!isDeviceClientHealthEvent(input.event)) {
    return invalid("Invalid client-health event");
  }
  if (
    typeof input.sequence !== "number" ||
    !Number.isInteger(input.sequence) ||
    input.sequence < 0 ||
    input.sequence > Number.MAX_SAFE_INTEGER
  ) {
    return invalid("Invalid sequence");
  }
  if (
    input.errorBucket !== undefined &&
    !isDeviceClientHealthErrorBucket(input.errorBucket)
  ) {
    return invalid("Invalid error bucket");
  }
  if (
    input.durationBucket !== undefined &&
    !isDeviceClientHealthDurationBucket(input.durationBucket)
  ) {
    return invalid("Invalid duration bucket");
  }
  if (
    input.checkoutOutcome !== undefined &&
    !isDeviceClientHealthCheckoutOutcome(input.checkoutOutcome)
  ) {
    return invalid("Invalid checkout outcome");
  }
  if (
    (input.event === "uncaught_error" || input.event === "unhandled_rejection") &&
    input.errorBucket === undefined
  ) {
    return invalid("Missing error bucket");
  }
  if (
    input.event === "checkout_completed" &&
    (input.durationBucket === undefined || input.checkoutOutcome === undefined)
  ) {
    return invalid("Missing checkout summary");
  }

  return {
    ok: true,
    value: {
      event: input.event,
      sequence: input.sequence,
      errorBucket: input.errorBucket,
      durationBucket: input.durationBucket,
      checkoutOutcome: input.checkoutOutcome,
    },
  };
}

export function recordDeviceClientHealthEvent({
  payload,
  outletId,
  deviceId,
  deviceName,
  asOf = new Date().toISOString(),
}: {
  payload: DeviceClientHealthPayload;
  outletId: string | null;
  deviceId: string;
  deviceName: string;
  asOf?: string;
}): void {
  try {
    const event: DeviceClientHealthEventRecord = {
      event: payload.event,
      asOf: safeIso(asOf),
      outletId: outletId ? safeToken(outletId, 128) : null,
      deviceId: safeToken(deviceId, 128),
      deviceName: safeToken(deviceName, 80) || "Kiosk",
      durationBucket: payload.durationBucket ?? null,
      checkoutOutcome: payload.checkoutOutcome ?? null,
    };
    events.push(event);
    trimEvents(Date.parse(event.asOf));
  } catch {
    // Client-health status collection must never affect kiosk operation.
  }
}

export function getLocalDeviceClientHealthSummary({
  now = new Date(),
  windowMs = CLIENT_HEALTH_WINDOW_MS,
  outletId,
}: {
  now?: Date;
  windowMs?: number;
  outletId?: string | null;
} = {}): LocalDeviceClientHealthSummary {
  const windowStartMs = now.getTime() - Math.max(1, windowMs);
  const recent = events.filter((event) => {
    const atMs = Date.parse(event.asOf);
    if (!Number.isFinite(atMs) || atMs < windowStartMs) return false;
    if (!outletId) return true;
    return event.outletId == null || event.outletId === outletId;
  });
  const latest = [...recent].sort(
    (a, b) => Date.parse(b.asOf) - Date.parse(a.asOf),
  )[0] ?? null;

  return {
    source: "local-memory",
    windowMinutes: Math.max(1, Math.round(windowMs / 60_000)),
    totalCount: recent.length,
    latestAt: latest?.asOf ?? null,
    latestDeviceId: latest?.deviceId ?? null,
    latestDeviceName: latest?.deviceName ?? null,
    latestEvent: latest?.event ?? null,
    appLoadedCount: countEvents(recent, "app_loaded"),
    heartbeatCount: countEvents(recent, "heartbeat"),
    menuLoadedCount: countEvents(recent, "menu_loaded"),
    menuFailedCount: countEvents(recent, "menu_failed"),
    errorCount:
      countEvents(recent, "uncaught_error") +
      countEvents(recent, "unhandled_rejection"),
    unhandledRejectionCount: countEvents(recent, "unhandled_rejection"),
    checkoutStartedCount: countEvents(recent, "checkout_started"),
    checkoutCompletedCount: countEvents(recent, "checkout_completed"),
    checkoutSlowCount: recent.filter(
      (event) =>
        event.event === "checkout_completed" &&
        (event.durationBucket === "10-30s" || event.durationBucket === "30s+"),
    ).length,
  };
}

export function __resetDeviceClientHealthForTests(): void {
  if (process.env.NODE_ENV === "production") return;
  events = [];
  sessionRateBuckets.clear();
  ipRateBuckets.clear();
}

function countEvents(
  input: DeviceClientHealthEventRecord[],
  event: DeviceClientHealthEvent,
): number {
  return input.filter((row) => row.event === event).length;
}

function trimEvents(nowMs: number): void {
  const cutoff = nowMs - CLIENT_HEALTH_RETENTION_MS;
  events = events
    .filter((event) => {
      const atMs = Date.parse(event.asOf);
      return Number.isFinite(atMs) && atMs >= cutoff;
    })
    .slice(-CLIENT_HEALTH_MAX_EVENTS);
}

function safeIso(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function safeToken(value: string, maxLength: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}
