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
import { checkReadiness } from "@/lib/observability/health";
import {
  getLocalCriticalRouteTimingSummary,
  getLocalServerIssueSummary,
} from "@/lib/observability/status-events";
import { buildWorkspaceUptimeSnapshots } from "@/lib/observability/uptime-checks";
import {
  deriveWorkspaceSystemStatusSummary,
  type WorkspaceSystemStatusSummary,
} from "@/lib/admin/workspace/system-status-model";

type CookieReader = {
  get(name: string): { value: string } | undefined;
};

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
    canViewOperatorDetail,
  });
}
