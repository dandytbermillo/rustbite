import "server-only";

import { prisma } from "@/lib/db";
import type { AdminPermissionContext } from "@/lib/admin-sessions";
import { fmt } from "@/lib/pricing";
import { isMenuItemAvailable } from "@/lib/menu-availability";
import {
  isAddonOptionAvailable,
  isOptionLowStock,
  optionStockLabel,
  type OptionStockState,
} from "@/lib/option-stock";
import type { ImageFit } from "@/lib/types";
import { ADMIN_MENU_BADGES } from "@/lib/menu-admin";
import {
  classifyLink,
  compareItemsByOrder,
  dealBaseAvailabilityReason,
  dealExpirationState,
  dealExpirationSummary,
  dealHasCustomerAvailableUpgrade,
  dealHiddenReason,
  dealStructuralRepairReason,
  isDealsCategory,
  itemVisibleInMenuFilter,
  type Cat,
  type Item,
} from "@/lib/admin/menu/visibility";
import {
  buildMatchContext,
  dealNeedsAttention,
  itemMatchesFilter,
  nonDealInventoryLowNeedsAttention,
  nonDealInventoryOutNeedsAttention,
} from "@/lib/admin/filters/match";
import { isDealLimitLow, isDealLimitSoldOut } from "@/lib/deal-selling-limits";
import {
  MENU_ATTENTION_VALUES,
  MENU_STATUS_VALUES,
  MENU_STOCK_VALUES,
  isMenuFilterEmpty,
  type MenuAttention,
  type MenuFilterState,
} from "@/lib/admin/filters/types";

export type WorkspaceMenuFilter = MenuFilterState & {
  targetItemId: string | null;
};

export type WorkspaceMenuAttentionCounts = Record<MenuAttention, number>;

export type WorkspaceMenuCategoryOption = {
  id: string;
  slug: string;
  name: string;
  icon: string;
  sortOrder: number;
  isActive: boolean;
  itemCount: number;
  updatedAt: string;
};

export type WorkspaceMenuPriceOption = {
  id: string;
  name: string;
  priceDelta: number;
  priceDeltaLabel: string;
};

export type WorkspaceMenuOptionStockSummary = {
  mode: "MANUAL" | "QUANTITY";
  isOutOfStock: boolean;
  stockQty: number | null;
  lowStockThreshold: number | null;
  label: string;
  tone: "green" | "amber" | "red" | "stone";
  available: boolean;
  low: boolean;
};

export type WorkspaceMenuAddonOption = WorkspaceMenuPriceOption & {
  stock: WorkspaceMenuOptionStockSummary;
};

export type WorkspaceMenuSharedModifierOptionSummary = {
  id: string;
  name: string;
  inheritedPriceDelta: number;
  inheritedPriceDeltaLabel: string;
  effectivePriceDelta: number;
  effectivePriceDeltaLabel: string;
  isActive: boolean;
  isHidden: boolean;
  hasPriceOverride: boolean;
  stock: WorkspaceMenuOptionStockSummary;
};

export type WorkspaceMenuSharedModifierGroupSummary = {
  itemLinkId: string;
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  selectionLabel: string;
  ruleLabel: string;
  activeOptionCount: number;
  visibleOptionCount: number;
  options: WorkspaceMenuSharedModifierOptionSummary[];
};

export type WorkspaceMenuBaseItemSummary = {
  name: string;
  sizeName: string | null;
  statusLabel: string;
  stockLabel: string;
  tone: "green" | "amber" | "red" | "stone";
};

export type WorkspaceMenuDealOptionSummary = {
  id: string;
  title: string;
  extraChargeLabel: string;
  savingsLabel: string | null;
  linkedItems: Array<{
    id: string;
    name: string;
    emoji: string;
    bgColor: string;
    sizeName: string | null;
    statusLabel: string;
    priceLabel: string | null;
  }>;
};

export type WorkspaceMenuItemRow = {
  id: string;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  name: string;
  description: string;
  price: number;
  priceLabel: string;
  emoji: string;
  bgColor: string;
  badge: string | null;
  isDeal: boolean;
  visibilityState: "live" | "hidden" | "scheduled" | "expired";
  visibilityReason: string | null;
  stockLabel: string;
  stockTone: "green" | "amber" | "red" | "stone";
  stockDetails: {
    mode: string;
    qty: number | null;
    lowStockThreshold: number | null;
    manualOutOfStock: boolean;
  };
  optionSummary: string[];
  sizeOptions: WorkspaceMenuPriceOption[];
  addonOptions: WorkspaceMenuAddonOption[];
  sharedModifierGroups: WorkspaceMenuSharedModifierGroupSummary[];
  baseItem: WorkspaceMenuBaseItemSummary | null;
  dealOptions: WorkspaceMenuDealOptionSummary[];
  attention: MenuAttention[];
  dealExpiresLabel: string | null;
  updatedAt: string;
};

