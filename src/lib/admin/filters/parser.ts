import {
  MENU_FILTER_STRUCTURED_KEYS,
  isMenuFilterMultiKey,
  type MenuFilterState,
  type MenuFilterStructuredKey,
} from "./types";
import { isValidFieldValue, type FieldCatalogueEntry } from "./fields";

const STRUCTURED_KEYS = new Set<string>(MENU_FILTER_STRUCTURED_KEYS);

/**
 * Parse a free-form input string into a MenuFilterState.
 *
 * Rules:
 * - `field:value` syntax creates a structured token when the field is
 *   recognized AND the value validates against the catalogue.
 * - Unknown fields (`expires:<7d`, `foo:bar`) and invalid values fall
 *   through into `query` as the literal token.
 * - Bare words like `live`, `HOT`, `chicken` stay in `query`. Never
 *   auto-promote to a structured token — that requires explicit
 *   acceptance of an autocomplete suggestion.
 *
 * Single-valued keys (badge/status/stock): last value wins
 * (`status:live status:hidden` → `status:hidden`).
 *
 * Multi-valued keys (category): values accumulate
 * (`category:deals category:burgers` → `category:["deals","burgers"]`).
 * Duplicate values within the same input are de-duplicated.
 */
export function parseInput(
  input: string,
  catalogue: FieldCatalogueEntry[],
): MenuFilterState {
  const next: MenuFilterState = {};
  const queryTokens: string[] = [];

  const tokens = input.trim().split(/\s+/).filter((t) => t.length > 0);
  for (const token of tokens) {
    const colonIdx = token.indexOf(":");
    if (colonIdx > 0 && colonIdx < token.length - 1) {
      const key = token.slice(0, colonIdx);
      const value = token.slice(colonIdx + 1);
      if (
        STRUCTURED_KEYS.has(key) &&
        isValidFieldValue(catalogue, key, value)
      ) {
        if (isMenuFilterMultiKey(key)) {
          const arr = (next as Record<string, string[]>)[key] ?? [];
          if (!arr.includes(value)) arr.push(value);
          (next as Record<string, string[]>)[key] = arr;
        } else {
          (next as Record<string, string>)[key] = value;
        }
        continue;
      }
    }
    queryTokens.push(token);
  }

  const query = queryTokens.join(" ").trim();
  if (query.length > 0) next.query = query;
  return next;
}

/**
 * Build a "did you mean" structured promotion suggestion for a bare
 * value. Returns the matching {key, value} pair if exactly one
 * structured field would accept this token, otherwise null.
 *
 * The autocomplete UI is responsible for actually committing the
 * promotion — the parser never silently promotes bare values.
 */
export function suggestStructuredPromotion(
  value: string,
  catalogue: FieldCatalogueEntry[],
): { key: MenuFilterStructuredKey; value: string } | null {
  const matches: Array<{ key: MenuFilterStructuredKey; value: string }> = [];
  for (const entry of catalogue) {
    for (const option of entry.options) {
      if (option.value.toLowerCase() === value.toLowerCase()) {
        matches.push({ key: entry.key, value: option.value });
      }
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

export function structuredKeysWithValues(
  filter: MenuFilterState,
): MenuFilterStructuredKey[] {
  return MENU_FILTER_STRUCTURED_KEYS.filter((key) => {
    const value = filter[key];
    if (value == null) return false;
    if (Array.isArray(value)) return value.length > 0;
    return value !== "";
  });
}
