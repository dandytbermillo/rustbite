/* eslint-disable no-console */
import assert from "node:assert/strict";
import {
  __configureStructuredLogsForTests,
  __resetStructuredLogsForTests,
  logRequestCompleted,
} from "@/lib/observability/structured-logs";
import { captureException, __resetForTests } from "@/lib/observability/server";
import {
  __resetLocalServerIssuesForTests,
  getLocalCriticalRouteTimingSummary,
  getLocalServerIssueSummary,
  recordHttpServerIssue,
} from "@/lib/observability/status-events";

const now = new Date("2026-05-19T22:30:00.000Z");

function reset() {
  __resetForTests();
  __resetStructuredLogsForTests();
  __resetLocalServerIssuesForTests();
  __configureStructuredLogsForTests({
    now: () => now.toISOString(),
    requestSampleRate: 1,
    enabled: false,
  });
}

function main() {
  reset();

  logRequestCompleted({
    method: "GET",
    url: "http://localhost/api/orders/order_123?token=raw-secret",
    status: 500,
    durationMs: 12,
    context: {
      surface: "api",
      requestId: "req_status_1",
      outletId: "outlet-1",
      deviceId: "device-1",
      routePattern: "/api/orders/[id]",
    },
  });

  let summary = getLocalServerIssueSummary({ now, outletId: "outlet-1" });
  assert.equal(summary.totalCount, 1, "5xx route should create one issue.");
  assert.equal(summary.groups[0]?.routePattern, "/api/orders/[id]");
  assert.equal(summary.groups[0]?.surface, "api");
  assert.equal(summary.groups[0]?.latestStatus, 500);
  assert.equal(summary.groups[0]?.latestRequestId, "req_status_1");

  const serialized = JSON.stringify(summary);
  assert(!serialized.includes("raw-secret"), "query secrets must not survive.");
  assert(!serialized.includes("order_123?"), "raw URLs must not survive.");

  captureException(new Error("password=hunter2 card=4242424242424242"), {
    surface: "api",
    requestId: "req_status_1",
    outletId: "outlet-1",
    routePattern: "/api/orders/[id]",
  });
  summary = getLocalServerIssueSummary({ now, outletId: "outlet-1" });
  assert.equal(
    summary.totalCount,
    1,
    "same request id should dedupe captured exception + 5xx response.",
  );
  assert(
    !JSON.stringify(summary).includes("hunter2"),
    "raw exception messages must not appear in the status summary.",
  );
  assert(
    !JSON.stringify(summary).includes("424242"),
    "payment-like values must not appear in the status summary.",
  );

  recordHttpServerIssue({
    method: "GET",
    routePattern: "/api/payments/sessions",
    status: 503,
    context: {
      surface: "api",
      requestId: "req_status_2",
      outletId: "outlet-2",
    },
    asOf: now.toISOString(),
  });
  assert.equal(
    getLocalServerIssueSummary({ now, outletId: "outlet-1" }).totalCount,
    1,
    "outlet-specific issues should not leak into another outlet.",
  );
  assert.equal(
    getLocalServerIssueSummary({ now, outletId: "outlet-2" }).totalCount,
    1,
    "matching outlet issue should be visible.",
  );

  recordHttpServerIssue({
    method: "GET",
    routePattern: "/api/menu?access_token=raw-secret",
    status: 500,
    context: {
      surface: "kiosk",
      requestId: "req_status_3",
      outletId: "outlet-1",
    },
    asOf: now.toISOString(),
  });
  summary = getLocalServerIssueSummary({ now, outletId: "outlet-1" });
  assert(
    summary.groups.some((group) => group.routePattern === "/[unknown]"),
    "unsafe route patterns should collapse to /[unknown].",
  );

  reset();
  for (let index = 0; index < 3; index += 1) {
    logRequestCompleted({
      method: "GET",
      url: "http://localhost/api/menu?token=raw-secret",
      status: 200,
      durationMs: 250,
      context: {
        surface: "kiosk",
        requestId: `req_menu_fast_${index}`,
        outletId: "outlet-1",
        routePattern: "/api/menu",
      },
    });
  }
  for (let index = 0; index < 5; index += 1) {
    logRequestCompleted({
      method: "POST",
      url: "http://localhost/api/orders",
      status: 201,
      durationMs: index < 2 ? 3_500 : 900,
      context: {
        surface: "kiosk",
        requestId: `req_checkout_${index}`,
        outletId: "outlet-1",
        routePattern: "/api/orders",
      },
    });
  }

  let routeSummary = getLocalCriticalRouteTimingSummary({
    now,
    outletId: "outlet-1",
  });
  const menuGroup = routeSummary.groups.find(
    (group) => group.routeId === "menu_load",
  );
  const checkoutGroup = routeSummary.groups.find(
    (group) => group.routeId === "checkout_create",
  );
  assert.equal(menuGroup?.sampleCount, 3);
  assert.equal(menuGroup?.slowCount, 0);
  assert.equal(checkoutGroup?.sampleCount, 5);
  assert.equal(checkoutGroup?.slowCount, 2);
  assert.equal(checkoutGroup?.slowRatio, 0.4);
  assert.equal(checkoutGroup?.latestRequestId, "req_checkout_4");
  assert(
    !JSON.stringify(routeSummary).includes("raw-secret"),
    "slow-route summary must not retain raw query strings.",
  );

  logRequestCompleted({
    method: "POST",
    url: "http://localhost/api/payments/sessions",
    status: 201,
    durationMs: 6_000,
    context: {
      surface: "kiosk",
      requestId: "req_payment_other_outlet",
      outletId: "outlet-2",
      routePattern: "/api/payments/sessions",
    },
  });
  assert.equal(
    getLocalCriticalRouteTimingSummary({ now, outletId: "outlet-1" })
      .totalSamples,
    8,
    "outlet-specific slow-route timings should not leak into another outlet.",
  );
  assert.equal(
    getLocalCriticalRouteTimingSummary({ now, outletId: "outlet-2" })
      .totalSamples,
    1,
    "matching outlet route timing should be visible.",
  );

  recordHttpServerIssue({
    method: "GET",
    routePattern: "/api/orders",
    status: 500,
    context: {
      surface: "api",
      requestId: "req_server_issue_after_slow_flood",
      outletId: "outlet-1",
    },
    asOf: now.toISOString(),
  });
  for (let index = 0; index < 1_020; index += 1) {
    logRequestCompleted({
      method: "GET",
      url: "http://localhost/api/menu",
      status: 200,
      durationMs: 100,
      context: {
        surface: "kiosk",
        requestId: `req_menu_flood_${index}`,
        outletId: "outlet-1",
        routePattern: "/api/menu",
      },
    });
  }
  assert.equal(
    getLocalServerIssueSummary({ now, outletId: "outlet-1" }).totalCount,
    1,
    "slow-route timing volume must not evict recent server-error issues.",
  );
  routeSummary = getLocalCriticalRouteTimingSummary({ now, outletId: "outlet-1" });
  assert(
    routeSummary.totalSamples <= 1_000,
    "critical-route timing buffer should remain bounded separately.",
  );

  console.log("OK: observability status-event tests passed");
}

main();