export type WorkspaceMenuSection = {
  category: {
    id: string;
    slug: string;
    name: string;
    icon: string;
    isActive: boolean;
  };
  totalCount: number;
  activeCount: number;
  items: WorkspaceMenuItemRow[];
};

export type AdminWorkspaceMenuSummary = {
  generatedAt: string;
  outletId: string;
  filter: WorkspaceMenuFilter;
  counts: {
    categories: number;
    items: number;
    live: number;
    hidden: number;
    attention: WorkspaceMenuAttentionCounts;
  };
  categories: WorkspaceMenuCategoryOption[];
  sections: WorkspaceMenuSection[];
  limitPerSection: number;
};

const DEFAULT_LIMIT_PER_SECTION = 16;

type WorkspaceVisibilityItem = Item & {
  sharedModifierGroups: WorkspaceMenuSharedModifierGroupSummary[];
};

function normalizeImageFit(value: string | null | undefined): ImageFit {
  return value === "CONTAIN" ? "CONTAIN" : "COVER";
}

function numberValue(value: { toString(): string } | number | null): number {
  if (value == null) return 0;
  return typeof value === "number" ? value : Number(value);
}

type WorkspaceOptionStockInput = OptionStockState & {
  isActive?: boolean | null;
  isHidden?: boolean | null;
};

type NormalizedOptionStock = {
  stockMode: "MANUAL" | "QUANTITY";
  isOutOfStock: boolean;
  stockQty: number | null;
  lowStockThreshold: number | null;
};

function normalizeOptionStock(
  option: WorkspaceOptionStockInput,
): NormalizedOptionStock {
  const stockMode = option.stockMode === "QUANTITY" ? "QUANTITY" : "MANUAL";
  return {
    stockMode,
    isOutOfStock:
      stockMode === "QUANTITY" ? false : Boolean(option.isOutOfStock),
    stockQty: stockMode === "QUANTITY" ? option.stockQty ?? 0 : null,
    lowStockThreshold:
      stockMode === "QUANTITY" ? option.lowStockThreshold ?? null : null,
  };
}

function optionStockSummary(
  option: WorkspaceOptionStockInput,
): WorkspaceMenuOptionStockSummary {
  const stock = normalizeOptionStock(option);
  const stockAvailable = isAddonOptionAvailable(stock);
  const low = isOptionLowStock(stock);
  const label = low ? `Low · ${optionStockLabel(stock)}` : optionStockLabel(stock);
  const tone: WorkspaceMenuOptionStockSummary["tone"] = stockAvailable
    ? low
      ? "amber"
      : stock.stockMode === "MANUAL"
        ? "green"
        : "stone"
    : "red";

  return {
    mode: stock.stockMode,
    isOutOfStock: stock.isOutOfStock,
    stockQty: stock.stockQty,
    lowStockThreshold: stock.lowStockThreshold,
    label,
    tone,
    available:
      stockAvailable &&
      option.isActive !== false &&
      option.isHidden !== true,
    low,
  };
}

function sharedSelectionLabel(selectionMode: string): string {
  if (selectionMode === "REQUIRED_SINGLE") return "Required single";
  if (selectionMode === "OPTIONAL_SINGLE") return "Optional single";
  if (selectionMode === "REQUIRED_MULTI") return "Required multi";
  return "Optional multi";
}

function sharedRuleLabel({
  selectionMode,
  minSelect,
  maxSelect,
  minSelectOverride,
  maxSelectOverride,
}: {
  selectionMode: string;
  minSelect: number;
  maxSelect: number | null;
  minSelectOverride: number | null;
  maxSelectOverride: number | null;
}): string {
  const min = minSelectOverride ?? minSelect;
  const max = maxSelectOverride ?? maxSelect;
  if (selectionMode === "OPTIONAL_SINGLE") return "choose up to 1";
  if (selectionMode === "REQUIRED_SINGLE") return "choose 1";
  if (max == null) return min > 0 ? `choose ${min}+` : "choose any";
  if (min === max) return `choose ${min}`;
  return `choose ${min}-${max}`;
}

export function parseWorkspaceMenuAttention(
  value: string | null | undefined,
): MenuAttention | null {
  return MENU_ATTENTION_VALUES.includes(value as MenuAttention)
    ? (value as MenuAttention)
    : null;
}

function uniqueNonEmpty(values: string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || out.includes(trimmed)) continue;
    out.push(trimmed);
  }
  return out;
}

