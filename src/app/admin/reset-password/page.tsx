import { BRAND } from "@/lib/brand";
import { passwordPolicyText } from "@/lib/admin-user-management";

type SearchParams = Promise<{
  token?: string;
  done?: string;
  invalid?: string;
  mismatch?: string;
}>;

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminResetPasswordPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const token = sp.token ?? "";
  const done = sp.done === "1";
  const invalid = sp.invalid === "1";
  const mismatch = sp.mismatch === "1";

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
        <h1 className="display text-4xl mb-3">New password</h1>
        <p className="text-sm opacity-70 mb-6">
          Set a new admin password. Existing sessions will be revoked.
        </p>

        {done && (
          <div
            role="status"
            className="mb-5 px-4 py-3 rounded-xl text-sm font-bold"
            style={{ background: "#E4F8E8", color: "#276B35" }}
          >
            Password changed. Sign in with the new password.
          </div>
        )}
        {invalid && (
          <div
            role="alert"
            className="mb-5 px-4 py-3 rounded-xl text-sm font-bold"
            style={{ background: "#FFE3E0", color: BRAND.redDark }}
          >
            This reset link is invalid, expired, or the password does not meet policy.
          </div>
        )}
        {mismatch && (
          <div
            role="alert"
            className="mb-5 px-4 py-3 rounded-xl text-sm font-bold"
            style={{ background: "#FFE3E0", color: BRAND.redDark }}
          >
            Password fields did not match.
          </div>
        )}

        {token && !done ? (
          <form action="/api/admin/auth/reset-password" method="POST" className="space-y-4">
            <input type="hidden" name="token" value={token} />
            <label className="block text-xs font-black tracking-widest opacity-60">
              PASSWORD ({passwordPolicyText().toUpperCase()})
              <input
                type="password"
                name="password"
                className="block mt-2 w-full rounded-xl border border-stone-300 px-3 py-3 text-sm font-bold"
                autoComplete="new-password"
                autoFocus
                required
              />
            </label>

            <label className="block text-xs font-black tracking-widest opacity-60">
              CONFIRM PASSWORD
              <input
                type="password"
                name="confirmPassword"
                className="block mt-2 w-full rounded-xl border border-stone-300 px-3 py-3 text-sm font-bold"
                autoComplete="new-password"
                required
              />
            </label>

            <button
              type="submit"
              className="btn-press w-full rounded-2xl py-4 display text-xl"
              style={{ background: BRAND.red, color: "white" }}
            >
              CHANGE PASSWORD
            </button>
          </form>
        ) : (
          <a
            href="/admin/login"
            className="btn-press block w-full rounded-2xl py-4 text-center display text-xl"
            style={{ background: BRAND.red, color: "white" }}
          >
            SIGN IN
          </a>
        )}
      </div>
    </main>
  );
}
