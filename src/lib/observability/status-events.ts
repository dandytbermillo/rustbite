import type {
  CaptureContext,
  SanitizedExceptionEvent,
  Surface,
} from "./types";
import { VALID_SURFACES } from "./types";

export type LocalServerIssueKind = "http_5xx" | "captured_exception";

export type LocalServerIssueEvent = {
  kind: LocalServerIssueKind;
  asOf: string;
  routePattern: string;
  surface: Surface;
  status: number | null;
  errorName: string | null;
  requestId: string | null;
  outletId: string | null;
  deviceId: string | null;
  adminUserId: string | null;
};

export type LocalServerIssueGroup = {
  routePattern: string;
  surface: Surface;
  count: number;
  latestAt: string;
  latestStatus: number | null;
  latestErrorName: string | null;
  latestRequestId: string | null;
};

export type LocalServerIssueSummary = {
  source: "local-memory";
  windowMinutes: number;
  totalCount: number;
  latestAt: string | null;
  groups: LocalServerIssueGroup[];
};

export type LocalCriticalRouteId =
  | "menu_load"
  | "checkout_create"
  | "payment_session_create"
  | "payment_session_poll";

export type LocalCriticalRouteTimingEvent = {
  routeId: LocalCriticalRouteId;
  asOf: string;
  routePattern: string;
  method: string;
  surface: Surface;
  status: number;
  durationMs: number;
  requestId: string | null;
  outletId: string | null;
  deviceId: string | null;
  adminUserId: string | null;
};

export type LocalCriticalRouteTimingGroup = {
  routeId: LocalCriticalRouteId;
  label: string;
  routePattern: string;
  method: string;
  thresholdMs: number;
  minSamples: number;
  degradedSlowCount: number;
  degradedSlowRatio: number;
  actionSlowCount: number;
  actionSlowRatio: number;
  sampleCount: number;
  slowCount: number;
  slowRatio: number;
  latestAt: string | null;
  latestDurationMs: number | null;
  latestStatus: number | null;
  latestRequestId: string | null;
};

export type LocalCriticalRouteTimingSummary = {
  source: "local-memory";
  windowMinutes: number;
  totalSamples: number;
  totalSlowCount: number;
  latestAt: string | null;
  groups: LocalCriticalRouteTimingGroup[];
};

type CriticalRouteConfig = {
  routeId: LocalCriticalRouteId;
  label: string;
  routePattern: string;
  method: string;
  thresholdMs: number;
  minSamples: number;
  degradedSlowCount: number;
  degradedSlowRatio: number;
  actionSlowCount: number;
  actionSlowRatio: number;
};

const DEFAULT_WINDOW_MS = 15 * 60_000;
const RETENTION_MS = 60 * 60_000;
const MAX_EVENTS = 500;
const MAX_CRITICAL_ROUTE_TIMING_EVENTS = 1_000;
const MAX_GROUPS = 8;
const UNKNOWN_ROUTE = "/[unknown]";
const CAPTURED_EXCEPTION_ROUTE = "/[captured-exception]";

let events: LocalServerIssueEvent[] = [];
let criticalRouteTimingEvents: LocalCriticalRouteTimingEvent[] = [];

