"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Crown,
  Eye,
  EyeOff,
  KeyRound,
  ShieldCheck,
  Store,
  UserRound,
} from "lucide-react";
import { BRAND } from "@/lib/brand";
import type {
  AdminOutletRoleValue,
  AdminOutletRow,
  AdminSiteRoleValue,
  AdminUserRow,
} from "@/lib/admin-user-management";

type UserDraft = {
  displayName: string;
  siteRole: AdminSiteRoleValue | "";
  isActive: boolean;
  outletRoles: Record<string, AdminOutletRoleValue | "">;
};

type CreateForm = {
  email: string;
  displayName: string;
  password: string;
  siteRole: AdminSiteRoleValue | "";
  outletRoles: Record<string, AdminOutletRoleValue | "">;
};

function userToDraft(user: AdminUserRow, outlets: AdminOutletRow[]): UserDraft {
  const outletRoles: Record<string, AdminOutletRoleValue | ""> = {};
  for (const outlet of outlets) outletRoles[outlet.id] = "";
  for (const role of user.outletRoles) outletRoles[role.outletId] = role.role;

  return {
    displayName: user.displayName,
    siteRole: user.siteRole ?? "",
    isActive: user.isActive,
    outletRoles,
  };
}

function blankCreateForm(outlets: AdminOutletRow[]): CreateForm {
  // Default new users to VIEWER across all outlets. Plan §417-422: VIEWER is
  // read-only and is ignored by the active-operator pre-flight, so a freshly-
  // created user is "safe by default" — they can't accidentally end up as an
  // incomplete OPERATOR/MANAGER blocking deployment. The Owner explicitly
  // promotes them after surface grants and operational PIN are in place.
  const outletRoles: Record<string, AdminOutletRoleValue | ""> = {};
  for (const outlet of outlets) outletRoles[outlet.id] = "VIEWER";
  return {
    email: "",
    displayName: "",
    password: "",
    siteRole: "",
    outletRoles,
  };
}

function serializeOutletRoles(
  outletRoles: Record<string, AdminOutletRoleValue | "">
) {
  return Object.entries(outletRoles)
    .filter((entry): entry is [string, AdminOutletRoleValue] => entry[1] !== "")
    .map(([outletId, role]) => ({ outletId, role }));
}

type RoleIconKind =
  | "owner"
  | "admin"
  | "staff-account"
  | "manager"
  | "staff"
  | "viewer"
  | "none";

const ROLE_ICON_CLASS =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border";

function RoleIcon({ kind }: { kind: RoleIconKind }) {
  if (kind === "owner") {
    return (
      <span className={`${ROLE_ICON_CLASS} border-amber-300 bg-amber-100 text-amber-700`}>
        <Crown size={15} strokeWidth={2.5} aria-hidden />
      </span>
    );
  }
  if (kind === "manager") {
    return (
      <span className={`${ROLE_ICON_CLASS} border-sky-300 bg-sky-100 text-sky-700`}>
        <KeyRound size={15} strokeWidth={2.5} aria-hidden />
      </span>
    );
  }
  if (kind === "admin") {
    return (
      <span className={`${ROLE_ICON_CLASS} border-red-200 bg-red-50 text-red-700`}>
        <ShieldCheck size={15} strokeWidth={2.5} aria-hidden />
      </span>
    );
  }
  if (kind === "staff") {
    return (
      <span className={`${ROLE_ICON_CLASS} border-emerald-300 bg-emerald-100 text-emerald-700`}>
        <UserRound size={15} strokeWidth={2.5} aria-hidden />
      </span>
    );
  }
  if (kind === "viewer") {
    return (
      <span className={`${ROLE_ICON_CLASS} border-stone-300 bg-stone-100 text-stone-700`}>
        <Eye size={15} strokeWidth={2.5} aria-hidden />
      </span>
    );
  }
  if (kind === "none") {
    return (
      <span className={`${ROLE_ICON_CLASS} border-stone-200 bg-stone-50 text-stone-400`}>
        <EyeOff size={15} strokeWidth={2.5} aria-hidden />
      </span>
    );
  }
  return (
    <span className={`${ROLE_ICON_CLASS} border-red-200 bg-red-50 text-red-700`}>
      <Store size={15} strokeWidth={2.5} aria-hidden />
    </span>
  );
}

function roleIconKindForUser(user: AdminUserRow): RoleIconKind {
  if (user.siteRole === "OWNER") return "owner";
  if (user.siteRole === "ADMIN") return "admin";
  if (user.outletRoles.some((role) => role.role === "MANAGER")) return "manager";
  if (user.outletRoles.some((role) => role.role === "OPERATOR")) return "staff";
  if (user.outletRoles.some((role) => role.role === "VIEWER")) return "viewer";
  return "staff-account";
}

