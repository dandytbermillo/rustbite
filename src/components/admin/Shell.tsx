import Link from "next/link";
import { BRAND } from "@/lib/brand";
import {
  adminActorHasPermission,
  getServerAdminSession,
} from "@/lib/admin-sessions";
import type { AdminPermission } from "@/lib/production-auth";
import { resolveAdminActiveOutlet, displayActiveRole } from "@/lib/admin-active-outlet";
import { cookies } from "next/headers";
import AdminAttentionWidget from "@/components/admin/AdminAttentionWidget";

type AdminShellActive =
  | "dashboard"
  | "menu"
  | "dealHistory"
  | "orders"
  | "settings"
  | "security"
  | "users"
  | "devices";

type AdminNavItem = {
  key: AdminShellActive;
  href: string;
  label: string;
  permission: AdminPermission | null;
  group: "primary" | "more";
};

const NAV_ITEMS: AdminNavItem[] = [
  {
    key: "dashboard",
    href: "/admin",
    label: "Dashboard",
    permission: "admin.dashboard.read",
    group: "primary",
  },
  {
    key: "orders",
    href: "/admin/orders",
    label: "Orders",
    permission: "admin.orders.read",
    group: "primary",
  },
  {
    key: "menu",
    href: "/admin/menu",
    label: "Menu",
    permission: "admin.menu.read",
    group: "primary",
  },
  {
    key: "devices",
    href: "/admin/devices",
    label: "Devices",
    permission: "admin.auth.devices.manage",
    group: "primary",
  },
  {
    key: "users",
    href: "/admin/users",
    label: "Users",
    permission: "admin.auth.users.manage",
    group: "primary",
  },
  {
    key: "dealHistory",
    href: "/admin/workspace?modal=deal-history",
    label: "Deal history",
    permission: "admin.dealHistory.read",
    group: "more",
  },
  {
    key: "settings",
    href: "/admin/workspace?modal=settings",
    label: "Settings",
    permission: "admin.settings.read",
    group: "more",
  },
  {
    key: "security",
    href: "/admin/workspace?modal=security",
    label: "Security",
    permission: null,
    group: "more",
  },
];

function navLinkClass(active: boolean, compact = false) {
  const size = compact ? "px-3 py-2 text-[12px]" : "px-4 py-2 text-[13px]";
  return `${size} rounded-full font-black transition ${
    active
      ? "bg-yellow-400 text-stone-950"
      : "text-white/72 hover:bg-white/10 hover:text-white"
  }`;
}

