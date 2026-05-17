"use client";

import UsersManagementPanel from "@/components/admin/users/UsersManagementPanel";
import type {
  AdminOutletRow,
  AdminUserRow,
} from "@/lib/admin-user-management";

export default function UsersNextClient({
  initialUsers,
  outlets,
  passwordPolicy,
  canManageSiteAdminAccounts,
}: {
  initialUsers: AdminUserRow[];
  outlets: AdminOutletRow[];
  passwordPolicy: string;
  canManageSiteAdminAccounts: boolean;
}) {
  return (
    <UsersManagementPanel
      initialUsers={initialUsers}
      initialOutlets={outlets}
      passwordPolicy={passwordPolicy}
      canManageSiteAdminAccounts={canManageSiteAdminAccounts}
      variant="page"
    />
  );
}
