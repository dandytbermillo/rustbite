import type { AdminWorkspaceDashboardSummary } from "@/lib/admin/workspace/dashboard-summary";
import type { AdminWorkspaceDevicesSummary } from "@/lib/admin/workspace/devices-summary";
import type { LocalDeviceClientHealthSummary } from "@/lib/device-client-health-shared";
import { DEFAULT_SITE_TIMEZONE } from "@/lib/outlets";
import type {
  LocalCriticalRouteTimingGroup,
  LocalCriticalRouteTimingSummary,
  LocalServerIssueSummary,
} from "@/lib/observability/status-events";
import type { ObservabilityUptimeCheckSnapshot } from "@/lib/observability/uptime-checks";

export type WorkspaceSystemStatusState =
  | "ready"
  | "unknown"
  | "degraded"
  | "action_needed";

export type WorkspaceSystemStatusSignalId =
  | "app"
  | "database"
  | "external-monitor"
  | "devices"
  | "kiosk-client"
  | "orders"
  | "payments"
  | "performance"
  | "errors";

export type WorkspaceSystemStatusSignal = {
  id: WorkspaceSystemStatusSignalId;
  label: string;
  state: WorkspaceSystemStatusState;
  detail: string;
  nextAction: string | null;
  href: string | null;
  lastCheckedAt: string | null;
};

export type WorkspaceSystemStatusSummary = {
  generatedAt: string;
  outletId: string;
  outletName: string;
  overall: {
    state: WorkspaceSystemStatusState;
    title: string;
    detail: string;
    nextAction: string | null;
  };
  signals: WorkspaceSystemStatusSignal[];
  uptimeChecks: ObservabilityUptimeCheckSnapshot[];
  serverIssues: LocalServerIssueSummary | null;
  routePerformance: LocalCriticalRouteTimingSummary | null;
  businessHealth: WorkspaceBusinessHealthSummary | null;
  kioskClientHealth: LocalDeviceClientHealthSummary | null;
  noExternalPushAlerts: true;
  permissions: {
    canViewOperatorDetail: boolean;
  };
  operatorDetail: {
    runbookHref: string;
    sourceNotes: string[];
  } | null;
};

export type WorkspaceBusinessHealthSummary =
  | {
      source: "database";
      windowMinutes: number;
      generatedAt: string;
      orderCount: number;
      successfulOrderCount: number;
      paymentAttemptCount: number;
      successfulPaymentCount: number;
      failedPaymentCount: number;
      pendingPaymentCount: number;
      oldestPendingPaymentAgeMinutes: number | null;
      latestOrderAt: string | null;
      latestPaymentAt: string | null;
    }
  | {
      source: "unavailable";
      windowMinutes: number;
      generatedAt: string;
      reason: "query_failed" | "permission_hidden";
    };

const STATE_RANK: Record<WorkspaceSystemStatusState, number> = {
  ready: 0,
  unknown: 1,
  degraded: 2,
  action_needed: 3,
};
const PILOT_BUSINESS_START_HOUR = 7;
const PILOT_BUSINESS_END_HOUR = 22;
const BUSINESS_HEALTH_MIN_PAYMENT_ATTEMPTS = 10;
const PAYMENT_FAILURE_DEGRADED_COUNT = 2;
const PAYMENT_FAILURE_ACTION_COUNT = 4;
const PAYMENT_FAILURE_DEGRADED_RATIO = 0.25;
const PAYMENT_FAILURE_ACTION_RATIO = 0.5;
const PAYMENT_PENDING_DEGRADED_MINUTES = 10;
const PAYMENT_PENDING_ACTION_MINUTES = 20;
const KIOSK_CLIENT_ERROR_DEGRADED_COUNT = 1;
const KIOSK_CLIENT_ERROR_ACTION_COUNT = 3;
const KIOSK_CHECKOUT_SLOW_DEGRADED_COUNT = 2;
const KIOSK_CHECKOUT_SLOW_ACTION_COUNT = 4;

type WorkspaceFleetDevice = NonNullable<
  AdminWorkspaceDevicesSummary["deviceFleet"]
>["devices"][number];

type DeviceFleetThresholds = {
  businessHours: boolean;
  activeDevices: WorkspaceFleetDevice[];
  activeKiosks: WorkspaceFleetDevice[];
  onlineKiosks: WorkspaceFleetDevice[];
  staleKiosks: WorkspaceFleetDevice[];
  unexpectedOfflineKiosks: WorkspaceFleetDevice[];
};

function strongestState(
  states: WorkspaceSystemStatusState[],
): WorkspaceSystemStatusState {
  return states.reduce<WorkspaceSystemStatusState>(
    (best, state) => (STATE_RANK[state] > STATE_RANK[best] ? state : best),
    "ready",
  );
}

function countLateOrders(
  buckets: AdminWorkspaceDashboardSummary["operationBuckets"],
): number {
  if (!buckets) return 0;
  return Object.entries(buckets).reduce((sum, [key, bucket]) => {
    if (key === "completedToday") return sum;
    return sum + bucket.lateCount;
  }, 0);
}

