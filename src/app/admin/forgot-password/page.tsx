import { BRAND } from "@/lib/brand";

type SearchParams = Promise<{ email?: string; sent?: string }>;

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminForgotPasswordPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const sent = sp.sent === "1";
  const email = typeof sp.email === "string" ? sp.email.trim() : "";

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
          ACCOUNT RECOVERY
        </div>
        <h1 className="display text-4xl mb-3">Reset password</h1>
        <p className="text-sm opacity-70 mb-6">
          {sent
            ? "Check your email for the secure reset link. For privacy, this screen does not show whether an account exists."
            : "Enter your admin email below. This is a separate reset screen, not the sign-in form."}
        </p>

        {sent && (
          <div
            role="status"
            className="mb-5 px-4 py-3 rounded-xl text-sm font-bold"
            style={{ background: "#E4F8E8", color: "#276B35" }}
          >
            If that account exists, a reset link has been sent.
          </div>
        )}

        {!sent && (
          <form action="/api/admin/auth/forgot-password" method="POST" className="space-y-4">
            <label className="block text-xs font-black tracking-widest opacity-60">
              EMAIL
              <input
                type="email"
                name="email"
                defaultValue={email}
                className="block mt-2 w-full rounded-xl border border-stone-300 px-3 py-3 text-sm font-bold"
                autoComplete="off"
                autoFocus
                required
              />
            </label>

            <button
              type="submit"
              className="btn-press w-full rounded-2xl py-4 display text-xl"
              style={{ background: BRAND.red, color: "white" }}
            >
              SEND RESET LINK
            </button>
          </form>
        )}

        <a
          href="/admin/login"
          className="mt-5 block text-center text-xs font-black tracking-widest opacity-60"
        >
          BACK TO SIGN IN
        </a>
      </div>
    </main>
  );
}
