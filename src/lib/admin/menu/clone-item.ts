import type { Item } from "@/lib/admin/menu/visibility";

const COPY_SUFFIX = " (Copy)";
// EditItemModal:229 enforces maxLength={60} on the name input even though the
// server validator at menu-admin.ts:836 allows up to 80. We truncate to the
// modal's tighter cap so a duplicated name remains editable in the input
// without appearing pre-clipped. If the modal's maxLength is later raised,
// bump this to 80 (still safe — server validator allows it).
const ITEM_NAME_MAX = 60;

/**
 * Truncate the source name so the " (Copy)" suffix fits inside the modal's
 * input cap. A pure 60-char source name would otherwise produce 67 chars and
 * the input would silently clip the menu manager's edits.
 */
export function suffixCopy(name: string): string {
  const headroom = ITEM_NAME_MAX - COPY_SUFFIX.length; // 53
  const head =
    name.length > headroom ? name.slice(0, headroom).trimEnd() : name;
  return `${head}${COPY_SUFFIX}`;
}

/**
 * Place the duplicate at the end of its category, gap-safe. Length-based
 * sortOrder is unsafe because deletions or reorders create gaps; a
 * length-based value can collide with a real existing sortOrder.
 * `Math.max(-1, ...orders) + 1` seeds correctly for empty categories.
 */
export function nextBottomSortOrder(
  items: ReadonlyArray<{ sortOrder: number }>,
): number {
  return Math.max(-1, ...items.map((i) => i.sortOrder)) + 1;
}

/**
 * Build a draft Item suitable for the create modal from a source item.
 *
 * Safety rules (each one prevents a real bug or UX foot-gun):
 *
 * 1. Strip top-level id and reset updatedAt — fresh row, fresh timestamp.
 *    (Item has no createdAt/outletId fields — those live on the Prisma row.)
 * 2. Strip stockUpdatedAt, stockUpdatedById — POST item ledger writes its
 *    own initial stock movement; copying these fields produces phantom history.
 * 3. Reset stock state: stockMode → MANUAL, stockQty → null,
 *    lowStockThreshold → null, isOutOfStock → false. Avoids inheriting
 *    "50 units in stock" and the misleading initial-quantity audit row that
 *    POST item writes when stockMode === "QUANTITY" (route.ts:549).
 * 4. Strip comboNum — Int? but not unique in the schema; two deals sharing
 *    a comboNum confuse customers/receipts.
 * 5. Strip dealExpiresAt and dealBaseMenuItemId — only relevant for deals;
 *    v1 doesn't allow deal duplication so these are null on the source.
 *    Also force upgradeOptions: [] (see rule 11). The create route at
 *    route.ts:370 returns 400 (`non_deal_upgrade_options_not_allowed`) if
 *    a non-deal create carries upgradeOptions. Today the DB invariant is
 *    "no non-deal upgrades", but defensively forcing [] insulates duplicate
 *    from any future legacy row that violates the invariant.
 * 6. Replace nested ids with unique temp IDs ("new-size-0", "new-addon-0",
 *    etc.) — NOT empty strings. The validators at menu-admin.ts:228, 298
 *    strip both, but unique React keys matter for the modal's nested editor
 *    AND for any future code that maps over rows during edit. POST item
 *    persists nested ids when present (route.ts:511, 530), so naive copy → P2002.
 * 7. Force isActive = false — duplicate is a hidden draft. Menu manager/admin
 *    explicitly publishes after review. Prevents two identical live items
 *    from appearing on the kiosk.
 * 8. Suffix name with " (Copy)" — visible signal that it's a duplicate.
 *    Truncate to 53 chars first so the suffix fits inside the 60-char modal
 *    input cap at EditItemModal.tsx:229.
 * 9. sortOrder = max(existing sortOrders) + 1 — places at end. Using
 *    itemsInCategory.length is wrong because sortOrders can have gaps
 *    (after deletions or reorders), so a length-based value can collide
 *    with a real existing sortOrder.
 * 10. imageUrl, imageAlt, imageFit, cardImageUrl, cardImageAlt: copy as-is.
 *     Both items reference the same CDN object. Documented sharing.
 */
export function cloneItemAsDraft(
  source: Item,
  itemsInCategory: Item[],
): Item {
  return {
    id: "new-item",
    categoryId: source.categoryId,
    name: suffixCopy(source.name),
    description: source.description,
    price: source.price,
    emoji: source.emoji,
    bgColor: source.bgColor,
    badge: source.badge,
    bundleSavings: source.bundleSavings,
    imageUrl: source.imageUrl,
    imageAlt: source.imageAlt,
    imageFit: source.imageFit,
    cardImageUrl: source.cardImageUrl,
    cardImageAlt: source.cardImageAlt,
    isActive: false,
    isOutOfStock: false,
    stockMode: "MANUAL",
    stockQty: null,
    lowStockThreshold: null,
    stockUpdatedAt: null,
    stockUpdatedById: null,
    comboNum: null,
    dealBaseMenuItemId: null,
    dealBaseSizeId: null,
    dealBaseSizeNameSnapshot: null,
    dealStartsAt: null,
    dealExpiresAt: null,
    sortOrder: nextBottomSortOrder(itemsInCategory),
    lockVersion: 0,
    updatedAt: new Date(0).toISOString(),
    sizes: source.sizes.map((size, i) => ({
      id: `new-size-${i}`,
      name: size.name,
      priceDelta: size.priceDelta,
    })),
    addons: source.addons.map((addon, i) => ({
      id: `new-addon-${i}`,
      name: addon.name,
      priceDelta: addon.priceDelta,
    })),
    // v1 only duplicates non-deal items, and the create route rejects
    // upgradeOptions on non-deals (route.ts:370). Force empty array — even
    // if a legacy non-deal row somehow has upgrades attached, the duplicate
    // won't 400. Deal duplication is a deferred follow-up.
    upgradeOptions: [],
  };
}
