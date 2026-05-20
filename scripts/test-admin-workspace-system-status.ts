/* eslint-disable no-console */
import assert from "node:assert/strict";
import type {
  DashboardDeviceFleet,
  DashboardDeviceFleetDevice,
} from "@/lib/admin/dashboard/summary";
import type { AdminWorkspaceDashboardSummary } from "@/lib/admin/workspace/dashboard-summary";
import type { AdminWorkspaceDevicesSummary } from "@/lib/admin/workspace/devices-summary";
import { deriveWorkspaceSystemStatusSummary } from "@/lib/admin/workspace/system-status-model";
import type {
  LocalCriticalRouteTimingSummary,
  LocalServerIssueSummary,
} from "@/lib/observability/status-events";
import {
  OBSERVABILITY_UPTIME_CHECKS,
  definitionOnlyUptimeSnapshots,
  type ObservabilityUptimeCheckId,
  type ObservabilityUptimeCheckSnapshot,
} from "@/lib/observability/uptime-checks";

const generatedAt = "2026-05-19T18:00:00.000Z";

function dashboardSummary(
  overrides: Partial<AdminWorkspaceDashboardSummary> = {},
): AdminWorkspaceDashboardSummary {
  return {
    generatedAt,
    outletId: "outlet-1",
    outletName: "Downtown",
    permissions: {
      canReadRevenue: true,
      canReadOrders: true,
      canReadDevices: true,
      canReadMenuAttention: true,
    },
    kpis: {
      netSales: 125,
      orderCount: 4,
      averageTicket: 31.25,
      itemsPerOrder: 2,
      cashDue: 0,
    },
    operations: {
      awaitingCounterPayment: 0,
      paid: 1,
      inKitchen: 0,
      ready: 0,
    },
    operationBuckets: {
      awaitingCounterPayment: {
        count: 0,
        lateCount: 0,
        oldestAgeMinutes: null,
        lateAfterMinutes: 5,
        previewOrders: [],
      },
      paid: {
        count: 1,
        lateCount: 0,
        oldestAgeMinutes: 2,
        lateAfterMinutes: 5,
        previewOrders: [],
      },
      inKitchen: {
        count: 0,
        lateCount: 0,
        oldestAgeMinutes: null,
        lateAfterMinutes: 10,
        previewOrders: [],
      },
      ready: {
        count: 0,
        lateCount: 0,
        oldestAgeMinutes: null,
        lateAfterMinutes: 3,
        previewOrders: [],
      },
      completedToday: {
        count: 3,
        lateCount: 99,
        oldestAgeMinutes: 40,
        lateAfterMinutes: null,
        previewOrders: [],
      },
    },
    deviceHealth: {
      online: 1,
      idle: 1,
      offline: 0,
      disabled: 0,
    },
    deviceHealthHref: "/admin/devices",
    attention: {
      totalCount: 0,
      groups: [],
    },
    ...overrides,
  };
}

function devicesSummary(
  overrides: Partial<AdminWorkspaceDevicesSummary> = {},
): AdminWorkspaceDevicesSummary {
  return {
    generatedAt,
    outletId: "outlet-1",
    outletName: "Downtown",
    permissions: {
      canReadDevices: true,
      canManageDevices: true,
    },
    deviceHealth: {
      online: 1,
      idle: 1,
      offline: 0,
      disabled: 0,
    },
    deviceHealthHref: "/admin/devices",
    deviceFleet: null,
    devices: [],
    ...overrides,
  };
}

function fleetDevice(
  overrides: Partial<DashboardDeviceFleetDevice> = {},
): DashboardDeviceFleetDevice {
  return {
    id: "device-1",
    name: "KIOSK 01",
    role: "kiosk",
    roleLabel: "Kiosk",
    state: "online",
    presenceKind: "online",
    presenceLabel: "Online",
    presenceReason: null,
    presenceLastLifecycleAt: generatedAt,
    presenceLastHeartbeatAt: generatedAt,
    lastSeenAt: generatedAt,
    lastSeenLabel: "Last seen <1m ago",
    physicalLocation: null,
    assignmentLabel: "Downtown",
    activeSessionCount: 1,
    screen: "Kiosk ordering",
    session: "1 active session",
    activeOperator: null,
    note: null,
    ...overrides,
  };
}