function siteRoleSummary(user: AdminUserRow) {
  if (user.siteRole === "OWNER") return "Account type: Owner";
  if (user.siteRole === "ADMIN") return "Account type: Admin";
  return "Account type: Staff";
}

function roleLabel(role: AdminOutletRoleValue) {
  if (role === "MANAGER") return "Manager";
  if (role === "OPERATOR") return "Operator";
  return "Viewer";
}

function outletRoleSummary(user: AdminUserRow) {
  if (user.siteRole === "OWNER") return "Outlet access: All outlets";
  if (user.siteRole === "ADMIN") return "Outlet access: Site-wide admin";
  if (user.outletRoles.length === 0) return "Outlet access: None";
  return `Outlet access: ${user.outletRoles
    .map((role) => `${role.outletName} · ${roleLabel(role.role)}`)
    .join(" / ")}`;
}

function ownerChangeActionLabel(action: string) {
  if (action === "DEACTIVATE") return "Deactivate Owner";
  if (action === "DEMOTE") return "Demote Owner";
  if (action === "PASSWORD_RESET") return "Reset Owner password";
  if (action === "MFA_RESET") return "Reset Owner MFA";
  if (action === "DELETE") return "Delete Owner";
  return action;
}

async function readError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);
  return body && typeof body.error === "string" ? body.error : fallback;
}

