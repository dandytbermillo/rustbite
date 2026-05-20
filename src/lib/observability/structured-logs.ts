import type { CaptureContext } from "./types";
import {
  recordCriticalRouteTiming,
  recordHttpServerIssue,
} from "./status-events";

export type StructuredLogLevel = "info" | "warn" | "error";

export type StructuredLogEvent =
  | RequestCompletedLog
  | RequestSlowLog
  | JobLifecycleLog
  | PaymentCorrelationLog;

export type RequestCompletedLog = BaseStructuredLog & {
  event: "request.completed";
  method: string;
  routePattern: string;
  status: number;
  durationMs: number;
  sampled: boolean;
  context: SafeLogContext;
};

export type RequestSlowLog = BaseStructuredLog & {
  event: "request.slow";
  method: string;
  routePattern: string;
  status: number;
  durationMs: number;
  thresholdMs: number;
  context: SafeLogContext;
};

export type JobLifecycleLog = BaseStructuredLog & {
  event: "job.started" | "job.completed" | "job.failed";
  jobName: string;
  jobId: string;
  durationMs?: number;
  context: SafeLogContext;
};

export type PaymentCorrelationLog = BaseStructuredLog & {
  event: "payment.correlation";
  action: string;
  correlationId: string;
  status?: string;
  provider?: string;
  providerPaymentIntentId?: string;
  providerReaderId?: string;
  context: SafeLogContext;
};

type BaseStructuredLog = {
  schema: "rushbite.observability.structured-log.v1";
  level: StructuredLogLevel;
  asOf: string;
};

type SafeLogContext = {
  surface?: string;
  requestId?: string;
  clientRequestId?: string;
  outletId?: string;
  deviceId?: string;
  adminUserId?: string;
  jobId?: string;
  jobName?: string;
  startedAt?: string;
  routePattern?: string;
};

type StructuredLogWriter = (
  level: StructuredLogLevel,
  line: string,
  event: StructuredLogEvent,
) => void;

const LOGGING_ENABLED_ENV = "OBSERVABILITY_STRUCTURED_LOGS";
const REQUEST_SAMPLE_RATE_ENV = "OBSERVABILITY_REQUEST_LOG_SAMPLE_RATE";
const SLOW_SAMPLE_RATE_ENV = "OBSERVABILITY_SLOW_REQUEST_LOG_SAMPLE_RATE";
const SLOW_THRESHOLD_ENV = "OBSERVABILITY_SLOW_REQUEST_MS";
const DEFAULT_SLOW_REQUEST_MS = 1_000;

const RAW_CONSOLE_LOG = console.log.bind(console);
const RAW_CONSOLE_WARN = console.warn.bind(console);
const RAW_CONSOLE_ERROR = console.error.bind(console);

const STATIC_ROUTE_PATTERNS = new Set([
  "/api/menu",
  "/api/orders",
  "/api/device-session/client-health",
  "/api/device-session/presence",
  "/api/payments/sessions",
  "/api/observability/test-exception",
  "/api/admin/observability/investigation-mode",
  "/api/admin/workspace/dashboard/summary",
  "/api/admin/workspace/menu/editor-context",
  "/api/admin/workspace/orders/summary",
  "/api/admin/workspace/system-status",
]);

const DYNAMIC_ROUTE_PATTERNS: Array<[RegExp, string]> = [
  [/^\/api\/orders\/[^/]+$/, "/api/orders/[id]"],
  [/^\/api\/payments\/sessions\/[^/]+$/, "/api/payments/sessions/[id]"],
  [/^\/api\/admin\/devices\/[^/]+$/, "/api/admin/devices/[id]"],
  [/^\/api\/admin\/devices\/[^/]+\/active$/, "/api/admin/devices/[id]/active"],
  [/^\/api\/admin\/devices\/[^/]+\/rotate$/, "/api/admin/devices/[id]/rotate"],
];

const testState: {
  writer: StructuredLogWriter | null;
  now: (() => string) | null;
  requestSampleRate: number | null;
  slowSampleRate: number | null;
  slowThresholdMs: number | null;
  random: (() => number) | null;
  enabled: boolean | null;
} = {
  writer: null,
  now: null,
  requestSampleRate: null,
  slowSampleRate: null,
  slowThresholdMs: null,
  random: null,
  enabled: null,
};

export function routePatternFromUrl(url: string): string {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return "/api/[unknown]";
  }

  if (STATIC_ROUTE_PATTERNS.has(pathname)) return pathname;
  for (const [pattern, label] of DYNAMIC_ROUTE_PATTERNS) {
    if (pattern.test(pathname)) return label;
  }
  if (pathname.startsWith("/api/")) return "/api/[unknown]";
  return "/[unknown]";
}

