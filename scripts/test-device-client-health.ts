/* eslint-disable no-console */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { NextRequest } from "next/server";

const require = createRequire(import.meta.url);
const serverOnlyPath = require.resolve("server-only");
require.cache[serverOnlyPath] = {
  id: serverOnlyPath,
  filename: serverOnlyPath,
  loaded: true,
  exports: {},
  children: [],
  paths: [],
} as unknown as NodeJS.Module;

type ClientHealthLib = typeof import("@/lib/device-client-health");
type ClientHealthRoute =
  typeof import("@/app/api/device-session/client-health/route");

function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/device-session/client-health", {
    method: "POST",
    headers: {
      origin: "http://localhost",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function main() {
  process.env.DEVICE_CLIENT_HEALTH_RATE_LIMIT_SESSION_MAX = "2";
  process.env.DEVICE_CLIENT_HEALTH_RATE_LIMIT_IP_MAX = "100";

  const [clientHealth, route]: [ClientHealthLib, ClientHealthRoute] =
    await Promise.all([
      import("@/lib/device-client-health"),
      import("@/app/api/device-session/client-health/route"),
    ]);

  clientHealth.__resetDeviceClientHealthForTests();

  const valid = clientHealth.validateDeviceClientHealthPayload({
    event: "checkout_completed",
    sequence: 1,
    durationBucket: "10-30s",
    checkoutOutcome: "completed",
  });
  assert.equal(valid.ok, true, "valid checkout summary should parse");

  const rawErrorLeak = clientHealth.validateDeviceClientHealthPayload({
    event: "uncaught_error",
    sequence: 2,
    errorBucket: "uncaught_error",
    message: "raw message must not be accepted",
  });
  assert.equal(
    rawErrorLeak.ok,
    false,
    "client-health payload must reject unknown/raw fields",
  );

  const missingBucket = clientHealth.validateDeviceClientHealthPayload({
    event: "unhandled_rejection",
    sequence: 3,
  });
  assert.equal(
    missingBucket.ok,
    false,
    "error events should require a coarse bucket",
  );

  clientHealth.recordDeviceClientHealthEvent({
    payload: { event: "app_loaded", sequence: 1 },
    outletId: "outlet-1",
    deviceId: "device-1",
    deviceName: "KIOSK 01",
    asOf: "2026-05-19T18:00:00.000Z",
  });
  clientHealth.recordDeviceClientHealthEvent({
    payload: { event: "menu_failed", sequence: 2 },
    outletId: "outlet-1",
    deviceId: "device-1",
    deviceName: "KIOSK 01",
    asOf: "2026-05-19T18:01:00.000Z",
  });
  clientHealth.recordDeviceClientHealthEvent({
    payload: {
      event: "checkout_completed",
      sequence: 3,
      durationBucket: "30s+",
      checkoutOutcome: "completed",
    },
    outletId: "outlet-1",
    deviceId: "device-1",
    deviceName: "KIOSK 01",
    asOf: "2026-05-19T18:02:00.000Z",
  });

  const summary = clientHealth.getLocalDeviceClientHealthSummary({
    now: new Date("2026-05-19T18:03:00.000Z"),
    outletId: "outlet-1",
  });
  assert.equal(summary.totalCount, 3, "summary should include recent outlet events");
  assert.equal(summary.menuFailedCount, 1, "menu failure should be counted");
  assert.equal(summary.checkoutSlowCount, 1, "slow checkout bucket should be counted");
  assert.equal(summary.latestDeviceName, "KIOSK 01", "safe device label retained");

  const otherOutlet = clientHealth.getLocalDeviceClientHealthSummary({
    now: new Date("2026-05-19T18:03:00.000Z"),
    outletId: "outlet-2",
  });
  assert.equal(otherOutlet.totalCount, 0, "outlet filter should isolate events");

  clientHealth.__resetDeviceClientHealthForTests();
  const firstRateLimit = clientHealth.checkDeviceClientHealthRateLimit({
    req: request({ event: "heartbeat", sequence: 1 }),
    sessionId: "session-1",
    nowMs: 1_000,
  });
  const secondRateLimit = clientHealth.checkDeviceClientHealthRateLimit({
    req: request({ event: "heartbeat", sequence: 2 }),
    sessionId: "session-1",
    nowMs: 1_001,
  });
  const exhaustedRateLimit = clientHealth.checkDeviceClientHealthRateLimit({
    req: request({ event: "heartbeat", sequence: 3 }),
    sessionId: "session-1",
    nowMs: 1_002,
  });
  assert.equal(firstRateLimit.ok, true, "first event should pass rate limit");
  assert.equal(secondRateLimit.ok, true, "second event should pass rate limit");
  assert.equal(
    exhaustedRateLimit.ok,
    false,
    "third event should exhaust the configured per-session rate limit",
  );
  assert(
    exhaustedRateLimit.retryAfterSeconds > 0,
    "rate-limited response should include a retry-after hint",
  );

  const badOrigin = await route.POST(
    request(
      { event: "heartbeat", sequence: 1 },
      { origin: "https://evil.example" },
    ),
  );
  assert.equal(badOrigin.status, 403, "cross-origin POST should be rejected");
  assert.equal(
    badOrigin.headers.get("cache-control"),
    "no-store",
    "cross-origin rejection should be explicitly no-store",
  );

  const res = await route.POST(request({ event: "heartbeat", sequence: 1 }));
  assert.equal(res.status, 401, "route should reject missing device session");
  console.log("Device client-health tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