export function workspaceMenuFilterFromParams(
  params: URLSearchParams,
): WorkspaceMenuFilter {
  const attention = uniqueNonEmpty(params.getAll("attention"))
    .map(parseWorkspaceMenuAttention)
    .filter((value): value is MenuAttention => value != null);
  const category = uniqueNonEmpty(params.getAll("category"));
  const badge = params.get("badge")?.trim() ?? "";
  const status = params.get("status")?.trim() ?? "";
  const stock = params.get("stock")?.trim() ?? "";
  const query = params.get("q")?.trim() ?? "";
  const targetItemId = params.get("item") ?? params.get("id");

  return {
    ...(attention.length > 0 ? { attention } : {}),
    ...(category.length > 0 ? { category } : {}),
    ...(ADMIN_MENU_BADGES.includes(badge as (typeof ADMIN_MENU_BADGES)[number])
      ? { badge: badge as (typeof ADMIN_MENU_BADGES)[number] }
      : {}),
    ...(MENU_STATUS_VALUES.includes(
      status as (typeof MENU_STATUS_VALUES)[number],
    )
      ? { status: status as (typeof MENU_STATUS_VALUES)[number] }
      : {}),
    ...(MENU_STOCK_VALUES.includes(stock as (typeof MENU_STOCK_VALUES)[number])
      ? { stock: stock as (typeof MENU_STOCK_VALUES)[number] }
      : {}),
    ...(query ? { query } : {}),
    targetItemId,
  };
}

function menuFilterState(filter: WorkspaceMenuFilter): MenuFilterState {
  const next: MenuFilterState = {};
  if (filter.attention?.length) next.attention = filter.attention;
  if (filter.category?.length) next.category = filter.category;
  if (filter.badge) next.badge = filter.badge;
  if (filter.status) next.status = filter.status;
  if (filter.stock) next.stock = filter.stock;
  if (filter.query) next.query = filter.query;
  return next;
}

function mapCategory(category: {
  id: string;
  slug: string;
  name: string;
  icon: string;
  sortOrder: number;
  isActive: boolean;
  updatedAt: Date;
}): Cat {
  return {
    id: category.id,
    slug: category.slug,
    name: category.name,
    icon: category.icon,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
    updatedAt: category.updatedAt.toISOString(),
  };
}