function buildDatabaseSignal({
  readinessOk,
  generatedAt,
}: {
  readinessOk: boolean;
  generatedAt: string;
}): WorkspaceSystemStatusSignal {
  if (!readinessOk) {
    return {
      id: "database",
      label: "Database readiness",
      state: "action_needed",
      detail: "Readiness failed or timed out.",
      nextAction: "Check database availability before taking new kiosk orders.",
      href: null,
      lastCheckedAt: generatedAt,
    };
  }

  return {
    id: "database",
    label: "Database readiness",
    state: "ready",
    detail: "Readiness probe passed.",
    nextAction: null,
    href: null,
    lastCheckedAt: generatedAt,
  };
}

function buildExternalMonitorSignal({
  uptimeChecks,
}: {
  uptimeChecks: ObservabilityUptimeCheckSnapshot[];
}): WorkspaceSystemStatusSignal {
  const state = strongestState(uptimeChecks.map((check) => check.state));
  const checkedAtValues = uptimeChecks
    .map((check) => check.checkedAt)
    .filter((value): value is string => Boolean(value))
    .sort();
  const lastCheckedAt = checkedAtValues.at(-1) ?? null;

  if (state === "ready") {
    return {
      id: "external-monitor",
      label: "External monitor",
      state,
      detail: "External uptime checks are passing.",
      nextAction: null,
      href: null,
      lastCheckedAt,
    };
  }

  if (state === "action_needed" || state === "degraded") {
    return {
      id: "external-monitor",
      label: "External monitor",
      state,
      detail: "One or more external uptime checks are not passing.",
      nextAction: "Review Better Stack check history.",
      href: null,
      lastCheckedAt,
    };
  }

  return {
    id: "external-monitor",
    label: "External monitor",
    state: "unknown",
    detail: "External uptime history is unavailable or inconclusive.",
    nextAction: "Review Better Stack configuration and check freshness.",
    href: null,
    lastCheckedAt,
  };
}

function buildDeviceSignal({
  dashboardSummary,
  devicesSummary,
}: {
  dashboardSummary: AdminWorkspaceDashboardSummary;
  devicesSummary: AdminWorkspaceDevicesSummary | null;
}): WorkspaceSystemStatusSignal {
  const deviceHealth = getDeviceHealthForStatus({
    dashboardSummary,
    devicesSummary,
  });
  if (!deviceHealth) {
    return {
      id: "devices",
      label: "Devices",
      state: "unknown",
      detail: "Device health is hidden for this role.",
      nextAction: null,
      href: null,
      lastCheckedAt: dashboardSummary.generatedAt,
    };
  }

  const fleetThresholds = analyzeDeviceFleetForStatus({
    devicesSummary,
    generatedAt: devicesSummary?.generatedAt ?? dashboardSummary.generatedAt,
  });
  const fleetSignal = fleetThresholds
    ? buildDeviceFleetThresholdSignal({
        thresholds: fleetThresholds,
        generatedAt: devicesSummary?.generatedAt ?? dashboardSummary.generatedAt,
      })
    : null;
  if (fleetSignal) return fleetSignal;

  const activeDevices =
    deviceHealth.online + deviceHealth.idle + deviceHealth.offline;
  if (activeDevices === 0) {
    return {
      id: "devices",
      label: "Devices",
      state: "degraded",
      detail: "No active devices are reporting for this outlet.",
      nextAction: "Open Devices and confirm at least one active kiosk or station.",
      href: "/admin/workspace?modal=devices",
      lastCheckedAt: devicesSummary?.generatedAt ?? dashboardSummary.generatedAt,
    };
  }

  if (deviceHealth.offline >= activeDevices) {
    return {
      id: "devices",
      label: "Devices",
      state: "action_needed",
      detail: "All active devices are offline.",
      nextAction: "Open Devices and check kiosk/station connectivity.",
      href: "/admin/workspace?modal=devices",
      lastCheckedAt: devicesSummary?.generatedAt ?? dashboardSummary.generatedAt,
    };
  }

  if (deviceHealth.offline > 0) {
    return {
      id: "devices",
      label: "Devices",
      state: "degraded",
      detail: `${deviceHealth.offline} active device${
        deviceHealth.offline === 1 ? " is" : "s are"
      } offline.`,
      nextAction: "Open Devices to identify the offline device.",
      href: "/admin/workspace?modal=devices",
      lastCheckedAt: devicesSummary?.generatedAt ?? dashboardSummary.generatedAt,
    };
  }

  return {
    id: "devices",
    label: "Devices",
    state: "ready",
    detail: `${deviceHealth.online + deviceHealth.idle} active device${
      deviceHealth.online + deviceHealth.idle === 1 ? " is" : "s are"
    } reporting.`,
    nextAction: null,
    href: "/admin/workspace?modal=devices",
    lastCheckedAt: devicesSummary?.generatedAt ?? dashboardSummary.generatedAt,
  };
}

