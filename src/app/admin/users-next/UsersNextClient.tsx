"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  CookingPot,
  Crown,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Plus,
  Search,
  ShieldCheck,
  Store,
  Monitor,
  UserRound,
  X,
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

type RoleIconKind =
  | "owner"
  | "admin"
  | "staff-account"
  | "manager"
  | "staff"
  | "viewer"
  | "none";

type AccountFilter = "all" | "owner" | "admin" | "staff";
type AccountKind = Exclude<AccountFilter, "all">;
type NotificationHistoryItem = {
  id: string;
  tone: "error" | "success";
  message: string;
  createdAt: number;
};

const NOTIFICATION_HISTORY_STORAGE_KEY = "rushbite.admin.usersNext.notificationHistory";

const roleColors = {
  owner: {
    avatar: "bg-amber-400 text-stone-950",
    badge: "bg-amber-100 text-amber-800 border-amber-200",
    ring: "border-amber-300 bg-amber-100 text-amber-700",
  },
  admin: {
    avatar: "bg-red-500 text-white",
    badge: "bg-red-50 text-red-700 border-red-200",
    ring: "border-red-200 bg-red-50 text-red-700",
  },
  staff: {
    avatar: "bg-orange-500 text-white",
    badge: "bg-orange-50 text-orange-700 border-orange-200",
    ring: "border-orange-200 bg-orange-50 text-orange-700",
  },
  manager: {
    avatar: "bg-sky-500 text-white",
    badge: "bg-sky-50 text-sky-700 border-sky-200",
    ring: "border-sky-300 bg-sky-100 text-sky-700",
  },
  operator: {
    avatar: "bg-emerald-500 text-white",
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
    ring: "border-emerald-300 bg-emerald-100 text-emerald-700",
  },
  viewer: {
    avatar: "bg-stone-500 text-white",
    badge: "bg-stone-100 text-stone-700 border-stone-200",
    ring: "border-stone-300 bg-stone-100 text-stone-700",
  },
  none: {
    ring: "border-stone-200 bg-stone-50 text-stone-400",
  },
} as const;

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
  const outletRoles: Record<string, AdminOutletRoleValue | ""> = {};
  for (const outlet of outlets) outletRoles[outlet.id] = "";
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

function roleLabel(role: AdminOutletRoleValue) {
  if (role === "MANAGER") return "Manager";
  if (role === "OPERATOR") return "Operator";
  return "Viewer";
}

function accountLabel(user: Pick<AdminUserRow, "siteRole">) {
  if (user.siteRole === "OWNER") return "Owner";
  if (user.siteRole === "ADMIN") return "Admin";
  return "Staff";
}

function filterForUser(user: AdminUserRow): AccountKind {
  if (user.siteRole === "OWNER") return "owner";
  if (user.siteRole === "ADMIN") return "admin";
  return "staff";
}

function avatarClassForUser(user: AdminUserRow) {
  if (user.siteRole === "OWNER") return roleColors.owner.avatar;
  if (user.siteRole === "ADMIN") return roleColors.admin.avatar;
  if (user.outletRoles.some((role) => role.role === "MANAGER")) {
    return roleColors.manager.avatar;
  }
  if (user.outletRoles.some((role) => role.role === "OPERATOR")) {
    return roleColors.operator.avatar;
  }
  if (user.outletRoles.some((role) => role.role === "VIEWER")) {
    return roleColors.viewer.avatar;
  }
  return roleColors.staff.avatar;
}

function outletRoleSummary(user: AdminUserRow) {
  if (user.siteRole === "OWNER") return "All outlets";
  if (user.siteRole === "ADMIN") return "Site-wide admin";
  if (user.outletRoles.length === 0) return "No outlet access";
  return user.outletRoles
    .map((role) => `${role.outletName} · ${roleLabel(role.role)}`)
    .join(" / ");
}

function rowScopeSummary(user: AdminUserRow) {
  if (user.siteRole === "OWNER") return "All outlets";
  if (user.siteRole === "ADMIN") return "Site-wide admin";
  if (user.outletRoles.length === 0) return "No outlet access";
  if (user.outletRoles.length === 1) {
    const role = user.outletRoles[0]!;
    return `${role.outletName} · ${roleLabel(role.role)}`;
  }
  const uniqueRoles = [...new Set(user.outletRoles.map((role) => role.role))];
  if (uniqueRoles.length === 1) {
    return `${roleLabel(uniqueRoles[0]!)} · ${user.outletRoles.length} outlets`;
  }
  return `Mixed roles · ${user.outletRoles.length} outlets`;
}