const CRITICAL_ROUTE_CONFIGS: readonly CriticalRouteConfig[] = [
  {
    routeId: "menu_load",
    label: "Menu loading",
    routePattern: "/api/menu",
    method: "GET",
    thresholdMs: 2_000,
    minSamples: 3,
    degradedSlowCount: 2,
    degradedSlowRatio: 0.34,
    actionSlowCount: 5,
    actionSlowRatio: 0.5,
  },
  {
    routeId: "checkout_create",
    label: "Checkout order creation",
    routePattern: "/api/orders",
    method: "POST",
    thresholdMs: 3_000,
    minSamples: 3,
    degradedSlowCount: 2,
    degradedSlowRatio: 0.4,
    actionSlowCount: 4,
    actionSlowRatio: 0.6,
  },
  {
    routeId: "payment_session_create",
    label: "Payment session creation",
    routePattern: "/api/payments/sessions",
    method: "POST",
    thresholdMs: 5_000,
    minSamples: 3,
    degradedSlowCount: 2,
    degradedSlowRatio: 0.4,
    actionSlowCount: 3,
    actionSlowRatio: 0.6,
  },
  {
    routeId: "payment_session_poll",
    label: "Payment polling",
    routePattern: "/api/payments/sessions/[id]",
    method: "GET",
    thresholdMs: 5_000,
    minSamples: 3,
    degradedSlowCount: 2,
    degradedSlowRatio: 0.4,
    actionSlowCount: 3,
    actionSlowRatio: 0.6,
  },
];

export function recordHttpServerIssue({
  method: _method,
  routePattern,
  status,
  context,
  asOf = new Date().toISOString(),
}: {
  method: string;
  routePattern: string;
  status: number;
  context: CaptureContext;
  asOf?: string;
}): void {
  if (status < 500) return;
  recordEvent({
    kind: "http_5xx",
    asOf,
    routePattern,
    status,
    context,
    errorName: null,
  });
}

export function recordCapturedExceptionIssue(
  event: SanitizedExceptionEvent,
): void {
  recordEvent({
    kind: "captured_exception",
    asOf: event.asOf,
    routePattern: event.context.routePattern ?? CAPTURED_EXCEPTION_ROUTE,
    status: null,
    context: event.context,
    errorName: event.name,
  });
}

export function recordCriticalRouteTiming({
  method,
  routePattern,
  status,
  durationMs,
  context,
  asOf = new Date().toISOString(),
}: {
  method: string;
  routePattern: string;
  status: number;
  durationMs: number;
  context: CaptureContext;
  asOf?: string;
}): void {
  const config = criticalRouteConfigFor(method, routePattern);
  if (!config) return;

  try {
    const event: LocalCriticalRouteTimingEvent = {
      routeId: config.routeId,
      asOf: safeIso(asOf),
      routePattern: config.routePattern,
      method: config.method,
      surface: safeSurface(context.surface),
      status: Math.trunc(status),
      durationMs: Math.max(0, Math.round(durationMs)),
      requestId: context.requestId ? safeToken(context.requestId, 128) : null,
      outletId: context.outletId ? safeToken(context.outletId, 128) : null,
      deviceId: context.deviceId ? safeToken(context.deviceId, 128) : null,
      adminUserId: context.adminUserId ? safeToken(context.adminUserId, 128) : null,
    };
    criticalRouteTimingEvents.push(event);
    trimCriticalRouteTimingEvents(Date.parse(event.asOf));
  } catch {
    // Status collection must never affect request behavior.
  }
}

export function getLocalServerIssueSummary({
  now = new Date(),
  windowMs = DEFAULT_WINDOW_MS,
  outletId,
}: {
  now?: Date;
  windowMs?: number;
  outletId?: string | null;
} = {}): LocalServerIssueSummary {
  const windowStartMs = now.getTime() - Math.max(1, windowMs);
  const recent = dedupeByRequest(
    events.filter((event) => {
      const atMs = Date.parse(event.asOf);
      if (!Number.isFinite(atMs) || atMs < windowStartMs) return false;
      if (!outletId) return true;
      return event.outletId == null || event.outletId === outletId;
    }),
  );

  const groups = new Map<string, LocalServerIssueGroup>();
  for (const event of recent) {
    const key = `${event.surface}\n${event.routePattern}`;
    const current = groups.get(key);
    if (!current) {
      groups.set(key, {
        routePattern: event.routePattern,
        surface: event.surface,
        count: 1,
        latestAt: event.asOf,
        latestStatus: event.status,
        latestErrorName: event.errorName,
        latestRequestId: event.requestId,
      });
      continue;
    }

    current.count += 1;
    if (Date.parse(event.asOf) >= Date.parse(current.latestAt)) {
      current.latestAt = event.asOf;
      current.latestStatus = event.status;
      current.latestErrorName = event.errorName;
      current.latestRequestId = event.requestId;
    }
  }

  const sortedGroups = [...groups.values()]
    .sort(
      (a, b) =>
        b.count - a.count ||
        Date.parse(b.latestAt) - Date.parse(a.latestAt) ||
        a.routePattern.localeCompare(b.routePattern),
    )
    .slice(0, MAX_GROUPS);
  const latestAt =
    recent
      .map((event) => event.asOf)
      .sort()
      .at(-1) ?? null;

  return {
    source: "local-memory",
    windowMinutes: Math.max(1, Math.round(windowMs / 60_000)),
    totalCount: recent.length,
    latestAt,
    groups: sortedGroups,
  };
}

