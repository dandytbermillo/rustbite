import "server-only";

import {
  adminActorHasPermission,
  type AdminPermissionContext,
} from "@/lib/admin-sessions";
import {
  buildAdminWorkspaceDashboardSummary,
  type AdminWorkspaceDashboardSummary,
} from "@/lib/admin/workspace/dashboard-summary";
import {
  buildAdminWorkspaceDevicesSummary,
  type AdminWorkspaceDevicesSummary,
} from "@/lib/admin/workspace/devices-summary";
import { prisma } from "@/lib/db";
import { checkReadiness } from "@/lib/observability/health";
import { syntheticOutletRelationExclude } from "@/lib/observability/synthetic-fixtures";
import {
  getLocalCriticalRouteTimingSummary,
  getLocalServerIssueSummary,
} from "@/lib/observability/status-events";
import { buildWorkspaceUptimeSnapshots } from "@/lib/observability/uptime-checks";
import {
  isSuccessfulPaymentStatus,
  isTerminalPendingStatus,
} from "@/lib/payments";
import type { PaymentTransactionStatus } from "@/lib/types";
import {
  deriveWorkspaceSystemStatusSummary,
  type WorkspaceBusinessHealthSummary,
  type WorkspaceSystemStatusSummary,
} from "@/lib/admin/workspace/system-status-model";
import { getLocalDeviceClientHealthSummary } from "@/lib/device-client-health";

type CookieReader = {
  get(name: string): { value: string } | undefined;
};

const BUSINESS_HEALTH_WINDOW_MINUTES = 30;
const SUCCESSFUL_ORDER_STATUSES = new Set([
  "PAID",
  "IN_KITCHEN",
  "READY",
  "COMPLETED",
]);
const PENDING_PAYMENT_STATUSES = ["CREATED", "PROCESSING"] as const;

export async function buildAdminWorkspaceSystemStatusSummary({
  context,
  cookies,
  dashboardSummary,
  devicesSummary,
  now = new Date(),
}: {
  context: AdminPermissionContext;
  cookies: CookieReader;
  dashboardSummary?: AdminWorkspaceDashboardSummary;
  devicesSummary?: AdminWorkspaceDevicesSummary | null;
  now?: Date;
}): Promise<WorkspaceSystemStatusSummary> {
  const [canReadDevices, canViewOperatorDetail, readiness, uptimeChecks] =
    await Promise.all([
      adminActorHasPermission(
        context.actor,
        "admin.devices.read",
        context.outletId,
      ),
      adminActorHasPermission(
        context.actor,
        "admin.observability.investigationMode.manage",
        context.outletId,
      ),
      checkReadiness(),
      buildWorkspaceUptimeSnapshots({ now }),
    ]);

  const resolvedDashboardSummary =
    dashboardSummary ??
    (await buildAdminWorkspaceDashboardSummary({
      context,
      searchParams: new URLSearchParams({ range: "today" }),
      cookies,
    }));
  const resolvedDevicesSummary =
    devicesSummary !== undefined
      ? devicesSummary
      : canReadDevices
        ? await buildAdminWorkspaceDevicesSummary({ context, now })
        : null;
  const businessHealth = resolvedDashboardSummary.permissions.canReadOrders
    ? await buildWorkspaceBusinessHealthSummary({
        outletId: context.outletId,
        now,
      })
    : buildUnavailableBusinessHealth({
        now,
        reason: "permission_hidden",
      });

  return deriveWorkspaceSystemStatusSummary({
    generatedAt: now.toISOString(),
    outletId: context.outletId,
    outletName: context.activeOutlet.outletName,
    readinessOk: readiness.ok,
    dashboardSummary: resolvedDashboardSummary,
    devicesSummary: resolvedDevicesSummary,
    uptimeChecks,
    serverIssues: getLocalServerIssueSummary({
      now,
      outletId: context.outletId,
    }),
    routePerformance: getLocalCriticalRouteTimingSummary({
      now,
      outletId: context.outletId,
    }),
    businessHealth,
    kioskClientHealth: getLocalDeviceClientHealthSummary({
      now,
      outletId: context.outletId,
    }),
    canViewOperatorDetail,
  });
}

function buildUnavailableBusinessHealth({
  now,
  reason,
}: {
  now: Date;
  reason: "query_failed" | "permission_hidden";
}): WorkspaceBusinessHealthSummary {
  return {
    source: "unavailable",
    windowMinutes: BUSINESS_HEALTH_WINDOW_MINUTES,
    generatedAt: now.toISOString(),
    reason,
  };
}

function latestIso(values: Array<Date | null | undefined>): string | null {
  const latest = values
    .filter((value): value is Date => Boolean(value))
    .sort((a, b) => b.getTime() - a.getTime())[0];
  return latest?.toISOString() ?? null;
}

function ageMinutes(now: Date, value: Date): number {
  return Math.max(0, Math.floor((now.getTime() - value.getTime()) / 60_000));
}

async function buildWorkspaceBusinessHealthSummary({
  outletId,
  now,
}: {
  outletId: string;
  now: Date;
}): Promise<WorkspaceBusinessHealthSummary> {
  const since = new Date(now.getTime() - BUSINESS_HEALTH_WINDOW_MINUTES * 60_000);

  try {
    const [orders, paymentTransactions] = await Promise.all([
      prisma.order.findMany({
        where: {
          outletId,
          createdAt: { gte: since },
          ...syntheticOutletRelationExclude(),
        },
        select: {
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.paymentTransaction.findMany({
        where: {
          outletId,
          OR: [
            { createdAt: { gte: since } },
            { status: { in: [...PENDING_PAYMENT_STATUSES] } },
          ],
          ...syntheticOutletRelationExclude(),
        },
        select: {
          status: true,
          createdAt: true,
          updatedAt: true,
          completedAt: true,
        },
      }),
    ]);

    const paymentAttempts = paymentTransactions.filter(
      (transaction) => transaction.status !== "PENDING_COUNTER_PAYMENT",
    );
    const pendingPayments = paymentAttempts.filter((transaction) =>
      isTerminalPendingStatus(transaction.status as PaymentTransactionStatus),
    );

    return {
      source: "database",
      windowMinutes: BUSINESS_HEALTH_WINDOW_MINUTES,
      generatedAt: now.toISOString(),
      orderCount: orders.length,
      successfulOrderCount: orders.filter((order) =>
        SUCCESSFUL_ORDER_STATUSES.has(order.status),
      ).length,
      paymentAttemptCount: paymentAttempts.length,
      successfulPaymentCount: paymentAttempts.filter((transaction) =>
        isSuccessfulPaymentStatus(
          transaction.status as PaymentTransactionStatus,
        ),
      ).length,
      failedPaymentCount: paymentAttempts.filter(
        (transaction) =>
          transaction.status === "FAILED" || transaction.status === "CANCELLED",
      ).length,
      pendingPaymentCount: pendingPayments.length,
      oldestPendingPaymentAgeMinutes:
        pendingPayments.length === 0
          ? null
          : Math.max(
              ...pendingPayments.map((transaction) =>
                ageMinutes(now, transaction.createdAt),
              ),
            ),
      latestOrderAt: latestIso(orders.map((order) => order.createdAt)),
      latestPaymentAt: latestIso(
        paymentTransactions.map(
          (transaction) =>
            transaction.completedAt ??
            transaction.updatedAt ??
            transaction.createdAt,
        ),
      ),
    };
  } catch {
    return buildUnavailableBusinessHealth({
      now,
      reason: "query_failed",
    });
  }
}
