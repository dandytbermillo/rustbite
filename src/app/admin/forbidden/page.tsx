import Link from "next/link";
import { BRAND } from "@/lib/brand";

export default function AdminForbiddenPage() {
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
          style={{ background: "#FFE3E0", color: BRAND.redDark }}
        >
          ACCESS LIMITED
        </div>
        <h1 className="display text-4xl mb-3">Not allowed</h1>
        <p className="text-sm opacity-70 mb-6">
          Your admin account is signed in, but it does not have permission to
          open this admin area.
        </p>
        <Link
          href="/admin/login"
          className="inline-block rounded-2xl px-5 py-3 display text-lg"
          style={{ background: BRAND.red, color: "white" }}
        >
          SIGN IN AS DIFFERENT ADMIN
        </Link>
      </div>
    </main>
  );
}