function mapItem(item: {
  id: string;
  categoryId: string;
  comboNum: number | null;
  name: string;
  description: string;
  price: { toString(): string };
  emoji: string;
  bgColor: string;
  badge: string | null;
  bundleSavings: { toString(): string } | null;
  mealSavings: { toString(): string } | null;
  dealBaseMenuItemId: string | null;
  dealBaseSizeId: string | null;
  dealBaseSizeNameSnapshot: string | null;
  dealStartsAt: Date | null;
  dealLimitMode: Item["dealLimitMode"];
  dealLimitQty: number | null;
  dealLimitLowThreshold: number | null;
  dealLimitUpdatedAt: Date | null;
  dealLimitUpdatedById: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  imageFit: string;
  cardImageUrl: string | null;
  cardImageAlt: string | null;
  dealExpiresAt: Date | null;
  isActive: boolean;
  isOutOfStock: boolean;
  stockMode: Item["stockMode"];
  stockQty: number | null;
  lowStockThreshold: number | null;
  stockUpdatedAt: Date | null;
  stockUpdatedById: string | null;
  sortOrder: number;
  lockVersion: number;
  updatedAt: Date;
  sizes: Array<{
    id: string;
    name: string;
    priceDelta: { toString(): string };
  }>;
  addons: Array<{
    id: string;
    name: string;
    priceDelta: { toString(): string };
    stockMode: Item["stockMode"];
    isOutOfStock: boolean;
    stockQty: number | null;
    lowStockThreshold: number | null;
    stockUpdatedAt: Date | null;
    stockUpdatedById: string | null;
  }>;
  modifierGroupLinks: Array<{
    id: string;
    sortOrder: number;
    minSelectOverride: number | null;
    maxSelectOverride: number | null;
    isActive: boolean;
    modifierGroup: {
      id: string;
      name: string;
      description: string | null;
      selectionMode: string;
      minSelect: number;
      maxSelect: number | null;
      isActive: boolean;
      options: Array<{
        id: string;
        name: string;
        priceDelta: { toString(): string };
        isActive: boolean;
        stockMode: Item["stockMode"];
        isOutOfStock: boolean;
        stockQty: number | null;
        lowStockThreshold: number | null;
        stockUpdatedAt: Date | null;
        stockUpdatedById: string | null;
        sortOrder: number;
      }>;
    };
    optionOverrides: Array<{
      modifierOptionId: string;
      isHidden: boolean;
      priceDeltaOverride: { toString(): string } | null;
      sortOrderOverride: number | null;
    }>;
  }>;
  upgradeOptions: Array<{
    id: string;
    customTitle: string | null;
    extraCharge: { toString(): string };
    savingsLabel: { toString(): string } | null;
    discountPct: { toString(): string } | null;
    sortOrder: number;
    linkedItems: Array<{
      id: string;
      linkedMenuItemId: string | null;
      linkedSizeId: string | null;
      itemNameSnapshot: string | null;
      sizeNameSnapshot: string | null;
      sortOrder: number;
      linkedMenuItem: {
        id: string;
        name: string;
        emoji: string;
        bgColor: string;
        isActive: boolean;
        isOutOfStock: boolean;
        stockMode: Item["stockMode"];
        stockQty: number | null;
        lowStockThreshold: number | null;
        price: { toString(): string };
        sizes: Array<{ id: string }>;
      } | null;
      linkedSize: {
        id: string;
        name: string;
        priceDelta: { toString(): string };
      } | null;
    }>;
  }>;
}): WorkspaceVisibilityItem {
  const sharedModifierGroups = item.modifierGroupLinks
    .filter((link) => link.isActive)
    .sort(
      (a, b) =>
        a.sortOrder - b.sortOrder ||
        a.modifierGroup.name.localeCompare(b.modifierGroup.name),
    )
    .map((link) => {
      const overrides = new Map(
        link.optionOverrides.map((override) => [
          override.modifierOptionId,
          override,
        ]),
      );
      const options = [...link.modifierGroup.options]
        .sort((a, b) => {
          const overrideA = overrides.get(a.id);
          const overrideB = overrides.get(b.id);
          const sortA = overrideA?.sortOrderOverride ?? a.sortOrder;
          const sortB = overrideB?.sortOrderOverride ?? b.sortOrder;
          return sortA - sortB || a.name.localeCompare(b.name);
        })
        .map((option) => {
          const override = overrides.get(option.id);
          const inheritedPriceDelta = numberValue(option.priceDelta);
          const effectivePriceDelta =
            override?.priceDeltaOverride != null
              ? numberValue(override.priceDeltaOverride)
              : inheritedPriceDelta;
          return {
            id: option.id,
            name: option.name,
            inheritedPriceDelta,
            inheritedPriceDeltaLabel: fmt(inheritedPriceDelta),
            effectivePriceDelta,
            effectivePriceDeltaLabel: fmt(effectivePriceDelta),
            isActive: option.isActive,
            isHidden: override?.isHidden ?? false,
            hasPriceOverride: override?.priceDeltaOverride != null,
            stock: optionStockSummary(
              {
                stockMode: option.stockMode,
                isOutOfStock: option.isOutOfStock,
                stockQty: option.stockQty,
                lowStockThreshold: option.lowStockThreshold,
                isActive: option.isActive,
                isHidden: override?.isHidden ?? false,
              },
            ),
          };
        });
      const activeOptionCount = options.filter((option) => option.isActive).length;
      const visibleOptionCount = options.filter(
        (option) => option.isActive && !option.isHidden && option.stock.available,
      ).length;
      return {
        itemLinkId: link.id,
        id: link.modifierGroup.id,
        name: link.modifierGroup.name,
        description: link.modifierGroup.description,
        isActive: link.modifierGroup.isActive,
        selectionLabel: sharedSelectionLabel(link.modifierGroup.selectionMode),
        ruleLabel: sharedRuleLabel({
          selectionMode: link.modifierGroup.selectionMode,
          minSelect: link.modifierGroup.minSelect,
          maxSelect: link.modifierGroup.maxSelect,
          minSelectOverride: link.minSelectOverride,
          maxSelectOverride: link.maxSelectOverride,
        }),
        activeOptionCount,
        visibleOptionCount,
        options,
      };
    });

  return {
    id: item.id,
    categoryId: item.categoryId,
    comboNum: item.comboNum,
    name: item.name,
    description: item.description,
    price: numberValue(item.price),
    emoji: item.emoji,
    bgColor: item.bgColor,
    badge: item.badge,
    bundleSavings:
      item.bundleSavings != null
        ? numberValue(item.bundleSavings)
        : item.mealSavings != null
          ? numberValue(item.mealSavings)
          : null,
    dealBaseMenuItemId: item.dealBaseMenuItemId,
    dealBaseSizeId: item.dealBaseSizeId,
    dealBaseSizeNameSnapshot: item.dealBaseSizeNameSnapshot,
    dealStartsAt: item.dealStartsAt?.toISOString() ?? null,
    dealLimitMode: item.dealLimitMode,
    dealLimitQty: item.dealLimitQty,
    dealLimitLowThreshold: item.dealLimitLowThreshold,
    dealLimitUpdatedAt: item.dealLimitUpdatedAt?.toISOString() ?? null,
    dealLimitUpdatedById: item.dealLimitUpdatedById,
    imageUrl: item.imageUrl,
    imageAlt: item.imageAlt,
    imageFit: normalizeImageFit(item.imageFit),
    cardImageUrl: item.cardImageUrl,
    cardImageAlt: item.cardImageAlt,
    dealExpiresAt: item.dealExpiresAt?.toISOString() ?? null,
    isActive: item.isActive,
    isOutOfStock: item.isOutOfStock,
    stockMode: item.stockMode,
    stockQty: item.stockQty,
    lowStockThreshold: item.lowStockThreshold,
    stockUpdatedAt: item.stockUpdatedAt?.toISOString() ?? null,
    stockUpdatedById: item.stockUpdatedById,
    sortOrder: item.sortOrder,
    lockVersion: item.lockVersion,
    updatedAt: item.updatedAt.toISOString(),
    sizes: item.sizes.map((size) => ({
      id: size.id,
      name: size.name,
      priceDelta: numberValue(size.priceDelta),
    })),
    addons: item.addons.map((addon) => ({
      id: addon.id,
      name: addon.name,
      priceDelta: numberValue(addon.priceDelta),
      stockMode: addon.stockMode,
      isOutOfStock: addon.isOutOfStock,
      stockQty: addon.stockQty,
      lowStockThreshold: addon.lowStockThreshold,
      stockUpdatedAt: addon.stockUpdatedAt?.toISOString() ?? null,
      stockUpdatedById: addon.stockUpdatedById,
    })),
    sharedModifierGroups,
    upgradeOptions: item.upgradeOptions.map((upgrade) => ({
      id: upgrade.id,
      customTitle: upgrade.customTitle,
      extraCharge: numberValue(upgrade.extraCharge),
      savingsLabel:
        upgrade.savingsLabel != null ? numberValue(upgrade.savingsLabel) : null,
      discountPct:
        upgrade.discountPct != null ? numberValue(upgrade.discountPct) : null,
      sortOrder: upgrade.sortOrder,
      linkedItems: upgrade.linkedItems.map((link) => ({
        id: link.id,
        linkedMenuItemId: link.linkedMenuItemId,
        linkedSizeId: link.linkedSizeId,
        itemNameSnapshot: link.itemNameSnapshot,
        sizeNameSnapshot: link.sizeNameSnapshot,
        sortOrder: link.sortOrder,
        linkedMenuItem: link.linkedMenuItem
          ? {
              id: link.linkedMenuItem.id,
              name: link.linkedMenuItem.name,
              emoji: link.linkedMenuItem.emoji,
              bgColor: link.linkedMenuItem.bgColor,
              isActive: link.linkedMenuItem.isActive,
              isOutOfStock: link.linkedMenuItem.isOutOfStock,
              stockMode: link.linkedMenuItem.stockMode,
              stockQty: link.linkedMenuItem.stockQty,
              lowStockThreshold: link.linkedMenuItem.lowStockThreshold,
              price: numberValue(link.linkedMenuItem.price),
              sizeCount: link.linkedMenuItem.sizes.length,
            }
          : null,
        linkedSize: link.linkedSize
          ? {
              id: link.linkedSize.id,
              name: link.linkedSize.name,
              priceDelta: numberValue(link.linkedSize.priceDelta),
            }
          : null,
      })),
    })),
  };
}

