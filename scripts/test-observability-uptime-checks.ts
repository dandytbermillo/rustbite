/* eslint-disable no-console */
import assert from "node:assert/strict";
import {
  buildWorkspaceUptimeSnapshots,
  OBSERVABILITY_UPTIME_CHECKS,
  type ObservabilityUptimeCheckId,
} from "@/lib/observability/uptime-checks";

const now = new Date("2026-05-19T23:30:00.000Z");

const env = {
  BETTER_STACK_UPTIME_API_TOKEN: "test_token_1234567890",
  BETTER_STACK_UPTIME_APP_ROOT_MONITOR_ID: "app_root",
  BETTER_STACK_UPTIME_HEALTH_MONITOR_ID: "health",
  BETTER_STACK_UPTIME_READINESS_MONITOR_ID: "readiness",
  BETTER_STACK_UPTIME_KIOSK_REACHABILITY_MONITOR_ID: "kiosk",
};

type MonitorFixture = {
  status: string;
  lastCheckedAt?: string | null;
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function monitorResponse(fixture: MonitorFixture): Response {
  return response({
    data: {
      id: "monitor",
      type: "monitor",
      attributes: {
        status: fixture.status,
        last_checked_at:
          fixture.lastCheckedAt === undefined
            ? "2026-05-19T23:29:30.000Z"
            : fixture.lastCheckedAt,
      },
    },
  });
}

function idFromUrl(url: string): string {
  return decodeURIComponent(url.split("/").at(-1) ?? "");
}

function fakeFetch(fixtures: Record<string, MonitorFixture>): typeof fetch {
  return async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const id = idFromUrl(url);
    const fixture = fixtures[id];
    return fixture ? monitorResponse(fixture) : response({ errors: "missing" }, 404);
  };
}

async function main() {
  assert.deepEqual(
    OBSERVABILITY_UPTIME_CHECKS.map((check) => check.id),
    ["app-root", "health", "readiness", "kiosk-reachability"],
    "uptime definitions should keep the expected Workspace check ids",
  );
  assert(
    OBSERVABILITY_UPTIME_CHECKS.every(
      (check) => check.pushAlerts === "disabled",
    ),
    "Better Stack check definitions must not enable push alerts",
  );

  let called = false;
  const missingConfig = await buildWorkspaceUptimeSnapshots({
    env: {},
    now,
    fetcher: (async () => {
      called = true;
      return response({});
    }) as typeof fetch,
  });
  assert.equal(called, false, "missing token should not call Better Stack");
  assert(
    missingConfig.every((snapshot) => snapshot.state === "unknown"),
    "missing Better Stack config must stay unknown, not green",
  );

  const allUp = await buildWorkspaceUptimeSnapshots({
    env,
    now,
    fetcher: fakeFetch({
      app_root: { status: "up" },
      health: { status: "up" },
      readiness: { status: "up" },
      kiosk: { status: "up" },
    }),
  });
  assert(
    allUp.every((snapshot) => snapshot.state === "ready"),
    "recent Better Stack up statuses should map to ready",
  );
  assert.equal(allUp[0]?.checkedAt, "2026-05-19T23:29:30.000Z");

  const mixed = await buildWorkspaceUptimeSnapshots({
    env,
    now,
    fetcher: fakeFetch({
      app_root: { status: "up" },
      health: { status: "validating" },
      readiness: { status: "down" },
      kiosk: { status: "maintenance" },
    }),
  });
  const stateById = Object.fromEntries(
    mixed.map((snapshot) => [snapshot.id, snapshot.state]),
  ) as Record<ObservabilityUptimeCheckId, string>;
  assert.equal(stateById["app-root"], "ready");
  assert.equal(stateById.health, "degraded");
  assert.equal(stateById.readiness, "action_needed");
  assert.equal(stateById["kiosk-reachability"], "unknown");

  const stale = await buildWorkspaceUptimeSnapshots({
    env,
    now,
    fetcher: fakeFetch({
      app_root: {
        status: "up",
        lastCheckedAt: "2026-05-19T22:00:00.000Z",
      },
      health: { status: "up" },
      readiness: { status: "up" },
      kiosk: { status: "up" },
    }),
  });
  assert.equal(
    stale.find((snapshot) => snapshot.id === "app-root")?.state,
    "unknown",
    "stale external check history should not be marked ready",
  );

  const providerFailure = await buildWorkspaceUptimeSnapshots({
    env,
    now,
    fetcher: (async () => response({ errors: "nope" }, 503)) as typeof fetch,
  });
  assert(
    providerFailure.every((snapshot) => snapshot.state === "unknown"),
    "provider/API failures should fail unknown",
  );
  assert(
    !JSON.stringify(providerFailure).includes(env.BETTER_STACK_UPTIME_API_TOKEN),
    "Workspace snapshots must never expose the Better Stack token",
  );
  assert(
    !JSON.stringify(providerFailure).includes("app_root"),
    "Workspace snapshots must not expose provider monitor ids",
  );

  console.log("OK: observability uptime-check tests passed");
}

main();
