"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Search, X, SlidersHorizontal } from "lucide-react";
import {
  buildFieldCatalogue,
  findFieldEntry,
  isValidFieldValue,
  type FieldCatalogueEntry,
} from "@/lib/admin/filters/fields";
import {
  parseInput,
  structuredKeysWithValues,
  suggestStructuredPromotion,
} from "@/lib/admin/filters/parser";
import {
  MENU_FILTER_STRUCTURED_KEYS,
  isMenuFilterMultiKey,
  type HistoryMethod,
  type MenuFilterState,
  type MenuFilterStructuredKey,
} from "@/lib/admin/filters/types";
import {
  getRecentFiltersExcludingActive,
  recordFilterUsage,
  type RecentFilterEntry,
} from "@/lib/admin/filters/recent-filters";
import type { Cat } from "@/lib/admin/menu/visibility";

type DropdownRow =
  | {
      kind: "quick" | "field" | "value" | "promotion" | "free-text";
      key: string;
      label: string;
      hint?: string;
      apply: () => void;
    };

type Props = {
  filter: MenuFilterState;
  categories: Cat[];
  onFilterChange: (next: MenuFilterState, method: HistoryMethod) => void;
  setSingleFilter: <K extends MenuFilterStructuredKey | "query">(
    key: K,
    value: MenuFilterState[K],
    method: HistoryMethod,
  ) => void;
  onOpenBuilder: () => void;
  inputTestId?: string;
};

const QUICK_FILTERS: Array<{
  key: MenuFilterStructuredKey;
  value: string;
  label: string;
}> = [
  { key: "status", value: "live", label: "status: live" },
  { key: "status", value: "hidden", label: "status: hidden" },
  { key: "status", value: "expired", label: "status: expired" },
  { key: "stock", value: "out", label: "stock: out" },
];