function deviceFleet(
  devices: DashboardDeviceFleetDevice[],
): DashboardDeviceFleet {
  return {
    counts: {
      online: devices.filter((device) => device.state === "online").length,
      idle: devices.filter((device) => device.state === "idle").length,
      offline: devices.filter((device) => device.state === "offline").length,
      disabled: devices.filter((device) => device.state === "disabled").length,
    },
    devices,
    manageHref: "/admin/devices",
  };
}

function devicesSummaryWithFleet(
  devices: DashboardDeviceFleetDevice[],
  overrides: Partial<AdminWorkspaceDevicesSummary> = {},
): AdminWorkspaceDevicesSummary {
  const fleet = deviceFleet(devices);
  return devicesSummary({
    deviceHealth: fleet.counts,
    deviceFleet: fleet,
    ...overrides,
  });
}

function serverIssues(
  overrides: Partial<LocalServerIssueSummary> = {},
): LocalServerIssueSummary {
  return {
    source: "local-memory",
    windowMinutes: 15,
    totalCount: 0,
    latestAt: null,
    groups: [],
    ...overrides,
  };
}

function routePerformance(
  overrides: Partial<LocalCriticalRouteTimingSummary> = {},
): LocalCriticalRouteTimingSummary {
  return {
    source: "local-memory",
    windowMinutes: 15,
    totalSamples: 0,
    totalSlowCount: 0,
    latestAt: null,
    groups: [
      {
        routeId: "menu_load",
        label: "Menu loading",
        routePattern: "/api/menu",
        method: "GET",
        thresholdMs: 2000,
        minSamples: 3,
        degradedSlowCount: 2,
        degradedSlowRatio: 0.34,
        actionSlowCount: 5,
        actionSlowRatio: 0.5,
        sampleCount: 0,
        slowCount: 0,
        slowRatio: 0,
        latestAt: null,
        latestDurationMs: null,
        latestStatus: null,
        latestRequestId: null,
      },
      {
        routeId: "checkout_create",
        label: "Checkout order creation",
        routePattern: "/api/orders",
        method: "POST",
        thresholdMs: 3000,
        minSamples: 3,
        degradedSlowCount: 2,
        degradedSlowRatio: 0.4,
        actionSlowCount: 4,
        actionSlowRatio: 0.6,
        sampleCount: 0,
        slowCount: 0,
        slowRatio: 0,
        latestAt: null,
        latestDurationMs: null,
        latestStatus: null,
        latestRequestId: null,
      },
      {
        routeId: "payment_session_create",
        label: "Payment session creation",
        routePattern: "/api/payments/sessions",
        method: "POST",
        thresholdMs: 5000,
        minSamples: 3,
        degradedSlowCount: 2,
        degradedSlowRatio: 0.4,
        actionSlowCount: 3,
        actionSlowRatio: 0.6,
        sampleCount: 0,
        slowCount: 0,
        slowRatio: 0,
        latestAt: null,
        latestDurationMs: null,
        latestStatus: null,
        latestRequestId: null,
      },
      {
        routeId: "payment_session_poll",
        label: "Payment polling",
        routePattern: "/api/payments/sessions/[id]",
        method: "GET",
        thresholdMs: 5000,
        minSamples: 3,
        degradedSlowCount: 2,
        degradedSlowRatio: 0.4,
        actionSlowCount: 3,
        actionSlowRatio: 0.6,
        sampleCount: 0,
        slowCount: 0,
        slowRatio: 0,
        latestAt: null,
        latestDurationMs: null,
        latestStatus: null,
        latestRequestId: null,
      },
    ],
    ...overrides,
  };
}