export function getLocalCriticalRouteTimingSummary({
  now = new Date(),
  windowMs = DEFAULT_WINDOW_MS,
  outletId,
}: {
  now?: Date;
  windowMs?: number;
  outletId?: string | null;
} = {}): LocalCriticalRouteTimingSummary {
  const windowStartMs = now.getTime() - Math.max(1, windowMs);
  const recent = criticalRouteTimingEvents.filter((event) => {
    const atMs = Date.parse(event.asOf);
    if (!Number.isFinite(atMs) || atMs < windowStartMs) return false;
    if (!outletId) return true;
    return event.outletId == null || event.outletId === outletId;
  });

  const groups = new Map<LocalCriticalRouteId, LocalCriticalRouteTimingGroup>(
    CRITICAL_ROUTE_CONFIGS.map((config) => [
      config.routeId,
      {
        routeId: config.routeId,
        label: config.label,
        routePattern: config.routePattern,
        method: config.method,
        thresholdMs: config.thresholdMs,
        minSamples: config.minSamples,
        degradedSlowCount: config.degradedSlowCount,
        degradedSlowRatio: config.degradedSlowRatio,
        actionSlowCount: config.actionSlowCount,
        actionSlowRatio: config.actionSlowRatio,
        sampleCount: 0,
        slowCount: 0,
        slowRatio: 0,
        latestAt: null,
        latestDurationMs: null,
        latestStatus: null,
        latestRequestId: null,
      },
    ]),
  );

  for (const event of recent) {
    const group = groups.get(event.routeId);
    if (!group) continue;
    group.sampleCount += 1;
    if (event.durationMs >= group.thresholdMs) group.slowCount += 1;
    if (!group.latestAt || Date.parse(event.asOf) >= Date.parse(group.latestAt)) {
      group.latestAt = event.asOf;
      group.latestDurationMs = event.durationMs;
      group.latestStatus = event.status;
      group.latestRequestId = event.requestId;
    }
  }

  const materializedGroups = [...groups.values()].map((group) => ({
    ...group,
    slowRatio:
      group.sampleCount === 0 ? 0 : roundRatio(group.slowCount / group.sampleCount),
  }));
  const latestAt =
    recent
      .map((event) => event.asOf)
      .sort()
      .at(-1) ?? null;

  return {
    source: "local-memory",
    windowMinutes: Math.max(1, Math.round(windowMs / 60_000)),
    totalSamples: recent.length,
    totalSlowCount: materializedGroups.reduce(
      (sum, group) => sum + group.slowCount,
      0,
    ),
    latestAt,
    groups: materializedGroups,
  };
}

export function __resetLocalServerIssuesForTests(): void {
  if (process.env.NODE_ENV === "production") return;
  events = [];
  criticalRouteTimingEvents = [];
}

