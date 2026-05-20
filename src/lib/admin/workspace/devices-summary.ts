import "server-only";

import {
  buildAdminDashboardSummary,
  type AdminDashboardSummary,
} from "@/lib/admin/dashboard/summary";
import {
  adminActorHasPermission,
  type AdminPermissionContext,
} from "@/lib/admin-sessions";
import { listDevices, type DeviceRow } from "@/lib/device-management";

export type WorkspaceDeviceRow = DeviceRow;

export type AdminWorkspaceDevicesSummary = {
  generatedAt: string;
  outletId: string;
  outletName: string;
  permissions: {
    canReadDevices: boolean;
    canManageDevices: boolean;
  };
  deviceHealth: AdminDashboardSummary["deviceHealth"];
  deviceHealthHref: string | null;
  deviceFleet: AdminDashboardSummary["deviceFleet"];
  devices: WorkspaceDeviceRow[];
};

function deviceBelongsToOutlet(device: DeviceRow, outletId: string): boolean {
  return (
    device.outletId === outletId ||
    device.sharedOutlets.some((outlet) => outlet.outletId === outletId)
  );
}

export async function buildAdminWorkspaceDevicesSummary({
  context,
  now,
}: {
  context: AdminPermissionContext;
  now?: Date;
}): Promise<AdminWorkspaceDevicesSummary> {
  const [summary, devices, canManageDevices] = await Promise.all([
    buildAdminDashboardSummary({
      context,
      searchParams: new URLSearchParams({ range: "today" }),
      now,
    }),
    listDevices(),
    adminActorHasPermission(
      context.actor,
      "admin.auth.devices.manage",
      context.outletId,
    ),
  ]);

  const fleetById = new Map(
    (summary.deviceFleet?.devices ?? []).map((device) => [device.id, device]),
  );
  const workspaceDevices = devices
    .filter((device) => deviceBelongsToOutlet(device, context.outletId))
    .map((device) => {
      const fleetDevice = fleetById.get(device.id);
      return fleetDevice
        ? {
            ...device,
            presenceKind: fleetDevice.presenceKind,
            presenceLabel: fleetDevice.presenceLabel,
            presenceReason: fleetDevice.presenceReason,
            presenceLastLifecycleAt: fleetDevice.presenceLastLifecycleAt,
            presenceLastHeartbeatAt: fleetDevice.presenceLastHeartbeatAt,
          }
        : device;
    });

  return {
    generatedAt: summary.generatedAt,
    outletId: summary.outletId,
    outletName: summary.outletName,
    permissions: {
      canReadDevices: summary.permissions.canReadDevices,
      canManageDevices,
    },
    deviceHealth: summary.deviceHealth,
    deviceHealthHref: summary.deviceHealthHref,
    deviceFleet: summary.deviceFleet,
    devices: workspaceDevices,
  };
}