export function logRequestCompleted({
  method,
  url,
  status,
  durationMs,
  context,
}: {
  method: string;
  url: string;
  status: number;
  durationMs: number;
  context: CaptureContext;
}): void {
  const routePattern = routePatternFromUrl(url);
  const roundedDuration = Math.max(0, Math.round(durationMs));
  const isFailure = status >= 500;
  const isSlow = roundedDuration >= slowRequestThresholdMs();
  const asOf = nowIso();

  recordCriticalRouteTiming({
    method,
    routePattern,
    status,
    durationMs: roundedDuration,
    context,
    asOf,
  });

  if (isFailure) {
    recordHttpServerIssue({
      method,
      routePattern,
      status,
      context,
      asOf,
    });
  }

  if (!structuredLogsEnabled()) return;
  const shouldLogCompletion =
    isFailure || shouldSample(requestLogSampleRate());

  if (shouldLogCompletion) {
    writeStructuredLog({
      schema: "rushbite.observability.structured-log.v1",
      event: "request.completed",
      level: status >= 500 ? "error" : "info",
      asOf,
      method: sanitizeLogString(method, 16).toUpperCase(),
      routePattern,
      status,
      durationMs: roundedDuration,
      sampled: !isFailure,
      context: safeLogContext(context),
    });
  }

  if (isSlow && (isFailure || shouldSample(slowRequestLogSampleRate()))) {
    writeStructuredLog({
      schema: "rushbite.observability.structured-log.v1",
      event: "request.slow",
      level: status >= 500 ? "error" : "warn",
      asOf,
      method: sanitizeLogString(method, 16).toUpperCase(),
      routePattern,
      status,
      durationMs: roundedDuration,
      thresholdMs: slowRequestThresholdMs(),
      context: safeLogContext(context),
    });
  }
}

export function logJobStarted(context: CaptureContext): void {
  if (!structuredLogsEnabled()) return;
  writeStructuredLog({
    schema: "rushbite.observability.structured-log.v1",
    event: "job.started",
    level: "info",
    asOf: nowIso(),
    jobName: sanitizeLogString(context.jobName ?? "unknown-job", 64),
    jobId: sanitizeLogString(context.jobId ?? "unknown-job-id", 128),
    context: safeLogContext(context),
  });
}

export function logJobCompleted(context: CaptureContext, durationMs: number): void {
  if (!structuredLogsEnabled()) return;
  writeStructuredLog({
    schema: "rushbite.observability.structured-log.v1",
    event: "job.completed",
    level: "info",
    asOf: nowIso(),
    jobName: sanitizeLogString(context.jobName ?? "unknown-job", 64),
    jobId: sanitizeLogString(context.jobId ?? "unknown-job-id", 128),
    durationMs: Math.max(0, Math.round(durationMs)),
    context: safeLogContext(context),
  });
}

export function logJobFailed(context: CaptureContext, durationMs: number): void {
  if (!structuredLogsEnabled()) return;
  writeStructuredLog({
    schema: "rushbite.observability.structured-log.v1",
    event: "job.failed",
    level: "error",
    asOf: nowIso(),
    jobName: sanitizeLogString(context.jobName ?? "unknown-job", 64),
    jobId: sanitizeLogString(context.jobId ?? "unknown-job-id", 128),
    durationMs: Math.max(0, Math.round(durationMs)),
    context: safeLogContext(context),
  });
}

export function logPaymentCorrelation({
  action,
  transactionId,
  status,
  provider,
  providerPaymentIntentId,
  providerReaderId,
  context,
}: {
  action: string;
  transactionId: string;
  status?: string | null;
  provider?: string | null;
  providerPaymentIntentId?: string | null;
  providerReaderId?: string | null;
  context?: CaptureContext;
}): void {
  if (!structuredLogsEnabled()) return;
  const event: PaymentCorrelationLog = {
    schema: "rushbite.observability.structured-log.v1",
    event: "payment.correlation",
    level: status === "FAILED" ? "error" : "info",
    asOf: nowIso(),
    action: sanitizeLogString(action, 64),
    correlationId: sanitizeLogString(transactionId, 128),
    context: safeLogContext(context),
  };
  if (status) event.status = sanitizeLogString(status, 48);
  if (provider) event.provider = sanitizeLogString(provider, 48);
  if (providerPaymentIntentId) {
    event.providerPaymentIntentId = sanitizeLogString(providerPaymentIntentId, 128);
  }
  if (providerReaderId) {
    event.providerReaderId = sanitizeLogString(providerReaderId, 128);
  }
  writeStructuredLog(event);
}