function recordEvent({
  kind,
  asOf,
  routePattern,
  status,
  context,
  errorName,
}: {
  kind: LocalServerIssueKind;
  asOf: string;
  routePattern: string;
  status: number | null;
  context: CaptureContext;
  errorName: string | null;
}): void {
  try {
    const event: LocalServerIssueEvent = {
      kind,
      asOf: safeIso(asOf),
      routePattern: safeRoutePattern(routePattern),
      surface: safeSurface(context.surface),
      status: typeof status === "number" ? Math.trunc(status) : null,
      errorName: errorName ? safeToken(errorName, 80) : null,
      requestId: context.requestId ? safeToken(context.requestId, 128) : null,
      outletId: context.outletId ? safeToken(context.outletId, 128) : null,
      deviceId: context.deviceId ? safeToken(context.deviceId, 128) : null,
      adminUserId: context.adminUserId ? safeToken(context.adminUserId, 128) : null,
    };
    events.push(event);
    trimEvents(Date.parse(event.asOf));
  } catch {
    // Status collection must never affect request or capture behavior.
  }
}

function trimEvents(nowMs: number): void {
  const cutoff = nowMs - RETENTION_MS;
  events = events
    .filter((event) => {
      const atMs = Date.parse(event.asOf);
      return Number.isFinite(atMs) && atMs >= cutoff;
    })
    .slice(-MAX_EVENTS);
}

function trimCriticalRouteTimingEvents(nowMs: number): void {
  const cutoff = nowMs - RETENTION_MS;
  criticalRouteTimingEvents = criticalRouteTimingEvents
    .filter((event) => {
      const atMs = Date.parse(event.asOf);
      return Number.isFinite(atMs) && atMs >= cutoff;
    })
    .slice(-MAX_CRITICAL_ROUTE_TIMING_EVENTS);
}

function dedupeByRequest(
  rawEvents: LocalServerIssueEvent[],
): LocalServerIssueEvent[] {
  const withoutRequestId: LocalServerIssueEvent[] = [];
  const byRequestId = new Map<string, LocalServerIssueEvent>();

  for (const event of rawEvents) {
    if (!event.requestId) {
      withoutRequestId.push(event);
      continue;
    }
    const current = byRequestId.get(event.requestId);
    if (!current || preferEvent(event, current)) {
      byRequestId.set(event.requestId, event);
    }
  }

  return [...withoutRequestId, ...byRequestId.values()];
}

function preferEvent(
  candidate: LocalServerIssueEvent,
  current: LocalServerIssueEvent,
): boolean {
  if (candidate.kind === "http_5xx" && current.kind !== "http_5xx") return true;
  if (
    candidate.routePattern !== CAPTURED_EXCEPTION_ROUTE &&
    current.routePattern === CAPTURED_EXCEPTION_ROUTE
  ) {
    return true;
  }
  return Date.parse(candidate.asOf) >= Date.parse(current.asOf);
}

function safeIso(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function safeSurface(value: Surface): Surface {
  return VALID_SURFACES.has(value) ? value : "api";
}

function safeRoutePattern(value: string): string {
  const normalized = safeToken(value, 128);
  if (!normalized.startsWith("/")) return UNKNOWN_ROUTE;
  if (normalized.includes("?") || normalized.includes("#")) return UNKNOWN_ROUTE;
  if (!/^[A-Za-z0-9/_\-[\].]+$/.test(normalized)) return UNKNOWN_ROUTE;
  return normalized;
}

function safeToken(value: string, maxLength: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function criticalRouteConfigFor(
  method: string,
  routePattern: string,
): CriticalRouteConfig | null {
  const normalizedMethod = safeToken(method, 16).toUpperCase();
  const normalizedRoute = safeRoutePattern(routePattern);
  return (
    CRITICAL_ROUTE_CONFIGS.find(
      (config) =>
        config.method === normalizedMethod &&
        config.routePattern === normalizedRoute,
    ) ?? null
  );
}

function roundRatio(value: number): number {
  return Math.round(value * 100) / 100;
}
