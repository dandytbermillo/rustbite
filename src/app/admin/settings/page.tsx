import { redirect } from "next/navigation";
import { requireAdminPagePermission } from "@/lib/admin-sessions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SettingsPage() {
  await requireAdminPagePermission("admin.settings.read");
  redirect("/admin/workspace?modal=settings");
}
