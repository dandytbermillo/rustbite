import AdminShell from "@/components/admin/Shell";
import {
  getServerAdminSession,
  requireAdminPagePermission,
} from "@/lib/admin-sessions";
import {
  canManageSiteAdminAccounts,
  listAdminOutlets,
  listAdminUsers,
  passwordPolicyText,
} from "@/lib/admin-user-management";
import UsersNextClient from "../users-next/UsersNextClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminUsersPage() {
  await requireAdminPagePermission("admin.auth.users.manage");
  const [users, outlets, session] = await Promise.all([
    listAdminUsers(),
    listAdminOutlets(),
    getServerAdminSession(),
  ]);

  return (
    <AdminShell active="users">
      <UsersNextClient
        initialUsers={users}
        outlets={outlets}
        passwordPolicy={passwordPolicyText()}
        canManageSiteAdminAccounts={canManageSiteAdminAccounts(session)}
      />
    </AdminShell>
  );
}
