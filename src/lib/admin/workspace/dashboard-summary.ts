import "server-only";

import {
  buildAdminDashboardSummary,
  type AdminDashboardSummary,
  type DashboardOperationBucketKey,
  type DashboardOperationPreviewOrder,
} from "@/lib/admin/dashboard/summary";
import {
  loadAdminAttentionSummary,
  type AdminAttentionSummary,
} from "@/lib/admin/attention-summary";
import type { AdminPermissionContext } from "@/lib/admin-sessions";

type CookieReader = {
  get(name: string): { value: string } | undefined;
};

type WorkspaceOperationBucket = {
  count: number;
  lateCount: number;
  oldestAgeMinutes: number | null;
  lateAfterMinutes: number | null;
  previewOrders: DashboardOperationPreviewOrder[];
};

type WorkspaceAttentionSummary = {
  totalCount: number;
  groups: AdminAttentionSummary["groups"];
};

export type AdminWorkspaceDashboardSummary = {
  generatedAt: string;
  outletId: string;
  outletName: string;
  permissions: AdminDashboardSummary["permissions"];
  kpis: AdminDashboardSummary["kpis"];
  operations: AdminDashboardSummary["operations"];
  operationBuckets: Record<
    DashboardOperationBucketKey,
    WorkspaceOperationBucket
  > | null;
  deviceHealth: AdminDashboardSummary["deviceHealth"];
  deviceHealthHref: string | null;
  attention: WorkspaceAttentionSummary | null;
};

function compactOperationBuckets(
  summary: AdminDashboardSummary,
): AdminWorkspaceDashboardSummary["operationBuckets"] {
  if (!summary.operationsPreview) return null;

  return Object.fromEntries(
    Object.entries(summary.operationsPreview).map(([key, bucket]) => [
      key,
      {
        count: bucket.count,
        lateCount: bucket.lateCount,
        oldestAgeMinutes: bucket.oldestAgeMinutes,
        lateAfterMinutes: bucket.lateAfterMinutes,
        previewOrders: bucket.previewOrders,
      },
    ]),
  ) as Record<DashboardOperationBucketKey, WorkspaceOperationBucket>;
}

function compactAttentionSummary(
  result: Awaited<ReturnType<typeof loadAdminAttentionSummary>>,
): WorkspaceAttentionSummary | null {
  if (!result.ok) return null;
  return {
    totalCount: result.summary.totalCount,
    groups: result.summary.groups,
  };
}

export async function buildAdminWorkspaceDashboardSummary({
  context,
  searchParams,
  cookies,
}: {
  context: AdminPermissionContext;
  searchParams: URLSearchParams;
  cookies: CookieReader;
}): Promise<AdminWorkspaceDashboardSummary> {
  const [summary, attention] = await Promise.all([
    buildAdminDashboardSummary({ context, searchParams }),
    loadAdminAttentionSummary({ session: context.actor, cookies }),
  ]);

  return {
    generatedAt: summary.generatedAt,
    outletId: summary.outletId,
    outletName: summary.outletName,
    permissions: summary.permissions,
    kpis: summary.kpis,
    operations: summary.operations,
    operationBuckets: compactOperationBuckets(summary),
    deviceHealth: summary.deviceHealth,
    deviceHealthHref: summary.deviceHealthHref,
    attention: compactAttentionSummary(attention),
  };
}
