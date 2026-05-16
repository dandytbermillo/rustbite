import type { ImageFit } from "@/lib/types";
import {
  isMenuItemAvailable,
  type MenuStockMode,
} from "@/lib/menu-availability";
import { validateDealSchedule } from "@/lib/deal-schedule";
import type { DealLimitMode } from "@/lib/types";

// Canonical sort for items (and categories) across the admin menu UI AND the
// reorder endpoint. Using `id` as the final tiebreaker keeps the order stable
// when both `sortOrder` and `name` collide — without it, the endpoint's
// expectedCurrentOrder check could spuriously 409 against the UI.
export function compareItemsByOrder<
  T extends { sortOrder: number; name: string; id: string },
>(a: T, b: T): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  const byName = a.name.localeCompare(b.name);
  if (byName !== 0) return byName;
  return a.id.localeCompare(b.id);
}

export type Cat = {
  id: string;
  slug: string;
  name: string;
  icon: string;
  sortOrder: number;
  isActive: boolean;
  updatedAt: string;
};

export type Mod = {
  id: string;
  name: string;
  priceDelta: number;
  stockMode?: MenuStockMode;
  isOutOfStock?: boolean;
  stockQty?: number | null;
  lowStockThreshold?: number | null;
  stockUpdatedAt?: string | null;
  stockUpdatedById?: string | null;
};

export type UpgradeLinkedMenuItem = {
  id: string;
  name: string;
  emoji: string;
  bgColor: string;
  isActive: boolean;
  isOutOfStock: boolean;
  stockMode: MenuStockMode;
  stockQty: number | null;
  lowStockThreshold?: number | null;
  price: number;
  sizeCount: number;
};

export type UpgradeLinkedSize = {
  id: string;
  name: string;
  priceDelta: number;
};

export type UpgradeLink = {
  id: string;
  linkedMenuItemId: string | null;
  linkedSizeId: string | null;
  itemNameSnapshot: string | null;
  sizeNameSnapshot: string | null;
  sortOrder: number;
  linkedMenuItem: UpgradeLinkedMenuItem | null;
  linkedSize: UpgradeLinkedSize | null;
};

export type Upgrade = {
  id: string;
  customTitle: string | null;
  extraCharge: number;
  savingsLabel: number | null;
  discountPct: number | null;
  sortOrder: number;
  linkedItems: UpgradeLink[];
};

export type Item = {
  id: string;
  categoryId: string;
  comboNum: number | null;
  name: string;
  description: string;
  price: number;
  emoji: string;
  bgColor: string;
  badge: string | null;
  bundleSavings: number | null;
  dealBaseMenuItemId: string | null;
  dealBaseSizeId: string | null;
  dealBaseSizeNameSnapshot: string | null;
  dealStartsAt?: string | null;
  dealExpiresAt: string | null;
  dealLimitMode?: DealLimitMode;
  dealLimitQty?: number | null;
  dealLimitLowThreshold?: number | null;
  dealLimitUpdatedAt?: string | null;
  dealLimitUpdatedById?: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  imageFit: ImageFit;
  cardImageUrl: string | null;
  cardImageAlt: string | null;
  isActive: boolean;
  isOutOfStock: boolean;
  stockMode: MenuStockMode;
  stockQty: number | null;
  lowStockThreshold: number | null;
  stockUpdatedAt: string | null;
  stockUpdatedById: string | null;
  sortOrder: number;
  lockVersion: number;
  updatedAt: string;
  sizes: Mod[];
  addons: Mod[];
  upgradeOptions: Upgrade[];
};

export type LinkClassificationContext = {
  itemById: Map<string, Item>;
  categoryById: Map<string, Cat>;
};

export type LinkRenderState =
  | { kind: "ok" }
  | { kind: "missing-item"; rememberedItemName: string | null }
  | { kind: "nested-deal-item" }
  | { kind: "inactive-item" }
  | { kind: "out-of-stock-item" }
  | { kind: "size-lost"; rememberedSizeName: string }
  | { kind: "needs-size" };

export function isDealsCategory(category: Cat): boolean {
  return category.slug === "deals";
}

