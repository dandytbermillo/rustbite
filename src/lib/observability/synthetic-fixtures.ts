// Stable synthetic-monitor fixture identifiers + the single shared
// synthetic-exclusion predicate. Intentionally pure (no prisma, no
// server-only) so lib code, route handlers, the seed script, and tests can
// all import it without a runtime shim.

export const SYNTHETIC_OUTLET_ID = "synthetic-monitor-outlet";
export const SYNTHETIC_DEVICE_ID = "synthetic-monitor-device";

export const SYNTHETIC_DEVICE_ACCESS_CODE_ENV = "SYNTHETIC_DEVICE_ACCESS_CODE";

/**
 * Prisma `where` fragment that excludes synthetic Outlet/Device rows.
 * The ONE predicate every normal admin/business surface must use so
 * synthetic fixtures never pollute lists, validators, or (later, #3)
 * KPI / fleet-health queries.
 */
export function syntheticExcludeWhere(): { isSynthetic: false } {
  return { isSynthetic: false };
}

/** Inverse — selects only synthetic rows (tests / future synthetic-only
 * reporting). */
export function syntheticOnlyWhere(): { isSynthetic: true } {
  return { isSynthetic: true };
}

/**
 * True if a fetched Outlet/Device row is the synthetic fixture. Used by the
 * shared by-id admin mutation guard. Checks the flag first; the id fallback
 * is belt-and-suspenders for callers whose `select` omitted `isSynthetic`.
 */
export function isSyntheticRow(
  row: { id?: string | null; isSynthetic?: boolean | null } | null | undefined
): boolean {
  if (!row) return false;
  if (row.isSynthetic === true) return true;
  return row.id === SYNTHETIC_OUTLET_ID || row.id === SYNTHETIC_DEVICE_ID;
}