function attentionForItem(
  item: Item,
  category: Cat,
  matchContext: ReturnType<typeof buildMatchContext>,
): MenuAttention[] {
  const attention: MenuAttention[] = [];
  if (dealNeedsAttention(item, category, matchContext)) {
    attention.push("deals");
  }
  if (nonDealInventoryOutNeedsAttention(item, category)) {
    attention.push("inventory-out");
  }
  if (nonDealInventoryLowNeedsAttention(item, category)) {
    attention.push("inventory-low");
  }
  return attention;
}

function stockSummary({
  item,
  category,
  matchContext,
}: {
  item: Item;
  category: Cat;
  matchContext: ReturnType<typeof buildMatchContext>;
}): Pick<WorkspaceMenuItemRow, "stockLabel" | "stockTone"> {
  if (isDealsCategory(category)) {
    const baseItem = item.dealBaseMenuItemId
      ? (matchContext.itemById.get(item.dealBaseMenuItemId) ?? null)
      : null;
    if (!baseItem) return { stockLabel: "Base missing", stockTone: "red" };
    if (!baseItem.isActive) return { stockLabel: "Base hidden", stockTone: "red" };
    if (!isMenuItemAvailable(baseItem)) {
      return { stockLabel: "Base out", stockTone: "red" };
    }
    if (isDealLimitSoldOut(item)) {
      return { stockLabel: "Limit sold out", stockTone: "red" };
    }
    if (isDealLimitLow(item)) {
      return {
        stockLabel: `Limit low · ${item.dealLimitQty ?? 0} left`,
        stockTone: "amber",
      };
    }
    if (item.dealLimitMode === "LIMITED") {
      return {
        stockLabel: `Limit · ${item.dealLimitQty ?? 0} left`,
        stockTone: "stone",
      };
    }
    return { stockLabel: "Base ok", stockTone: "green" };
  }

  if (item.stockMode === "QUANTITY") {
    const qty = item.stockQty ?? 0;
    if (qty <= 0) return { stockLabel: "Out · 0 left", stockTone: "red" };
    if (item.isOutOfStock) {
      return { stockLabel: `Paused · ${qty} left`, stockTone: "red" };
    }
    const low =
      item.lowStockThreshold != null && qty <= item.lowStockThreshold;
    return {
      stockLabel: `${low ? "Low · " : ""}${qty} left`,
      stockTone: low ? "amber" : "stone",
    };
  }

  if (!item.isActive) return { stockLabel: "-", stockTone: "stone" };
  return item.isOutOfStock
    ? { stockLabel: "Out of stock", stockTone: "red" }
    : { stockLabel: "In stock", stockTone: "green" };
}