export function buildLinkClassificationContext(
  allItems: Item[],
  categories: Cat[],
): LinkClassificationContext {
  return {
    itemById: new Map(allItems.map((menuItem) => [menuItem.id, menuItem])),
    categoryById: new Map(
      categories.map((category) => [category.id, category]),
    ),
  };
}

export function categoryNameForItem(
  item: Pick<Item, "categoryId"> | null,
  context: LinkClassificationContext,
): string | null {
  if (!item) return null;
  return context.categoryById.get(item.categoryId)?.name ?? null;
}

export function isItemInDealsCategory(
  item: Pick<Item, "categoryId"> | null,
  context: LinkClassificationContext,
): boolean {
  if (!item) return false;
  const category = context.categoryById.get(item.categoryId);
  return !!category && isDealsCategory(category);
}

export function dealExpirationState(
  item: Item,
  nowMs: number,
): "missing" | "invalid" | "scheduled" | "expired" | "active" {
  const schedule = validateDealSchedule(
    { startsAt: item.dealStartsAt, expiresAt: item.dealExpiresAt },
    new Date(nowMs),
  );
  return schedule.status;
}

export function dealExpirationSummary(item: Item, nowMs: number): string {
  const schedule = validateDealSchedule(
    { startsAt: item.dealStartsAt, expiresAt: item.dealExpiresAt },
    new Date(nowMs),
  );
  if (!schedule.ok) return schedule.status === "missing" ? "No date" : "Invalid schedule";
  if (schedule.status === "expired") return "Expired";
  if (schedule.status === "scheduled") {
    const startsAt = schedule.startsAt?.getTime();
    if (!startsAt) return "Scheduled";
    return formatRelativeDealWindow(startsAt - nowMs, "Starts in");
  }

  return formatRelativeDealWindow(schedule.expiresAt.getTime() - nowMs, "", "left");
}

function formatRelativeDealWindow(
  diffMs: number,
  prefix: string,
  suffix = "",
): string {
  const minuteMs = 60 * 1000;
  const hourMinutes = 60;
  const dayMinutes = 24 * hourMinutes;
  const totalMinutes = Math.max(1, Math.ceil(diffMs / minuteMs));
  const parts: string[] = [];

  if (totalMinutes < hourMinutes) {
    parts.push(`${totalMinutes} min`);
  } else if (totalMinutes < dayMinutes) {
    const hours = Math.floor(totalMinutes / hourMinutes);
    const minutes = totalMinutes % hourMinutes;
    parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
  } else {
    const days = Math.ceil(totalMinutes / dayMinutes);
    parts.push(`${days} day${days === 1 ? "" : "s"}`);
  }

  return [prefix, parts.join(" "), suffix].filter(Boolean).join(" ");
}

export function classifyLink(
  link: UpgradeLink,
  context?: LinkClassificationContext,
): LinkRenderState {
  if (link.linkedMenuItemId == null || link.linkedMenuItem == null) {
    return { kind: "missing-item", rememberedItemName: link.itemNameSnapshot };
  }
  if (
    context &&
    isItemInDealsCategory(
      context.itemById.get(link.linkedMenuItemId) ?? null,
      context,
    )
  ) {
    return { kind: "nested-deal-item" };
  }
  if (!link.linkedMenuItem.isActive) {
    return { kind: "inactive-item" };
  }
  if (!isMenuItemAvailable(link.linkedMenuItem)) {
    return { kind: "out-of-stock-item" };
  }
  if (link.sizeNameSnapshot != null && link.linkedSizeId == null) {
    return { kind: "size-lost", rememberedSizeName: link.sizeNameSnapshot };
  }
  if (link.sizeNameSnapshot == null && link.linkedMenuItem.sizeCount > 0) {
    return { kind: "needs-size" };
  }
  return { kind: "ok" };
}

export function dealBaseStructuralRepairReason(
  item: Item,
  context: LinkClassificationContext,
): string | null {
  if (!item.dealBaseMenuItemId) return "Base item missing";
  if (item.dealBaseMenuItemId === item.id) return "Base item is this deal";

  const baseItem = context.itemById.get(item.dealBaseMenuItemId);
  if (!baseItem) return "Base item missing";
  if (isItemInDealsCategory(baseItem, context)) {
    return "Base item is another deal";
  }

  return null;
}