function buildDeviceFleetThresholdSignal({
  thresholds,
  generatedAt,
}: {
  thresholds: DeviceFleetThresholds;
  generatedAt: string;
}): WorkspaceSystemStatusSignal | null {
  const activeDevices = thresholds.activeDevices.length;
  if (activeDevices === 0) {
    return {
      id: "devices",
      label: "Devices",
      state: "degraded",
      detail: "No active devices are reporting for this outlet.",
      nextAction: "Open Devices and confirm at least one active kiosk or station.",
      href: "/admin/workspace?modal=devices",
      lastCheckedAt: generatedAt,
    };
  }

  const reportingDevices = thresholds.activeDevices.filter(
    (device) => device.state === "online" || device.state === "idle",
  ).length;
  if (reportingDevices === 0) {
    return {
      id: "devices",
      label: "Devices",
      state: thresholds.businessHours ? "action_needed" : "degraded",
      detail: thresholds.businessHours
        ? "All active devices are offline."
        : "All active devices are offline during quiet hours.",
      nextAction: thresholds.businessHours
        ? "Open Devices and check kiosk/station connectivity."
        : "Review Devices before opening.",
      href: "/admin/workspace?modal=devices",
      lastCheckedAt: generatedAt,
    };
  }

  if (thresholds.businessHours && thresholds.activeKiosks.length === 0) {
    return {
      id: "devices",
      label: "Devices",
      state: "degraded",
      detail: "No active kiosk devices are configured for this outlet.",
      nextAction: "Open Devices and add or enable a kiosk before relying on kiosk orders.",
      href: "/admin/workspace?modal=devices",
      lastCheckedAt: generatedAt,
    };
  }

  if (thresholds.activeKiosks.length > 0 && thresholds.onlineKiosks.length === 0) {
    return {
      id: "devices",
      label: "Devices",
      state: thresholds.businessHours ? "action_needed" : "unknown",
      detail: thresholds.businessHours
        ? "No kiosk is online during business hours."
        : "No kiosk is online during quiet hours.",
      nextAction: thresholds.businessHours
        ? "Open Devices and check kiosk browser or network connectivity."
        : "Review Devices before opening.",
      href: "/admin/workspace?modal=devices",
      lastCheckedAt: generatedAt,
    };
  }

  if (thresholds.unexpectedOfflineKiosks.length > 0) {
    return {
      id: "devices",
      label: "Devices",
      state: thresholds.businessHours ? "degraded" : "unknown",
      detail: `${formatDeviceSubject(
        thresholds.unexpectedOfflineKiosks,
        "kiosk",
      )} stopped heartbeating without a clean close.`,
      nextAction: "Open Devices to inspect the affected kiosk.",
      href: "/admin/workspace?modal=devices",
      lastCheckedAt: generatedAt,
    };
  }

  if (thresholds.staleKiosks.length > 0) {
    const verb = thresholds.staleKiosks.length === 1 ? "has" : "have";
    return {
      id: "devices",
      label: "Devices",
      state: thresholds.businessHours ? "degraded" : "unknown",
      detail: `${formatDeviceSubject(
        thresholds.staleKiosks,
        "kiosk",
      )} ${verb} a stale or hidden heartbeat.`,
      nextAction: "Open Devices and confirm the kiosk browser is awake.",
      href: "/admin/workspace?modal=devices",
      lastCheckedAt: generatedAt,
    };
  }

  return null;
}

function analyzeDeviceFleetForStatus({
  devicesSummary,
  generatedAt,
}: {
  devicesSummary: AdminWorkspaceDevicesSummary | null;
  generatedAt: string;
}): DeviceFleetThresholds | null {
  const devices = devicesSummary?.deviceFleet?.devices ?? null;
  if (!devices) return null;

  const activeDevices = devices.filter((device) => device.state !== "disabled");
  const activeKiosks = activeDevices.filter((device) => device.role === "kiosk");
  return {
    businessHours: isPilotBusinessHours(generatedAt),
    activeDevices,
    activeKiosks,
    onlineKiosks: activeKiosks.filter(
      (device) => device.presenceKind === "online",
    ),
    staleKiosks: activeKiosks.filter(
      (device) =>
        device.presenceKind === "idle" || device.presenceKind === "hidden",
    ),
    unexpectedOfflineKiosks: activeKiosks.filter(
      (device) => device.presenceKind === "unexpected_offline",
    ),
  };
}

function isPilotBusinessHours(value: string): boolean {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return true;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DEFAULT_SITE_TIMEZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  if (!Number.isInteger(hour)) return true;
  return hour >= PILOT_BUSINESS_START_HOUR && hour < PILOT_BUSINESS_END_HOUR;
}

function formatDeviceSubject(
  devices: WorkspaceFleetDevice[],
  fallbackLabel: string,
): string {
  if (devices.length === 1) return devices[0]?.name || `1 ${fallbackLabel}`;
  const names = devices
    .slice(0, 2)
    .map((device) => device.name)
    .filter(Boolean);
  const suffix = devices.length > names.length ? ` +${devices.length - names.length}` : "";
  return names.length > 0
    ? `${devices.length} ${fallbackLabel}s (${names.join(", ")}${suffix})`
    : `${devices.length} ${fallbackLabel}s`;
}

function getDeviceHealthForStatus({
  dashboardSummary,
  devicesSummary,
}: {
  dashboardSummary: AdminWorkspaceDashboardSummary;
  devicesSummary: AdminWorkspaceDevicesSummary | null;
}): AdminWorkspaceDashboardSummary["deviceHealth"] {
  return devicesSummary?.deviceHealth ?? dashboardSummary.deviceHealth ?? null;
}