function stockDetails(item: Item): WorkspaceMenuItemRow["stockDetails"] {
  return {
    mode: item.stockMode,
    qty: item.stockQty,
    lowStockThreshold: item.lowStockThreshold,
    manualOutOfStock: item.isOutOfStock,
  };
}

function baseItemSummary({
  item,
  category,
  matchContext,
}: {
  item: Item;
  category: Cat;
  matchContext: ReturnType<typeof buildMatchContext>;
}): WorkspaceMenuBaseItemSummary | null {
  if (!isDealsCategory(category)) return null;
  const baseItem = item.dealBaseMenuItemId
    ? (matchContext.itemById.get(item.dealBaseMenuItemId) ?? null)
    : null;
  if (!baseItem) {
    return {
      name: "Missing base item",
      sizeName: null,
      statusLabel: "Missing",
      stockLabel: "Base missing",
      tone: "red",
    };
  }
  const baseSize =
    item.dealBaseSizeId != null
      ? (baseItem.sizes.find((size) => size.id === item.dealBaseSizeId) ?? null)
      : null;
  const sizeName =
    baseSize?.name ?? item.dealBaseSizeNameSnapshot ?? null;
  if (!baseItem.isActive) {
    return {
      name: baseItem.name,
      sizeName,
      statusLabel: "Hidden",
      stockLabel: "Base hidden",
      tone: "red",
    };
  }
  if (!isMenuItemAvailable(baseItem)) {
    return {
      name: baseItem.name,
      sizeName,
      statusLabel: "Live",
      stockLabel: "Base out",
      tone: "red",
    };
  }
  return {
    name: baseItem.name,
    sizeName,
    statusLabel: "Live",
    stockLabel: "Base ok",
    tone: "green",
  };
}

function linkStatusLabel(state: ReturnType<typeof classifyLink>): string {
  if (state.kind === "ok") return "OK";
  if (state.kind === "missing-item") return "Missing item";
  if (state.kind === "nested-deal-item") return "Nested deal";
  if (state.kind === "inactive-item") return "Hidden item";
  if (state.kind === "out-of-stock-item") return "Out of stock";
  if (state.kind === "size-lost") return "Size lost";
  return "Needs size";
}

function dealOptionSummaries(
  item: Item,
  matchContext: ReturnType<typeof buildMatchContext>,
): WorkspaceMenuDealOptionSummary[] {
  return item.upgradeOptions.map((option, index) => ({
    id: option.id,
    title: option.customTitle || `Deal option ${index + 1}`,
    extraChargeLabel: fmt(option.extraCharge),
    savingsLabel:
      option.savingsLabel != null ? `${fmt(option.savingsLabel)} saved` : null,
    linkedItems: option.linkedItems.map((link) => {
      const state = classifyLink(link, matchContext.linkContext);
      const linkedPrice =
        link.linkedMenuItem != null
          ? link.linkedMenuItem.price + (link.linkedSize?.priceDelta ?? 0)
          : null;
      return {
        id: link.id,
        name:
          link.linkedMenuItem?.name ??
          link.itemNameSnapshot ??
          "Missing item",
        emoji: link.linkedMenuItem?.emoji ?? "?",
        bgColor: link.linkedMenuItem?.bgColor ?? "#f5f5f4",
        sizeName: link.linkedSize?.name ?? link.sizeNameSnapshot,
        statusLabel: linkStatusLabel(state),
        priceLabel: linkedPrice != null ? fmt(linkedPrice) : null,
      };
    }),
  }));
}

