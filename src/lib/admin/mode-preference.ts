export type AdminMode = "workspace" | "classic";

export const ADMIN_MODE_COOKIE = "rb_admin_mode";

export function parseAdminMode(value: unknown): AdminMode | null {
  return value === "workspace" || value === "classic" ? value : null;
}

export function adminModeCookieValue(
  cookies: { get(name: string): { value: string } | undefined },
): AdminMode | null {
  return parseAdminMode(cookies.get(ADMIN_MODE_COOKIE)?.value);
}

export function adminModeFromSearchParams(
  searchParams: URLSearchParams,
): AdminMode | null {
  return parseAdminMode(searchParams.get("mode"));
}

export function resolveAdminModePreference({
  searchParams,
  cookies,
  fallback = "classic",
}: {
  searchParams: URLSearchParams;
  cookies: { get(name: string): { value: string } | undefined };
  fallback?: AdminMode;
}): AdminMode {
  return adminModeFromSearchParams(searchParams) ?? adminModeCookieValue(cookies) ?? fallback;
}

export function adminModePreferenceHref({
  mode,
  next,
}: {
  mode: AdminMode;
  next: string;
}): string {
  const params = new URLSearchParams({ mode, next });
  return `/api/admin/mode?${params.toString()}`;
}

export function isSafeAdminModeRedirect(value: string | null): value is string {
  if (!value) return false;
  if (!value.startsWith("/admin")) return false;
  if (value.startsWith("//")) return false;
  if (value.includes("\n") || value.includes("\r")) return false;
  return true;
}
