import { NextResponse } from "next/server";
import { isSyntheticRow } from "./synthetic-fixtures";

/**
 * The single durable by-id mutation guard. Returns a 404 `NextResponse` if
 * the fetched Device/Outlet row is the synthetic fixture (maintained ONLY
 * by the seed script), else `null`.
 *
 * Apply uniformly to EVERY by-id admin Device/Outlet mutation route:
 *
 *   const blocked = syntheticByIdNotFound(existing);
 *   if (blocked) return blocked;
 *
 * Centralised + `isSyntheticRow`-based (incl. the id fallback) so a newly
 * added by-id route is covered by calling this, not by re-deriving the
 * check — that is the whole point (no enumerate-and-patch). The 404 body
 * matches the routes' own not-found response so the fixture is not
 * disclosed differently from a genuinely missing row.
 */
export function syntheticByIdNotFound(
  row: { id?: string | null; isSynthetic?: boolean | null } | null | undefined
): NextResponse | null {
  if (isSyntheticRow(row)) {
    return NextResponse.json({ error: "Device not found" }, { status: 404 });
  }
  return null;
}
