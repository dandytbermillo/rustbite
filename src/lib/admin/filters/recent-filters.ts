import {
  isMenuFilterMultiKey,
  MENU_FILTER_STRUCTURED_KEYS,
  type MenuFilterState,
  type MenuFilterStructuredKey,
} from "./types";

export type RecentFilterEntry = {
  key: MenuFilterStructuredKey;
  value: string;
};

const STORAGE_KEY = "rushbite:menu-editor:recent-filters:v1";
const MAX_RECENT = 5;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function isValidEntry(raw: unknown): raw is RecentFilterEntry {
  if (raw == null || typeof raw !== "object") return false;
  const e = raw as Record<string, unknown>;
  if (typeof e.value !== "string" || e.value === "") return false;
  if (typeof e.key !== "string") return false;
  return (MENU_FILTER_STRUCTURED_KEYS as readonly string[]).includes(e.key);
}

export function loadRecentFilters(): RecentFilterEntry[] {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidEntry).slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

function saveRecentFilters(entries: RecentFilterEntry[]): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_RECENT)));
  } catch {
    // localStorage can throw (Safari private mode, quota). Silent failure
    // is acceptable here — recent-filters is a UX nicety, not load-bearing.
  }
}

/**
 * Compute the per-value entries that exist in `next` but not in `prev`.
 * For multi-keys, each value is its own entry. For single-keys, the entry
 * is the field's value when it differs.
 */
export function diffAddedFilterValues(
  prev: MenuFilterState,
  next: MenuFilterState,
): RecentFilterEntry[] {
  const added: RecentFilterEntry[] = [];
  for (const key of MENU_FILTER_STRUCTURED_KEYS) {
    const prevValue = prev[key];
    const nextValue = next[key];
    if (isMenuFilterMultiKey(key)) {
      const prevArr = Array.isArray(prevValue) ? (prevValue as string[]) : [];
      const nextArr = Array.isArray(nextValue) ? (nextValue as string[]) : [];
      for (const v of nextArr) {
        if (!prevArr.includes(v)) added.push({ key, value: v });
      }
    } else {
      const p = typeof prevValue === "string" ? prevValue : null;
      const n = typeof nextValue === "string" ? nextValue : null;
      if (n != null && n !== "" && n !== p) {
        added.push({ key, value: n });
      }
    }
  }
  return added;
}

/**
 * Update the persisted recent-filters list given a filter transition.
 * No-op when nothing was added. Newly-added entries are moved to the front
 * (MRU); duplicates are deduped on `${key}:${value}`.
 */
export function recordFilterUsage(
  prev: MenuFilterState,
  next: MenuFilterState,
): void {
  const added = diffAddedFilterValues(prev, next);
  if (added.length === 0) return;
  const existing = loadRecentFilters();
  const filtered = existing.filter(
    (e) => !added.some((a) => a.key === e.key && a.value === e.value),
  );
  saveRecentFilters([...added, ...filtered]);
}

/**
 * True when the recent entry is currently part of the active filter state.
 * Used to hide already-applied entries from the "Recent" dropdown section
 * so it doesn't echo chips the operator can already see.
 */
export function isEntryCurrentlyActive(
  entry: RecentFilterEntry,
  filter: MenuFilterState,
): boolean {
  const value = filter[entry.key];
  if (Array.isArray(value)) return (value as string[]).includes(entry.value);
  return value === entry.value;
}

export function getRecentFiltersExcludingActive(
  filter: MenuFilterState,
): RecentFilterEntry[] {
  return loadRecentFilters().filter(
    (entry) => !isEntryCurrentlyActive(entry, filter),
  );
}

/** Test-only helper: clears persisted state. */
export function __clearRecentFiltersForTest(): void {
  if (!isBrowser()) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
