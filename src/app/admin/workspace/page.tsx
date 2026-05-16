import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import {
  adminActorHasPermission,
  requireAdminPagePermission,
} from "@/lib/admin-sessions";
import { displayActiveRole } from "@/lib/admin-active-outlet";
import {
  buildAdminWorkspaceDashboardSummary,
} from "@/lib/admin/workspace/dashboard-summary";
import {
  buildAdminWorkspaceDevicesSummary,
} from "@/lib/admin/workspace/devices-summary";
import {
  buildAdminWorkspaceOrdersSummary,
  workspaceOrdersFilterFromStatus,
} from "@/lib/admin/workspace/orders-summary";
import {
  buildAdminWorkspaceMenuSummary,
  workspaceMenuFilterFromParams,
} from "@/lib/admin/workspace/menu-summary";
import AdminWorkspaceClient, {
  type WorkspaceUtilityModal,
} from "@/components/admin/workspace/AdminWorkspaceClient";
import type { AdminWorkspaceWidgetAccess } from "@/lib/admin/workspace/layout";
import { parseWorkspaceWidgetId } from "@/lib/admin/workspace/deep-links";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SearchParamValue = string | string[] | undefined;
type WorkspaceSearchParams = Record<string, SearchParamValue>;

type WorkspacePageProps = {
  searchParams?: Promise<WorkspaceSearchParams>;
};

function firstSearchValue(value: SearchParamValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function toUrlSearchParams(params: WorkspaceSearchParams): URLSearchParams {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) out.append(key, item);
    } else if (value != null) {
      out.set(key, value);
    }
  }
  return out;
}

function parseWorkspaceUtilityModal(
  value: string | undefined,
): WorkspaceUtilityModal | null {
  switch (value) {
    case "deal-history":
    case "dealHistory":
      return "dealHistory";
    case "settings":
      return "settings";
    case "security":
      return "security";
    case "devices":
      return "devices";
    default:
      return null;
  }
}

export default async function AdminWorkspacePage({
  searchParams,
}: WorkspacePageProps) {
  const permission = await requireAdminPagePermission("admin.dashboard.read");
  if (!permission) redirect("/admin/login");

  const resolvedSearchParams = searchParams ? await searchParams : {};
  const initialFocusWidgetId = parseWorkspaceWidgetId(
    firstSearchValue(resolvedSearchParams.widget),
  );
  const initialOrdersTargetOrderId =
    firstSearchValue(resolvedSearchParams.order) ??
    firstSearchValue(resolvedSearchParams.id) ??
    null;
  const initialOrdersFilter = workspaceOrdersFilterFromStatus(
    firstSearchValue(resolvedSearchParams.status),
  );
  const initialMenuFilter = workspaceMenuFilterFromParams(
    toUrlSearchParams(resolvedSearchParams),
  );
  const requestedUtilityModal = parseWorkspaceUtilityModal(
    firstSearchValue(resolvedSearchParams.modal),
  );
  const initialDevicesModalDeviceId =
    requestedUtilityModal === "devices"
      ? (firstSearchValue(resolvedSearchParams.device) ?? null)
      : null;

  const [
    canReadOrders,
    canReadMenu,
    canWriteMenu,
    canReadDevices,
    canManageDevices,
    canReadDealHistory,
    canReadSettings,
  ] = await Promise.all([
    adminActorHasPermission(
      permission.actor,
      "admin.orders.read",
      permission.outletId,
    ),
    adminActorHasPermission(
      permission.actor,
      "admin.menu.read",
      permission.outletId,
    ),
    adminActorHasPermission(
      permission.actor,
      "admin.menu.write",
      permission.outletId,
    ),
    adminActorHasPermission(
      permission.actor,
      "admin.devices.read",
      permission.outletId,
    ),
    adminActorHasPermission(
      permission.actor,
      "admin.auth.devices.manage",
      permission.outletId,
    ),
    adminActorHasPermission(
      permission.actor,
      "admin.dealHistory.read",
      permission.outletId,
    ),
    adminActorHasPermission(
      permission.actor,
      "admin.settings.read",
      permission.outletId,
    ),
  ]);

  const access: AdminWorkspaceWidgetAccess[] = [
    { id: "dashboard", canView: true },
    { id: "attention", canView: true },
    { id: "orders", canView: canReadOrders },
    { id: "menu", canView: canReadMenu },
    { id: "devices", canView: canReadDevices },
  ];
  const initialUtilityModal =
    requestedUtilityModal === "dealHistory" && !canReadDealHistory
      ? null
      : requestedUtilityModal === "settings" && !canReadSettings
        ? null
        : requestedUtilityModal === "devices" && !canReadDevices
          ? null
          : requestedUtilityModal;
  const cookieStore = await cookies();
  const [dashboardSummary, ordersSummary, menuSummary, devicesSummary] =
    await Promise.all([
    buildAdminWorkspaceDashboardSummary({
      context: permission,
      searchParams: new URLSearchParams({ range: "today" }),
      cookies: cookieStore,
    }),
    canReadOrders
      ? buildAdminWorkspaceOrdersSummary({
          context: permission,
          filter: initialOrdersFilter,
          targetOrderId: initialOrdersTargetOrderId,
        })
      : Promise.resolve(null),
    canReadMenu
      ? buildAdminWorkspaceMenuSummary({
          context: permission,
          filter: initialMenuFilter,
        })
      : Promise.resolve(null),
    canReadDevices
      ? buildAdminWorkspaceDevicesSummary({ context: permission })
      : Promise.resolve(null),
  ]);

  return (
    <AdminWorkspaceClient
      outletId={permission.outletId}
      outletName={permission.activeOutlet.outletName}
      userId={permission.actor.userId}
      userName={permission.actor.displayName}
      roleLabel={displayActiveRole(permission.activeOutlet.role)}
      access={access}
      canWriteMenu={canWriteMenu}
      canManageDevices={canManageDevices}
      canReadDevices={canReadDevices}
      canReadDealHistory={canReadDealHistory}
      canReadSettings={canReadSettings}
      initialFocusWidgetId={initialFocusWidgetId}
      initialUtilityModal={initialUtilityModal}
      initialDevicesModalDeviceId={initialDevicesModalDeviceId}
      dashboardSummary={dashboardSummary}
      ordersSummary={ordersSummary}
      initialOrdersTargetOrderId={initialOrdersTargetOrderId}
      menuSummary={menuSummary}
      devicesSummary={devicesSummary}
    />
  );
}