function writeStructuredLog(event: StructuredLogEvent): void {
  try {
    const line = JSON.stringify(event);
    const writer = testState.writer ?? defaultWriter;
    writer(event.level, line, event);
  } catch {
    // Logging must never change route/job behavior.
  }
}

function defaultWriter(level: StructuredLogLevel, line: string): void {
  if (level === "error") {
    RAW_CONSOLE_ERROR(line);
  } else if (level === "warn") {
    RAW_CONSOLE_WARN(line);
  } else {
    RAW_CONSOLE_LOG(line);
  }
}

function structuredLogsEnabled(): boolean {
  if (testState.enabled !== null) return testState.enabled;
  const raw = process.env[LOGGING_ENABLED_ENV];
  if (raw === undefined) return true;
  const normalized = raw.trim().toLowerCase();
  return normalized !== "false" && normalized !== "0";
}

function requestLogSampleRate(): number {
  if (testState.requestSampleRate !== null) return testState.requestSampleRate;
  return readRateEnv(
    REQUEST_SAMPLE_RATE_ENV,
    process.env.NODE_ENV === "production" ? 0.01 : 1,
  );
}

function slowRequestLogSampleRate(): number {
  if (testState.slowSampleRate !== null) return testState.slowSampleRate;
  return readRateEnv(SLOW_SAMPLE_RATE_ENV, 1);
}

function slowRequestThresholdMs(): number {
  if (testState.slowThresholdMs !== null) return testState.slowThresholdMs;
  const raw = Number(process.env[SLOW_THRESHOLD_ENV]);
  if (!Number.isFinite(raw)) return DEFAULT_SLOW_REQUEST_MS;
  return Math.max(1, Math.min(Math.trunc(raw), 60_000));
}

function readRateEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(0, Math.min(raw, 1));
}

function shouldSample(rate: number): boolean {
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  return (testState.random ?? Math.random)() < rate;
}

function nowIso(): string {
  return testState.now ? testState.now() : new Date().toISOString();
}

function safeLogContext(context?: CaptureContext | null): SafeLogContext {
  if (!context) return {};
  const out: SafeLogContext = {};
  for (const key of [
    "surface",
    "requestId",
    "clientRequestId",
    "outletId",
    "deviceId",
    "adminUserId",
    "jobId",
    "jobName",
    "startedAt",
    "routePattern",
  ] as const) {
    const value = context[key];
    if (typeof value === "string" && value.length > 0) {
      out[key] = sanitizeLogString(value, key === "jobName" ? 64 : 128);
    }
  }
  return out;
}

function sanitizeLogString(value: string, maxLength: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function __configureStructuredLogsForTests(options: {
  writer?: StructuredLogWriter | null;
  now?: (() => string) | null;
  requestSampleRate?: number | null;
  slowSampleRate?: number | null;
  slowThresholdMs?: number | null;
  random?: (() => number) | null;
  enabled?: boolean | null;
}): void {
  if (process.env.NODE_ENV === "production") return;
  if ("writer" in options) testState.writer = options.writer ?? null;
  if ("now" in options) testState.now = options.now ?? null;
  if ("requestSampleRate" in options) {
    testState.requestSampleRate =
      options.requestSampleRate === null || options.requestSampleRate === undefined
        ? null
        : Math.max(0, Math.min(options.requestSampleRate, 1));
  }
  if ("slowSampleRate" in options) {
    testState.slowSampleRate =
      options.slowSampleRate === null || options.slowSampleRate === undefined
        ? null
        : Math.max(0, Math.min(options.slowSampleRate, 1));
  }
  if ("slowThresholdMs" in options) {
    testState.slowThresholdMs =
      options.slowThresholdMs === null || options.slowThresholdMs === undefined
        ? null
        : Math.max(1, Math.trunc(options.slowThresholdMs));
  }
  if ("random" in options) testState.random = options.random ?? null;
  if ("enabled" in options) testState.enabled = options.enabled ?? null;
}

export function __resetStructuredLogsForTests(): void {
  if (process.env.NODE_ENV === "production") return;
  testState.writer = null;
  testState.now = null;
  testState.requestSampleRate = null;
  testState.slowSampleRate = null;
  testState.slowThresholdMs = null;
  testState.random = null;
  testState.enabled = null;
}