function activeDeviceState({
  dashboardSummary,
  devicesSummary,
}: {
  dashboardSummary: AdminWorkspaceDashboardSummary;
  devicesSummary: AdminWorkspaceDevicesSummary | null;
}): { activeDevices: number; reportingDevices: number } | null {
  const deviceHealth = getDeviceHealthForStatus({
    dashboardSummary,
    devicesSummary,
  });
  if (!deviceHealth) return null;
  return {
    activeDevices: deviceHealth.online + deviceHealth.idle + deviceHealth.offline,
    reportingDevices: deviceHealth.online + deviceHealth.idle,
  };
}

function intakeUnavailableReason({
  dashboardSummary,
  devicesSummary,
}: {
  dashboardSummary: AdminWorkspaceDashboardSummary;
  devicesSummary: AdminWorkspaceDevicesSummary | null;
}): string | null {
  const fleetThresholds = analyzeDeviceFleetForStatus({
    devicesSummary,
    generatedAt: devicesSummary?.generatedAt ?? dashboardSummary.generatedAt,
  });
  if (
    fleetThresholds?.businessHours &&
    fleetThresholds.activeKiosks.length === 0
  ) {
    return "No active kiosk devices are configured during business hours, so kiosk order intake cannot be verified.";
  }
  if (
    fleetThresholds?.businessHours &&
    fleetThresholds.activeKiosks.length > 0 &&
    fleetThresholds.onlineKiosks.length === 0
  ) {
    return "No kiosk is online during business hours, so new kiosk order intake cannot be verified.";
  }

  const deviceState = activeDeviceState({ dashboardSummary, devicesSummary });
  if (!deviceState) return null;
  if (deviceState.activeDevices === 0) {
    return "No active devices are reporting for this outlet, so new order intake cannot be verified.";
  }
  if (deviceState.reportingDevices === 0) {
    return "All active devices are offline, so new order and payment intake cannot be verified.";
  }
  return null;
}

function buildOrderSignal({
  dashboardSummary,
  devicesSummary,
  businessHealth,
}: {
  dashboardSummary: AdminWorkspaceDashboardSummary;
  devicesSummary: AdminWorkspaceDevicesSummary | null;
  businessHealth: WorkspaceBusinessHealthSummary | null;
}): WorkspaceSystemStatusSignal {
  if (!dashboardSummary.operations) {
    return {
      id: "orders",
      label: "Orders",
      state: "unknown",
      detail: "Order operations are hidden for this role.",
      nextAction: null,
      href: null,
      lastCheckedAt: dashboardSummary.generatedAt,
    };
  }

  const activeOrders =
    dashboardSummary.operations.awaitingCounterPayment +
    dashboardSummary.operations.paid +
    dashboardSummary.operations.inKitchen +
    dashboardSummary.operations.ready;
  const lateOrders = countLateOrders(dashboardSummary.operationBuckets);
  const blockedByDevices = intakeUnavailableReason({
    dashboardSummary,
    devicesSummary,
  });

  if (lateOrders > 0) {
    return {
      id: "orders",
      label: "Orders",
      state: "degraded",
      detail: `${lateOrders} active order${
        lateOrders === 1 ? " is" : "s are"
      } past the service threshold.`,
      nextAction: "Open Orders and clear the late queue.",
      href: "/admin/workspace?widget=orders",
      lastCheckedAt: dashboardSummary.generatedAt,
    };
  }

  if (blockedByDevices) {
    return {
      id: "orders",
      label: "Orders",
      state: "unknown",
      detail: blockedByDevices,
      nextAction: "Open Devices before trusting order intake status.",
      href: "/admin/workspace?modal=devices",
      lastCheckedAt: devicesSummary?.generatedAt ?? dashboardSummary.generatedAt,
    };
  }

  if (businessHealth?.source === "unavailable") {
    return {
      id: "orders",
      label: "Orders",
      state: "unknown",
      detail: "Recent order-volume health could not be checked.",
      nextAction: "Review Orders and database status before trusting intake.",
      href: "/admin/workspace?widget=orders",
      lastCheckedAt: businessHealth.generatedAt,
    };
  }

  if (
    businessHealth?.source === "database" &&
    isPilotBusinessHours(businessHealth.generatedAt) &&
    businessHealth.orderCount === 0
  ) {
    return {
      id: "orders",
      label: "Orders",
      state: "unknown",
      detail: `No recent orders in the last ${businessHealth.windowMinutes} minutes; order volume needs verification.`,
      nextAction: "Confirm store demand and run a safe kiosk/menu checkout smoke.",
      href: "/admin/workspace?widget=orders",
      lastCheckedAt: businessHealth.latestOrderAt ?? businessHealth.generatedAt,
    };
  }

  return {
    id: "orders",
    label: "Orders",
    state: "ready",
    detail:
      activeOrders === 0
        ? "No active orders in the queue."
        : `${activeOrders} active order${activeOrders === 1 ? "" : "s"} in the queue.`,
    nextAction: null,
    href: "/admin/workspace?widget=orders",
    lastCheckedAt: dashboardSummary.generatedAt,
  };
}