export function dealBaseAvailabilityReason(
  item: Item,
  context: LinkClassificationContext,
): string | null {
  if (dealBaseStructuralRepairReason(item, context)) return null;
  const baseItem = item.dealBaseMenuItemId
    ? (context.itemById.get(item.dealBaseMenuItemId) ?? null)
    : null;
  if (!baseItem) return null;
  if (!baseItem.isActive) return "Base item hidden";
  if (!isMenuItemAvailable(baseItem)) return "Base item out of stock";
  return null;
}

export function dealLinkStructuralRepairReason(
  item: Item,
  context: LinkClassificationContext,
): string | null {
  for (const link of item.upgradeOptions.flatMap(
    (option) => option.linkedItems,
  )) {
    const state = classifyLink(link, context);
    if (state.kind === "nested-deal-item") return "Nested deal link";
    if (state.kind === "missing-item") return "Needs repair";
    if (state.kind === "size-lost") return "Needs repair";
    if (state.kind === "needs-size") return "Needs repair";
  }

  return null;
}

export function dealStructuralRepairReason(
  item: Item,
  context: LinkClassificationContext,
): string | null {
  return (
    dealBaseStructuralRepairReason(item, context) ??
    dealLinkStructuralRepairReason(item, context)
  );
}

export function dealOptionIsCustomerComplete(
  option: Upgrade,
  context?: LinkClassificationContext,
): boolean {
  return (
    option.linkedItems.length > 0 &&
    option.linkedItems.every(
      (link) => classifyLink(link, context).kind === "ok",
    )
  );
}

export function dealHasCustomerAvailableUpgrade(
  item: Pick<Item, "upgradeOptions">,
  context?: LinkClassificationContext,
): boolean {
  return item.upgradeOptions.some((option) =>
    dealOptionIsCustomerComplete(option, context),
  );
}

export function itemVisibleInMenuFilter(
  item: Item,
  category: Cat,
  nowMs: number,
  context: LinkClassificationContext,
): boolean {
  if (!item.isActive) return false;
  if (!isDealsCategory(category)) return true;
  if (dealStructuralRepairReason(item, context)) return false;
  if (dealBaseAvailabilityReason(item, context)) return false;
  if (dealExpirationState(item, nowMs) !== "active") return false;
  return dealHasCustomerAvailableUpgrade(item, context);
}

export function isStockHiddenReason(reason: string): boolean {
  const lower = reason.toLowerCase();
  return (
    lower.includes("out of stock") ||
    lower.includes("unavailable") ||
    lower.includes("incomplete deal option")
  );
}

export function dealHiddenReason(
  item: Item,
  hasAvailableUpgrade: boolean,
  expirationState: "missing" | "invalid" | "scheduled" | "expired" | "active",
  structuralRepairReason: string | null = null,
  context?: LinkClassificationContext,
): string | null {
  if (structuralRepairReason) return structuralRepairReason;
  if (expirationState === "missing") return "No expiration set";
  if (expirationState === "invalid") return "Invalid schedule";
  if (expirationState === "scheduled") return "Scheduled";
  if (expirationState === "expired") return "Expired";

  if (hasAvailableUpgrade) {
    return item.isActive ? null : "Manually hidden";
  }

  const links = item.upgradeOptions.flatMap((option) => option.linkedItems);
  if (links.length === 0) {
    return item.upgradeOptions.length === 0
      ? "No deal option"
      : "No required items";
  }

  const states = links.map((link) => classifyLink(link, context));
  if (states.some((state) => state.kind === "nested-deal-item")) {
    return "Nested deal link";
  }
  const hasRepairState = states.some(
    (state) =>
      state.kind === "missing-item" ||
      state.kind === "size-lost" ||
      state.kind === "needs-size",
  );
  if (hasRepairState) return "Needs repair";

  if (states.every((state) => state.kind === "out-of-stock-item")) {
    return "Included items out of stock";
  }

  if (states.every((state) => state.kind === "inactive-item")) {
    return "Included items hidden";
  }

  if (states.some((state) => state.kind === "ok")) {
    return "Incomplete deal option";
  }

  if (states.some((state) => state.kind === "out-of-stock-item")) {
    return "Included items unavailable";
  }

  return "No available included items";
}