function initialsFor(user: AdminUserRow) {
  const name = user.displayName.trim();
  if (name) {
    const parts = name.split(/\s+/);
    return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? parts[0]?.[1] ?? ""}`.toUpperCase();
  }
  return user.email.slice(0, 2).toUpperCase();
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
  const router = useRouter();
  const [users, setUsers] = useState(initialUsers);
  const [drafts, setDrafts] = useState<Record<string, UserDraft>>(() =>
    Object.fromEntries(initialUsers.map((user) => [user.id, userToDraft(user, outlets)]))
  );
  const [resetPasswords, setResetPasswords] = useState<Record<string, string>>({});
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({});
  const [revealedPins, setRevealedPins] = useState<Record<string, string>>({});
  const [createForm, setCreateForm] = useState(() => blankCreateForm(outlets));
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<AccountFilter>("all");
  const [stepUpCode, setStepUpCode] = useState("");
  const [showStepUp, setShowStepUp] = useState(false);
  const [stepUpMessage, setStepUpMessage] = useState(
    "Enter your MFA code before this sensitive action."
  );
  const [stepUpError, setStepUpError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notificationHistory, setNotificationHistory] = useState<
    NotificationHistoryItem[]
  >([]);
  const [notificationHistoryLoaded, setNotificationHistoryLoaded] = useState(false);
  const [isRefreshing, startRefresh] = useTransition();

  const stats = useMemo(() => {
    const owner = users.filter((user) => user.siteRole === "OWNER").length;
    const admin = users.filter((user) => user.siteRole === "ADMIN").length;
    const staff = users.length - owner - admin;
    const mfa = users.filter((user) => user.mfaEnabledAt).length;
    return { total: users.length, owner, admin, staff, mfa };
  }, [users]);

  const filteredUsers = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return users.filter((user) => {
      const matchesFilter = filter === "all" || filterForUser(user) === filter;
      const matchesSearch =
        !needle ||
        user.email.toLowerCase().includes(needle) ||
        user.displayName.toLowerCase().includes(needle) ||
        outletRoleSummary(user).toLowerCase().includes(needle);
      return matchesFilter && matchesSearch;
    });
  }, [filter, search, users]);

  const allVisibleExpanded =
    filteredUsers.length > 0 && filteredUsers.every((user) => expandedIds.has(user.id));

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
    if (!showStepUp && !createOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && pendingId === null) {
        setShowStepUp(false);
        setStepUpCode("");
        setStepUpError(null);
        setCreateOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [createOpen, pendingId, showStepUp]);

  useEffect(() => {
    if (!notice && !error) return;
    const timeout = window.setTimeout(() => {
      setNotice(null);
      setError(null);
    }, error ? 15000 : 12000);
    return () => window.clearTimeout(timeout);
  }, [error, notice]);

  useEffect(() => {
    const message = error ?? notice;
    if (!message) return;
    const tone: NotificationHistoryItem["tone"] = error ? "error" : "success";
    const createdAt = Date.now();
    setNotificationHistory((prev) => [
      { id: `${createdAt}-${tone}`, tone, message, createdAt },
      ...prev.filter((item) => item.message !== message || item.tone !== tone),
    ].slice(0, 5));
  }, [error, notice]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(NOTIFICATION_HISTORY_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          setNotificationHistory(
            parsed
              .filter(isNotificationHistoryItem)
              .sort((a, b) => b.createdAt - a.createdAt)
              .slice(0, 5)
          );
        }
      }
    } catch {
      // Storage is best-effort only.
    } finally {
      setNotificationHistoryLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!notificationHistoryLoaded) return;
    try {
      window.localStorage.setItem(
        NOTIFICATION_HISTORY_STORAGE_KEY,
        JSON.stringify(notificationHistory)
      );
    } catch {
      // Storage is best-effort only.
    }
  }, [notificationHistory, notificationHistoryLoaded]);

  const clearMessages = () => {
    setError(null);
    setNotice(null);
  };

  const handleSensitiveActionError = async (response: Response, fallback: string) => {
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

    const email = createForm.email.trim();
    const displayName = createForm.displayName.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Enter a valid email address before creating the user.");
      return;
    }
    if (!displayName) {
      setError("Enter a display name before creating the user.");
      return;
    }

    setPendingId("create");

    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        displayName,
        password: createForm.password,
        accountType: createForm.siteRole || "STAFF",
        siteRole: createForm.siteRole || null,
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
    const createdAccountLabel =
      createForm.siteRole === "OWNER"
        ? "Owner"
        : createForm.siteRole === "ADMIN"
          ? "Admin"
          : "Staff";
    setCreateForm(blankCreateForm(outlets));
    setCreateOpen(false);
    setNotice(`${createdAccountLabel} user created.`);
    refresh();
  };

  const updateUser = async (user: AdminUserRow) => {
    clearMessages();
    const draft = drafts[user.id];
    setPendingId(user.id);
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
    const updateBody = (await response.clone().json().catch(() => null)) as
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

  const setAllVisibleExpanded = () => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleExpanded) {
        for (const user of filteredUsers) next.delete(user.id);
      } else {
        for (const user of filteredUsers) next.add(user.id);
      }
      return next;
    });
  };

  return (
    <div className="max-w-[1380px]">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-5xl leading-none tracking-tight">Users</h1>
          <p className="mt-2 text-sm text-stone-600">
            Manage <span className="font-black text-stone-950">owners, admins, and staff</span> -
            roles, sessions, MFA, and operational access.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-black tracking-wide shadow-sm transition hover:brightness-105"
          style={{ background: BRAND.yellow, color: BRAND.black }}
        >
          <Plus size={17} strokeWidth={3} aria-hidden />
          CREATE USER
        </button>
      </div>

      <div className="mb-6 grid gap-3 xl:grid-cols-[1.25fr_1fr_1fr_1fr_1fr] md:grid-cols-3 grid-cols-2">
        <StatCard
          dark
          label="Total users"
          value={stats.total}
          bars={[
            { width: stats.total ? (stats.owner / stats.total) * 100 : 0, color: "#f59e0b" },
            { width: stats.total ? (stats.admin / stats.total) * 100 : 0, color: "#ef4444" },
            { width: stats.total ? (stats.staff / stats.total) * 100 : 0, color: "#f97316" },
          ]}
        />
        <StatCard label="Owners" value={stats.owner} small={`of ${stats.total}`} dot="#f59e0b" />
        <StatCard label="Admins" value={stats.admin} small={`of ${stats.total}`} dot="#ef4444" />
        <StatCard label="Staff" value={stats.staff} small={`of ${stats.total}`} dot="#f97316" />
        <StatCard label="MFA enabled" value={stats.mfa} small={`/ ${stats.total}`} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="relative min-w-[260px] flex-1">
          <Search
            size={17}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400"
            aria-hidden
          />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by email, name, outlet..."
            className="h-12 w-full rounded-xl border border-stone-200 bg-white pl-11 pr-4 text-sm font-bold outline-none transition focus:border-stone-950 focus:ring-4 focus:ring-stone-950/5"
          />
        </label>
        <div className="flex rounded-xl border border-stone-200 bg-white p-1">
          {[
            ["all", "All", stats.total],
            ["owner", "Owner", stats.owner],
            ["admin", "Admin", stats.admin],
            ["staff", "Staff", stats.staff],
          ].map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key as AccountFilter)}
              className={`rounded-lg px-3 py-2 text-xs font-black ${
                filter === key
                  ? "bg-stone-950 text-white"
                  : "text-stone-600 hover:text-stone-950"
              }`}
            >
              {label} <span className="opacity-60">{count}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={setAllVisibleExpanded}
          className="inline-flex h-12 items-center gap-2 rounded-xl border border-stone-200 bg-white px-4 text-xs font-black tracking-widest text-stone-600 hover:border-stone-950 hover:text-stone-950"
        >
          <ChevronDown size={15} aria-hidden />
          {allVisibleExpanded ? "COLLAPSE ALL" : "EXPAND ALL"}
        </button>
      </div>

      <ToastStack
        error={error}
        notice={notice}
        history={notificationHistory}
        onDismissError={() => setError(null)}
        onDismissNotice={() => setNotice(null)}
        onClearHistory={() => setNotificationHistory([])}
      />

      {pendingOwnerChanges.length > 0 && (
        <div className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <div className="text-xs font-black tracking-widest text-amber-900">
            PENDING OWNER CHANGES
          </div>
          <div className="mt-1 text-sm font-bold text-amber-900/75">
            Delayed for 24 hours and cancellable before execution.
          </div>
          <div className="mt-3 space-y-2">
            {pendingOwnerChanges.map(({ user, pending }) => (
              <div
                key={pending.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 text-sm"
              >
                <div>
                  <div className="font-black">
                    {ownerChangeActionLabel(pending.action)} - {user.email}
                  </div>
                  <div className="text-xs font-bold text-stone-500">
                    Eligible after {new Date(pending.executesAt).toLocaleString()}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => cancelOwnerChange(pending.id)}
                  disabled={pendingId === `owner-change:${pending.id}`}
                  className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-black tracking-widest disabled:opacity-50"
                >
                  CANCEL
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2" aria-busy={isRefreshing}>
        {filteredUsers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-12 text-center">
            <div className="text-xl font-black">No users match.</div>
            <div className="mt-1 text-sm font-bold text-stone-500">
              Try a different search or filter.
            </div>
          </div>
        ) : (
          filteredUsers.map((user) => {
            const expanded = expandedIds.has(user.id);
            const draft = drafts[user.id] ?? userToDraft(user, outlets);
            const isBusy = pendingId?.startsWith(user.id) ?? false;
            const isSiteAdminAccount = user.siteRole === "OWNER" || user.siteRole === "ADMIN";
            const canEditUser = canManageSiteAdminAccounts || !isSiteAdminAccount;
            const accountKind = filterForUser(user);

            return (
              <section
                key={user.id}
                className={`overflow-visible rounded-2xl border bg-white transition ${
                  expanded
                    ? "border-stone-950 shadow-[0_12px_32px_rgba(20,20,20,0.08)]"
                    : "border-stone-200 hover:border-stone-300"
                }`}
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpandedIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(user.id)) next.delete(user.id);
                      else next.add(user.id);
                      return next;
                    })
                  }
                  className="grid w-full grid-cols-[auto_1.4fr_1fr_1fr_auto_auto] items-center gap-5 px-5 py-4 text-left max-xl:grid-cols-[auto_1fr_auto] max-xl:[&_.optional-summary]:hidden"
                >
                  <span
                    className={`flex h-12 w-12 items-center justify-center rounded-full text-sm font-black ${
                      avatarClassForUser(user)
                    }`}
                  >
                    {initialsFor(user)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-base font-black">
                      {user.email}
                    </span>
                    <span className="block truncate text-sm font-serif italic text-stone-500">
                      {user.displayName}
                    </span>
                  </span>
                  <span className="optional-summary flex flex-wrap items-center gap-2">
                    <RoleBadge kind={accountKind} label={accountLabel(user)} />
                    {user.outletRoles[0] && (
                      <RoleBadge
                        kind={
                          user.outletRoles.some((role) => role.role === "MANAGER")
                            ? "manager"
                            : user.outletRoles.some((role) => role.role === "OPERATOR")
                              ? "operator"
                              : "viewer"
                        }
                        label={
                          user.outletRoles.some((role) => role.role === "MANAGER")
                            ? "Manager"
                            : user.outletRoles.some((role) => role.role === "OPERATOR")
                              ? "Operator"
                              : "Viewer"
                        }
                      />
                    )}
                  </span>
                  <span className="optional-summary min-w-0 text-xs font-bold text-stone-600">
                    <span className="block truncate">{rowScopeSummary(user)}</span>
                    <span className="block text-stone-400">
                      {user.activeSessionCount} active session
                      {user.activeSessionCount === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="optional-summary flex flex-wrap gap-2">
                    <StatusPill active={user.isActive} />
                    <MfaPill enabled={Boolean(user.mfaEnabledAt)} />
                  </span>
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
                      expanded ? "rotate-180 bg-stone-950 text-white" : "bg-stone-100 text-stone-500"
                    }`}
                  >
                    <ChevronDown size={16} aria-hidden />
                  </span>
                </button>

                {expanded && (
                  <div className="border-t border-stone-200 bg-gradient-to-b from-stone-50 to-white p-5">
                    {!canEditUser && (
                      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                        Only owners can edit Owner or Admin accounts.
                      </div>
                    )}

                    {user.pendingOwnerChanges.length > 0 && (
                      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
                        Pending owner change:{" "}
                        {user.pendingOwnerChanges
                          .map((pending) => ownerChangeActionLabel(pending.action))
                          .join(", ")}
                        . Eligible after{" "}
                        {new Date(user.pendingOwnerChanges[0]!.executesAt).toLocaleString()}.
                      </div>
                    )}

                    <div className="grid gap-4 xl:grid-cols-3 md:grid-cols-2">
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
                            [user.id]: { ...draft, siteRole },
                          }))
                        }
                      />
                      <PasswordInput
                        inputId={`users-next-password-${user.id}`}
                        label="New password"
                        value={resetPasswords[user.id] ?? ""}
                        onChange={(value) =>
                          setResetPasswords((prev) => ({
                            ...prev,
                            [user.id]: value,
                          }))
                        }
                        placeholder={`New password (${passwordPolicy})`}
                        disabled={!canEditUser}
                        visible={visiblePasswords[user.id] ?? false}
                        onToggleVisible={() =>
                          setVisiblePasswords((prev) => ({
                            ...prev,
                            [user.id]: !prev[user.id],
                          }))
                        }
                      />
                    </div>

                    {canEditUser && draft.siteRole !== "OWNER" && (
                      <div className="mt-4 rounded-xl border border-stone-200 bg-white p-4">
                        <div className="mb-3 text-xs font-black tracking-widest text-stone-500">
                          OUTLET ROLES
                        </div>
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
                      </div>
                    )}

                    {(user.accountType === "STAFF" || user.accountType === "ADMIN") && (
                      <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="text-xs font-black tracking-widest text-stone-500">
                              COUNTER / KITCHEN ACCESS
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm font-bold text-stone-600">
                              <span className="rounded-md bg-amber-100 px-2 py-1 text-xs font-black tracking-widest text-amber-700">
                                OWNER ONLY
                              </span>
                              <span>
                                Removing a surface signs out any operator currently active on a device of that surface.
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="mt-5 grid gap-4 lg:grid-cols-2">
                          {(["COUNTER", "KITCHEN"] as const).map((surface) => {
                            const granted = user.surfaceAccess.includes(surface);
                            const disabled =
                              !canManageSiteAdminAccounts ||
                              isBusy ||
                              pendingId === `${user.id}:surface`;
                            return (
                              <SurfaceAccessCard
                                key={surface}
                                surface={surface}
                                granted={granted}
                                disabled={disabled}
                                onToggle={() => {
                                  const next = new Set<"COUNTER" | "KITCHEN">(
                                    user.surfaceAccess
                                  );
                                  if (granted) next.delete(surface);
                                  else next.add(surface);
                                  updateSurfaceAccess(user, [...next]);
                                }}
                              />
                            );
                          })}
                        </div>
                        <div className="mt-5 rounded-2xl border border-dashed border-stone-300 bg-stone-50 p-4">
                          <div className="flex flex-wrap items-center gap-4">
                            <span className="flex h-14 w-14 items-center justify-center rounded-xl border border-stone-200 bg-white text-stone-700">
                              <KeyRound size={24} strokeWidth={2.5} aria-hidden />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-black tracking-widest text-stone-500">
                                OPERATIONAL PIN
                              </div>
                              <div
                                className={`mt-1 flex items-center gap-2 text-lg font-black ${
                                  user.operationalPinSet ? "text-emerald-700" : "text-amber-600"
                                }`}
                              >
                                <span className="h-2.5 w-2.5 rounded-full bg-current" />
                                {user.operationalPinSet ? "PIN set" : "Not set"}
                              </div>
                            </div>
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
                                  ? "Generate a new operational PIN."
                                  : "Only an Owner can reset operational PINs in v1."
                              }
                              className="inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-black tracking-wide text-stone-950 disabled:opacity-50"
                              style={{ background: BRAND.yellow }}
                            >
                              <Plus size={17} strokeWidth={3} aria-hidden />
                              {pendingId === `${user.id}:pin`
                                ? "Resetting..."
                                : user.operationalPinSet
                                  ? "Reset PIN"
                                  : "Set PIN"}
                            </button>
                          </div>
                        </div>
                        {revealedPins[user.id] && (
                          <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-black tracking-widest text-amber-900">
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
                              className="ml-3 rounded-lg border border-amber-400 bg-white px-2 py-1 text-[10px] font-black tracking-widest text-amber-900 hover:bg-amber-100"
                            >
                              DISMISS
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-stone-200 pt-4">
                      <label className="mr-auto inline-flex items-center gap-2 text-sm font-black">
                        <input
                          type="checkbox"
                          checked={draft.isActive}
                          disabled={!canEditUser}
                          onChange={(event) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [user.id]: { ...draft, isActive: event.target.checked },
                            }))
                          }
                          className="h-4 w-4"
                        />
                        Account active
                      </label>
                      <ActionButton
                        onClick={() => revokeSessions(user)}
                        disabled={isBusy || !canEditUser}
                      >
                        Revoke sessions
                      </ActionButton>
                      <ActionButton
                        onClick={() => resetPassword(user)}
                        disabled={isBusy || !canEditUser}
                      >
                        Reset password
                      </ActionButton>
                      <ActionButton
                        onClick={() => resetMfa(user)}
                        disabled={isBusy || !canEditUser || !user.mfaEnabledAt}
                        title={
                          user.mfaEnabledAt
                            ? "Reset this user's MFA enrollment"
                            : "MFA is not enrolled for this user"
                        }
                      >
                        Reset MFA
                      </ActionButton>
                      <button
                        type="button"
                        onClick={() => updateUser(user)}
                        disabled={isBusy || !canEditUser}
                        className="inline-flex items-center gap-2 rounded-xl bg-stone-950 px-4 py-2.5 text-xs font-black tracking-widest text-white disabled:opacity-50"
                      >
                        <Check size={14} strokeWidth={3} aria-hidden />
                        {pendingId === user.id ? "SAVING..." : "SAVE CHANGES"}
                      </button>
                    </div>
                  </div>
                )}
              </section>
            );
          })
        )}
      </div>

      {createOpen && (
        <CreateUserModal
          createForm={createForm}
          outlets={outlets}
          passwordPolicy={passwordPolicy}
          canManageSiteAdminAccounts={canManageSiteAdminAccounts}
          visiblePasswords={visiblePasswords}
          pending={pendingId === "create"}
          onClose={() => setCreateOpen(false)}
          onSubmit={createUser}
          onChange={setCreateForm}
          onTogglePassword={() =>
            setVisiblePasswords((prev) => ({ ...prev, create: !prev.create }))
          }
        />
      )}

      {showStepUp && (
        <StepUpModal
          message={stepUpMessage}
          error={stepUpError}
          code={stepUpCode}
          pending={pendingId === "step-up"}
          onCodeChange={setStepUpCode}
          onVerify={verifyStepUp}
          onClose={() => {
            setShowStepUp(false);
            setStepUpCode("");
            setStepUpError(null);
          }}
        />
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  small,
  dot,
  dark = false,
  bars,
}: {
  label: string;
  value: number;
  small?: string;
  dot?: string;
  dark?: boolean;
  bars?: Array<{ width: number; color: string }>;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        dark ? "border-stone-950 bg-stone-950 text-white" : "border-stone-200 bg-white"
      }`}
    >
      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-stone-500">
        {dot && <span className="h-2 w-2 rounded-full" style={{ background: dot }} />}
        {label}
      </div>
      <div className="mt-2 font-display text-3xl font-black leading-none">
        {value}
        {small && (
          <span className="ml-1 text-sm font-bold text-stone-500">{small}</span>
        )}
      </div>
      {bars && (
        <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-white/20">
          {bars.map((bar, index) => (
            <span
              key={index}
              className="block h-full"
              style={{ width: `${bar.width}%`, background: bar.color }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RoleIcon({ kind }: { kind: RoleIconKind }) {
  const className =
    "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border";
  if (kind === "owner") {
    return (
      <span className={`${className} ${roleColors.owner.ring}`}>
        <Crown size={15} strokeWidth={2.5} aria-hidden />
      </span>
    );
  }
  if (kind === "manager") {
    return (
      <span className={`${className} ${roleColors.manager.ring}`}>
        <KeyRound size={15} strokeWidth={2.5} aria-hidden />
      </span>
    );
  }
  if (kind === "admin") {
    return (
      <span className={`${className} ${roleColors.admin.ring}`}>
        <ShieldCheck size={15} strokeWidth={2.5} aria-hidden />
      </span>
    );
  }
  if (kind === "staff") {
    return (
      <span className={`${className} ${roleColors.operator.ring}`}>
        <UserRound size={15} strokeWidth={2.5} aria-hidden />
      </span>
    );
  }
  if (kind === "viewer") {
    return (
      <span className={`${className} ${roleColors.viewer.ring}`}>
        <Eye size={15} strokeWidth={2.5} aria-hidden />
      </span>
    );
  }
  if (kind === "none") {
    return (
      <span className={`${className} ${roleColors.none.ring}`}>
        <EyeOff size={15} strokeWidth={2.5} aria-hidden />
      </span>
    );
  }
  return (
    <span className={`${className} ${roleColors.staff.ring}`}>
      <Store size={15} strokeWidth={2.5} aria-hidden />
    </span>
  );
}

function RoleBadge({
  kind,
  label,
}: {
  kind: "owner" | "admin" | "staff" | "manager" | "operator" | "viewer";
  label: string;
}) {
  const color =
    kind === "owner"
      ? roleColors.owner.badge
      : kind === "admin"
        ? roleColors.admin.badge
        : kind === "staff"
          ? roleColors.staff.badge
          : kind === "manager"
            ? roleColors.manager.badge
            : kind === "operator"
              ? roleColors.operator.badge
              : roleColors.viewer.badge;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${color}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

function SurfaceAccessCard({
  surface,
  granted,
  disabled,
  onToggle,
}: {
  surface: "COUNTER" | "KITCHEN";
  granted: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const Icon = surface === "COUNTER" ? Monitor : CookingPot;
  const title = surface === "COUNTER" ? "Counter" : "Kitchen";
  const description =
    surface === "COUNTER" ? "POS register - order entry" : "KDS - order preparation";

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={granted}
      className={`flex items-center gap-5 rounded-2xl border p-5 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
        granted
          ? "border-emerald-300 bg-emerald-50 shadow-sm"
          : "border-stone-300 bg-white hover:border-stone-500"
      }`}
    >
      <span
        className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl ${
          granted ? "bg-emerald-100 text-emerald-700" : "bg-stone-100 text-stone-500"
        }`}
      >
        <Icon size={29} strokeWidth={2.4} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xl font-black text-stone-950">{title}</span>
        <span className="mt-1 block text-sm font-bold text-stone-500">
          {description}
        </span>
      </span>
      <span
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-black tracking-widest ${
          granted
            ? "border-emerald-300 bg-white text-emerald-700"
            : "border-stone-300 bg-stone-50 text-stone-500"
        }`}
      >
        {granted ? "ENABLED" : "DISABLED"}
        <span
          className={`h-2.5 w-2.5 rounded-full ${
            granted ? "bg-emerald-500" : "bg-stone-300"
          }`}
        />
      </span>
    </button>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-black ${
        active
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-stone-200 bg-stone-100 text-stone-500"
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function MfaPill({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-black ${
        enabled
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-amber-200 bg-amber-50 text-amber-700"
      }`}
    >
      <LockKeyhole size={11} strokeWidth={2.5} aria-hidden />
      {enabled ? "MFA" : "No MFA"}
    </span>
  );
}