export default function SearchField({
  filter,
  categories,
  onFilterChange,
  setSingleFilter,
  onOpenBuilder,
  inputTestId,
}: Props) {
  const catalogue = useMemo(
    () => buildFieldCatalogue(categories),
    [categories],
  );

  const [inputValue, setInputValue] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [recents, setRecents] = useState<RecentFilterEntry[]>([]);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();
  const previousFilterRef = useRef<MenuFilterState>(filter);

  // Keep input mirrored to the canonical query when external state changes
  // (e.g., URL hydration, popstate). We intentionally do not echo every
  // typed keystroke back through the props — only sync when the controlled
  // value differs in a way that suggests an external update.
  useEffect(() => {
    if ((filter.query ?? "") !== inputValue) {
      setInputValue(filter.query ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.query]);

  // Persist newly-added structured chips to localStorage so the "Recent"
  // dropdown section can offer them on the next session. Diff-based so any
  // commit path (chip click, builder modal, attention badge, URL hydration)
  // gets recorded without per-call instrumentation. Recompute the visible
  // recent list whenever the filter changes so already-active chips are
  // hidden.
  useEffect(() => {
    recordFilterUsage(previousFilterRef.current, filter);
    previousFilterRef.current = filter;
    setRecents(getRecentFiltersExcludingActive(filter));
  }, [filter]);

  // Initial-mount recents read (in case the filter never changes after
  // mount, e.g. an empty initial state with no URL params).
  useEffect(() => {
    setRecents(getRecentFiltersExcludingActive(filter));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onClickOutside);
    return () => window.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  type ActiveChip = {
    key: MenuFilterStructuredKey;
    value: string;
    label: string;
    onRemove: () => void;
  };

  const activeChips = useMemo<ActiveChip[]>(() => {
    const keys = structuredKeysWithValues(filter);
    const chips: ActiveChip[] = [];
    for (const key of keys) {
      const entry = findFieldEntry(catalogue, key);
      if (isMenuFilterMultiKey(key)) {
        const values = (filter[key] ?? []) as string[];
        for (const value of values) {
          const option = entry?.options.find((o) => o.value === value);
          chips.push({
            key,
            value,
            label: `${key}: ${option?.label ?? value}`,
            onRemove: () => {
              const remaining = values.filter((v) => v !== value);
              setSingleFilter(
                key,
                (remaining.length === 0 ? undefined : remaining) as never,
                "push",
              );
            },
          });
        }
      } else {
        const value = String(filter[key]);
        const option = entry?.options.find((o) => o.value === value);
        chips.push({
          key,
          value,
          label: `${key}: ${option?.label ?? value}`,
          onRemove: () => setSingleFilter(key, undefined as never, "push"),
        });
      }
    }
    return chips;
  }, [filter, catalogue, setSingleFilter]);

  const rows = useMemo<DropdownRow[]>(() => {
    return buildDropdownRows({
      inputValue,
      catalogue,
      filter,
      recents,
      onFilterChange,
      setSingleFilter,
      setInputValue,
      setOpen,
    });
  }, [inputValue, catalogue, filter, recents, onFilterChange, setSingleFilter]);

  // Keep highlight in range when rows change.
  useEffect(() => {
    if (highlight >= rows.length) setHighlight(Math.max(0, rows.length - 1));
  }, [rows.length, highlight]);

  const commitInputAsFreeText = (method: HistoryMethod) => {
    const parsed = parseInput(inputValue, catalogue);
    onFilterChange({ ...filter, ...parsed }, method);
    if (parsed.query == null) setInputValue("");
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlight((h) => (rows.length === 0 ? 0 : (h + 1) % rows.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setHighlight((h) =>
        rows.length === 0 ? 0 : (h - 1 + rows.length) % rows.length,
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (open && rows[highlight]) {
        rows[highlight].apply();
      } else {
        commitInputAsFreeText("push");
      }
      return;
    }
    if (event.key === "Tab") {
      // Tab commits ONLY when the dropdown is open AND a row is highlighted;
      // otherwise default focus traversal preserves a11y.
      if (open && rows[highlight]) {
        event.preventDefault();
        rows[highlight].apply();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === "Backspace" && inputValue.length === 0 && activeChips.length > 0) {
      event.preventDefault();
      activeChips[activeChips.length - 1].onRemove();
      return;
    }
  };

  return (
    <div ref={containerRef} className="relative w-full sm:w-[28rem]">
      <div
        className="flex items-center flex-wrap gap-1.5 rounded-xl border border-stone-200 bg-stone-50 pl-3 pr-2 py-1.5 focus-within:bg-white focus-within:border-stone-400 transition-colors"
        onClick={() => inputRef.current?.focus()}
      >
        <Search
          size={16}
          className="text-stone-500 pointer-events-none shrink-0"
        />
        {activeChips.map((chip) => (
          <span
            key={`${chip.key}:${chip.value}`}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-stone-300 text-xs font-bold text-stone-700"
          >
            {chip.label}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                chip.onRemove();
              }}
              aria-label={`Remove filter: ${chip.label}`}
              className="inline-flex items-center justify-center w-4 h-4 rounded-full text-stone-500 hover:text-stone-900 hover:bg-stone-200"
            >
              <X size={12} strokeWidth={2.5} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          data-testid={inputTestId}
          value={inputValue}
          onChange={(e) => {
            const next = e.target.value;
            setInputValue(next);
            setOpen(true);
            setHighlight(0);
            // Free-text typing: replaceState (no history-spam).
            onFilterChange(
              { ...filter, query: next === "" ? undefined : next },
              "replace",
            );
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={
            activeChips.length === 0
              ? "Search or filter (try category:deals)"
              : ""
          }
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && rows[highlight] ? `${listboxId}-${highlight}` : undefined
          }
          className="flex-1 min-w-[8rem] bg-transparent text-sm font-bold text-stone-900 placeholder:font-medium placeholder:text-stone-500 focus:outline-none py-1"
        />
        {inputValue.length > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setInputValue("");
              setSingleFilter("query", undefined, "push");
              inputRef.current?.focus();
            }}
            aria-label="Clear search text"
            title="Clear search text"
            className="inline-flex items-center justify-center w-6 h-6 rounded-full text-stone-500 hover:text-stone-900 hover:bg-stone-200 transition-colors"
          >
            <X size={14} strokeWidth={2.5} />
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenBuilder();
          }}
          aria-label="Open filter builder"
          title="Build filter"
          className="inline-flex items-center justify-center w-7 h-7 rounded-full text-stone-500 hover:text-stone-900 hover:bg-stone-200 transition-colors"
        >
          <SlidersHorizontal size={14} strokeWidth={2.5} />
        </button>
      </div>

      {open && rows.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 mt-1.5 max-h-72 overflow-y-auto rounded-xl border border-stone-200 bg-white shadow-lg z-40 py-1"
        >
          {rows.map((row, idx) => {
            const selected = idx === highlight;
            return (
              <li
                id={`${listboxId}-${idx}`}
                key={`${row.kind}-${row.key}`}
                role="option"
                aria-selected={selected}
                onMouseDown={(e) => {
                  e.preventDefault();
                  row.apply();
                }}
                onMouseEnter={() => setHighlight(idx)}
                className={`flex items-center justify-between gap-2 px-3 py-1.5 cursor-pointer text-sm ${
                  selected ? "bg-stone-100" : "hover:bg-stone-50"
                }`}
              >
                <span className="font-bold text-stone-900">{row.label}</span>
                {row.hint && (
                  <span className="text-xs font-medium text-stone-500">
                    {row.hint}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function buildDropdownRows({
  inputValue,
  catalogue,
  filter,
  recents,
  onFilterChange,
  setSingleFilter,
  setInputValue,
  setOpen,
}: {
  inputValue: string;
  catalogue: FieldCatalogueEntry[];
  filter: MenuFilterState;
  recents: RecentFilterEntry[];
  onFilterChange: (next: MenuFilterState, method: HistoryMethod) => void;
  setSingleFilter: <K extends MenuFilterStructuredKey | "query">(
    key: K,
    value: MenuFilterState[K],
    method: HistoryMethod,
  ) => void;
  setInputValue: (value: string) => void;
  setOpen: (open: boolean) => void;
}): DropdownRow[] {
  const trimmed = inputValue.trim();

  // Empty input: show "Recently used" (above) + quick filters.
  if (trimmed.length === 0) {
    const rows: DropdownRow[] = [];
    for (const entry of recents) {
      const fieldEntry = findFieldEntry(catalogue, entry.key);
      // Drop entries whose value is no longer in the catalogue (e.g., a
      // category that was deleted since the entry was recorded).
      if (!fieldEntry?.options.some((o) => o.value === entry.value)) continue;
      const option = fieldEntry.options.find((o) => o.value === entry.value);
      rows.push({
        kind: "quick",
        key: `recent-${entry.key}-${entry.value}`,
        label: `${entry.key}: ${option?.label ?? entry.value}`,
        hint: "recently used",
        apply: () => {
          if (isMenuFilterMultiKey(entry.key)) {
            const current =
              ((filter[entry.key] as string[] | undefined) ?? []).slice();
            if (!current.includes(entry.value)) current.push(entry.value);
            setSingleFilter(entry.key, current as never, "push");
          } else {
            setSingleFilter(entry.key, entry.value as never, "push");
          }
          setInputValue("");
          setOpen(false);
        },
      });
    }
    for (const qf of QUICK_FILTERS) {
      if (filter[qf.key] === qf.value) continue;
      rows.push({
        kind: "quick",
        key: `quick-${qf.key}-${qf.value}`,
        label: qf.label,
        hint: "quick filter",
        apply: () => {
          setSingleFilter(qf.key, qf.value as never, "push");
          setInputValue("");
          setOpen(false);
        },
      });
    }
    return rows;
  }

  // After "field:": show value picker.
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx > 0) {
    const fieldRaw = trimmed.slice(0, colonIdx);
    const valuePrefix = trimmed.slice(colonIdx + 1).toLowerCase();
    const entry = findFieldEntry(catalogue, fieldRaw);
    if (entry) {
      const isMulti = isMenuFilterMultiKey(entry.key);
      const matches = entry.options.filter((o) =>
        valuePrefix === ""
          ? true
          : o.value.toLowerCase().includes(valuePrefix) ||
            o.label.toLowerCase().includes(valuePrefix),
      );
      const rows: DropdownRow[] = [];
      if (isMulti) {
        const currentValues =
          ((filter[entry.key] as string[] | undefined) ?? []).slice();
        const allActive = currentValues.length === 0;
        rows.push({
          kind: "value",
          key: `value-${entry.key}-__all__`,
          label: `${entry.key}: All${allActive ? " ✓" : ""}`,
          hint: "show every value",
          apply: () => {
            setSingleFilter(entry.key, undefined as never, "push");
            setInputValue("");
            setOpen(false);
          },
        });
        for (const option of matches.slice(0, 12)) {
          const selected = currentValues.includes(option.value);
          rows.push({
            kind: "value",
            key: `value-${entry.key}-${option.value}`,
            label: `${entry.key}: ${option.label}${selected ? " ✓" : ""}`,
            hint: option.value === option.label ? undefined : option.value,
            apply: () => {
              const next = selected
                ? currentValues.filter((v) => v !== option.value)
                : [...currentValues, option.value];
              setSingleFilter(
                entry.key,
                (next.length === 0 ? undefined : next) as never,
                "push",
              );
              // Keep dropdown open so the operator can pick more values;
              // they close it explicitly with Esc, click-outside, or by
              // clearing the input.
            },
          });
        }
      } else {
        for (const option of matches.slice(0, 12)) {
          rows.push({
            kind: "value",
            key: `value-${entry.key}-${option.value}`,
            label: `${entry.key}: ${option.label}`,
            hint: option.value === option.label ? undefined : option.value,
            apply: () => {
              setSingleFilter(entry.key, option.value as never, "push");
              setInputValue("");
              setOpen(false);
            },
          });
        }
      }
      return rows;
    }
  }

  const rows: DropdownRow[] = [];

  // "Did you mean a structured filter?" — single-match promotion only.
  const promotion = suggestStructuredPromotion(trimmed, catalogue);
  if (promotion) {
    const entry = findFieldEntry(catalogue, promotion.key);
    const option = entry?.options.find((o) => o.value === promotion.value);
    rows.push({
      kind: "promotion",
      key: `promo-${promotion.key}-${promotion.value}`,
      label: `${promotion.key}: ${option?.label ?? promotion.value}`,
      hint: "did you mean a structured filter?",
      apply: () => {
        if (isMenuFilterMultiKey(promotion.key)) {
          const current =
            ((filter[promotion.key] as string[] | undefined) ?? []).slice();
          if (!current.includes(promotion.value)) current.push(promotion.value);
          setSingleFilter(promotion.key, current as never, "push");
        } else {
          setSingleFilter(promotion.key, promotion.value as never, "push");
        }
        setInputValue("");
        setOpen(false);
      },
    });
  }

  // Field-name suggestions when typing a partial field name without a colon.
  if (!trimmed.includes(":")) {
    const fieldMatches = MENU_FILTER_STRUCTURED_KEYS.filter((k) =>
      k.startsWith(trimmed.toLowerCase()),
    );
    for (const key of fieldMatches) {
      const entry = findFieldEntry(catalogue, key);
      if (!entry) continue;
      rows.push({
        kind: "field",
        key: `field-${key}`,
        label: `${key}:`,
        hint: entry.description,
        apply: () => {
          setInputValue(`${key}:`);
        },
      });
    }
  }

  // Free-text fallback row — explicit commit so users know what Enter does.
  rows.push({
    kind: "free-text",
    key: `free-${trimmed}`,
    label: `Search "${trimmed}"`,
    hint: "free text",
    apply: () => {
      const parsed = parseInput(inputValue, catalogue);
      onFilterChange({ ...filter, ...parsed }, "push");
      if (parsed.query == null) setInputValue("");
      setOpen(false);
    },
  });

  return rows;
}

// Re-validate at runtime that a field/value pair is acceptable. Exported
// so the builder modal can share the same predicate.
export { isValidFieldValue };
