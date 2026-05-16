import { BRAND } from "@/lib/brand";
import { AdminLoginForm } from "./AdminLoginForm";

type SearchParams = Promise<{
  error?: string;
}>;

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;

  return (
    <main
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: BRAND.cream, color: BRAND.black }}
    >
      <div
        className="w-full max-w-md rounded-3xl p-8"
        style={{ background: "white", boxShadow: "0 20px 60px rgba(0,0,0,0.12)" }}
      >
        <div
          className="inline-block px-3 py-1 rounded-full text-xs font-black tracking-widest mb-4"
          style={{ background: BRAND.yellow }}
        >
          ADMIN ACCESS
        </div>
        <h1 className="display text-4xl mb-3">RUSHBITE</h1>
        <p className="text-sm opacity-70 mb-6">
          Sign in with your admin account. Legacy Basic Auth remains available
          during the migration window.
        </p>

        <AdminLoginForm error={sp.error} />
      </div>
    </main>
  );
}
