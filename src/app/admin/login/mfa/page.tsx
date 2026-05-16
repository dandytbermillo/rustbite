import { BRAND } from "@/lib/brand";

type SearchParams = Promise<{
  error?: string;
}>;

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminLoginMfaPage({
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
          MFA REQUIRED
        </div>
        <h1 className="display text-4xl mb-3">Verify code</h1>
        <p className="text-sm opacity-70 mb-6">
          Enter the 6-digit code from your authenticator app, or use one recovery
          code if your authenticator is unavailable.
        </p>

        {sp.error === "invalid" && (
          <div
            role="alert"
            className="mb-5 px-4 py-3 rounded-xl text-sm font-bold"
            style={{ background: "#FFE3E0", color: BRAND.redDark }}
          >
            MFA or recovery code was not accepted.
          </div>
        )}
        {sp.error === "locked" && (
          <div
            role="alert"
            className="mb-5 px-4 py-3 rounded-xl text-sm font-bold"
            style={{ background: "#FFE3E0", color: BRAND.redDark }}
          >
            Too many MFA attempts. Wait a few minutes and try again.
          </div>
        )}

        <form action="/api/admin/auth/login/mfa" method="POST" className="space-y-4">
          <label className="block text-xs font-black tracking-widest opacity-60">
            AUTHENTICATOR OR RECOVERY CODE
            <input
              type="text"
              name="code"
              inputMode="text"
              autoComplete="one-time-code"
              minLength={6}
              maxLength={24}
              className="block mt-2 w-full rounded-xl border border-stone-300 px-3 py-3 text-sm font-black tracking-widest"
              autoFocus
              required
            />
          </label>

          <button
            type="submit"
            className="btn-press w-full rounded-2xl py-4 display text-xl"
            style={{ background: BRAND.red, color: "white" }}
          >
            VERIFY & SIGN IN
          </button>
        </form>
      </div>
    </main>
  );
}
