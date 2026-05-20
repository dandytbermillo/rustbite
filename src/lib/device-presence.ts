import "server-only";

import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import {
  isDevicePresenceCloseReason,
  isDevicePresenceErrorBucket,
  isDevicePresenceEvent,
  isDevicePresenceUptimeBucket,
  isDevicePresenceVisibilityState,
  type DevicePresencePayload,
} from "@/lib/device-presence-shared";
import { getLoginIpHash } from "@/lib/login-rate-limit";

export type DevicePresenceKind =
  | "online"
  | "idle"
  | "hidden"
  | "closed"
  | "unexpected_offline"
  | "offline"
  | "disabled";

export type DevicePresenceSummary = {
  presenceKind: DevicePresenceKind;
  presenceLabel: string;
  presenceReason: string | null;
  presenceLastLifecycleAt: string | null;
  presenceLastHeartbeatAt: string | null;
  state: "online" | "idle" | "offline" | "disabled";
  lastSeenLabel: string;
};

export type DevicePresenceSession = {
  lastSeenAt: Date;
  lastHeartbeatAt: Date | null;
  lastLifecycleAt: Date | null;
  lastLifecycleEvent: string | null;
  lastVisibilityState: string | null;
  lastClosedAt: Date | null;
  activeOutletId?: string | null;
  activeStaffOutletId?: string | null;
};

const PRESENCE_BODY_LIMIT_BYTES = 2 * 1024;
const ACTIVE_ONLINE_MS = 2 * 60_000;
const IDLE_MS = 10 * 60_000;
const EXTENDED_HIDDEN_MS = 10 * 60_000;
const PRESENCE_RATE_WINDOW_MS = 60_000;
const DEFAULT_SESSION_RATE_MAX = 12;
const DEFAULT_IP_RATE_MAX = 300;
const CLIENT_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{16,160}$/;

const ACTIVE_EVENTS = new Set([
  "opened",
  "heartbeat",
  "visible",
  "resume",
  "bfcache_pageshow",
  "client_error",
  "unhandled_rejection",
  "recovered_unclean_previous_session",
]);

const HIDDEN_EVENTS = new Set(["hidden", "freeze", "bfcache_pagehide"]);

type RateBucket = {
  windowStartedAt: number;
  count: number;
};

const sessionRateBuckets = new Map<string, RateBucket>();
const ipRateBuckets = new Map<string, RateBucket>();

function envInt(name: string, fallback: number, input: { min: number; max: number }) {
  const raw = process.env[name];
  if (!raw?.trim()) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(input.min, Math.min(Math.trunc(parsed), input.max));
}