function buildPaymentSignal({
  dashboardSummary,
  devicesSummary,
  businessHealth,
}: {
  dashboardSummary: AdminWorkspaceDashboardSummary;
  devicesSummary: AdminWorkspaceDevicesSummary | null;
  businessHealth: WorkspaceBusinessHealthSummary | null;
}): WorkspaceSystemStatusSignal {
  if (!dashboardSummary.operations) {
    return {
      id: "payments",
      label: "Payments",
      state: "unknown",
      detail: "Payment queue status is hidden for this role.",
      nextAction: null,
      href: null,
      lastCheckedAt: dashboardSummary.generatedAt,
    };
  }

  const waiting = dashboardSummary.operations.awaitingCounterPayment;
  const blockedByDevices = intakeUnavailableReason({
    dashboardSummary,
    devicesSummary,
  });
  if (blockedByDevices) {
    return {
      id: "payments",
      label: "Payments",
      state: "unknown",
      detail:
        waiting === 0
          ? blockedByDevices
          : `${blockedByDevices} ${waiting} counter payment${
              waiting === 1 ? " is" : "s are"
            } also waiting.`,
      nextAction:
        waiting === 0
          ? "Open Devices before trusting payment intake status."
          : "Open Devices, then review the payment queue in Orders.",
      href: "/admin/workspace?modal=devices",
      lastCheckedAt: devicesSummary?.generatedAt ?? dashboardSummary.generatedAt,
    };
  }

  if (businessHealth?.source === "unavailable") {
    return {
      id: "payments",
      label: "Payments",
      state: "unknown",
      detail: "Recent payment-success health could not be checked.",
      nextAction: "Review Orders and database status before trusting payment health.",
      href: "/admin/workspace?widget=orders&status=AWAITING_COUNTER_PAYMENT",
      lastCheckedAt: businessHealth.generatedAt,
    };
  }

  const paymentHealthSignal = businessHealth?.source === "database"
    ? buildPaymentBusinessHealthSignal({
        businessHealth,
        waiting,
      })
    : null;
  if (paymentHealthSignal) return paymentHealthSignal;

  return {
    id: "payments",
    label: "Payments",
    state: "ready",
    detail:
      waiting === 0
        ? "No counter payments waiting."
        : `${waiting} counter payment${waiting === 1 ? " is" : "s are"} waiting.`,
    nextAction: waiting === 0 ? null : "Review the payment queue in Orders.",
    href: "/admin/workspace?widget=orders&status=AWAITING_COUNTER_PAYMENT",
    lastCheckedAt: dashboardSummary.generatedAt,
  };
}

function buildPaymentBusinessHealthSignal({
  businessHealth,
  waiting,
}: {
  businessHealth: Extract<WorkspaceBusinessHealthSummary, { source: "database" }>;
  waiting: number;
}): WorkspaceSystemStatusSignal | null {
  const businessHours = isPilotBusinessHours(businessHealth.generatedAt);
  const failed = businessHealth.failedPaymentCount;
  const attempts = businessHealth.paymentAttemptCount;
  const failureRatio = attempts > 0 ? failed / attempts : 0;
  const hasEnoughSamples = attempts >= BUSINESS_HEALTH_MIN_PAYMENT_ATTEMPTS;
  const lastCheckedAt =
    businessHealth.latestPaymentAt ??
    businessHealth.latestOrderAt ??
    businessHealth.generatedAt;

  const failureState = hasEnoughSamples
    ? failed >= PAYMENT_FAILURE_ACTION_COUNT &&
      failureRatio >= PAYMENT_FAILURE_ACTION_RATIO
      ? "action_needed"
      : failed >= PAYMENT_FAILURE_DEGRADED_COUNT &&
          failureRatio >= PAYMENT_FAILURE_DEGRADED_RATIO
        ? "degraded"
        : null
    : failed >= PAYMENT_FAILURE_ACTION_COUNT
      ? "action_needed"
      : failed >= PAYMENT_FAILURE_DEGRADED_COUNT
        ? "degraded"
        : null;

  if (failureState) {
    return {
      id: "payments",
      label: "Payments",
      state: failureState,
      detail: `${failed} of ${attempts} recent payment attempt${
        attempts === 1 ? "" : "s"
      } failed in the last ${businessHealth.windowMinutes} minutes.`,
      nextAction:
        failureState === "action_needed"
          ? "Check payment provider status and recent failed orders now."
          : "Review recent failed payments before the issue repeats.",
      href: "/admin/workspace?widget=orders",
      lastCheckedAt,
    };
  }

  const pendingAge = businessHealth.oldestPendingPaymentAgeMinutes;
  if (
    pendingAge !== null &&
    pendingAge >= PAYMENT_PENDING_DEGRADED_MINUTES
  ) {
    const state: WorkspaceSystemStatusState =
      pendingAge >= PAYMENT_PENDING_ACTION_MINUTES
        ? "action_needed"
        : "degraded";
    return {
      id: "payments",
      label: "Payments",
      state,
      detail: `${businessHealth.pendingPaymentCount} payment attempt${
        businessHealth.pendingPaymentCount === 1 ? " is" : "s are"
      } still pending; oldest is ${pendingAge} minutes old.`,
      nextAction:
        state === "action_needed"
          ? "Check the payment terminal/provider flow now."
          : "Watch the pending payment and confirm it completes or fails cleanly.",
      href: "/admin/workspace?widget=orders",
      lastCheckedAt,
    };
  }

  if (businessHours && !hasEnoughSamples) {
    return {
      id: "payments",
      label: "Payments",
      state: "unknown",
      detail: `${attempts} recent payment attempt${
        attempts === 1 ? "" : "s"
      } in the last ${businessHealth.windowMinutes} minutes; not enough to judge payment success rate.`,
      nextAction:
        attempts === 0
          ? "Wait for real traffic or run a safe checkout payment smoke."
          : "Keep System Status open until more payment attempts are observed.",
      href: "/admin/workspace?widget=orders",
      lastCheckedAt,
    };
  }

  if (hasEnoughSamples) {
    return {
      id: "payments",
      label: "Payments",
      state: "ready",
      detail: `Payment success is within local thresholds over ${attempts} recent attempt${
        attempts === 1 ? "" : "s"
      }.`,
      nextAction:
        waiting === 0 ? null : "Review the payment queue in Orders.",
      href: "/admin/workspace?widget=orders&status=AWAITING_COUNTER_PAYMENT",
      lastCheckedAt,
    };
  }

  return null;
}

