import AdminShell from "@/components/admin/Shell";
import { redirect } from "next/navigation";
import { requireAdminPagePermission } from "@/lib/admin-sessions";
import { classicDeepLinkToWorkspaceTarget } from "@/lib/admin/workspace/deep-links";
import { listAdminOutlets } from "@/lib/admin-user-management";
import { listDevices } from "@/lib/device-management";
import DevicesClient from "./DevicesClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SearchParams = Promise<{
  mode?: string;
  id?: string;
  device?: string;
}>;

function toUrlSearchParams(params: Awaited<SearchParams>): URLSearchParams {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) next.set(key, value);
  }
  return next;
}

export default async function AdminDevicesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireAdminPagePermission("admin.auth.devices.manage");
  const sp = await searchParams;
  const workspaceTarget = classicDeepLinkToWorkspaceTarget({
    pathname: "/admin/devices",
    searchParams: toUrlSearchParams(sp),
  });
  if (workspaceTarget) redirect(workspaceTarget);

  const [devices, outlets] = await Promise.all([listDevices(), listAdminOutlets()]);

  return (
    <AdminShell active="devices">
      <DevicesClient initialDevices={devices} outlets={outlets} />
    </AdminShell>
  );
}