function rateLimitMax(kind: "session" | "ip") {
  return kind === "session"
    ? envInt("DEVICE_PRESENCE_RATE_LIMIT_SESSION_MAX", DEFAULT_SESSION_RATE_MAX, {
        min: 1,
        max: 10_000,
      })
    : envInt("DEVICE_PRESENCE_RATE_LIMIT_IP_MAX", DEFAULT_IP_RATE_MAX, {
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
  if (!existing || nowMs - existing.windowStartedAt >= PRESENCE_RATE_WINDOW_MS) {
    buckets.set(key, { windowStartedAt: nowMs, count: 1 });
    return { ok: true as const, retryAfterSeconds: 0 };
  }

  if (existing.count >= max) {
    const retryAfterMs =
      existing.windowStartedAt + PRESENCE_RATE_WINDOW_MS - nowMs;
    return {
      ok: false as const,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  existing.count += 1;
  return { ok: true as const, retryAfterSeconds: 0 };
}

export function checkDevicePresenceRateLimit(input: {
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

export function resetDevicePresenceRateLimitForTests() {
  sessionRateBuckets.clear();
  ipRateBuckets.clear();
}

export function hashDevicePresenceClientSessionId(value: string): string {
  return createHash("sha256")
    .update(`device-presence-client-session:${value}`, "utf8")
    .digest("hex");
}

export function isActiveDevicePresenceEvent(event: string) {
  return ACTIVE_EVENTS.has(event);
}

export function shouldUpdateClientHashForPresenceEvent(event: string) {
  return event === "opened" || event === "recovered_unclean_previous_session";
}

function invalid(error: string) {
  return { ok: false as const, error };
}

export async function readDevicePresencePayload(
  req: NextRequest,
): Promise<
  | { ok: true; payload: DevicePresencePayload; rawBytes: number }
  | { ok: false; error: string; status: number }
> {
  const text = await req.text();
  const rawBytes = Buffer.byteLength(text, "utf8");
  if (rawBytes > PRESENCE_BODY_LIMIT_BYTES) {
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

  const body = parsed as Record<string, unknown>;
  const payload = validateDevicePresencePayload(body);
  if (!payload.ok) return { ok: false, error: payload.error, status: 400 };
  return { ok: true, payload: payload.value, rawBytes };
}

export function validateDevicePresencePayload(input: Record<string, unknown>):
  | { ok: true; value: DevicePresencePayload }
  | { ok: false; error: string } {
  const sequence = input.sequence;

  if (!isDevicePresenceEvent(input.event)) {
    return invalid("Invalid lifecycle event");
  }
  if (
    typeof input.clientSessionId !== "string" ||
    !CLIENT_SESSION_ID_PATTERN.test(input.clientSessionId)
  ) {
    return invalid("Invalid client session id");
  }
  if (
    typeof sequence !== "number" ||
    !Number.isInteger(sequence) ||
    sequence < 0 ||
    sequence > Number.MAX_SAFE_INTEGER
  ) {
    return invalid("Invalid sequence");
  }
  if (
    input.visibilityState !== undefined &&
    !isDevicePresenceVisibilityState(input.visibilityState)
  ) {
    return invalid("Invalid visibility state");
  }
  if (
    input.closeReason !== undefined &&
    !isDevicePresenceCloseReason(input.closeReason)
  ) {
    return invalid("Invalid close reason");
  }
  if (
    input.uptimeMsBucket !== undefined &&
    !isDevicePresenceUptimeBucket(input.uptimeMsBucket)
  ) {
    return invalid("Invalid uptime bucket");
  }
  if (
    input.errorBucket !== undefined &&
    !isDevicePresenceErrorBucket(input.errorBucket)
  ) {
    return invalid("Invalid error bucket");
  }

  return {
    ok: true,
    value: {
      event: input.event,
      clientSessionId: input.clientSessionId,
      sequence,
      visibilityState: input.visibilityState,
      closeReason: input.closeReason,
      uptimeMsBucket: input.uptimeMsBucket,
      errorBucket: input.errorBucket,
    },
  };
}

function ageMinutes(now: Date, value: Date): number {
  return Math.max(0, Math.floor((now.getTime() - value.getTime()) / 60_000));
}

function formatRelativeLastSeen(now: Date, value: Date | null): string {
  if (!value) return "Never seen";
  const minutes = ageMinutes(now, value);
  if (minutes < 1) return "Last seen <1m ago";
  if (minutes < 60) return `Last seen ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return remainingMinutes > 0
      ? `Last seen ${hours}h ${remainingMinutes}m ago`
      : `Last seen ${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `Last seen ${days}d ago`;
}

function latestPresenceSession(sessions: DevicePresenceSession[]) {
  return [...sessions].sort((a, b) => {
    const aTime = (
      a.lastLifecycleAt ??
      a.lastHeartbeatAt ??
      a.lastSeenAt
    ).getTime();
    const bTime = (
      b.lastLifecycleAt ??
      b.lastHeartbeatAt ??
      b.lastSeenAt
    ).getTime();
    return bTime - aTime;
  })[0] ?? null;
}

function presenceLabel(kind: DevicePresenceKind): string {
  if (kind === "online") return "Online";
  if (kind === "idle") return "Idle";
  if (kind === "hidden") return "Hidden";
  if (kind === "closed") return "Closed";
  if (kind === "unexpected_offline") return "Unexpected offline";
  if (kind === "disabled") return "Disabled";
  return "Offline";
}

function presenceCountState(kind: DevicePresenceKind) {
  if (kind === "online") return "online" as const;
  if (kind === "idle" || kind === "hidden") return "idle" as const;
  if (kind === "disabled") return "disabled" as const;
  return "offline" as const;
}

export function deriveDevicePresence(input: {
  now: Date;
  isActive: boolean;
  lastSeenAt: Date | null;
  sessions: DevicePresenceSession[];
}): DevicePresenceSummary {
  if (!input.isActive) {
    return {
      presenceKind: "disabled",
      presenceLabel: "Disabled",
      presenceReason: "Device is disabled in admin.",
      presenceLastLifecycleAt: null,
      presenceLastHeartbeatAt: null,
      state: "disabled",
      lastSeenLabel: "Disabled",
    };
  }

  const session = latestPresenceSession(input.sessions);
  const event = session?.lastLifecycleEvent ?? null;
  const lifecycleAt = session?.lastLifecycleAt ?? null;
  const heartbeatAt = session?.lastHeartbeatAt ?? null;
  const lastSeenAt = heartbeatAt ?? input.lastSeenAt;
  let kind: DevicePresenceKind = "offline";
  let reason: string | null = null;

  if (session && event === "clean_close") {
    kind = "closed";
    reason = "Device reported a clean close.";
  } else if (
    session &&
    event === "hidden" &&
    heartbeatAt &&
    input.now.getTime() - heartbeatAt.getTime() < ACTIVE_ONLINE_MS
  ) {
    kind = "online";
  } else if (session && event && HIDDEN_EVENTS.has(event)) {
    if (
      heartbeatAt &&
      input.now.getTime() - heartbeatAt.getTime() <= EXTENDED_HIDDEN_MS
    ) {
      kind = "hidden";
      reason =
        event === "freeze"
          ? "Device browser is frozen or sleeping."
          : "Device browser is hidden or suspended.";
    } else {
      kind = "unexpected_offline";
      reason = "Hidden device stopped heartbeating.";
    }
  } else if (lastSeenAt) {
    const ageMs = input.now.getTime() - lastSeenAt.getTime();
    if (ageMs < ACTIVE_ONLINE_MS) {
      kind = "online";
    } else if (ageMs <= IDLE_MS) {
      kind = "idle";
    } else if (session && event && !ACTIVE_EVENTS.has(event)) {
      kind = "unexpected_offline";
      reason = "Device stopped heartbeating without a clean close.";
    } else if (session?.lastHeartbeatAt) {
      kind = "unexpected_offline";
      reason = "Device heartbeat expired without a clean close.";
    } else {
      kind = "offline";
    }
  }

  return {
    presenceKind: kind,
    presenceLabel: presenceLabel(kind),
    presenceReason: reason,
    presenceLastLifecycleAt: lifecycleAt?.toISOString() ?? null,
    presenceLastHeartbeatAt: heartbeatAt?.toISOString() ?? null,
    state: presenceCountState(kind),
    lastSeenLabel:
      kind === "closed"
        ? "Closed"
        : kind === "unexpected_offline"
          ? "Unexpected offline"
          : formatRelativeLastSeen(input.now, lastSeenAt),
  };
}
