import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiPermission } from "@/lib/admin-sessions";
import { getAppSettings, saveAppSettings } from "@/lib/app-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const authError = await requireAdminApiPermission(req, "admin.settings.read");
  if (authError) return authError;

  const settings = await getAppSettings();
  return NextResponse.json({ settings });
}

function parseTrimmedString(
  value: unknown,
  field: string,
  { maxLen = 200, allowEmpty = false }: { maxLen?: number; allowEmpty?: boolean } = {}
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: false, error: `${field} must be a string` };
  }
  const trimmed = value.trim();
  if (!allowEmpty && trimmed.length === 0) {
    return { ok: false, error: `${field} is required` };
  }
  if (trimmed.length > maxLen) {
    return { ok: false, error: `${field} must be ${maxLen} characters or fewer` };
  }
  return { ok: true, value: trimmed };
}

function parseNumberInRange(
  value: unknown,
  field: string,
  min: number,
  max: number
): { ok: true; value: number } | { ok: false; error: string } {
  if (value === null || value === undefined || value === "") {
    return { ok: false, error: `${field} is required` };
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    return { ok: false, error: `${field} must be a number` };
  }
  if (n < min || n > max) {
    return { ok: false, error: `${field} must be between ${min} and ${max}` };
  }
  return { ok: true, value: n };
}

function parseOptionalNumberInRange(
  value: unknown,
  field: string,
  min: number,
  max: number
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value === null || value === undefined || value === "") {
    return { ok: true, value: null };
  }
  return parseNumberInRange(value, field, min, max);
}

export async function PATCH(req: NextRequest) {
  const authError = await requireAdminApiPermission(req, "admin.settings.write");
  if (authError) return authError;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const raw = body as Record<string, unknown>;

  const storeName = parseTrimmedString(raw.storeName, "Store name", { maxLen: 120 });
  if (!storeName.ok) return NextResponse.json({ error: storeName.error }, { status: 400 });

  const storeLocation = parseTrimmedString(raw.storeLocation, "Store location", {
    maxLen: 200,
    allowEmpty: true,
  });
  if (!storeLocation.ok) return NextResponse.json({ error: storeLocation.error }, { status: 400 });

  const gstRate = parseNumberInRange(raw.gstRate, "GST rate", 0, 1);
  if (!gstRate.ok) return NextResponse.json({ error: gstRate.error }, { status: 400 });

  const dealDefaultDiscountPct = parseOptionalNumberInRange(
    raw.dealDefaultDiscountPct,
    "Deal default discount %",
    0,
    100
  );
  if (!dealDefaultDiscountPct.ok)
    return NextResponse.json({ error: dealDefaultDiscountPct.error }, { status: 400 });

  const settings = await saveAppSettings({
    storeName: storeName.value,
    storeLocation: storeLocation.value,
    gstRate: gstRate.value,
    dealDefaultDiscountPct: dealDefaultDiscountPct.value,
  });

  return NextResponse.json({ settings });
}
