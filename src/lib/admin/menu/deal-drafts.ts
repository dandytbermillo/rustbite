import { ADMIN_MENU_BADGES } from "@/lib/menu-admin";
import {
  defaultDealEndIso,
  defaultDealStartIso,
} from "@/lib/deal-schedule";
import type { MenuItemSnapshot } from "@/lib/menu-history";
import type {
  AdminUpgradeItemLinkInput,
  AdminUpgradeOptionInput,
  Category,
  Item,
} from "@/components/admin/menu-editor";

function newTempId(prefix: string): string {
  return `new-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function dealMatchKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function isDealsCategoryId(categoryId: string, categories: Category[]): boolean {
  return categories.find((category) => category.id === categoryId)?.slug === "deals";
}

function findRestorableBaseItem({
  snapshot,
  allItems,
  categories,
}: {
  snapshot: MenuItemSnapshot;
  allItems: Item[];
  categories: Category[];
}): Item | null {
  const byHistoricalId =
    snapshot.dealBaseMenuItemId != null
      ? (allItems.find(
          (item) =>
            item.id === snapshot.dealBaseMenuItemId &&
            !isDealsCategoryId(item.categoryId, categories),
        ) ?? null)
      : null;
  if (byHistoricalId) return byHistoricalId;

  const normalizedName = dealMatchKey(snapshot.name);
  return (
    allItems.find(
      (item) =>
        item.isActive &&
        !isDealsCategoryId(item.categoryId, categories) &&
        dealMatchKey(item.name) === normalizedName,
    ) ?? null
  );
}

function findRestorableBaseSize(
  snapshot: MenuItemSnapshot,
  baseItem: Item | null,
) {
  if (!baseItem) return null;
  const byId =
    snapshot.dealBaseSizeId != null
      ? (baseItem.sizes.find((size) => size.id === snapshot.dealBaseSizeId) ??
        null)
      : null;
  if (byId) return byId;

  const normalizedName =
    snapshot.dealBaseSizeNameSnapshot != null
      ? dealMatchKey(snapshot.dealBaseSizeNameSnapshot)
      : "";
  if (!normalizedName) return null;
  return (
    baseItem.sizes.find((size) => dealMatchKey(size.name) === normalizedName) ??
    null
  );
}

function sanitizeHistoryUpgradeOptions({
  snapshot,
  dealsCategory,
  allItems,
  categories,
}: {
  snapshot: MenuItemSnapshot;
  dealsCategory: Category;
  allItems: Item[];
  categories: Category[];
}): AdminUpgradeOptionInput[] {
  return snapshot.upgradeOptions
    .map((upgrade) => ({
      id: newTempId("upgrade"),
      customTitle: upgrade.customTitle,
      extraCharge: upgrade.extraCharge,
      savingsLabel: upgrade.savingsLabel,
      discountPct: upgrade.discountPct ?? null,
      sortOrder: upgrade.sortOrder,
      linkedItems: upgrade.linkedItems
        .map((link): AdminUpgradeItemLinkInput | null => {
          const linkedItem =
            link.linkedMenuItemId != null
              ? (allItems.find((item) => item.id === link.linkedMenuItemId) ??
                null)
              : null;
          if (!linkedItem) return null;
          if (linkedItem.categoryId === dealsCategory.id) return null;
          if (isDealsCategoryId(linkedItem.categoryId, categories)) return null;
          if (!linkedItem.isActive) return null;

          const linkedSize =
            link.linkedSizeId != null
              ? (linkedItem.sizes.find((size) => size.id === link.linkedSizeId) ??
                null)
              : null;
          if (linkedItem.sizes.length > 0 && !linkedSize) return null;
          if (linkedItem.sizes.length === 0 && link.linkedSizeId != null) {
            return null;
          }

          return {
            id: newTempId("link"),
            linkedMenuItemId: linkedItem.id,
            linkedSizeId: linkedSize?.id ?? null,
            itemNameSnapshot: linkedItem.name,
            sizeNameSnapshot: linkedSize?.name ?? null,
            sortOrder: link.sortOrder,
          };
        })
        .filter((link): link is AdminUpgradeItemLinkInput => link != null)
        .map((link, linkIndex) => ({ ...link, sortOrder: linkIndex })),
    }))
    .filter((upgrade) => upgrade.linkedItems.length > 0)
    .map((upgrade, upgradeIndex) => ({ ...upgrade, sortOrder: upgradeIndex }));
}

function buildFallbackUpgradeOption(
  baseItem: Item,
  defaultDiscountPct: number,
  baseSize: Item["sizes"][number] | null = null,
): AdminUpgradeOptionInput {
  const firstSize = baseSize ?? baseItem.sizes[0] ?? null;
  const linkedPrice = baseItem.price + (firstSize?.priceDelta ?? 0);
  const savingsLabel = +((linkedPrice * defaultDiscountPct) / 100).toFixed(2);
  const extraCharge = +(linkedPrice - savingsLabel).toFixed(2);

  return {
    id: newTempId("upgrade"),
    customTitle: null,
    extraCharge,
    savingsLabel,
    discountPct: defaultDiscountPct,
    sortOrder: 0,
    linkedItems: [
      {
        id: newTempId("link"),
        linkedMenuItemId: baseItem.id,
        linkedSizeId: firstSize?.id ?? null,
        itemNameSnapshot: baseItem.name,
        sizeNameSnapshot: firstSize?.name ?? null,
        sortOrder: 0,
      },
    ],
  };
}

function snapshotIsoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function makeDealDraftFromHistorySnapshot({
  snapshot,
  dealsCategory,
  allItems,
  categories,
  sortOrder,
  comboNum,
  defaultDiscountPct = 12,
}: {
  snapshot: MenuItemSnapshot;
  dealsCategory: Category;
  allItems: Item[];
  categories: Category[];
  sortOrder: number;
  comboNum: number | null;
  defaultDiscountPct?: number;
}): Item {
  const validBadge =
    snapshot.badge &&
    (ADMIN_MENU_BADGES as readonly string[]).includes(snapshot.badge)
      ? snapshot.badge
      : "DEAL";
  const baseItem = findRestorableBaseItem({ snapshot, allItems, categories });
  const baseSize = findRestorableBaseSize(snapshot, baseItem);
  const restoredUpgradeOptions = sanitizeHistoryUpgradeOptions({
    snapshot,
    dealsCategory,
    allItems,
    categories,
  });
  const upgradeOptions =
    restoredUpgradeOptions.length > 0
      ? restoredUpgradeOptions
      : baseItem?.isActive
        ? [buildFallbackUpgradeOption(baseItem, defaultDiscountPct, baseSize)]
        : [];
  const restoredDealStartsAt = snapshotIsoOrNull(snapshot.dealStartsAt);
  const restoredDealExpiresAt = snapshotIsoOrNull(snapshot.dealExpiresAt);

  return {
    id: "new",
    categoryId: dealsCategory.id,
    comboNum,
    name: snapshot.name,
    description: snapshot.description,
    price: snapshot.price,
    emoji: snapshot.emoji || "🍔",
    bgColor: snapshot.bgColor || "#ffe3b3",
    badge: validBadge,
    bundleSavings: snapshot.bundleSavings ?? snapshot.mealSavings ?? null,
    dealBaseMenuItemId: baseItem?.id ?? null,
    dealBaseSizeId: baseSize?.id ?? null,
    dealBaseSizeNameSnapshot: baseSize?.name ?? null,
    dealStartsAt: restoredDealStartsAt,
    dealExpiresAt: restoredDealExpiresAt ?? defaultDealEndIso(),
    imageUrl: snapshot.imageUrl ?? null,
    imageAlt: snapshot.imageAlt ?? null,
    imageFit: snapshot.imageFit === "CONTAIN" ? "CONTAIN" : "COVER",
    cardImageUrl: snapshot.cardImageUrl ?? null,
    cardImageAlt: snapshot.cardImageAlt ?? null,
    isActive: false,
    isOutOfStock: false,
    stockMode: "MANUAL",
    stockQty: null,
    lowStockThreshold: null,
    stockUpdatedAt: null,
    stockUpdatedById: null,
    sortOrder,
    lockVersion: 0,
    updatedAt: "",
    sizes: snapshot.sizes.map((size) => ({
      id: newTempId("size"),
      name: size.name,
      priceDelta: size.priceDelta,
    })),
    addons: snapshot.addons.map((addon) => ({
      id: newTempId("addon"),
      name: addon.name,
      priceDelta: addon.priceDelta,
    })),
    upgradeOptions,
  };
}