function rowForItem({
  item,
  category,
  matchContext,
  nowMs,
}: {
  item: WorkspaceVisibilityItem;
  category: Cat;
  matchContext: ReturnType<typeof buildMatchContext>;
  nowMs: number;
}): WorkspaceMenuItemRow {
  const isDeal = isDealsCategory(category);
  const structuralRepairReason = isDeal
    ? dealStructuralRepairReason(item, matchContext.linkContext)
    : null;
  const baseAvailabilityReason = isDeal
    ? dealBaseAvailabilityReason(item, matchContext.linkContext)
    : null;
  const expirationState = isDeal ? dealExpirationState(item, nowMs) : "active";
  const hasAvailableUpgrade = isDeal
    ? dealHasCustomerAvailableUpgrade(item, matchContext.linkContext)
    : true;
  const visible = itemVisibleInMenuFilter(
    item,
    category,
    nowMs,
    matchContext.linkContext,
  );
  const visibilityState: WorkspaceMenuItemRow["visibilityState"] = isDeal
    ? !item.isActive
      ? "hidden"
      : expirationState === "scheduled"
        ? "scheduled"
        : expirationState === "expired"
          ? "expired"
          : visible
            ? "live"
            : "hidden"
    : item.isActive
      ? "live"
      : "hidden";
  const visibilityReason =
    isDeal && !visible
      ? dealHiddenReason(
          item,
          hasAvailableUpgrade,
          expirationState,
          structuralRepairReason ?? baseAvailabilityReason,
          matchContext.linkContext,
        )
      : null;
  const optionSummary: string[] = [];
  if (item.sizes.length > 0) {
    optionSummary.push(`${item.sizes.length} size${item.sizes.length === 1 ? "" : "s"}`);
  }
  if (item.addons.length > 0) {
    optionSummary.push(
      `${item.addons.length} item-specific add-on${item.addons.length === 1 ? "" : "s"}`,
    );
  }
  if (!isDeal && item.sharedModifierGroups.length > 0) {
    optionSummary.push(
      `${item.sharedModifierGroups.length} add-on set${
        item.sharedModifierGroups.length === 1 ? "" : "s"
      }`,
    );
  }
  if (isDeal && item.upgradeOptions.length > 0) {
    optionSummary.push(
      `${item.upgradeOptions.length} deal option${
        item.upgradeOptions.length === 1 ? "" : "s"
      }`,
    );
  }

  return {
    id: item.id,
    categoryId: category.id,
    categoryName: category.name,
    categorySlug: category.slug,
    name: item.name,
    description: item.description,
    price: item.price,
    priceLabel: fmt(item.price),
    emoji: item.emoji,
    bgColor: item.bgColor,
    badge: item.badge,
    isDeal,
    visibilityState,
    visibilityReason,
    ...stockSummary({ item, category, matchContext }),
    stockDetails: stockDetails(item),
    optionSummary,
    sizeOptions: item.sizes.map((size) => ({
      id: size.id,
      name: size.name,
      priceDelta: size.priceDelta,
      priceDeltaLabel: fmt(size.priceDelta),
    })),
    addonOptions: item.addons.map((addon) => ({
      id: addon.id,
      name: addon.name,
      priceDelta: addon.priceDelta,
      priceDeltaLabel: fmt(addon.priceDelta),
      stock: optionStockSummary(addon),
    })),
    sharedModifierGroups: isDeal ? [] : item.sharedModifierGroups,
    baseItem: baseItemSummary({ item, category, matchContext }),
    dealOptions: isDeal ? dealOptionSummaries(item, matchContext) : [],
    attention: attentionForItem(item, category, matchContext),
    dealExpiresLabel: isDeal ? dealExpirationSummary(item, nowMs) : null,
    updatedAt: item.updatedAt,
  };
}

