import {
  buildLinkClassificationContext,
  dealBaseAvailabilityReason,
  dealExpirationState,
  dealHasCustomerAvailableUpgrade,
  dealHiddenReason,
  dealStructuralRepairReason,
  isDealsCategory,
  itemVisibleInMenuFilter,
  type Cat,
  type Item,
  type LinkClassificationContext,
} from "@/lib/admin/menu/visibility";
import type { MenuAttention, MenuFilterState, MenuStatus } from "./types";
import { isMenuItemAvailable } from "@/lib/menu-availability";
import { isDealLimitLow, isDealLimitSoldOut } from "@/lib/deal-selling-limits";

/**
 * "Needs attention" predicate for a deal: saved as live but the customer
 * cannot actually buy it right now. Mirrors the dealsNeedAttentionCount
 * derivation in MenuEditor — single source of truth so the badge count and
 * the filter agree.
 */
export function dealNeedsAttention(
  item: Item,
  category: Cat,
  ctx: MatchContext,
): boolean {
  if (!isDealsCategory(category)) return false;
  if (!item.isActive) return false;
  if (dealStructuralRepairReason(item, ctx.linkContext)) return true;
  if (dealBaseAvailabilityReason(item, ctx.linkContext)) return true;
  if (dealExpirationState(item, ctx.serverNowMs) !== "active") return true;
  if (!dealHasCustomerAvailableUpgrade(item, ctx.linkContext)) return true;
  if (isDealLimitSoldOut(item) || isDealLimitLow(item)) return true;
  return false;
}

function isActiveNonDealInventoryRow(item: Item, category: Cat): boolean {
  return category.isActive && item.isActive && !isDealsCategory(category);
}

export function nonDealInventoryOutNeedsAttention(
  item: Item,
  category: Cat,
): boolean {
  return isActiveNonDealInventoryRow(item, category) && !isMenuItemAvailable(item);
}

export function nonDealInventoryLowNeedsAttention(
  item: Item,
  category: Cat,
): boolean {
  if (!isActiveNonDealInventoryRow(item, category)) return false;
  if (item.stockMode !== "QUANTITY") return false;
  if (item.lowStockThreshold == null) return false;

  const stockQty = item.stockQty ?? 0;
  return stockQty > 0 && stockQty <= item.lowStockThreshold;
}

function itemMatchesAttention(
  item: Item,
  category: Cat,
  attentions: readonly MenuAttention[],
  ctx: MatchContext,
): boolean {
  for (const a of attentions) {
    if (a === "deals" && dealNeedsAttention(item, category, ctx)) return true;
    if (a === "inventory-out" && nonDealInventoryOutNeedsAttention(item, category)) {
      return true;
    }
    if (a === "inventory-low" && nonDealInventoryLowNeedsAttention(item, category)) {
      return true;
    }
  }
  return false;
}

export type MatchContext = {
  itemById: Map<string, Item>;
  categoryById: Map<string, Cat>;
  linkContext: LinkClassificationContext;
  serverNowMs: number;
};

export function buildMatchContext(
  items: Item[],
  categories: Cat[],
  serverNowMs: number,
): MatchContext {
  const linkContext = buildLinkClassificationContext(items, categories);
  return {
    itemById: linkContext.itemById,
    categoryById: linkContext.categoryById,
    linkContext,
    serverNowMs,
  };
}

/**
 * Classify an item into a status bucket per the precedence rules from the
 * source plan §102-118:
 *   1. !item.isActive            -> "hidden"
 *   2. deal + scheduled/expired  -> "scheduled" / "expired"
 *   3. customer-visible right now -> "live"
 *   4. anything else (e.g. active deal with broken/incomplete options)
 *      -> null (matches no status:* filter)
 *
 * Stock is NOT a status bucket — it's a separate dimension matched via
 * `stock:in` / `stock:out`.
 */
export function classifyItemStatus(
  item: Item,
  category: Cat,
  ctx: MatchContext,
): MenuStatus | null {
  if (!item.isActive) return "hidden";
  const isDeal = isDealsCategory(category);
  if (isDeal) {
    const expirationState = dealExpirationState(item, ctx.serverNowMs);
    if (expirationState === "scheduled") return "scheduled";
    if (expirationState === "expired") return "expired";
  }
  if (itemVisibleInMenuFilter(item, category, ctx.serverNowMs, ctx.linkContext)) {
    return "live";
  }
  return null;
}

