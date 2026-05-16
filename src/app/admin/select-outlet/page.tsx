import { redirect } from "next/navigation";
import AdminShell from "@/components/admin/Shell";
import { getServerAdminSession } from "@/lib/admin-sessions";
import { resolveAdminActiveOutlet, displayActiveRole } from "@/lib/admin-active-outlet";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export default async function AdminSelectOutletPage() {
  const session = await getServerAdminSession();
  if (!session) redirect("/admin/login");

  const resolution = await resolveAdminActiveOutlet(session, await cookies());
  if (resolution.status === "active") redirect("/admin");
  if (resolution.status === "no_access") redirect("/admin/no-access");

  return (
    <AdminShell active="dashboard">
      <div className="mb-6">
        <h1 className="display text-3xl">Choose Active Outlet</h1>
        <p className="mt-2 text-sm font-bold opacity-60">
          Your permissions depend on the outlet you are working in.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {resolution.outlets.map((outlet) => (
          <form key={outlet.id} action="/api/admin/active-outlet" method="POST">
            <input type="hidden" name="outletId" value={outlet.id} />
            <input type="hidden" name="returnTo" value="/admin" />
            <button className="w-full rounded-xl border border-stone-200 bg-white p-5 text-left hover:border-stone-400">
              <div className="display text-2xl">{outlet.name}</div>
              <div className="mt-2 text-xs font-black tracking-widest opacity-60">
                You are {displayActiveRole(outlet.role)} here
              </div>
            </button>
          </form>
        ))}
      </div>
    </AdminShell>
  );
}
