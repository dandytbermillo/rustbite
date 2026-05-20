export type ObservabilityUptimeCheckId =
  | "app-root"
  | "health"
  | "readiness"
  | "kiosk-reachability";

export type ObservabilityUptimeCheckDefinition = {
  id: ObservabilityUptimeCheckId;
  label: string;
  path: string;
  method: "GET";
  expectedStatuses: number[];
  timeoutMs: number;
  cadenceSeconds: number;
  betterStack: {
    checkType: "http";
    followRedirects: boolean;
  };
  workspaceSummary: string;
  pushAlerts: "disabled";
};

export type ObservabilityUptimeCheckSnapshot = {
  id: ObservabilityUptimeCheckId;
  label: string;
  path: string;
  state: "ready" | "degraded" | "action_needed" | "unknown";
  checkedAt: string | null;
  detail: string;
};

type UptimeCheckEnvKey =
  | "BETTER_STACK_UPTIME_API_TOKEN"
  | "BETTER_STACK_UPTIME_APP_ROOT_MONITOR_ID"
  | "BETTER_STACK_UPTIME_HEALTH_MONITOR_ID"
  | "BETTER_STACK_UPTIME_READINESS_MONITOR_ID"
  | "BETTER_STACK_UPTIME_KIOSK_REACHABILITY_MONITOR_ID";

type UptimeCheckEnv = Partial<Record<UptimeCheckEnvKey, string | undefined>>;

type FetchLike = typeof fetch;

type BetterStackMonitorStatus =
  | "paused"
  | "pending"
  | "maintenance"
  | "up"
  | "validating"
  | "down";

type BetterStackMonitorAttributes = {
  last_checked_at?: unknown;
  status?: unknown;
};

type BetterStackMonitorResponse = {
  data?: {
    attributes?: BetterStackMonitorAttributes;
  };
};

type BetterStackMonitorResult =
  | {
      ok: true;
      status: BetterStackMonitorStatus;
      checkedAt: string | null;
    }
  | { ok: false; reason: "missing_config" | "provider_unavailable" };

const BETTER_STACK_API_BASE = "https://uptime.betterstack.com/api/v2";
const BETTER_STACK_TIMEOUT_MS = 1_500;

const BETTER_STACK_MONITOR_ID_ENV: Record<
  ObservabilityUptimeCheckId,
  keyof UptimeCheckEnv
> = {
  "app-root": "BETTER_STACK_UPTIME_APP_ROOT_MONITOR_ID",
  health: "BETTER_STACK_UPTIME_HEALTH_MONITOR_ID",
  readiness: "BETTER_STACK_UPTIME_READINESS_MONITOR_ID",
  "kiosk-reachability": "BETTER_STACK_UPTIME_KIOSK_REACHABILITY_MONITOR_ID",
};

export const OBSERVABILITY_UPTIME_CHECKS: ObservabilityUptimeCheckDefinition[] =
  [
    {
      id: "app-root",
      label: "App reachability",
      path: "/",
      method: "GET",
      expectedStatuses: [200],
      timeoutMs: 5_000,
      cadenceSeconds: 60,
      betterStack: {
        checkType: "http",
        followRedirects: true,
      },
      workspaceSummary: "Confirms the public app responds from outside RushBite.",
      pushAlerts: "disabled",
    },
    {
      id: "health",
      label: "Health endpoint",
      path: "/api/health",
      method: "GET",
      expectedStatuses: [200],
      timeoutMs: 3_000,
      cadenceSeconds: 60,
      betterStack: {
        checkType: "http",
        followRedirects: false,
      },
      workspaceSummary: "Confirms the web process is alive without touching the database.",
      pushAlerts: "disabled",
    },
    {
      id: "readiness",
      label: "Readiness endpoint",
      path: "/api/health/ready",
      method: "GET",
      expectedStatuses: [200],
      timeoutMs: 5_000,
      cadenceSeconds: 60,
      betterStack: {
        checkType: "http",
        followRedirects: false,
      },
      workspaceSummary: "Confirms the app can reach the database within the readiness budget.",
      pushAlerts: "disabled",
    },
    {
      id: "kiosk-reachability",
      label: "Kiosk screen",
      path: "/kiosk",
      method: "GET",
      expectedStatuses: [200],
      timeoutMs: 5_000,
      cadenceSeconds: 120,
      betterStack: {
        checkType: "http",
        followRedirects: true,
      },
      workspaceSummary: "Confirms the customer kiosk shell can be loaded.",
      pushAlerts: "disabled",
    },
  ];

export function definitionOnlyUptimeSnapshots(): ObservabilityUptimeCheckSnapshot[] {
  return OBSERVABILITY_UPTIME_CHECKS.map((check) => ({
    id: check.id,
    label: check.label,
    path: check.path,
    state: "unknown",
    checkedAt: null,
    detail:
      "Better Stack check definition is available; external check history is not connected locally.",
  }));
}

