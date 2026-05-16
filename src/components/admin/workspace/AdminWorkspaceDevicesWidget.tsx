"use client";

import type { AdminWorkspaceDevicesSummary } from "@/lib/admin/workspace/devices-summary";
import type { AdminWorkspaceNotify } from "./AdminWorkspaceToastHost";
import WorkspaceDevicesPanel from "./WorkspaceDevicesPanel";

export default function AdminWorkspaceDevicesWidget({
  summary,
  notify,
  autoRefresh = true,
  onSummaryChange,
}: {
  summary: AdminWorkspaceDevicesSummary;
  notify: AdminWorkspaceNotify;
  autoRefresh?: boolean;
  onSummaryChange?: (summary: AdminWorkspaceDevicesSummary) => void;
}) {
  return (
    <WorkspaceDevicesPanel
      initialSummary={summary}
      notify={notify}
      variant="widget"
      autoRefresh={autoRefresh}
      onSummaryChange={onSummaryChange}
    />
  );
}
