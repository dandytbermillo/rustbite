"use client";

import { useRef } from "react";

import { BRAND } from "@/lib/brand";

export function AdminLoginForm({ error }: { error?: string }) {
  const emailRef = useRef<HTMLInputElement>(null);
  const resetEmailRef = useRef<HTMLInputElement>(null);
  const resetFormRef = useRef<HTMLFormElement>(null);

  function requestPasswordReset() {
    const email = emailRef.current?.value.trim() ?? "";

    if (!email) {
      window.location.href = "/admin/forgot-password";
      return;
    }

    if (resetEmailRef.current) {
      resetEmailRef.current.value = email;
    }
    resetFormRef.current?.requestSubmit();
  }

  return (
    <>
      {error === "invalid" && (
        <div
          role="alert"
          className="mb-5 px-4 py-3 rounded-xl text-sm font-bold"
          style={{ background: "#FFE3E0", color: BRAND.redDark }}
        >
          Email or password was not accepted.
        </div>
      )}
      {error === "locked" && (
        <div
          role="alert"
          className="mb-5 px-4 py-3 rounded-xl text-sm font-bold"
          style={{ background: "#FFE3E0", color: BRAND.redDark }}
        >
          Too many sign-in attempts. Wait a few minutes and try again.
        </div>
      )}
      {error === "mfa_expired" && (
        <div
          role="alert"
          className="mb-5 px-4 py-3 rounded-xl text-sm font-bold"
          style={{ background: "#FFE3E0", color: BRAND.redDark }}
        >
          MFA verification expired. Sign in again.
        </div>
      )}

      <form action="/api/admin/auth/login" method="POST" className="space-y-4">
        <label className="block text-xs font-black tracking-widest opacity-60">
          EMAIL
          <input
            type="email"
            name="email"
            ref={emailRef}
            className="block mt-2 w-full rounded-xl border border-stone-300 px-3 py-3 text-sm font-bold"
            autoComplete="username"
            autoFocus
            required
          />
        </label>

        <label className="block text-xs font-black tracking-widest opacity-60">
          PASSWORD
          <input
            type="password"
            name="password"
            className="block mt-2 w-full rounded-xl border border-stone-300 px-3 py-3 text-sm font-bold"
            autoComplete="current-password"
            required
          />
        </label>

        <button
          type="submit"
          className="btn-press w-full rounded-2xl py-4 display text-xl"
          style={{ background: BRAND.red, color: "white" }}
        >
          SIGN IN
        </button>
      </form>

      <form
        ref={resetFormRef}
        action="/api/admin/auth/forgot-password"
        method="POST"
        className="hidden"
        aria-hidden="true"
      >
        <input ref={resetEmailRef} type="hidden" name="email" />
      </form>

      <button
        type="button"
        onClick={requestPasswordReset}
        className="mt-5 block rounded-xl border border-stone-200 py-3 text-center text-xs font-black tracking-widest opacity-70 transition hover:opacity-100"
      >
        FORGOT PASSWORD?
      </button>
    </>
  );
}