export default async function AdminShell({
  children,
  active,
}: {
  children: React.ReactNode;
    active: AdminShellActive;
}) {
  const session = await getServerAdminSession();
  const activeOutlet = session && !session.mfaEnrollmentRequired
    ? await resolveAdminActiveOutlet(session, await cookies())
    : null;

  const visibleNavBase = session?.mfaEnrollmentRequired
    ? NAV_ITEMS.filter((item) => item.key === "security")
    : await Promise.all(
        NAV_ITEMS.map(async (item) => {
          if (!session) return item;
          if (!item.permission) return item;
          if (activeOutlet?.status !== "active") return null;
          return (await adminActorHasPermission(
            session,
            item.permission,
            activeOutlet.outletId,
          ))
            ? item
            : null;
        }),
      ).then((items) => items.filter((item): item is AdminNavItem => Boolean(item)));
  const visibleNav = session?.mfaEnrollmentRequired
    ? visibleNavBase.map((item) =>
        item.key === "security"
          ? { ...item, href: "/admin/security/mfa" }
          : item,
      )
    : visibleNavBase;
  const primaryNav = visibleNav.filter((item) => item.group === "primary");
  const moreNav = visibleNav.filter((item) => item.group === "more");
  const roleLabel =
    activeOutlet?.status === "active"
      ? displayActiveRole(activeOutlet.role)
      : session?.siteRole
        ? displayActiveRole(session.siteRole)
        : "Admin";

  return (
    <div className="min-h-screen bg-[#f7f6f2]">
      <header
        data-testid="admin-shell-header"
        className="sticky top-0 z-40 border-b-4 px-5 py-3 text-white shadow-sm"
        style={{ background: BRAND.black, borderColor: BRAND.yellow }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/admin"
            className="text-xl font-black tracking-tight"
            style={{ color: BRAND.yellow }}
          >
            RushBite
          </Link>

          {activeOutlet?.status === "active" ? (
            <Link
              href="/admin/select-outlet"
              data-testid="admin-active-outlet"
              className="rounded-full border border-white/12 bg-white/10 px-3 py-2 text-[13px] font-black text-white/88 hover:bg-white/15"
            >
              {activeOutlet.outletName}
            </Link>
          ) : activeOutlet?.status === "needs_picker" ? (
            <Link
              href="/admin/select-outlet"
              data-testid="admin-active-outlet"
              className="rounded-full border border-yellow-400/35 bg-yellow-400/10 px-3 py-2 text-[13px] font-black text-yellow-300"
            >
              Choose outlet
            </Link>
          ) : null}

          <nav
            data-testid="admin-shell-nav"
            className="flex max-w-full flex-wrap items-center gap-1 rounded-full border border-white/10 bg-white/5 p-1"
            aria-label="Admin navigation"
          >
            {primaryNav.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                data-testid={`admin-nav-${item.key}`}
                className={navLinkClass(active === item.key)}
              >
                {item.label}
              </Link>
            ))}
            {moreNav.length > 0 && (
              <details className="group relative">
                <summary
                  className={`${navLinkClass(
                    moreNav.some((item) => active === item.key),
                  )} list-none cursor-pointer`}
                >
                  More
                </summary>
                <div className="absolute left-0 z-50 mt-2 grid min-w-44 gap-1 rounded-xl border border-white/10 bg-neutral-950 p-2 shadow-2xl">
                  {moreNav.map((item) => (
                    <Link
                      key={item.key}
                      href={item.href}
                      data-testid={`admin-nav-${item.key}`}
                      className={navLinkClass(active === item.key, true)}
                    >
                      {item.label}
                    </Link>
                  ))}
                  <form action="/api/admin/auth/logout" method="POST">
                    <button className="w-full rounded-full px-3 py-2 text-left text-[12px] font-black text-white/72 hover:bg-white/10 hover:text-white">
                      Sign out
                    </button>
                  </form>
                </div>
              </details>
            )}
          </nav>

          {session && !session.mfaEnrollmentRequired && activeOutlet?.status === "active" && (
            <AdminAttentionWidget
              outletId={activeOutlet.outletId}
              scopeKey={`${session.sessionId}:${activeOutlet.outletId}`}
              variant="pill"
            />
          )}

          <span
            data-testid="admin-version-pill"
            className="rounded-full bg-yellow-400/20 px-3 py-1 text-[12px] font-black tracking-widest text-yellow-300"
          >
            V1
          </span>
          <Link
            href="/admin/workspace"
            data-testid="admin-workspace-return-link"
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[13px] font-black text-white/72 hover:bg-white/10 hover:text-white"
          >
            Workspace
          </Link>

          <div className="flex-1" />

          {session?.mfaEnrollmentRequired && (
            <div className="rounded-full border border-yellow-400/30 bg-yellow-400/10 px-3 py-2 text-[12px] font-black text-yellow-100">
              Complete MFA setup
            </div>
          )}
          <span
            data-testid="admin-user-pill"
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-2 text-[13px] font-black text-white/90"
          >
            {session?.displayName ?? "Admin"}
            <span
              data-testid="admin-role-pill"
              className="rounded-full px-2 py-0.5 text-[11px] font-black tracking-widest"
              style={{ background: BRAND.yellow, color: BRAND.black }}
            >
              {roleLabel.toUpperCase()}
            </span>
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-5 py-6">{children}</main>
    </div>
  );
}