export async function buildWorkspaceUptimeSnapshots({
  env = process.env as UptimeCheckEnv,
  fetcher = fetch,
  now = new Date(),
}: {
  env?: UptimeCheckEnv;
  fetcher?: FetchLike;
  now?: Date;
} = {}): Promise<ObservabilityUptimeCheckSnapshot[]> {
  const token = readToken(env.BETTER_STACK_UPTIME_API_TOKEN);
  if (!token) return definitionOnlyUptimeSnapshots();

  return Promise.all(
    OBSERVABILITY_UPTIME_CHECKS.map(async (check) => {
      const monitorId = readMonitorId(env[BETTER_STACK_MONITOR_ID_ENV[check.id]]);
      if (!monitorId) {
        return {
          id: check.id,
          label: check.label,
          path: check.path,
          state: "unknown" as const,
          checkedAt: null,
          detail: "Better Stack API token is configured, but this monitor id is missing.",
        };
      }

      const result = await fetchBetterStackMonitor({
        token,
        monitorId,
        fetcher,
      });
      return snapshotFromBetterStackResult({ check, result, now });
    }),
  );
}

async function fetchBetterStackMonitor({
  token,
  monitorId,
  fetcher,
}: {
  token: string;
  monitorId: string;
  fetcher: FetchLike;
}): Promise<BetterStackMonitorResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BETTER_STACK_TIMEOUT_MS);
  try {
    const response = await fetcher(
      `${BETTER_STACK_API_BASE}/monitors/${encodeURIComponent(monitorId)}`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
        },
        signal: controller.signal,
      },
    );
    if (!response.ok) return { ok: false, reason: "provider_unavailable" };

    const body = (await response.json().catch(() => null)) as
      | BetterStackMonitorResponse
      | null;
    const attributes = body?.data?.attributes;
    const status = normalizeBetterStackStatus(attributes?.status);
    if (!status) return { ok: false, reason: "provider_unavailable" };

    return {
      ok: true,
      status,
      checkedAt: normalizeIso(attributes?.last_checked_at),
    };
  } catch {
    return { ok: false, reason: "provider_unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}

function snapshotFromBetterStackResult({
  check,
  result,
  now,
}: {
  check: ObservabilityUptimeCheckDefinition;
  result: BetterStackMonitorResult;
  now: Date;
}): ObservabilityUptimeCheckSnapshot {
  if (!result.ok) {
    return {
      id: check.id,
      label: check.label,
      path: check.path,
      state: "unknown",
      checkedAt: null,
      detail:
        result.reason === "missing_config"
          ? "Better Stack monitor is not configured for this check."
          : "Better Stack check history could not be read.",
    };
  }

  if (!result.checkedAt) {
    return {
      id: check.id,
      label: check.label,
      path: check.path,
      state: "unknown",
      checkedAt: null,
      detail: "Better Stack has not reported a check time for this monitor.",
    };
  }

  if (isStaleCheck({ checkedAt: result.checkedAt, now, check })) {
    return {
      id: check.id,
      label: check.label,
      path: check.path,
      state: "unknown",
      checkedAt: result.checkedAt,
      detail: "Better Stack check history is stale; do not treat this as healthy.",
    };
  }

  if (result.status === "up") {
    return {
      id: check.id,
      label: check.label,
      path: check.path,
      state: "ready",
      checkedAt: result.checkedAt,
      detail: "Better Stack reports this check is passing.",
    };
  }

  if (result.status === "down") {
    return {
      id: check.id,
      label: check.label,
      path: check.path,
      state: "action_needed",
      checkedAt: result.checkedAt,
      detail: "Better Stack reports this check is failing.",
    };
  }

  if (result.status === "validating") {
    return {
      id: check.id,
      label: check.label,
      path: check.path,
      state: "degraded",
      checkedAt: result.checkedAt,
      detail: "Better Stack is validating recovery after a failed check.",
    };
  }

  return {
    id: check.id,
    label: check.label,
    path: check.path,
    state: "unknown",
    checkedAt: result.checkedAt,
    detail: `Better Stack monitor is ${result.status}; external reachability is not confirmed.`,
  };
}

function isStaleCheck({
  checkedAt,
  now,
  check,
}: {
  checkedAt: string;
  now: Date;
  check: ObservabilityUptimeCheckDefinition;
}): boolean {
  const checkedAtMs = Date.parse(checkedAt);
  if (!Number.isFinite(checkedAtMs)) return true;
  const maxAgeMs = Math.max(check.cadenceSeconds * 3 * 1_000, 10 * 60_000);
  return now.getTime() - checkedAtMs > maxAgeMs;
}

function normalizeBetterStackStatus(
  value: unknown,
): BetterStackMonitorStatus | null {
  if (typeof value !== "string") return null;
  if (
    value === "paused" ||
    value === "pending" ||
    value === "maintenance" ||
    value === "up" ||
    value === "validating" ||
    value === "down"
  ) {
    return value;
  }
  return null;
}

function normalizeIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function readToken(value: unknown): string | null {
  return typeof value === "string" && value.trim().length >= 16
    ? value.trim()
    : null;
}

function readMonitorId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(trimmed) ? trimmed : null;
}
