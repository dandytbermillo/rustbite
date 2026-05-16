import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { requireAdminPagePermission } from "@/lib/admin-sessions";
import {
  buildAdminDashboardSummary,
  InvalidDashboardRangeError,
  type AdminDashboardSummary,
} from "@/lib/admin/dashboard/summary";
import { resolveAdminModePreference } from "@/lib/admin/mode-preference";
import AdminShell from "@/components/admin/Shell";
import AdminDashboardClient from "@/components/admin/AdminDashboardClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SearchParamValue = string | string[] | undefined;
type DashboardSearchParams = Record<string, SearchParamValue>;

type DashboardPageProps = {
  searchParams?: Promise<DashboardSearchParams>;
};

function toUrlSearchParams(params: DashboardSearchParams = {}): URLSearchParams {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined) next.append(key, item);
      }
    } else if (value !== undefined) {
      next.set(key, value);
    }
  }
  return next;
}

export default async function AdminDashboardPage({
  searchParams,
}: DashboardPageProps) {
  const permission = await requireAdminPagePermission("admin.dashboard.read");
  if (!permission) redirect("/admin/login");

  const resolvedSearchParams = searchParams ? await searchParams : {};
  const urlSearchParams = toUrlSearchParams(resolvedSearchParams);
  const mode = resolveAdminModePreference({
    searchParams: urlSearchParams,
    cookies: await cookies(),
  });
  if (mode === "workspace") {
    redirect("/admin/workspace");
  }
  urlSearchParams.delete("mode");
  let rangeError: string | null = null;
  let summary: AdminDashboardSummary;

  try {
    summary = await buildAdminDashboardSummary({
      context: permission,
      searchParams: urlSearchParams,
    });
  } catch (error) {
    if (!(error instanceof InvalidDashboardRangeError)) throw error;
    rangeError = error.reason;
    summary = await buildAdminDashboardSummary({
      context: permission,
      searchParams: new URLSearchParams(),
    });
  }

  return (
    <AdminShell active="dashboard">
      <AdminDashboardClient
        initialSummary={summary}
        initialRangeError={rangeError}
      />
    </AdminShell>
  );
}
