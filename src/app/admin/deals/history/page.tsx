import { redirect } from "next/navigation";
import { requireAdminPagePermission } from "@/lib/admin-sessions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DealHistoryPage() {
  await requireAdminPagePermission("admin.dealHistory.read");
  redirect("/admin/workspace?modal=deal-history");
}