function derive(opts: {
  readinessOk?: boolean;
  dashboard?: AdminWorkspaceDashboardSummary;
  devices?: AdminWorkspaceDevicesSummary | null;
  uptimeChecks?: ObservabilityUptimeCheckSnapshot[];
  serverIssues?: LocalServerIssueSummary | null;
  routePerformance?: LocalCriticalRouteTimingSummary | null;
  canViewOperatorDetail?: boolean;
}) {
  return deriveWorkspaceSystemStatusSummary({
    generatedAt,
    outletId: "outlet-1",
    outletName: "Downtown",
    readinessOk: opts.readinessOk ?? true,
    dashboardSummary: opts.dashboard ?? dashboardSummary(),
    devicesSummary:
      opts.devices === undefined ? devicesSummary() : opts.devices,
    uptimeChecks: opts.uptimeChecks ?? definitionOnlyUptimeSnapshots(),
    serverIssues:
      opts.serverIssues === undefined ? null : opts.serverIssues,
    routePerformance:
      opts.routePerformance === undefined ? null : opts.routePerformance,
    canViewOperatorDetail: opts.canViewOperatorDetail ?? false,
  });
}

function uptimeSnapshots(
  states: Partial<
    Record<
      ObservabilityUptimeCheckId,
      ObservabilityUptimeCheckSnapshot["state"]
    >
  > = {},
): ObservabilityUptimeCheckSnapshot[] {
  return OBSERVABILITY_UPTIME_CHECKS.map((check) => {
    const state = states[check.id] ?? "ready";
    return {
      id: check.id,
      label: check.label,
      path: check.path,
      state,
      checkedAt: generatedAt,
      detail: `${check.label} ${state} test snapshot.`,
    };
  });
}