export default function UsersClient({
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
  const router = useRouter();
  const [users, setUsers] = useState(initialUsers);
  const [drafts, setDrafts] = useState<Record<string, UserDraft>>(() =>
    Object.fromEntries(initialUsers.map((user) => [user.id, userToDraft(user, outlets)]))
  );
  const [resetPasswords, setResetPasswords] = useState<Record<string, string>>({});
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({});
  // Counter/Kitchen Active Operator (Phase 2): per-user "shown once" auto-PIN.
  const [revealedPins, setRevealedPins] = useState<Record<string, string>>({});
  const [createForm, setCreateForm] = useState(() => blankCreateForm(outlets));
  const [stepUpCode, setStepUpCode] = useState("");
  const [showStepUp, setShowStepUp] = useState(false);
  const [stepUpMessage, setStepUpMessage] = useState(
    "Enter your MFA code before this sensitive action."
  );
  const [stepUpError, setStepUpError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, startRefresh] = useTransition();

  const refresh = () => {
    startRefresh(async () => {
      const response = await fetch("/api/admin/users", { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as { users: AdminUserRow[] };
      setUsers(body.users);
      setDrafts(
        Object.fromEntries(body.users.map((user) => [user.id, userToDraft(user, outlets)]))
      );
      router.refresh();
    });
  };

  useEffect(() => {
    if (!showStepUp) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && pendingId !== "step-up") {
        setShowStepUp(false);
        setStepUpCode("");
        setStepUpError(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [pendingId, showStepUp]);

  const clearMessages = () => {
    setError(null);
    setNotice(null);
  };

  const handleSensitiveActionError = async (
    response: Response,
    fallback: string
  ) => {
    const body = await response.json().catch(() => null);
    const errorCode =
      body && typeof body.errorCode === "string" ? body.errorCode : null;
    const message = body && typeof body.error === "string" ? body.error : fallback;
    if (response.status === 428 && errorCode === "mfa_enrollment_required") {
      setError(`${message} Open Security > MFA setup first.`);
      return;
    }
    if (response.status === 428 && errorCode === "step_up_required") {
      setStepUpMessage(message);
      setStepUpError(null);
      setShowStepUp(true);
      return;
    }
    setError(message);
  };

  const verifyStepUp = async () => {
    setStepUpError(null);
    setNotice(null);
    setPendingId("step-up");
    const response = await fetch("/api/admin/auth/step-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: stepUpCode }),
    });
    setPendingId(null);
    if (!response.ok) {
      setStepUpError(await readError(response, "Could not verify MFA code."));
      return;
    }
    setStepUpCode("");
    setShowStepUp(false);
    setNotice("MFA verified for sensitive actions. Run the action again.");
  };

  const createUser = async (event: React.FormEvent) => {
    event.preventDefault();
    clearMessages();
    setPendingId("create");

    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: createForm.email,
        displayName: createForm.displayName,
        password: createForm.password,
        accountType: createForm.siteRole || "STAFF",
        siteRole: createForm.siteRole || null,
        // ADMIN may also receive outlet roles for operational participation;
        // only OWNER is excluded in v1.
        outletRoles:
          createForm.siteRole === "OWNER"
            ? []
            : serializeOutletRoles(createForm.outletRoles),
      }),
    });

    setPendingId(null);
    if (!response.ok) {
      await handleSensitiveActionError(response, "Could not create admin user.");
      return;
    }
    setCreateForm(blankCreateForm(outlets));
    setNotice("Admin user created.");
    refresh();
  };

  const updateUser = async (user: AdminUserRow) => {
    clearMessages();
    const draft = drafts[user.id];
    setPendingId(user.id);
    // ADMIN and STAFF may hold outlet roles for counter/kitchen operational
    // participation (Phase 2 plan §244-250). Only OWNER has its outlet
    // roles cleared here in v1.
    const accountType = draft.siteRole || "STAFF";
    const includeOutletRoles = accountType !== "OWNER";
    const response = await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: draft.displayName,
        accountType,
        siteRole: draft.siteRole || null,
        isActive: draft.isActive,
        outletRoles: includeOutletRoles
          ? serializeOutletRoles(draft.outletRoles)
          : [],
      }),
    });
    setPendingId(null);
    if (!response.ok) {
      await handleSensitiveActionError(response, "Could not update admin user.");
      return;
    }
    if (response.status === 202) {
      setNotice("Owner change queued for 24-hour cooling-off.");
      refresh();
      return;
    }
    const updateBody = (await response
      .clone()
      .json()
      .catch(() => null)) as
      | {
          cascadeClearedSessionCount?: number;
          sessionsRevoked?: boolean;
        }
      | null;
    const cleared = updateBody?.cascadeClearedSessionCount ?? 0;
    if (cleared > 0) {
      setNotice(
        `User updated. ${cleared} active operator session${
          cleared === 1 ? "" : "s"
        } cleared.`
      );
    } else if (updateBody?.sessionsRevoked) {
      setNotice("User updated. Admin sessions revoked.");
    } else {
      setNotice("User updated.");
    }
    refresh();
  };

  const resetPassword = async (user: AdminUserRow) => {
    clearMessages();
    const password = resetPasswords[user.id] ?? "";
    if (!password) {
      setError("Enter a new password first.");
      return;
    }
    setPendingId(`${user.id}:password`);
    const response = await fetch(`/api/admin/users/${user.id}/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setPendingId(null);
    if (!response.ok) {
      await handleSensitiveActionError(response, "Could not reset password.");
      return;
    }
    if (response.status === 202) {
      setResetPasswords((prev) => ({ ...prev, [user.id]: "" }));
      setNotice("Owner password reset queued for 24-hour cooling-off.");
      refresh();
      return;
    }
    setResetPasswords((prev) => ({ ...prev, [user.id]: "" }));
    setNotice("Password reset and sessions revoked.");
    refresh();
  };

  const resetMfa = async (user: AdminUserRow) => {
    clearMessages();
    setPendingId(`${user.id}:mfa`);
    const response = await fetch(`/api/admin/users/${user.id}/reset-mfa`, {
      method: "POST",
    });
    setPendingId(null);
    if (!response.ok) {
      await handleSensitiveActionError(response, "Could not reset MFA.");
      return;
    }
    if (response.status === 202) {
      setNotice("Owner MFA reset queued for 24-hour cooling-off.");
      refresh();
      return;
    }
    setNotice("MFA reset. The user must enroll MFA again on next login.");
    refresh();
  };

  const revokeSessions = async (user: AdminUserRow) => {
    clearMessages();
    setPendingId(`${user.id}:sessions`);
    const response = await fetch(`/api/admin/users/${user.id}/revoke-sessions`, {
      method: "POST",
    });
    setPendingId(null);
    if (!response.ok) {
      await handleSensitiveActionError(response, "Could not revoke sessions.");
      return;
    }
    const body = (await response.json()) as { revokedCount: number };
    setNotice(`Revoked ${body.revokedCount} session${body.revokedCount === 1 ? "" : "s"}.`);
    refresh();
  };

  const resetOperationalPin = async (user: AdminUserRow) => {
    clearMessages();
    setRevealedPins((prev) => {
      const next = { ...prev };
      delete next[user.id];
      return next;
    });
    setPendingId(`${user.id}:pin`);
    const response = await fetch(`/api/admin/users/${user.id}/reset-pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ generate: true }),
    });
    setPendingId(null);
    if (!response.ok) {
      await handleSensitiveActionError(response, "Could not reset operational PIN.");
      return;
    }
    const body = (await response.json()) as {
      pin?: string;
      cascadeClearedSessionCount?: number;
    };
    if (body.pin) {
      setRevealedPins((prev) => ({ ...prev, [user.id]: body.pin! }));
    }
    const cleared = body.cascadeClearedSessionCount ?? 0;
    setNotice(
      cleared > 0
        ? `Operational PIN reset. ${cleared} active operator session${
            cleared === 1 ? "" : "s"
          } cleared.`
        : "Operational PIN reset."
    );
    refresh();
  };

  const updateSurfaceAccess = async (
    user: AdminUserRow,
    nextSurfaces: Array<"COUNTER" | "KITCHEN">
  ) => {
    clearMessages();
    setPendingId(`${user.id}:surface`);
    const response = await fetch(`/api/admin/users/${user.id}/surface-access`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ surfaces: nextSurfaces }),
    });
    setPendingId(null);
    if (!response.ok) {
      await handleSensitiveActionError(response, "Could not update surface access.");
      return;
    }
    const body = (await response.json()) as {
      cascadeClearedSessionCount?: number;
      changed?: boolean;
    };
    if (body.changed) {
      const cleared = body.cascadeClearedSessionCount ?? 0;
      setNotice(
        cleared > 0
          ? `Surface access updated. ${cleared} active operator session${
              cleared === 1 ? "" : "s"
            } cleared.`
          : "Surface access updated."
      );
    }
    refresh();
  };

  const cancelOwnerChange = async (pendingIdValue: string) => {
    clearMessages();
    setPendingId(`owner-change:${pendingIdValue}`);
    const response = await fetch(`/api/admin/owner-changes/${pendingIdValue}/cancel`, {
      method: "POST",
    });
    setPendingId(null);
    if (!response.ok) {
      await handleSensitiveActionError(response, "Could not cancel pending owner change.");
      return;
    }
    setNotice("Pending owner change cancelled.");
    refresh();
  };

  const pendingOwnerChanges = users.flatMap((user) =>
    user.pendingOwnerChanges.map((pending) => ({ user, pending }))
  );

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="display text-3xl">Users</h1>
          <div className="text-xs font-black tracking-widest opacity-60 mt-2">
            Owner, admin, and staff accounts, roles, and sessions.
          </div>
        </div>
        <div className="text-xs font-black tracking-widest opacity-60">
          {users.length} user{users.length === 1 ? "" : "s"}
        </div>
      </div>

      <form
        onSubmit={createUser}
        className="mb-6 rounded-xl border border-stone-200 bg-white p-5"
      >
        <div className="mb-4 text-xs font-black tracking-widest opacity-60">
          CREATE USER
        </div>
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_160px]">
          <Input
            label="Email"
            value={createForm.email}
            onChange={(value) => setCreateForm((prev) => ({ ...prev, email: value }))}
            type="email"
          />
          <Input
            label="Display name"
            value={createForm.displayName}
            onChange={(value) =>
              setCreateForm((prev) => ({ ...prev, displayName: value }))
            }
          />
          <PasswordInput
            label={`Password (${passwordPolicy})`}
            value={createForm.password}
            onChange={(value) =>
              setCreateForm((prev) => ({ ...prev, password: value }))
            }
            visible={visiblePasswords.create ?? false}
            onToggleVisible={() =>
              setVisiblePasswords((prev) => ({ ...prev, create: !prev.create }))
            }
          />
          <SiteRoleSelect
            value={createForm.siteRole}
            allowSiteAdminRoles={canManageSiteAdminAccounts}
            onChange={(siteRole) =>
              setCreateForm((prev) => ({
                ...prev,
                siteRole,
              }))
            }
          />
        </div>

        {createForm.siteRole !== "OWNER" && (
          <OutletRoleControls
            outlets={outlets}
            values={createForm.outletRoles}
            onChange={(outletId, role) =>
              setCreateForm((prev) => ({
                ...prev,
                outletRoles: { ...prev.outletRoles, [outletId]: role },
              }))
            }
          />
        )}

        <div className="mt-4 flex justify-end">
          <button
            disabled={pendingId === "create"}
            className="rounded-md px-5 py-3 text-xs font-black tracking-widest disabled:opacity-50"
            style={{ background: BRAND.red, color: "white" }}
          >
            {pendingId === "create" ? "CREATING..." : "CREATE USER"}
          </button>
        </div>
      </form>

      {error && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
          {notice}
        </div>
      )}
      {showStepUp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && pendingId !== "step-up") {
              setShowStepUp(false);
              setStepUpCode("");
              setStepUpError(null);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="mfa-step-up-title"
            className="w-full max-w-lg rounded-xl border border-amber-300 bg-amber-50 p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div
                  id="mfa-step-up-title"
                  className="text-xs font-black tracking-widest text-amber-950"
                >
                  MFA STEP-UP REQUIRED
                </div>
                <div className="mt-2 text-sm font-bold text-amber-900/80">
                  {stepUpMessage} Verify here, then click the same sensitive
                  action again.
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowStepUp(false);
                  setStepUpCode("");
                  setStepUpError(null);
                }}
                disabled={pendingId === "step-up"}
                className="rounded-md px-2 py-1 text-xs font-black tracking-widest text-amber-950 disabled:opacity-50"
              >
                CLOSE
              </button>
            </div>

            {stepUpError && (
              <div className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
                {stepUpError}
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <input
                value={stepUpCode}
                onChange={(event) => setStepUpCode(event.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                autoFocus
                className="min-h-11 w-44 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-black tracking-widest"
              />
              <button
                type="button"
                onClick={verifyStepUp}
                disabled={pendingId === "step-up" || stepUpCode.trim().length < 6}
                className="min-h-11 rounded-md px-4 py-2 text-xs font-black tracking-widest disabled:opacity-50"
                style={{ background: BRAND.black, color: "white" }}
              >
                {pendingId === "step-up" ? "VERIFYING..." : "VERIFY MFA"}
              </button>
              <a
                href="/admin/workspace?modal=security"
                className="flex min-h-11 items-center rounded-md border border-stone-300 bg-white px-4 py-2 text-xs font-black tracking-widest"
              >
                MFA SETUP
              </a>
            </div>
          </div>
        </div>
      )}

      {pendingOwnerChanges.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <div className="text-xs font-black tracking-widest text-amber-900">
            PENDING OWNER CHANGES
          </div>
          <div className="mt-1 text-sm font-bold text-amber-900/75">
            These changes are delayed for 24 hours and can be cancelled before execution.
          </div>
          <div className="mt-3 space-y-2">
            {pendingOwnerChanges.map(({ user, pending }) => (
              <div
                key={pending.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-sm"
              >
                <div>
                  <div className="font-black">
                    {ownerChangeActionLabel(pending.action)} · {user.email}
                  </div>
                  <div className="text-xs font-bold text-stone-500">
                    Eligible after {new Date(pending.executesAt).toLocaleString()}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => cancelOwnerChange(pending.id)}
                  disabled={pendingId === `owner-change:${pending.id}`}
                  className="rounded-md border border-stone-300 px-3 py-2 text-xs font-black tracking-widest disabled:opacity-50"
                >
                  CANCEL
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3 opacity-100" aria-busy={isRefreshing}>
        {users.map((user) => {
          const draft = drafts[user.id] ?? userToDraft(user, outlets);
          const isBusy = pendingId?.startsWith(user.id) ?? false;
          const isSiteAdminAccount = user.siteRole === "OWNER" || user.siteRole === "ADMIN";
          const canEditUser = canManageSiteAdminAccounts || !isSiteAdminAccount;

          return (
            <section
              key={user.id}
              className="rounded-xl border border-stone-200 bg-white p-5"
            >
              <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr_1fr_auto]">
                <div>
                  <div className="flex items-start gap-3">
                    <RoleIcon kind={roleIconKindForUser(user)} />
                    <div>
                      <div className="display text-xl leading-none">{user.email}</div>
                      <div className="mt-2 text-xs font-black tracking-widest opacity-50">
                        {siteRoleSummary(user)}
                      </div>
                      <div className="mt-1 text-xs font-bold opacity-60">
                        {outletRoleSummary(user)}
                      </div>
                      <div className="mt-1 text-xs font-bold opacity-60">
                        MFA: {user.mfaEnabledAt ? "Enabled" : "Not enrolled"}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 text-xs opacity-60">
                    {user.activeSessionCount} active session
                    {user.activeSessionCount === 1 ? "" : "s"}
                  </div>
                </div>

                <Input
                  label="Display name"
                  value={draft.displayName}
                  disabled={!canEditUser}
                  onChange={(value) =>
                    setDrafts((prev) => ({
                      ...prev,
                      [user.id]: { ...draft, displayName: value },
                    }))
                  }
                />

                <SiteRoleSelect
                  value={draft.siteRole}
                  allowSiteAdminRoles={canManageSiteAdminAccounts}
                  disabled={!canEditUser}
                  onChange={(siteRole) =>
                    setDrafts((prev) => ({
                      ...prev,
                      [user.id]: {
                        ...draft,
                        siteRole,
                      },
                    }))
                  }
                />

                <label className="flex items-center gap-2 self-end text-sm font-bold">
                  <input
                    type="checkbox"
                    checked={draft.isActive}
                    disabled={!canEditUser}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [user.id]: { ...draft, isActive: e.target.checked },
                      }))
                    }
                    className="h-4 w-4"
                  />
                  Active
                </label>
              </div>

              {!canEditUser && (
                <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                  Only owners can edit Owner or Admin accounts.
                </div>
              )}

              {user.pendingOwnerChanges.length > 0 && (
                <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
                  Pending owner change:{" "}
                  {user.pendingOwnerChanges
                    .map((pending) => ownerChangeActionLabel(pending.action))
                    .join(", ")}
                  . Eligible after{" "}
                  {new Date(user.pendingOwnerChanges[0]!.executesAt).toLocaleString()}.
                </div>
              )}

              {canEditUser && draft.siteRole !== "OWNER" && (
                <OutletRoleControls
                  outlets={outlets}
                  values={draft.outletRoles}
                  onChange={(outletId, role) =>
                    setDrafts((prev) => ({
                      ...prev,
                      [user.id]: {
                        ...draft,
                        outletRoles: { ...draft.outletRoles, [outletId]: role },
                      },
                    }))
                  }
                />
              )}

              {(user.accountType === "STAFF" || user.accountType === "ADMIN") && (
                <div className="mt-4 rounded-lg border border-stone-200 bg-stone-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-black tracking-widest opacity-60">
                      COUNTER / KITCHEN ACCESS
                    </div>
                    <OperatorReadinessBadge user={user} />
                  </div>
                  <div className="mt-1 text-xs text-stone-600">
                    {canManageSiteAdminAccounts
                      ? "Owner controls. Removing a surface signs out any operator currently active on a device of that surface."
                      : "Only an Owner can change these grants or reset the operational PIN."}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    {(["COUNTER", "KITCHEN"] as const).map((surface) => {
                      const granted = user.surfaceAccess.includes(surface);
                      const disabled =
                        !canManageSiteAdminAccounts ||
                        isBusy ||
                        pendingId === `${user.id}:surface`;
                      return (
                        <label
                          key={surface}
                          className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-black tracking-widest ${
                            granted
                              ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                              : "border-stone-300 bg-white text-stone-600"
                          } ${disabled ? "opacity-60" : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={granted}
                            disabled={disabled}
                            onChange={(event) => {
                              const next = new Set<"COUNTER" | "KITCHEN">(
                                user.surfaceAccess
                              );
                              if (event.target.checked) next.add(surface);
                              else next.delete(surface);
                              updateSurfaceAccess(user, [...next]);
                            }}
                          />
                          {surface}
                        </label>
                      );
                    })}
                    <span className="text-xs font-bold text-stone-600">
                      Operational PIN: {user.operationalPinSet ? "set" : "not set"}
                    </span>
                  </div>
                  {revealedPins[user.id] && (
                    <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-black tracking-widest text-amber-900">
                      NEW PIN (shown once): {revealedPins[user.id]}
                      <button
                        type="button"
                        onClick={() =>
                          setRevealedPins((prev) => {
                            const next = { ...prev };
                            delete next[user.id];
                            return next;
                          })
                        }
                        className="ml-3 rounded-md border border-amber-400 bg-white px-2 py-1 text-[10px] font-black tracking-widest text-amber-900 hover:bg-amber-100"
                      >
                        DISMISS
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <PasswordInput
                  label="New password"
                  value={resetPasswords[user.id] ?? ""}
                  onChange={(e) =>
                    setResetPasswords((prev) => ({
                      ...prev,
                      [user.id]: e,
                    }))
                  }
                  placeholder={`New password (${passwordPolicy})`}
                  compact
                  disabled={!canEditUser}
                  visible={visiblePasswords[user.id] ?? false}
                  onToggleVisible={() =>
                    setVisiblePasswords((prev) => ({
                      ...prev,
                      [user.id]: !prev[user.id],
                    }))
                  }
                />
                <button
                  type="button"
                  onClick={() => revokeSessions(user)}
                  disabled={isBusy || !canEditUser}
                  className="rounded-md border border-stone-300 px-4 py-2 text-xs font-black tracking-widest disabled:opacity-50"
                >
                  REVOKE SESSIONS
                </button>
                <button
                  type="button"
                  onClick={() => resetPassword(user)}
                  disabled={isBusy || !canEditUser}
                  className="rounded-md border border-stone-300 px-4 py-2 text-xs font-black tracking-widest disabled:opacity-50"
                >
                  RESET PASSWORD
                </button>
                <button
                  type="button"
                  onClick={() => resetMfa(user)}
                  disabled={isBusy || !canEditUser || !user.mfaEnabledAt}
                  title={
                    user.mfaEnabledAt
                      ? "Reset this user's MFA enrollment"
                      : "MFA is not enrolled for this user"
                  }
                  className="rounded-md border border-stone-300 px-4 py-2 text-xs font-black tracking-widest disabled:opacity-50"
                >
                  RESET MFA
                </button>
                {(user.accountType === "STAFF" || user.accountType === "ADMIN") && (
                  <button
                    type="button"
                    onClick={() => resetOperationalPin(user)}
                    disabled={
                      isBusy ||
                      !canManageSiteAdminAccounts ||
                      pendingId === `${user.id}:pin`
                    }
                    title={
                      canManageSiteAdminAccounts
                        ? "Generate a new operational PIN; any active counter/kitchen sessions for this user will be cleared."
                        : "Only an Owner can reset operational PINs in v1."
                    }
                    className="rounded-md border border-stone-300 px-4 py-2 text-xs font-black tracking-widest disabled:opacity-50"
                  >
                    {pendingId === `${user.id}:pin` ? "RESETTING..." : "RESET PIN"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => updateUser(user)}
                  disabled={isBusy || !canEditUser}
                  className="rounded-md px-4 py-2 text-xs font-black tracking-widest disabled:opacity-50"
                  style={{ background: BRAND.black, color: "white" }}
                >
                  {pendingId === user.id ? "SAVING..." : "SAVE"}
                </button>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function OperatorReadinessBadge({ user }: { user: AdminUserRow }) {
  // Only meaningful for STAFF/ADMIN with at least one MANAGER/OPERATOR
  // outlet role. VIEWER-only users have no operator setup to complete.
  const hasOperatorRole = user.outletRoles.some(
    (row) => row.role === "MANAGER" || row.role === "OPERATOR"
  );
  if (!hasOperatorRole) {
    return (
      <span className="rounded-md bg-stone-200 px-2 py-1 text-[10px] font-black tracking-widest text-stone-600">
        VIEWER
      </span>
    );
  }

  // Per-surface + per-PIN pills. Plan note 2026-04-30: a single "READY"
  // badge over-claims because the UI doesn't know which surfaces this
  // user's outlets actually require. Pre-flight owns that deeper truth;
  // here we just show the literal grant state so the Owner reads it
  // directly. Runtime safety doesn't depend on this badge — incomplete
  // operators still cannot sign in.
  const counter = user.surfaceAccess.includes("COUNTER");
  const kitchen = user.surfaceAccess.includes("KITCHEN");
  const pin = user.operationalPinSet;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <ReadinessPill label="COUNTER" granted={counter} />
      <ReadinessPill label="KITCHEN" granted={kitchen} />
      <ReadinessPill label="PIN" granted={pin} />
    </div>
  );
}

function ReadinessPill({
  label,
  granted,
}: {
  label: string;
  granted: boolean;
}) {
  const className = granted
    ? "rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-[10px] font-black tracking-widest text-emerald-800"
    : "rounded-md border border-stone-300 bg-white px-2 py-1 text-[10px] font-black tracking-widest text-stone-500";
  const title = granted
    ? `${label} grant is set`
    : `${label} not granted yet — operator cannot sign in for this until set`;
  return (
    <span className={className} title={title}>
      {label} {granted ? "✓" : "✗"}
    </span>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "password";
  disabled?: boolean;
}) {
  return (
    <label className="block text-[10px] font-black tracking-widest opacity-70">
      {label.toUpperCase()}
      <input
        type={type}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 w-full rounded-md border border-stone-300 px-3 py-2 text-sm font-bold disabled:bg-stone-100 disabled:text-stone-500"
      />
    </label>
  );
}

function PasswordInput({
  label,
  value,
  onChange,
  visible,
  onToggleVisible,
  placeholder,
  compact = false,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggleVisible: () => void;
  placeholder?: string;
  compact?: boolean;
  disabled?: boolean;
}) {
  const inputId = `password-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <label
      className={`block text-[10px] font-black tracking-widest opacity-70 ${
        compact ? "min-w-[280px]" : ""
      }`}
      htmlFor={inputId}
    >
      <span className={compact ? "sr-only" : ""}>{label.toUpperCase()}</span>
      <span className="relative mt-2 block">
        <input
          id={inputId}
          type={visible ? "text" : "password"}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-md border border-stone-300 px-3 py-2 pr-11 text-sm font-bold disabled:bg-stone-100 disabled:text-stone-500"
        />
        <button
          type="button"
          onClick={onToggleVisible}
          disabled={disabled}
          aria-label={visible ? "Hide password" : "Show password"}
          title={visible ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-stone-500 hover:text-stone-900 disabled:opacity-40"
        >
          {visible ? (
            <EyeOff size={17} strokeWidth={2.25} aria-hidden />
          ) : (
            <Eye size={17} strokeWidth={2.25} aria-hidden />
          )}
        </button>
      </span>
    </label>
  );
}

type RoleSelectOption<T extends string> = {
  value: T;
  label: string;
  description: string;
  icon: RoleIconKind;
};

function RoleSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: RoleSelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? options[0];

  return (
    <div
      className="relative block text-[10px] font-black tracking-widest opacity-100"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget as Node | null;
        if (!event.currentTarget.contains(nextTarget)) setOpen(false);
      }}
    >
      <div className="opacity-70">{label.toUpperCase()}</div>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="mt-2 flex w-full items-center justify-between gap-3 rounded-md border border-stone-300 bg-white px-3 py-2 text-left text-sm font-bold disabled:bg-stone-100 disabled:text-stone-500"
      >
        <span className="flex min-w-0 items-center gap-2">
          <RoleIcon kind={selected.icon} />
          <span className="truncate">{selected.label}</span>
        </span>
        <span className="text-stone-500" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute z-30 mt-2 w-full overflow-hidden rounded-lg border border-stone-200 bg-white p-1 shadow-xl"
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left ${
                option.value === value ? "bg-yellow-50" : "hover:bg-stone-50"
              }`}
            >
              <RoleIcon kind={option.icon} />
              <span className="min-w-0">
                <span className="block text-sm font-black normal-case tracking-normal">
                  {option.label}
                </span>
                <span className="block text-[11px] font-bold normal-case tracking-normal text-stone-500">
                  {option.description}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SiteRoleSelect({
  value,
  onChange,
  allowSiteAdminRoles,
  disabled = false,
}: {
  value: AdminSiteRoleValue | "";
  onChange: (value: AdminSiteRoleValue | "") => void;
  allowSiteAdminRoles: boolean;
  disabled?: boolean;
}) {
  const options: RoleSelectOption<AdminSiteRoleValue | "">[] = [
    {
      value: "",
      label: "Staff",
      description: "Uses one or more outlet roles.",
      icon: "staff-account",
    },
  ];
  if (allowSiteAdminRoles) {
    options.push(
      {
        value: "OWNER",
        label: "Owner",
        description: "Full site access and user management.",
        icon: "owner",
      },
      {
        value: "ADMIN",
        label: "Admin",
        description: "Site admin without owner-level control.",
        icon: "admin",
      }
    );
  } else if (value === "OWNER") {
    options.push({
      value: "OWNER",
      label: "Owner",
      description: "Owner-only account.",
      icon: "owner",
    });
  } else if (value === "ADMIN") {
    options.push({
      value: "ADMIN",
      label: "Admin",
      description: "Owner-managed admin account.",
      icon: "admin",
    });
  }

  return (
    <RoleSelect
      label="Account type"
      value={value}
      onChange={onChange}
      disabled={disabled}
      options={options}
    />
  );
}

function OutletRoleSelect({
  outletName,
  value,
  onChange,
}: {
  outletName: string;
  value: AdminOutletRoleValue | "";
  onChange: (value: AdminOutletRoleValue | "") => void;
}) {
  return (
    <RoleSelect
      label={outletName}
      value={value}
      onChange={onChange}
      options={[
        {
          value: "",
          label: "No access",
          description: "Cannot access this outlet.",
          icon: "none",
        },
        {
          value: "MANAGER",
          label: "Manager",
          description: "Can manage this outlet.",
          icon: "manager",
        },
        {
          value: "OPERATOR",
          label: "Operator",
          description: "Can operate this outlet.",
          icon: "staff",
        },
        {
          value: "VIEWER",
          label: "Viewer",
          description: "Read-only outlet access.",
          icon: "viewer",
        },
      ]}
    />
  );
}

function OutletRoleControls({
  outlets,
  values,
  onChange,
}: {
  outlets: AdminOutletRow[];
  values: Record<string, AdminOutletRoleValue | "">;
  onChange: (outletId: string, role: AdminOutletRoleValue | "") => void;
}) {
  return (
    <div className="mt-4 grid gap-3 md:grid-cols-2">
      {outlets.map((outlet) => (
        <div
          key={outlet.id}
          className="rounded-md border border-stone-200 bg-stone-50 p-3"
        >
          <OutletRoleSelect
            outletName={outlet.name}
            value={values[outlet.id] ?? ""}
            onChange={(role) => onChange(outlet.id, role)}
          />
        </div>
      ))}
    </div>
  );
}
