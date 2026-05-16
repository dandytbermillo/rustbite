import { redirect } from "next/navigation";
import AdminShell from "@/components/admin/Shell";
import {
  getServerAdminSession,
  requireAdminPageAuth,
} from "@/lib/admin-sessions";
import MfaClient from "./MfaClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminMfaPage() {
  await requireAdminPageAuth();
  const session = await getServerAdminSession();
  if (!session?.mfaEnrollmentRequired) {
    redirect("/admin/workspace?modal=security");
  }

  return (
    <AdminShell active="security">
      <MfaClient />
    </AdminShell>
  );
}