export async function buildAdminWorkspaceMenuSummary({
  context,
  filter,
  limitPerSection = DEFAULT_LIMIT_PER_SECTION,
  now = new Date(),
}: {
  context: AdminPermissionContext;
  filter: WorkspaceMenuFilter;
  limitPerSection?: number;
  now?: Date;
}): Promise<AdminWorkspaceMenuSummary> {
  const take = Math.max(1, Math.min(limitPerSection, DEFAULT_LIMIT_PER_SECTION));
  const [rawCategories, rawItems] = await Promise.all([
    prisma.category.findMany({
      where: { outletId: context.outletId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.menuItem.findMany({
      where: { outletId: context.outletId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        sizes: { orderBy: { sortOrder: "asc" } },
        addons: { orderBy: { sortOrder: "asc" } },
        modifierGroupLinks: {
          where: { isActive: true },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          include: {
            modifierGroup: {
              include: {
                options: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
              },
            },
            optionOverrides: { orderBy: [{ createdAt: "asc" }] },
          },
        },
        upgradeOptions: {
          orderBy: { sortOrder: "asc" },
          include: {
            linkedItems: {
              orderBy: { sortOrder: "asc" },
              include: {
                linkedMenuItem: {
                  select: {
                    id: true,
                    name: true,
                    emoji: true,
                    bgColor: true,
                    isActive: true,
                    isOutOfStock: true,
                    stockMode: true,
                    stockQty: true,
                    lowStockThreshold: true,
                    price: true,
                    sizes: { select: { id: true } },
                  },
                },
                linkedSize: { select: { id: true, name: true, priceDelta: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  const categories = rawCategories.map(mapCategory);
  const items = rawItems.map(mapItem);
  const nowMs = now.getTime();
  const matchContext = buildMatchContext(items, categories, nowMs);
  const state = menuFilterState(filter);
  const filterIsEmpty = isMenuFilterEmpty(state);
  const rowsByItemId = new Map(
    items.map((item) => {
      const category = matchContext.categoryById.get(item.categoryId);
      return category
        ? [item.id, rowForItem({ item, category, matchContext, nowMs })]
        : null;
    }).filter((entry): entry is [string, WorkspaceMenuItemRow] => entry != null),
  );

  const attentionCounts: WorkspaceMenuAttentionCounts = {
    deals: 0,
    "inventory-out": 0,
    "inventory-low": 0,
  };
  let live = 0;
  const itemCountByCategoryId = new Map<string, number>();
  for (const item of items) {
    const category = matchContext.categoryById.get(item.categoryId);
    if (!category) continue;
    itemCountByCategoryId.set(
      category.id,
      (itemCountByCategoryId.get(category.id) ?? 0) + 1,
    );
    if (itemVisibleInMenuFilter(item, category, nowMs, matchContext.linkContext)) {
      live += 1;
    }
    const attention = attentionForItem(item, category, matchContext);
    for (const key of attention) attentionCounts[key] += 1;
  }

  const sections = categories
    .map((category) => {
      const itemsInCategory = items
        .filter((item) => item.categoryId === category.id)
        .sort(compareItemsByOrder);
      const visibleItems = filterIsEmpty
        ? itemsInCategory
        : itemsInCategory.filter((item) =>
            itemMatchesFilter(item, category, state, matchContext),
          );
      const targetItem =
        filter.targetItemId != null
          ? itemsInCategory.find((item) => item.id === filter.targetItemId)
          : null;
      const boundedItems = visibleItems.slice(0, take);
      const displayItems =
        targetItem && !boundedItems.some((item) => item.id === targetItem.id)
          ? [targetItem, ...boundedItems]
          : boundedItems;
      return {
        category: {
          id: category.id,
          slug: category.slug,
          name: category.name,
          icon: category.icon,
          isActive: category.isActive,
        },
        totalCount: itemsInCategory.length,
        activeCount: itemsInCategory.filter((item) =>
          itemVisibleInMenuFilter(
            item,
            category,
            nowMs,
            matchContext.linkContext,
          ),
        ).length,
        items: displayItems
          .map((item) => rowsByItemId.get(item.id))
          .filter((row): row is WorkspaceMenuItemRow => row != null),
      };
    })
    .filter((section) => filterIsEmpty || section.items.length > 0);

  return {
    generatedAt: now.toISOString(),
    outletId: context.outletId,
    filter,
    counts: {
      categories: categories.length,
      items: items.length,
      live,
      hidden: items.length - live,
      attention: attentionCounts,
    },
    categories: categories.map((category) => ({
      id: category.id,
      slug: category.slug,
      name: category.name,
      icon: category.icon,
      sortOrder: category.sortOrder,
      isActive: category.isActive,
      itemCount: itemCountByCategoryId.get(category.id) ?? 0,
      updatedAt: category.updatedAt,
    })),
    sections,
    limitPerSection: take,
  };
}
