import AdminShell from "@/components/admin/Shell";

export default function AdminNoAccessPage() {
  return (
    <AdminShell active="dashboard">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
        <div className="display text-3xl">No outlet access</div>
        <p className="mt-3 max-w-2xl text-sm font-bold text-amber-900">
          Your staff account is active, but it has no outlet role assigned. Ask an
          Owner or Admin to assign you access before using the admin area.
        </p>
      </div>
    </AdminShell>
  );
}
