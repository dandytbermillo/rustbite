"use client";

import { useEffect, useState, useTransition } from "react";
import { QRCodeSVG } from "qrcode.react";
import { BRAND } from "@/lib/brand";

type MfaStatus = {
  accountType: "OWNER" | "ADMIN" | "STAFF";
  mfaRequired: boolean;
  mfaEnabled: boolean;
  mfaEnabledAt: string | null;
  recoveryCodesRemaining: number;
  stepUpExpiresAt: string | null;
  serverNow: string;
};

type SetupState = {
  secret: string;
  otpauthUri: string;
};

async function readError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);
  return body && typeof body.error === "string" ? body.error : fallback;
}

export default function MfaClient({ showHeader = true }: { showHeader?: boolean }) {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const loadStatus = () => {
    startTransition(async () => {
      const response = await fetch("/api/admin/mfa/status", { cache: "no-store" });
      if (!response.ok) {
        setError(await readError(response, "Could not load MFA status."));
        return;
      }
      setStatus((await response.json()) as MfaStatus);
    });
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const startEnrollment = async () => {
    setError(null);
    setNotice(null);
    setRecoveryCodes(null);
    const response = await fetch("/api/admin/mfa/enrollment/start", {
      method: "POST",
    });
    if (!response.ok) {
      setError(await readError(response, "Could not start MFA enrollment."));
      return;
    }
    setSetup((await response.json()) as SetupState);
    setNotice("Secret generated. Add it to your authenticator app, then enter the code.");
  };

  const verifyEnrollment = async () => {
    setError(null);
    setNotice(null);
    const response = await fetch("/api/admin/mfa/enrollment/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!response.ok) {
      setError(await readError(response, "Could not verify MFA code."));
      return;
    }
    const body = (await response.json()) as { recoveryCodes?: string[] };
    setSetup(null);
    setCode("");
    setRecoveryCodes(body.recoveryCodes ?? []);
    setNotice("MFA enabled. Save these recovery codes now; they will not be shown again.");
    loadStatus();
  };

  const verifyStepUp = async () => {
    setError(null);
    setNotice(null);
    const response = await fetch("/api/admin/auth/step-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!response.ok) {
      setError(await readError(response, "Could not verify MFA code."));
      return;
    }
    setCode("");
    setNotice("Sensitive actions are verified for the next 10 minutes.");
    loadStatus();
  };

  const regenerateRecoveryCodes = async () => {
    setError(null);
    setNotice(null);
    const response = await fetch("/api/admin/mfa/recovery-codes/regenerate", {
      method: "POST",
    });
    if (!response.ok) {
      setError(await readError(response, "Could not regenerate recovery codes."));
      return;
    }
    const body = (await response.json()) as { recoveryCodes?: string[] };
    setRecoveryCodes(body.recoveryCodes ?? []);
    setNotice("Recovery codes regenerated. Previous recovery codes no longer work.");
    loadStatus();
  };

  const stepUpActive =
    status?.stepUpExpiresAt && new Date(status.stepUpExpiresAt) > new Date();

  const downloadRecoveryCodes = () => {
    if (!recoveryCodes || recoveryCodes.length === 0) return;
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const content = [
      "Rushbite — MFA Recovery Codes",
      `Generated: ${now.toISOString()}`,
      "",
      "These codes are SINGLE-USE backups for when your authenticator app is unavailable.",
      "- Each code works exactly once. Used codes are permanently invalidated.",
      "- If you regenerate, all codes (used and unused) become invalid.",
      "- Store this file in a password manager or other secure location.",
      "- Do NOT email these codes or store them in plain cloud notes.",
      "",
      "Recovery codes:",
      ...recoveryCodes.map((c) => `  ${c}`),
      "",
    ].join("\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `rushbite-recovery-codes-${dateStr}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-3xl">
      {showHeader && (
        <div className="mb-6">
          <h1 className="display text-3xl">Security</h1>
          <div className="mt-2 text-xs font-black tracking-widest opacity-60">
            MFA protects owner/admin actions like user creation, password resets,
            and session revocation.
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
          {notice}
        </div>
      )}

      {recoveryCodes && recoveryCodes.length > 0 && (
        <section className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-5">
          <div className="text-xs font-black tracking-widest text-amber-900">
            ONE-TIME RECOVERY CODES
          </div>
          <div className="mt-2 text-sm font-bold text-amber-900/80">
            Store these outside the kiosk. Each code can be used once if the
            authenticator app is unavailable.
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {recoveryCodes.map((recoveryCode) => (
              <code
                key={recoveryCode}
                className="rounded-md bg-white px-3 py-2 text-sm font-black tracking-widest"
              >
                {recoveryCode}
              </code>
            ))}
          </div>
          <div className="mt-4">
            <button
              type="button"
              onClick={downloadRecoveryCodes}
              className="rounded-md border border-amber-400 bg-white px-4 py-2 text-xs font-black tracking-widest text-amber-900 hover:bg-amber-100"
            >
              DOWNLOAD .TXT
            </button>
          </div>
        </section>
      )}

      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black tracking-widest opacity-60">
              MULTI-FACTOR AUTHENTICATION
            </div>
            <div className="mt-2 text-2xl font-black">
              {status?.mfaEnabled ? "Enabled" : "Not enabled"}
            </div>
            <div className="mt-1 text-sm font-bold text-stone-600">
              Account type: {status?.accountType ?? "..."}
              {status?.mfaRequired ? " · Required" : " · Optional"}
            </div>
            {status?.mfaEnabled && (
              <div className="mt-1 text-sm font-bold text-stone-600">
                Recovery codes remaining: {status.recoveryCodesRemaining}
              </div>
            )}
          </div>
          {status?.mfaEnabled && (
            <div className="rounded-full bg-emerald-100 px-4 py-2 text-xs font-black tracking-widest text-emerald-800">
              ACTIVE
            </div>
          )}
        </div>

        {status?.mfaEnabled ? (
          <div className="mt-6 rounded-lg border border-stone-200 bg-stone-50 p-4">
            <div className="text-sm font-bold text-stone-700">
              {stepUpActive
                ? `Step-up verified until ${new Date(status.stepUpExpiresAt!).toLocaleTimeString()}`
                : "Enter a current authenticator code to unlock sensitive actions for 10 minutes."}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                className="w-44 rounded-md border border-stone-300 px-3 py-2 text-sm font-black tracking-widest"
              />
              <button
                type="button"
                disabled={isPending || code.trim().length < 6}
                onClick={verifyStepUp}
                className="rounded-md px-5 py-2 text-xs font-black tracking-widest disabled:opacity-50"
                style={{ background: BRAND.black, color: "white" }}
              >
                VERIFY CODE
              </button>
              <button
                type="button"
                disabled={isPending || !stepUpActive}
                onClick={regenerateRecoveryCodes}
                className="rounded-md border border-stone-300 bg-white px-5 py-2 text-xs font-black tracking-widest disabled:opacity-50"
              >
                REGENERATE RECOVERY CODES
              </button>
            </div>
            {!stepUpActive && (
              <div className="mt-2 text-xs font-bold text-stone-500">
                Verify an authenticator code first before regenerating recovery codes.
              </div>
            )}
          </div>
        ) : (
          <div className="mt-6">
            {!setup ? (
              <button
                type="button"
                disabled={isPending || !status}
                onClick={startEnrollment}
                className="rounded-md px-5 py-3 text-xs font-black tracking-widest disabled:opacity-50"
                style={{ background: BRAND.red, color: "white" }}
              >
                START MFA SETUP
              </button>
            ) : (
              <div className="space-y-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
                <div className="flex flex-col items-start gap-4 sm:flex-row">
                  <div className="rounded-md border border-amber-200 bg-white p-3">
                    <QRCodeSVG
                      value={setup.otpauthUri}
                      size={176}
                      level="M"
                      includeMargin={false}
                    />
                  </div>
                  <div className="flex-1 text-xs font-bold text-amber-900/80">
                    <div className="text-xs font-black tracking-widest text-amber-900">
                      SCAN WITH AUTHENTICATOR APP
                    </div>
                    <div className="mt-2">
                      Open Google Authenticator, 1Password, Authy, or any TOTP app
                      and scan this QR code to add your account.
                    </div>
                  </div>
                </div>
                <div>
                  <div className="text-xs font-black tracking-widest text-amber-900">
                    CAN'T SCAN? USE THE SETUP KEY
                  </div>
                  <code className="mt-2 block break-all rounded-md bg-white px-3 py-2 text-sm font-black">
                    {setup.secret}
                  </code>
                  <div className="mt-2 text-xs font-bold text-amber-900/70">
                    Add this secret manually to 1Password, Google Authenticator,
                    Authy, or any TOTP app. If your app supports otpauth URLs:
                  </div>
                  <code className="mt-2 block break-all rounded-md bg-white px-3 py-2 text-xs">
                    {setup.otpauthUri}
                  </code>
                </div>
                <div className="flex flex-wrap gap-2">
                  <input
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    className="w-44 rounded-md border border-stone-300 px-3 py-2 text-sm font-black tracking-widest"
                  />
                  <button
                    type="button"
                    disabled={isPending || code.trim().length < 6}
                    onClick={verifyEnrollment}
                    className="rounded-md px-5 py-2 text-xs font-black tracking-widest disabled:opacity-50"
                    style={{ background: BRAND.black, color: "white" }}
                  >
                    ENABLE MFA
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