function main() {
  assert.deepEqual(
    OBSERVABILITY_UPTIME_CHECKS.map((check) => check.path),
    ["/", "/api/health", "/api/health/ready", "/kiosk"],
    "uptime definitions should cover root, health, readiness, and kiosk reachability",
  );
  assert(
    OBSERVABILITY_UPTIME_CHECKS.every(
      (check) => check.pushAlerts === "disabled",
    ),
    "uptime definitions must not configure Slack/email/paging/SMS/webhook push alerts",
  );

  const localReady = derive({});
  assert.equal(
    localReady.overall.state,
    "unknown",
    "definition-only external monitor history should not pretend to be fully ready",
  );
  assert.equal(localReady.noExternalPushAlerts, true);
  const connectedExternalReady = derive({ uptimeChecks: uptimeSnapshots() });
  assert.equal(
    connectedExternalReady.signals.find(
      (signal) => signal.id === "external-monitor",
    )?.state,
    "ready",
    "connected passing external uptime snapshots should make the external monitor signal ready",
  );
  const externalDegraded = derive({
    uptimeChecks: uptimeSnapshots({ health: "degraded" }),
  });
  assert.equal(
    externalDegraded.signals.find(
      (signal) => signal.id === "external-monitor",
    )?.state,
    "degraded",
    "validating or degraded external uptime snapshots should degrade the external monitor signal",
  );
  const externalDown = derive({
    uptimeChecks: uptimeSnapshots({ readiness: "action_needed" }),
  });
  assert.equal(
    externalDown.signals.find((signal) => signal.id === "external-monitor")
      ?.state,
    "action_needed",
    "failing external uptime snapshots should make the external monitor signal action_needed",
  );
  const externalUnknown = derive({
    uptimeChecks: uptimeSnapshots({ "app-root": "unknown" }),
  });
  assert.equal(
    externalUnknown.signals.find((signal) => signal.id === "external-monitor")
      ?.state,
    "unknown",
    "unknown external uptime snapshots should not be treated as healthy",
  );
  assert.equal(
    localReady.signals.find((signal) => signal.id === "errors")?.state,
    "unknown",
    "missing sanitized error-store reader should be explicit, not hidden",
  );
  const noRecentErrors = derive({ serverIssues: serverIssues() });
  assert.equal(
    noRecentErrors.signals.find((signal) => signal.id === "errors")?.state,
    "ready",
    "connected server-issue source with no recent errors should be ready",
  );
  const noRouteSamples = derive({ routePerformance: routePerformance() });
  assert.equal(
    noRouteSamples.signals.find((signal) => signal.id === "performance")
      ?.state,
    "unknown",
    "no recent critical-route samples should not be shown as green",
  );
  const enoughFastRouteSamples = routePerformance({
    totalSamples: 12,
    latestAt: generatedAt,
    groups: routePerformance().groups.map((group) => ({
      ...group,
      sampleCount: group.minSamples,
      latestAt: generatedAt,
      latestDurationMs: Math.max(1, group.thresholdMs - 100),
      latestStatus: 200,
      latestRequestId: `${group.routeId}_fast`,
    })),
  });
  const fastRoutes = derive({ routePerformance: enoughFastRouteSamples });
  assert.equal(
    fastRoutes.signals.find((signal) => signal.id === "performance")?.state,
    "ready",
    "critical routes should be ready only after each configured route has enough fast samples",
  );
  const partialFastRoutes = derive({
    routePerformance: routePerformance({
      totalSamples: 3,
      latestAt: generatedAt,
      groups: routePerformance().groups.map((group) =>
        group.routeId === "menu_load"
          ? {
              ...group,
              sampleCount: group.minSamples,
              latestAt: generatedAt,
              latestDurationMs: 500,
              latestStatus: 200,
              latestRequestId: "menu_fast",
            }
          : group,
      ),
    }),
  });
  assert.equal(
    partialFastRoutes.signals.find((signal) => signal.id === "performance")
      ?.state,
    "unknown",
    "fast menu samples alone should not claim checkout and payment speed are healthy",
  );
  const degradedRouteSpeed = derive({
    routePerformance: routePerformance({
      totalSamples: 5,
      totalSlowCount: 2,
      latestAt: generatedAt,
      groups: routePerformance().groups.map((group) =>
        group.routeId === "checkout_create"
          ? {
              ...group,
              sampleCount: 5,
              slowCount: 2,
              slowRatio: 0.4,
              latestAt: generatedAt,
              latestDurationMs: 3200,
              latestStatus: 201,
              latestRequestId: "checkout_slow",
            }
          : group,
      ),
    }),
  });
  assert.equal(
    degradedRouteSpeed.signals.find((signal) => signal.id === "performance")
      ?.state,
    "degraded",
    "repeated slow checkout route samples should degrade the speed signal",
  );
  const actionRouteSpeed = derive({
    routePerformance: routePerformance({
      totalSamples: 4,
      totalSlowCount: 3,
      latestAt: generatedAt,
      groups: routePerformance().groups.map((group) =>
        group.routeId === "payment_session_poll"
          ? {
              ...group,
              sampleCount: 4,
              slowCount: 3,
              slowRatio: 0.75,
              latestAt: generatedAt,
              latestDurationMs: 6500,
              latestStatus: 200,
              latestRequestId: "payment_poll_slow",
            }
          : group,
      ),
    }),
  });
  assert.equal(
    actionRouteSpeed.signals.find((signal) => signal.id === "performance")
      ?.state,
    "action_needed",
    "payment route speed should become action_needed after enough repeated slow samples",
  );

  const dbDown = derive({ readinessOk: false });
  assert.equal(dbDown.overall.state, "action_needed");
  assert.equal(
    dbDown.signals.find((signal) => signal.id === "database")?.state,
    "action_needed",
  );

  const allDevicesOffline = derive({
    dashboard: dashboardSummary({
      deviceHealth: {
        online: 0,
        idle: 0,
        offline: 7,
        disabled: 0,
      },
    }),
    devices: devicesSummary({
      deviceHealth: {
        online: 0,
        idle: 0,
        offline: 2,
        disabled: 0,
      },
    }),
  });
  assert.equal(
    allDevicesOffline.signals.find((signal) => signal.id === "devices")
      ?.state,
    "action_needed",
  );
  assert.equal(
    allDevicesOffline.signals.find((signal) => signal.id === "devices")
      ?.detail,
    "All active devices are offline.",
    "all-offline wording should not depend on stale dashboard device counts",
  );
  assert.equal(
    allDevicesOffline.signals.find((signal) => signal.id === "orders")
      ?.state,
    "unknown",
    "orders should not be marked ready when every active device is offline",
  );
  assert.equal(
    allDevicesOffline.signals.find((signal) => signal.id === "payments")
      ?.state,
    "unknown",
    "payments should not be marked ready when every active device is offline",
  );
  assert.match(
    allDevicesOffline.signals.find((signal) => signal.id === "orders")
      ?.detail ?? "",
    /cannot be verified/,
    "orders should explain that offline devices block intake verification",
  );

  const devicesSourceWins = derive({
    dashboard: dashboardSummary({
      deviceHealth: {
        online: 0,
        idle: 0,
        offline: 7,
        disabled: 0,
      },
    }),
    devices: devicesSummary({
      deviceHealth: {
        online: 1,
        idle: 0,
        offline: 8,
        disabled: 0,
      },
    }),
  });
  assert.equal(
    devicesSourceWins.signals.find((signal) => signal.id === "devices")
      ?.detail,
    "8 active devices are offline.",
    "System Status should prefer the refreshed Devices summary over the dashboard fallback.",
  );

  const noOnlineKioskDuringBusiness = derive({
    dashboard: dashboardSummary({
      deviceHealth: {
        online: 1,
        idle: 1,
        offline: 0,
        disabled: 0,
      },
    }),
    devices: devicesSummaryWithFleet([
      fleetDevice({
        name: "KIOSK 01",
        state: "idle",
        presenceKind: "idle",
        presenceLabel: "Idle",
      }),
      fleetDevice({
        id: "counter-1",
        name: "COUNTER 01",
        role: "counter",
        roleLabel: "Counter POS",
        state: "online",
        presenceKind: "online",
        presenceLabel: "Online",
      }),
    ]),
  });
  assert.equal(
    noOnlineKioskDuringBusiness.signals.find(
      (signal) => signal.id === "devices",
    )?.state,
    "action_needed",
    "no online kiosk during business hours should be action_needed even when another station is online",
  );
  assert.equal(
    noOnlineKioskDuringBusiness.signals.find(
      (signal) => signal.id === "orders",
    )?.state,
    "unknown",
    "orders should not be marked ready when no kiosk is online during business hours",
  );
  assert.match(
    noOnlineKioskDuringBusiness.signals.find(
      (signal) => signal.id === "devices",
    )?.detail ?? "",
    /No kiosk is online/,
  );

  const staleKioskWithAnotherOnline = derive({
    dashboard: dashboardSummary({
      deviceHealth: {
        online: 1,
        idle: 1,
        offline: 0,
        disabled: 0,
      },
    }),
    devices: devicesSummaryWithFleet([
      fleetDevice({ name: "KIOSK 01" }),
      fleetDevice({
        id: "kiosk-2",
        name: "KIOSK 02",
        state: "idle",
        presenceKind: "idle",
        presenceLabel: "Idle",
      }),
    ]),
  });
  assert.equal(
    staleKioskWithAnotherOnline.signals.find(
      (signal) => signal.id === "devices",
    )?.state,
    "degraded",
    "a stale kiosk heartbeat should degrade Devices when another kiosk is online",
  );
  assert.match(
    staleKioskWithAnotherOnline.signals.find(
      (signal) => signal.id === "devices",
    )?.detail ?? "",
    /KIOSK 02/,
    "per-device context should identify the affected kiosk",
  );

  const unexpectedOfflineKiosk = derive({
    dashboard: dashboardSummary({
      deviceHealth: {
        online: 1,
        idle: 0,
        offline: 1,
        disabled: 0,
      },
    }),
    devices: devicesSummaryWithFleet([
      fleetDevice({ name: "KIOSK 01" }),
      fleetDevice({
        id: "kiosk-2",
        name: "KIOSK 02",
        state: "offline",
        presenceKind: "unexpected_offline",
        presenceLabel: "Unexpected offline",
        presenceReason: "Device heartbeat expired without a clean close.",
      }),
    ]),
  });
  assert.equal(
    unexpectedOfflineKiosk.signals.find((signal) => signal.id === "devices")
      ?.state,
    "degraded",
    "an unexpected-offline kiosk should degrade Devices when another kiosk is online",
  );
  assert.match(
    unexpectedOfflineKiosk.signals.find((signal) => signal.id === "devices")
      ?.detail ?? "",
    /KIOSK 02.*stopped heartbeating/,
    "unexpected-offline kiosk detail should identify the affected kiosk",
  );

  const quietHoursNoOnlineKiosk = derive({
    dashboard: dashboardSummary({
      generatedAt: "2026-05-19T06:00:00.000Z",
      deviceHealth: {
        online: 1,
        idle: 1,
        offline: 0,
        disabled: 0,
      },
    }),
    devices: devicesSummaryWithFleet(
      [
        fleetDevice({
          name: "KIOSK 01",
          state: "idle",
          presenceKind: "idle",
          presenceLabel: "Idle",
        }),
        fleetDevice({
          id: "counter-1",
          name: "COUNTER 01",
          role: "counter",
          roleLabel: "Counter POS",
          state: "online",
          presenceKind: "online",
          presenceLabel: "Online",
        }),
      ],
      { generatedAt: "2026-05-19T06:00:00.000Z" },
    ),
  });
  assert.equal(
    quietHoursNoOnlineKiosk.signals.find((signal) => signal.id === "devices")
      ?.state,
    "unknown",
    "quiet-hours no-online-kiosk should be lowered rather than action_needed",
  );

  const lateOrders = derive({
    dashboard: dashboardSummary({
      operationBuckets: {
        ...dashboardSummary().operationBuckets!,
        inKitchen: {
          count: 1,
          lateCount: 1,
          oldestAgeMinutes: 15,
          lateAfterMinutes: 10,
          previewOrders: [],
        },
      },
    }),
  });
  assert.equal(
    lateOrders.signals.find((signal) => signal.id === "orders")?.state,
    "degraded",
    "late active orders should degrade the owner-visible status",
  );
  assert.equal(
    lateOrders.overall.state,
    "degraded",
    "a degraded signal should make the overall Workspace status degraded when no higher-priority action is needed",
  );

  const repeatedServerErrors = derive({
    serverIssues: serverIssues({
      totalCount: 3,
      latestAt: generatedAt,
      groups: [
        {
          routePattern: "/api/orders",
          surface: "api",
          count: 3,
          latestAt: generatedAt,
          latestStatus: 500,
          latestErrorName: null,
          latestRequestId: "req_status_123",
        },
      ],
    }),
  });
  assert.equal(
    repeatedServerErrors.signals.find((signal) => signal.id === "errors")
      ?.state,
    "action_needed",
    "repeated recent server errors should be owner-visible action_needed",
  );

  assert.equal(derive({ canViewOperatorDetail: false }).operatorDetail, null);
  assert(
    derive({ canViewOperatorDetail: true }).operatorDetail,
    "authorized operators should receive sanitized source detail",
  );

  console.log("Admin workspace system status tests passed.");
}

main();