function isNotificationHistoryItem(value: unknown): value is NotificationHistoryItem {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<NotificationHistoryItem>;
  return (
    typeof candidate.id === "string" &&
    (candidate.tone === "error" || candidate.tone === "success") &&
    typeof candidate.message === "string" &&
    typeof candidate.createdAt === "number"
  );
}

function ToastStack({
  error,
  notice,
  history,
  onDismissError,
  onDismissNotice,
  onClearHistory,
}: {
  error: string | null;
  notice: string | null;
  history: NotificationHistoryItem[];
  onDismissError: () => void;
  onDismissNotice: () => void;
  onClearHistory: () => void;
}) {
  if (!error && !notice && history.length === 0) return null;

  return (
    <div className="fixed right-6 top-6 z-[70] flex w-[min(420px,calc(100vw-3rem))] flex-col gap-3">
      {error && (
        <ToastCard tone="error" message={error} onDismiss={onDismissError} />
      )}
      {notice && (
        <ToastCard tone="success" message={notice} onDismiss={onDismissNotice} />
      )}
      {history.length > 0 && (
        <details className="rounded-2xl border border-stone-200 bg-white/95 p-3 shadow-[0_12px_36px_rgba(20,20,20,0.14)] backdrop-blur-md">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-black uppercase tracking-widest text-stone-600">
            <span>Recent notifications ({history.length})</span>
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                onClearHistory();
              }}
              className="rounded-full px-2 py-1 text-[10px] font-black text-stone-400 hover:bg-stone-100 hover:text-stone-950"
            >
              CLEAR
            </button>
          </summary>
          <div className="mt-3 space-y-2">
            {history.map((item) => (
              <div
                key={item.id}
                className="grid grid-cols-[auto_1fr_auto] gap-2 rounded-xl bg-stone-50 px-3 py-2 text-xs"
              >
                <span
                  className={`mt-1 h-2 w-2 rounded-full ${
                    item.tone === "error" ? "bg-red-500" : "bg-emerald-500"
                  }`}
                />
                <span className="font-bold leading-snug text-stone-800">
                  {item.message}
                </span>
                <span className="font-bold text-stone-400">
                  {formatNotificationTime(item.createdAt)}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function formatNotificationTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function ToastCard({
  tone,
  message,
  onDismiss,
}: {
  tone: "error" | "success";
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex items-start gap-3 rounded-2xl border bg-white/95 p-4 shadow-[0_18px_50px_rgba(20,20,20,0.18)] backdrop-blur-md ${
        tone === "error" ? "border-red-200" : "border-emerald-200"
      }`}
    >
      <span
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          tone === "error" ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
        }`}
      >
        {tone === "error" ? (
          <X size={16} strokeWidth={3} aria-hidden />
        ) : (
          <Check size={16} strokeWidth={3} aria-hidden />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-black uppercase tracking-widest text-stone-500">
          {tone === "error" ? "Needs attention" : "Saved"}
        </span>
        <span className="mt-1 block text-sm font-black leading-snug text-stone-950">
          {message}
        </span>
      </span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-stone-400 hover:bg-stone-100 hover:text-stone-950"
      >
        <X size={15} strokeWidth={2.5} aria-hidden />
      </button>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-xs font-black tracking-widest text-stone-700 hover:border-stone-950 hover:text-stone-950 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  disabled = false,
  placeholder,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "password";
  disabled?: boolean;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-[10px] font-black uppercase tracking-widest text-stone-500">
      {label}
      <input
        type={type}
        value={value}
        disabled={disabled}
        required={required}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-12 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm font-bold text-stone-950 outline-none transition focus:border-stone-950 focus:ring-4 focus:ring-stone-950/5 disabled:bg-stone-100 disabled:text-stone-500"
      />
    </label>
  );
}

function PasswordInput({
  inputId,
  label,
  value,
  onChange,
  visible,
  onToggleVisible,
  placeholder,
  disabled = false,
}: {
  inputId: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggleVisible: () => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className="block text-[10px] font-black uppercase tracking-widest text-stone-500"
      htmlFor={inputId}
    >
      {label}
      <span className="relative mt-2 block">
        <input
          id={inputId}
          type={visible ? "text" : "password"}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="h-12 w-full rounded-xl border border-stone-200 bg-white px-3 pr-11 text-sm font-bold text-stone-950 outline-none transition focus:border-stone-950 focus:ring-4 focus:ring-stone-950/5 disabled:bg-stone-100 disabled:text-stone-500"
        />
        <button
          type="button"
          onClick={onToggleVisible}
          disabled={disabled}
          aria-label={visible ? "Hide password" : "Show password"}
          title={visible ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-xl text-stone-500 hover:text-stone-950 disabled:opacity-40"
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
      className="relative block text-[10px] font-black uppercase tracking-widest text-stone-500"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget as Node | null;
        if (!event.currentTarget.contains(nextTarget)) setOpen(false);
      }}
    >
      {label}
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="mt-2 flex h-12 w-full items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white px-3 text-left text-sm font-black normal-case tracking-normal text-stone-950 disabled:bg-stone-100 disabled:text-stone-500"
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
          className="absolute z-30 mt-2 w-full overflow-hidden rounded-xl border border-stone-200 bg-white p-1 shadow-xl"
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
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left ${
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
    <div className="grid gap-3 md:grid-cols-2">
      {outlets.map((outlet) => (
        <div
          key={outlet.id}
          className="rounded-xl border border-stone-200 bg-stone-50 p-3"
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

function CreateUserModal({
  createForm,
  outlets,
  passwordPolicy,
  canManageSiteAdminAccounts,
  visiblePasswords,
  pending,
  onClose,
  onSubmit,
  onChange,
  onTogglePassword,
}: {
  createForm: CreateForm;
  outlets: AdminOutletRow[];
  passwordPolicy: string;
  canManageSiteAdminAccounts: boolean;
  visiblePasswords: Record<string, boolean>;
  pending: boolean;
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => void;
  onChange: React.Dispatch<React.SetStateAction<CreateForm>>;
  onTogglePassword: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/50 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <form
        onSubmit={onSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-user-title"
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-stone-200 px-7 py-6">
          <div>
            <h2 id="create-user-title" className="display text-3xl leading-none">
              Create new user
            </h2>
            <p className="mt-2 text-sm font-bold text-stone-500">
              Add a teammate to this Rushbite workspace.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-stone-100 text-stone-700 hover:bg-stone-950 hover:text-white disabled:opacity-50"
          >
            <X size={17} strokeWidth={2.5} aria-hidden />
          </button>
        </div>

        <div className="space-y-4 px-7 py-6">
          <Input
            label="Email address"
            type="email"
            value={createForm.email}
            onChange={(value) => onChange((prev) => ({ ...prev, email: value }))}
            placeholder="newuser@example.com"
            required
          />
          <Input
            label="Display name"
            value={createForm.displayName}
            onChange={(value) =>
              onChange((prev) => ({ ...prev, displayName: value }))
            }
            placeholder="How should we call them?"
            required
          />
          <PasswordInput
            inputId="users-next-create-password"
            label={`Password (${passwordPolicy})`}
            value={createForm.password}
            onChange={(value) => onChange((prev) => ({ ...prev, password: value }))}
            placeholder="Strong, unique password"
            visible={visiblePasswords.create ?? false}
            onToggleVisible={onTogglePassword}
          />

          <div>
            <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-stone-500">
              Account type
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              <AccountTile
                label="Staff"
                description="Per outlet"
                selected={createForm.siteRole === ""}
                icon={<Store size={18} strokeWidth={2.5} aria-hidden />}
                onClick={() => onChange((prev) => ({ ...prev, siteRole: "" }))}
              />
              {canManageSiteAdminAccounts && (
                <>
                  <AccountTile
                    label="Owner"
                    description="Full control"
                    selected={createForm.siteRole === "OWNER"}
                    icon={<Crown size={18} strokeWidth={2.5} aria-hidden />}
                    onClick={() =>
                      onChange((prev) => ({ ...prev, siteRole: "OWNER" }))
                    }
                  />
                  <AccountTile
                    label="Admin"
                    description="Site-wide"
                    selected={createForm.siteRole === "ADMIN"}
                    icon={<ShieldCheck size={18} strokeWidth={2.5} aria-hidden />}
                    onClick={() =>
                      onChange((prev) => ({ ...prev, siteRole: "ADMIN" }))
                    }
                  />
                </>
              )}
            </div>
          </div>

          {createForm.siteRole !== "OWNER" && (
            <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
              <div className="mb-3 text-xs font-black tracking-widest text-stone-500">
                OUTLET ROLES
              </div>
              <OutletRoleControls
                outlets={outlets}
                values={createForm.outletRoles}
                onChange={(outletId, role) =>
                  onChange((prev) => ({
                    ...prev,
                    outletRoles: { ...prev.outletRoles, [outletId]: role },
                  }))
                }
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-stone-200 px-7 py-5">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-xl border border-stone-300 bg-white px-5 py-3 text-xs font-black tracking-widest disabled:opacity-50"
          >
            CANCEL
          </button>
          <button
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-xl bg-stone-950 px-5 py-3 text-xs font-black tracking-widest text-white disabled:opacity-50"
          >
            <Check size={15} strokeWidth={3} aria-hidden />
            {pending ? "CREATING..." : "CREATE USER"}
          </button>
        </div>
      </form>
    </div>
  );
}

function AccountTile({
  label,
  description,
  selected,
  icon,
  onClick,
}: {
  label: string;
  description: string;
  selected: boolean;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border-2 p-4 text-left transition ${
        selected
          ? "border-stone-950 bg-stone-950 text-white"
          : "border-stone-200 bg-white text-stone-950 hover:border-stone-500"
      }`}
    >
      <span className="block">{icon}</span>
      <span className="mt-2 block text-sm font-black">{label}</span>
      <span className={`mt-1 block text-xs font-bold ${selected ? "text-stone-400" : "text-stone-500"}`}>
        {description}
      </span>
    </button>
  );
}

function StepUpModal({
  message,
  error,
  code,
  pending,
  onCodeChange,
  onVerify,
  onClose,
}: {
  message: string;
  error: string | null;
  code: string;
  pending: boolean;
  onCodeChange: (value: string) => void;
  onVerify: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/50 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mfa-step-up-title"
        className="w-full max-w-lg rounded-3xl border border-amber-300 bg-amber-50 p-6 shadow-2xl"
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
              {message} Verify here, then click the same sensitive action again.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-lg px-2 py-1 text-xs font-black tracking-widest text-amber-950 disabled:opacity-50"
          >
            CLOSE
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
            {error}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <input
            value={code}
            onChange={(event) => onCodeChange(event.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            autoFocus
            className="min-h-11 w-44 rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-black tracking-widest"
          />
          <button
            type="button"
            onClick={onVerify}
            disabled={pending || code.trim().length < 6}
            className="min-h-11 rounded-xl bg-stone-950 px-4 py-2 text-xs font-black tracking-widest text-white disabled:opacity-50"
          >
            {pending ? "VERIFYING..." : "VERIFY MFA"}
          </button>
          <a
            href="/admin/workspace?modal=security"
            className="flex min-h-11 items-center rounded-xl border border-stone-300 bg-white px-4 py-2 text-xs font-black tracking-widest"
          >
            MFA SETUP
          </a>
        </div>
      </div>
    </div>
  );
}
