import {
  MENU_FILTER_STRUCTURED_KEYS,
  isMenuFilterMultiKey,
  type MenuFilterState,
} from "./types";
import { isValidFieldValue, type FieldCatalogueEntry } from "./fields";

/**
 * Encode filter state to URLSearchParams. Empty fields are omitted so the
 * empty state encodes to an empty params object (caller decides whether to
 * strip the query string entirely).
 *
 * Multi-value fields use repeated-key encoding (`?category=deals&category=burgers`)
 * to keep each value addressable individually and roundtrip-clean.
 */
export function encodeFilter(filter: MenuFilterState): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of MENU_FILTER_STRUCTURED_KEYS) {
    const value = filter[key];
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const v of value) {
        if (v != null && v !== "") params.append(key, v);
      }
    } else if (value !== "") {
      params.set(key, String(value));
    }
  }
  if (filter.query != null && filter.query !== "") {
    params.set("q", filter.query);
  }
  return params;
}

/**
 * Decode URLSearchParams to filter state, validating each value against the
 * catalogue. Unknown/invalid values are dropped silently in production; in
 * development a console.warn helps debugging.
 *
 * For multi-value fields, repeated-key form is preferred but legacy single-key
 * URLs (`?category=deals`) still decode correctly because `params.getAll`
 * returns `["deals"]` in both cases.
 */
export function decodeFilter(
  params: URLSearchParams,
  catalogue: FieldCatalogueEntry[],
): MenuFilterState {
  const next: MenuFilterState = {};
  const isDev = process.env.NODE_ENV === "development";

  for (const key of MENU_FILTER_STRUCTURED_KEYS) {
    if (isMenuFilterMultiKey(key)) {
      const values = params.getAll(key).filter((v) => v !== "");
      const valid: string[] = [];
      for (const raw of values) {
        if (isValidFieldValue(catalogue, key, raw)) {
          if (!valid.includes(raw)) valid.push(raw);
        } else if (isDev) {
          console.warn(
            `[admin/filters] dropped invalid URL value for ${key}: ${raw}`,
          );
        }
      }
      if (valid.length > 0) {
        (next as Record<string, string[]>)[key] = valid;
      }
      continue;
    }

    const raw = params.get(key);
    if (raw == null || raw === "") continue;
    if (isValidFieldValue(catalogue, key, raw)) {
      (next as Record<string, string>)[key] = raw;
    } else if (isDev) {
      console.warn(
        `[admin/filters] dropped invalid URL value for ${key}: ${raw}`,
      );
    }
  }

  const q = params.get("q");
  if (q != null && q !== "") next.query = q;

  return next;
}

export function encodeFilterToString(filter: MenuFilterState): string {
  const params = encodeFilter(filter);
  const str = params.toString();
  return str.length > 0 ? `?${str}` : "";
}
