"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BRAND } from "@/lib/brand";
import type { AppSettings } from "@/lib/app-settings";

type FormState = {
  storeName: string;
  storeLocation: string;
  gstRatePct: string;
  dealDefaultDiscountPct: string;
};

function settingsToForm(settings: AppSettings): FormState {
  return {
    storeName: settings.storeName,
    storeLocation: settings.storeLocation,
    gstRatePct: (settings.gstRate * 100).toFixed(2),
    dealDefaultDiscountPct:
      settings.dealDefaultDiscountPct != null
        ? String(settings.dealDefaultDiscountPct)
        : "",
  };
}

export default function SettingsClient({
  initialSettings,
  showHeader = true,
}: {
  initialSettings: AppSettings;
  showHeader?: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => settingsToForm(initialSettings));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const update = <K extends keyof FormState>(key: K, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError(null);
    setNotice(null);
  };

  const onSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const gstPctNum = Number(form.gstRatePct);
    if (!Number.isFinite(gstPctNum) || gstPctNum < 0 || gstPctNum > 100) {
      setError("GST rate must be between 0 and 100.");
      return;
    }

    let dealPct: number | null = null;
    if (form.dealDefaultDiscountPct.trim() !== "") {
      const n = Number(form.dealDefaultDiscountPct);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        setError("Default deal discount must be between 0 and 100.");
        return;
      }
      dealPct = n;
    }

    const payload = {
      storeName: form.storeName.trim(),
      storeLocation: form.storeLocation.trim(),
      gstRate: gstPctNum / 100,
      dealDefaultDiscountPct: dealPct,
    };

    if (!payload.storeName) {
      setError("Store name is required.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body?.error ?? "Could not save settings.");
        return;
      }
      const body = (await response.json()) as { settings: AppSettings };
      setForm(settingsToForm(body.settings));
      setNotice("Settings saved.");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {showHeader && (
        <div className="mb-6">
          <h1 className="display text-3xl">Settings</h1>
          <div className="text-xs font-black tracking-widest opacity-60 mt-2">
            Store details, tax rate, and default deal pricing.
          </div>
        </div>
      )}

      <form
        onSubmit={onSave}
        className="max-w-2xl space-y-6 rounded-xl border border-stone-200 bg-white p-6"
      >
        <Field
          label="Store name"
          hint="Shown on the kiosk welcome screen and receipts."
        >
          <input
            value={form.storeName}
            onChange={(e) => update("storeName", e.target.value)}
            maxLength={120}
            className="border border-stone-300 rounded-md px-3 py-2 w-full text-sm font-bold"
          />
        </Field>

        <Field
          label="Store address"
          hint="Shown beneath the store name on the kiosk welcome screen. Leave blank to hide."
        >
          <input
            value={form.storeLocation}
            onChange={(e) => update("storeLocation", e.target.value)}
            maxLength={200}
            className="border border-stone-300 rounded-md px-3 py-2 w-full text-sm font-bold"
          />
        </Field>

        <Field
          label="GST rate (%)"
          hint="Applied to every order at checkout. Enter as a percentage, e.g. 5 for 5%."
        >
          <input
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={form.gstRatePct}
            onChange={(e) => update("gstRatePct", e.target.value)}
            className="border border-stone-300 rounded-md px-3 py-2 w-full text-sm mono"
          />
        </Field>

        <Field
          label="Default deal discount (%)"
          hint="Used as the starting value when you create a new deal upgrade or open a deal that doesn't have its own discount yet. Existing deals keep their own discount until you change it on the deal's edit page. Leave blank for no default."
        >
          <input
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={form.dealDefaultDiscountPct}
            onChange={(e) => update("dealDefaultDiscountPct", e.target.value)}
            placeholder="(none)"
            className="border border-stone-300 rounded-md px-3 py-2 w-full text-sm mono"
          />
        </Field>

        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
            {error}
          </div>
        )}
        {notice && (
          <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
            {notice}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md px-5 py-3 text-xs font-black tracking-widest disabled:opacity-50"
            style={{ background: BRAND.red, color: "white" }}
          >
            {saving ? "SAVING..." : "SAVE SETTINGS"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[10px] font-black tracking-widest opacity-70 mb-2">
        {label.toUpperCase()}
      </label>
      {children}
      {hint && (
        <p className="text-[11px] opacity-60 mt-1 leading-snug">{hint}</p>
      )}
    </div>
  );
}
