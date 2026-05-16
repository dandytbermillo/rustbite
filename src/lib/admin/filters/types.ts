export type MenuStatus = "live" | "hidden" | "scheduled" | "expired";
export type MenuStock = "in" | "out";
export type MenuAttention = "deals" | "inventory-out" | "inventory-low";

export type MenuFilterState = {
  category?: string[];
  badge?: string;
  status?: MenuStatus;
  stock?: MenuStock;
  attention?: MenuAttention[];
  query?: string;
};

export const MENU_FILTER_STRUCTURED_KEYS = [
  "category",
  "badge",
  "status",
  "stock",
  "attention",
] as const;

export type MenuFilterStructuredKey =
  (typeof MENU_FILTER_STRUCTURED_KEYS)[number];

export const MENU_FILTER_MULTI_KEYS = ["category", "attention"] as const;
export type MenuFilterMultiKey = (typeof MENU_FILTER_MULTI_KEYS)[number];

export function isMenuFilterMultiKey(
  key: string,
): key is MenuFilterMultiKey {
  return (MENU_FILTER_MULTI_KEYS as readonly string[]).includes(key);
}

export const MENU_STATUS_VALUES: readonly MenuStatus[] = [
  "live",
  "hidden",
  "scheduled",
  "expired",
];

export const MENU_STOCK_VALUES: readonly MenuStock[] = ["in", "out"];

export const MENU_ATTENTION_VALUES: readonly MenuAttention[] = [
  "deals",
  "inventory-out",
  "inventory-low",
];

export type HistoryMethod = "replace" | "push";

export function isMenuFilterEmpty(filter: MenuFilterState): boolean {
  if (filter.category != null && filter.category.length > 0) return false;
  if (filter.badge != null && filter.badge !== "") return false;
  if (filter.status != null) return false;
  if (filter.stock != null) return false;
  if (filter.attention != null && filter.attention.length > 0) return false;
  if (filter.query != null && filter.query !== "") return false;
  return true;
}