function buildKioskClientHealthSignal({
  generatedAt,
  kioskClientHealth,
}: {
  generatedAt: string;
  kioskClientHealth: LocalDeviceClientHealthSummary | null;
}): WorkspaceSystemStatusSignal {
  if (!kioskClientHealth) {
    return {
      id: "kiosk-client",
      label: "Kiosk browser",
      state: "unknown",
      detail: "Kiosk client-health events are not connected yet.",
      nextAction: "Use Devices and kiosk screen checks until client health is wired.",
      href: "/admin/workspace?modal=devices",
      lastCheckedAt: generatedAt,
    };
  }

  const latestAt = kioskClientHealth.latestAt ?? generatedAt;
  const deviceName = kioskClientHealth.latestDeviceName ?? "Kiosk";

  if (kioskClientHealth.totalCount === 0) {
    return {
      id: "kiosk-client",
      label: "Kiosk browser",
      state: "unknown",
      detail: `No kiosk client-health events in the last ${kioskClientHealth.windowMinutes} minutes.`,
      nextAction: "Open the kiosk and confirm the browser can load the menu.",
      href: "/admin/workspace?modal=devices",
      lastCheckedAt: latestAt,
    };
  }

  if (kioskClientHealth.menuFailedCount > 0) {
    return {
      id: "kiosk-client",
      label: "Kiosk browser",
      state: "action_needed",
      detail: `${deviceName} reported a menu load failure.`,
      nextAction: "Open the kiosk browser and reload the menu before taking orders.",
      href: "/admin/workspace?modal=devices",
      lastCheckedAt: latestAt,
    };
  }

  if (kioskClientHealth.errorCount >= KIOSK_CLIENT_ERROR_ACTION_COUNT) {
    return {
      id: "kiosk-client",
      label: "Kiosk browser",
      state: "action_needed",
      detail: `${kioskClientHealth.errorCount} kiosk browser error event${
        kioskClientHealth.errorCount === 1 ? "" : "s"
      } in the last ${kioskClientHealth.windowMinutes} minutes.`,
      nextAction: "Reload the kiosk and review recent browser-safe health events.",
      href: "/admin/workspace?modal=devices",
      lastCheckedAt: latestAt,
    };
  }

  if (kioskClientHealth.checkoutSlowCount >= KIOSK_CHECKOUT_SLOW_ACTION_COUNT) {
    return {
      id: "kiosk-client",
      label: "Kiosk browser",
      state: "action_needed",
      detail: `${kioskClientHealth.checkoutSlowCount} kiosk checkout flow${
        kioskClientHealth.checkoutSlowCount === 1 ? " was" : "s were"
      } slow in the last ${kioskClientHealth.windowMinutes} minutes.`,
      nextAction: "Check the kiosk browser and checkout route status now.",
      href: "/admin/workspace?widget=orders",
      lastCheckedAt: latestAt,
    };
  }

  if (kioskClientHealth.errorCount >= KIOSK_CLIENT_ERROR_DEGRADED_COUNT) {
    return {
      id: "kiosk-client",
      label: "Kiosk browser",
      state: "degraded",
      detail: `${deviceName} reported a kiosk browser error event.`,
      nextAction: "Watch the kiosk and reload it if the error repeats.",
      href: "/admin/workspace?modal=devices",
      lastCheckedAt: latestAt,
    };
  }

  if (kioskClientHealth.checkoutSlowCount >= KIOSK_CHECKOUT_SLOW_DEGRADED_COUNT) {
    return {
      id: "kiosk-client",
      label: "Kiosk browser",
      state: "degraded",
      detail: `${kioskClientHealth.checkoutSlowCount} kiosk checkout flow${
        kioskClientHealth.checkoutSlowCount === 1 ? " was" : "s were"
      } slow in the last ${kioskClientHealth.windowMinutes} minutes.`,
      nextAction: "Compare with Checkout speed and payment signals.",
      href: "/admin/workspace?widget=status",
      lastCheckedAt: latestAt,
    };
  }

  if (kioskClientHealth.menuLoadedCount === 0) {
    return {
      id: "kiosk-client",
      label: "Kiosk browser",
      state: "unknown",
      detail: "Kiosk browser heartbeat is present, but no menu-loaded event has been seen.",
      nextAction: "Open the kiosk and confirm the menu is visible.",
      href: "/admin/workspace?modal=devices",
      lastCheckedAt: latestAt,
    };
  }

  return {
    id: "kiosk-client",
    label: "Kiosk browser",
    state: "ready",
    detail: `${deviceName} reported kiosk app and menu health.`,
    nextAction: null,
    href: "/admin/workspace?modal=devices",
    lastCheckedAt: latestAt,
  };
}

