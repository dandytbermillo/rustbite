import { parseAdminMode } from "@/lib/admin/mode-preference";
import type { AdminWorkspaceWidgetId } from "@/lib/admin/workspace/layout";

const CLASSIC_TO_WORKSPACE_WIDGET: Record<string, AdminWorkspaceWidgetId> = {
  "/admin": "dashboard",
  "/admin/orders": "orders",
  "/admin/menu": "menu",
  "/admin/devices": "devices",
};

function copyParam({
  from,
  to,
  sourceName,
  targetName = sourceName,
}: {
  from: URLSearchParams;
  to: URLSearchParams;
  sourceName: string;
  targetName?: string;
}) {
  const value = from.get(sourceName);
  if (value) to.set(targetName, value);
}

function copyParams({
  from,
  to,
  sourceName,
  targetName = sourceName,
}: {
  from: URLSearchParams;
  to: URLSearchParams;
  sourceName: string;
  targetName?: string;
}) {
  const values = from.getAll(sourceName).filter(Boolean);
  for (const value of values) {
    to.append(targetName, value);
  }
}

export function classicDeepLinkToWorkspaceTarget({
  pathname,
  searchParams,
}: {
  pathname: string;
  searchParams: URLSearchParams;
}): string | null {
  if (parseAdminMode(searchParams.get("mode")) !== "workspace") return null;

  const widget = CLASSIC_TO_WORKSPACE_WIDGET[pathname];
  if (!widget) return null;

  const target = new URLSearchParams({ widget });
  if (widget === "orders") {
    copyParam({ from: searchParams, to: target, sourceName: "order" });
    copyParam({
      from: searchParams,
      to: target,
      sourceName: "id",
      targetName: "order",
    });
    copyParam({ from: searchParams, to: target, sourceName: "status" });
    copyParam({ from: searchParams, to: target, sourceName: "from" });
    copyParam({ from: searchParams, to: target, sourceName: "to" });
  }
  if (widget === "menu") {
    copyParam({ from: searchParams, to: target, sourceName: "item" });
    copyParam({
      from: searchParams,
      to: target,
      sourceName: "id",
      targetName: "item",
    });
    copyParam({ from: searchParams, to: target, sourceName: "q" });
    copyParams({ from: searchParams, to: target, sourceName: "category" });
    copyParam({ from: searchParams, to: target, sourceName: "badge" });
    copyParam({ from: searchParams, to: target, sourceName: "status" });
    copyParam({ from: searchParams, to: target, sourceName: "stock" });
    copyParams({ from: searchParams, to: target, sourceName: "attention" });
  }
  if (widget === "devices") {
    copyParam({ from: searchParams, to: target, sourceName: "device" });
    copyParam({
      from: searchParams,
      to: target,
      sourceName: "id",
      targetName: "device",
    });
  }

  return `/admin/workspace?${target.toString()}`;
}

export function workspaceSearchParamsForWidget({
  widget,
  current,
}: {
  widget: AdminWorkspaceWidgetId;
  current?: URLSearchParams;
}): string {
  const params = new URLSearchParams(current);
  params.set("widget", widget);
  return `/admin/workspace?${params.toString()}`;
}

export function parseWorkspaceWidgetId(
  value: unknown,
): AdminWorkspaceWidgetId | null {
  if (
    value === "dashboard" ||
    value === "orders" ||
    value === "menu" ||
    value === "devices" ||
    value === "attention"
  ) {
    return value;
  }
  return null;
}