function tokenizeFreeText(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function buildItemHaystack(
  item: Item,
  category: Cat,
  ctx: MatchContext,
): string {
  const parts: string[] = [
    item.name,
    item.description,
    item.badge ?? "",
    item.comboNum != null ? String(item.comboNum) : "",
    category.name,
    category.slug,
    ...item.sizes.map((s) => s.name),
    ...item.addons.map((a) => a.name),
  ];

  if (item.dealBaseMenuItemId) {
    const baseItem = ctx.itemById.get(item.dealBaseMenuItemId);
    if (baseItem) parts.push(baseItem.name);
  }

  const status = classifyItemStatus(item, category, ctx);
  if (status) parts.push(status);

  parts.push(isMenuItemAvailable(item) ? "in stock" : "out of stock");

  if (isDealsCategory(category)) {
    const hasUpgrade = dealHasCustomerAvailableUpgrade(item, ctx.linkContext);
    const expirationState = dealExpirationState(item, ctx.serverNowMs);
    const repairReason = dealStructuralRepairReason(item, ctx.linkContext);
    const reason = dealHiddenReason(
      item,
      hasUpgrade,
      expirationState,
      repairReason,
      ctx.linkContext,
    );
    if (reason) parts.push(reason);
    const baseReason = dealBaseAvailabilityReason(item, ctx.linkContext);
    if (baseReason) parts.push(baseReason);
  }

  return parts.join(" ").toLowerCase();
}

function categoryMatchesQuery(
  category: Cat,
  queryTokens: string[],
): boolean {
  if (queryTokens.length === 0) return false;
  const haystack = `${category.name} ${category.slug}`.toLowerCase();
  return queryTokens.every((t) => haystack.includes(t));
}

function itemMatchesStructuredFields(
  item: Item,
  category: Cat,
  filter: MenuFilterState,
  ctx: MatchContext,
): boolean {
  if (filter.category != null && filter.category.length > 0) {
    if (!filter.category.includes(category.slug)) return false;
  }

  if (filter.badge != null && filter.badge !== "") {
    if (item.badge !== filter.badge) return false;
  }

  if (filter.status != null) {
    const status = classifyItemStatus(item, category, ctx);
    if (status !== filter.status) return false;
  }

  if (filter.stock != null) {
    const available = isMenuItemAvailable(item);
    if (filter.stock === "out" && available) return false;
    if (filter.stock === "in" && !available) return false;
  }

  if (filter.attention != null && filter.attention.length > 0) {
    if (!itemMatchesAttention(item, category, filter.attention, ctx)) {
      return false;
    }
  }

  return true;
}

/**
 * Decide whether an item matches the current filter state.
 *
 * Matching strategy:
 * 1. Structured fields (category/badge/status/stock) are AND-combined:
 *    every set field must match the item's classification.
 * 2. Free-text query is AND-combined with the structured fields. The query
 *    tokens are matched against a per-item haystack (name, description,
 *    badge, comboNum, category name+slug, deal-base name, status text,
 *    stock text, hidden-reason text, sizes, add-ons).
 * 3. Category-name shortcut preserved from the previous editor: when the
 *    free-text query matches a category name/slug, ALL items in that
 *    category match, not just those whose individual haystack contains
 *    the query. The matcher signals this via {category-name match} short-
 *    circuit — callers should use itemMatchesFilter together with
 *    categoryMatchesFilterFreeText for the per-section rendering.
 */
export function itemMatchesFilter(
  item: Item,
  category: Cat,
  filter: MenuFilterState,
  ctx: MatchContext,
): boolean {
  if (!itemMatchesStructuredFields(item, category, filter, ctx)) {
    return false;
  }

  if (filter.query == null || filter.query === "") return true;

  const tokens = tokenizeFreeText(filter.query);
  if (tokens.length === 0) return true;

  if (categoryMatchesQuery(category, tokens)) return true;

  const haystack = buildItemHaystack(item, category, ctx);
  return tokens.every((t) => haystack.includes(t));
}

/**
 * True when the free-text query matches the category's name or slug.
 * Used by MenuEditor to decide whether to show all items in this category
 * even if individual items don't match the query.
 */
export function categoryMatchesFilterFreeText(
  category: Cat,
  filter: MenuFilterState,
): boolean {
  if (filter.query == null || filter.query === "") return false;
  return categoryMatchesQuery(category, tokenizeFreeText(filter.query));
}