function formatDurationThreshold(ms: number): string {
  if (ms >= 1_000 && ms % 1_000 === 0) return `${ms / 1_000}s`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${ms}ms`;
}

function routeGroupHasAction(group: LocalCriticalRouteTimingGroup): boolean {
  if (group.sampleCount < group.minSamples) return false;
  return (
    group.slowCount >= group.actionSlowCount &&
    group.slowRatio >= group.degradedSlowRatio
  );
}

function routeGroupHasDegraded(group: LocalCriticalRouteTimingGroup): boolean {
  if (group.sampleCount < group.minSamples) return false;
  return (
    group.slowCount >= group.degradedSlowCount &&
    group.slowRatio >= group.degradedSlowRatio
  );
}

function sortSlowRouteGroups(
  groups: LocalCriticalRouteTimingGroup[],
): LocalCriticalRouteTimingGroup[] {
  return [...groups].sort(
    (a, b) =>
      Number(routeGroupHasAction(b)) - Number(routeGroupHasAction(a)) ||
      Number(routeGroupHasDegraded(b)) - Number(routeGroupHasDegraded(a)) ||
      b.slowCount - a.slowCount ||
      b.slowRatio - a.slowRatio ||
      b.sampleCount - a.sampleCount ||
      a.label.localeCompare(b.label),
  );
}

function buildPerformanceSignal({
  generatedAt,
  routePerformance,
}: {
  generatedAt: string;
  routePerformance: LocalCriticalRouteTimingSummary | null;
}): WorkspaceSystemStatusSignal {
  if (!routePerformance) {
    return {
      id: "performance",
      label: "Checkout speed",
      state: "unknown",
      detail: "Slow checkout/menu/payment summary is not connected yet.",
      nextAction: "Use structured request logs until the local speed summary is wired.",
      href: null,
      lastCheckedAt: generatedAt,
    };
  }

  const groupsWithSamples = routePerformance.groups.filter(
    (group) => group.sampleCount > 0,
  );
  if (groupsWithSamples.length === 0) {
    return {
      id: "performance",
      label: "Checkout speed",
      state: "unknown",
      detail: `No recent menu, checkout, or payment traffic in the last ${routePerformance.windowMinutes} minutes.`,
      nextAction: "Wait for real traffic or run a safe checkout/menu smoke.",
      href: null,
      lastCheckedAt: routePerformance.latestAt ?? generatedAt,
    };
  }

  const allGroupsHaveEnoughSamples = routePerformance.groups.every(
    (group) => group.sampleCount >= group.minSamples,
  );
  const slowGroups = sortSlowRouteGroups(
    groupsWithSamples.filter((group) => group.slowCount > 0),
  );
  const actionGroup = slowGroups.find(routeGroupHasAction);
  const degradedGroup = slowGroups.find(routeGroupHasDegraded);
  const primary = actionGroup ?? degradedGroup;

  if (primary) {
    const state: WorkspaceSystemStatusState = actionGroup
      ? "action_needed"
      : "degraded";
    return {
      id: "performance",
      label: "Checkout speed",
      state,
      detail: `${primary.label} is slow: ${primary.slowCount} of ${
        primary.sampleCount
      } request${primary.sampleCount === 1 ? "" : "s"} took ${formatDurationThreshold(
        primary.thresholdMs,
      )} or longer.`,
      nextAction:
        state === "action_needed"
          ? "Check the affected checkout path and platform logs now."
          : "Watch the affected route and check logs if it repeats.",
      href: null,
      lastCheckedAt: primary.latestAt ?? routePerformance.latestAt ?? generatedAt,
    };
  }

  if (!allGroupsHaveEnoughSamples || slowGroups.length > 0) {
    return {
      id: "performance",
      label: "Checkout speed",
      state: "unknown",
      detail:
        slowGroups.length > 0
          ? "A slow critical request was seen, but there are not enough samples to call the route degraded."
          : "Waiting for enough recent samples across menu, checkout, and payment routes.",
      nextAction: "Keep System Status open or run a safe checkout/menu smoke.",
      href: null,
      lastCheckedAt: routePerformance.latestAt ?? generatedAt,
    };
  }

  return {
    id: "performance",
    label: "Checkout speed",
    state: "ready",
    detail: `Menu, checkout, and payment routes are within local speed thresholds in the last ${routePerformance.windowMinutes} minutes.`,
    nextAction: null,
    href: null,
    lastCheckedAt: routePerformance.latestAt ?? generatedAt,
  };
}

function buildErrorSignal({
  generatedAt,
  serverIssues,
}: {
  generatedAt: string;
  serverIssues: LocalServerIssueSummary | null;
}): WorkspaceSystemStatusSignal {
  if (serverIssues) {
    if (serverIssues.totalCount === 0) {
      return {
        id: "errors",
        label: "Application errors",
        state: "ready",
        detail: `No server errors in the last ${serverIssues.windowMinutes} minutes.`,
        nextAction: null,
        href: null,
        lastCheckedAt: generatedAt,
      };
    }

    const state: WorkspaceSystemStatusState =
      serverIssues.totalCount >= 3 ? "action_needed" : "degraded";
    return {
      id: "errors",
      label: "Application errors",
      state,
      detail: `${serverIssues.totalCount} server error${
        serverIssues.totalCount === 1 ? "" : "s"
      } in the last ${serverIssues.windowMinutes} minutes.`,
      nextAction:
        state === "action_needed"
          ? "Review recent server errors by request id."
          : "Review the affected route before the issue repeats.",
      href: null,
      lastCheckedAt: serverIssues.latestAt ?? generatedAt,
    };
  }

  return {
    id: "errors",
    label: "Application errors",
    state: "unknown",
    detail: "Sanitized error counts are not connected to a local event store yet.",
    nextAction: "Use captured server logs until the structured error summary is wired.",
    href: null,
    lastCheckedAt: generatedAt,
  };
}

function buildOverall(
  signals: WorkspaceSystemStatusSignal[],
): WorkspaceSystemStatusSummary["overall"] {
  const state = strongestState(signals.map((signal) => signal.state));
  if (state === "action_needed") {
    return {
      state,
      title: "Action needed",
      detail: "At least one system signal needs attention now.",
      nextAction:
        signals.find((signal) => signal.state === "action_needed")
          ?.nextAction ?? null,
    };
  }
  if (state === "degraded") {
    return {
      state,
      title: "Degraded",
      detail: "Core service is reachable, but one or more signals need review.",
      nextAction:
        signals.find((signal) => signal.state === "degraded")?.nextAction ??
        null,
    };
  }
  if (state === "unknown") {
    return {
      state,
      title: "Needs verification",
      detail: "Local checks are available, but at least one monitor source has no status yet.",
      nextAction:
        signals.find((signal) => signal.state === "unknown")?.nextAction ??
        null,
    };
  }
  return {
    state,
    title: "Ready",
    detail: "All available local and monitor signals are passing.",
    nextAction: null,
  };
}

export function deriveWorkspaceSystemStatusSummary({
  generatedAt,
  outletId,
  outletName,
  readinessOk,
  dashboardSummary,
  devicesSummary,
  uptimeChecks,
  serverIssues = null,
  routePerformance = null,
  businessHealth = null,
  kioskClientHealth = null,
  canViewOperatorDetail,
}: {
  generatedAt: string;
  outletId: string;
  outletName: string;
  readinessOk: boolean;
  dashboardSummary: AdminWorkspaceDashboardSummary;
  devicesSummary: AdminWorkspaceDevicesSummary | null;
  uptimeChecks: ObservabilityUptimeCheckSnapshot[];
  serverIssues?: LocalServerIssueSummary | null;
  routePerformance?: LocalCriticalRouteTimingSummary | null;
  businessHealth?: WorkspaceBusinessHealthSummary | null;
  kioskClientHealth?: LocalDeviceClientHealthSummary | null;
  canViewOperatorDetail: boolean;
}): WorkspaceSystemStatusSummary {
  const signals: WorkspaceSystemStatusSignal[] = [
    {
      id: "app",
      label: "Workspace app",
      state: "ready",
      detail: "Workspace rendered and status data loaded.",
      nextAction: null,
      href: "/admin/workspace?widget=status",
      lastCheckedAt: generatedAt,
    },
    buildDatabaseSignal({ readinessOk, generatedAt }),
    buildExternalMonitorSignal({ uptimeChecks }),
    buildDeviceSignal({ dashboardSummary, devicesSummary }),
    buildKioskClientHealthSignal({ generatedAt, kioskClientHealth }),
    buildOrderSignal({ dashboardSummary, devicesSummary, businessHealth }),
    buildPaymentSignal({ dashboardSummary, devicesSummary, businessHealth }),
    buildPerformanceSignal({ generatedAt, routePerformance }),
    buildErrorSignal({ generatedAt, serverIssues }),
  ];

  return {
    generatedAt,
    outletId,
    outletName,
    overall: buildOverall(signals),
    signals,
    uptimeChecks,
    serverIssues,
    routePerformance,
    businessHealth,
    kioskClientHealth,
    noExternalPushAlerts: true,
    permissions: {
      canViewOperatorDetail,
    },
    operatorDetail: canViewOperatorDetail
      ? {
          runbookHref: "/admin/workspace?widget=status",
          sourceNotes: [
            "Health/readiness values come from local endpoints.",
            "Checkout speed uses a bounded local summary of critical menu, order, and payment route timings.",
            "Order volume and payment success use recent local database counts with minimum-sample safeguards.",
            "Kiosk browser health uses first-party registered-device events without raw errors, stack traces, user agents, cart contents, customer text, or payment data.",
            "External status is Better Stack check history when configured; no Slack/email/paging/SMS/webhook push alerts are configured in this phase.",
            "Workspace status never includes secrets, raw logs, stack traces, raw headers, raw IPs, or raw user agents.",
          ],
        }
      : null,
  };
}
