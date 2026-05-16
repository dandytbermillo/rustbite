import { Prisma } from "@prisma/client";
import { createSnapshotDealBaseResolver } from "./deal-base-validation";
import { DEAL_LIMIT_MAX_QTY } from "./deal-selling-limits";
import { DEFAULT_OUTLET_ID } from "./outlets";
import { bumpOutletMenuVersion } from "./outlet-menu-sync";
import type { DealLimitMode, ImageFit } from "./types";
import type { MenuStockMode } from "./menu-availability";

export const MENU_HISTORY_ACTOR = {
  type: "ADMIN_BASIC",
  identity: "shared-admin",
} as const;

export const MENU_HISTORY_STATE_ID = menuHistoryStateIdForOutlet(DEFAULT_OUTLET_ID);

export function menuHistoryStateIdForOutlet(outletId: string): string {
  return `outlet:${outletId}`;
}

export type MenuCategorySnapshot = {
  id: string;
  slug: string;
  name: string;
  icon: string;
  sortOrder: number;
  isActive: boolean;
};

export type MenuModifierSnapshot = {
  id: string;
  name: string;
  priceDelta: number;
  sortOrder: number;
  stockSnapshotVersion?: 1;
  stockMode?: MenuStockMode;
  isOutOfStock?: boolean;
  stockQty?: number | null;
  lowStockThreshold?: number | null;
  stockUpdatedAt?: string | null;
  stockUpdatedById?: string | null;
};

export type MenuUpgradeItemLinkSnapshot = {
  id: string;
  linkedMenuItemId: string | null;
  linkedSizeId: string | null;
  itemNameSnapshot: string | null;
  sizeNameSnapshot: string | null;
  sortOrder: number;
};

export type MenuUpgradeOptionSnapshot = {
  id: string;
  customTitle: string | null;
  extraCharge: number;
  savingsLabel: number | null;
  // Operator's intent in % when set; null = manual mode. Persisted alongside
  // dollar columns so revisions/restore preserve the live-recompute intent.
  discountPct: number | null;
  sortOrder: number;
  linkedItems: MenuUpgradeItemLinkSnapshot[];
};

export type MenuItemSnapshot = {
  id: string;
  categoryId: string;
  comboNum: number | null;
  name: string;
  description: string;
  price: number;
  emoji: string;
  bgColor: string;
  badge: string | null;
  // Legacy fields kept for backward compat with pre-cutover snapshots; new
  // snapshots also write them while the parent columns are still alive.
  mealUpgrade: number | null;
  mealSavings: number | null;
  bundleSavings: number | null;
  dealBaseMenuItemId: string | null;
  dealBaseSizeId: string | null;
  dealBaseSizeNameSnapshot: string | null;
  dealStartsAt?: string | null;
  dealExpiresAt: string | null;
  dealLimitMode?: DealLimitMode;
  dealLimitQty?: number | null;
  dealLimitLowThreshold?: number | null;
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
  sortOrder: number;
  sizes: MenuModifierSnapshot[];
  addons: MenuModifierSnapshot[];
  upgradeOptions: MenuUpgradeOptionSnapshot[];
};

export type MenuSnapshot = {
  categories: MenuCategorySnapshot[];
  items: MenuItemSnapshot[];
};

type MenuHistoryTx = Prisma.TransactionClient;

type CurrentRestoreStockState = {
  stockMode: MenuStockMode;
  stockQty: number | null;
  stockUpdatedAt: Date | null;
  stockUpdatedById: string | null;
};

type CurrentAddonRestoreStockState = CurrentRestoreStockState;

function menuRestoreStockFields(
  item: MenuItemSnapshot,
  isDeal: boolean,
  current: CurrentRestoreStockState | undefined
) {
  if (isDeal || item.stockMode !== "QUANTITY") {
    return {
      stockMode: "MANUAL" as const,
      stockQty: null,
      lowStockThreshold: null,
      stockUpdatedAt: null,
      stockUpdatedById: null,
    };
  }

  const preserveCurrentQuantity = current?.stockMode === "QUANTITY";

  return {
    stockMode: "QUANTITY" as const,
    stockQty: preserveCurrentQuantity ? current.stockQty ?? 0 : 0,
    lowStockThreshold: item.lowStockThreshold,
    stockUpdatedAt: preserveCurrentQuantity ? current.stockUpdatedAt : null,
    stockUpdatedById: preserveCurrentQuantity ? current.stockUpdatedById : null,
  };
}

function addonRestoreStockFields(
  addon: MenuModifierSnapshot,
  current: CurrentAddonRestoreStockState | undefined
) {
  const stockMode = addon.stockMode === "QUANTITY" ? "QUANTITY" : "MANUAL";
  if (stockMode !== "QUANTITY") {
    return {
      stockMode: "MANUAL" as const,
      isOutOfStock: Boolean(addon.isOutOfStock),
      stockQty: null,
      lowStockThreshold: null,
      stockUpdatedAt: null,
      stockUpdatedById: null,
    };
  }

  const preserveCurrentQuantity = current?.stockMode === "QUANTITY";

  return {
    stockMode: "QUANTITY" as const,
    isOutOfStock: false,
    stockQty: preserveCurrentQuantity ? current.stockQty ?? 0 : 0,
    lowStockThreshold: addon.lowStockThreshold ?? null,
    stockUpdatedAt: preserveCurrentQuantity ? current.stockUpdatedAt : null,
    stockUpdatedById: preserveCurrentQuantity ? current.stockUpdatedById : null,
  };
}

type RevisionReason =
  | "CATEGORY_CREATED"
  | "CATEGORY_UPDATED"
  | "CATEGORY_DELETED"
  | "ITEM_CREATED"
  | "ITEM_UPDATED"
  | "ITEM_HIDDEN"
  | "ITEM_DELETED"
  | "MODIFIER_GROUP_CREATED"
  | "MODIFIER_GROUP_UPDATED"
  | "MODIFIER_GROUP_DEACTIVATED"
  | "MODIFIER_GROUP_HARD_DELETED"
  | "MODIFIER_OPTION_CREATED"
  | "MODIFIER_OPTION_UPDATED"
  | "MODIFIER_OPTION_DEACTIVATED"
  | "MODIFIER_OPTION_HARD_DELETED"
  | "ITEM_MODIFIER_GROUP_ATTACHED"
  | "ITEM_MODIFIER_GROUP_UPDATED"
  | "ITEM_MODIFIER_GROUP_DETACHED"
  | "ITEM_MODIFIER_OVERRIDE_UPDATED"
  | "ITEM_MODIFIER_OVERRIDE_CLEARED"
  | "MENU_RESTORED"
  | "MENU_REORDERED";

type AuditWriteInput = {
  actionType: RevisionReason;
  targetType:
    | "CATEGORY"
    | "ITEM"
    | "MODIFIER_GROUP"
    | "MODIFIER_OPTION"
    | "ITEM_MODIFIER_GROUP"
    | "ITEM_MODIFIER_OVERRIDE"
    | "MENU_REVISION";
  outletId?: string;
  targetId?: string | null;
  targetLabel?: string | null;
  beforePayload?: Prisma.InputJsonValue;
  afterPayload?: Prisma.InputJsonValue;
  sourceRevisionId?: string | null;
};

export function categorySnapshotFromRecord(record: {
  id: string;
  slug: string;
  name: string;
  icon: string;
  sortOrder: number;
  isActive: boolean;
}): MenuCategorySnapshot {
  return {
    id: record.id,
    slug: record.slug,
    name: record.name,
    icon: record.icon,
    sortOrder: record.sortOrder,
    isActive: record.isActive,
  };
}

function modifierSnapshotFromRecord(record: {
  id: string;
  name: string;
  priceDelta: Prisma.Decimal;
  sortOrder: number;
  stockMode?: MenuStockMode | null;
  isOutOfStock?: boolean | null;
  stockQty?: number | null;
  lowStockThreshold?: number | null;
  stockUpdatedAt?: Date | null;
  stockUpdatedById?: string | null;
}): MenuModifierSnapshot {
  const snapshot: MenuModifierSnapshot = {
    id: record.id,
    name: record.name,
    priceDelta: Number(record.priceDelta),
    sortOrder: record.sortOrder,
  };

  if (record.stockMode) {
    snapshot.stockSnapshotVersion = 1;
    snapshot.stockMode = record.stockMode;
    snapshot.isOutOfStock =
      record.stockMode === "QUANTITY" ? false : Boolean(record.isOutOfStock);
    snapshot.stockQty =
      record.stockMode === "QUANTITY" ? record.stockQty ?? 0 : null;
    snapshot.lowStockThreshold =
      record.stockMode === "QUANTITY" ? record.lowStockThreshold ?? null : null;
    snapshot.stockUpdatedAt = record.stockUpdatedAt?.toISOString() ?? null;
    snapshot.stockUpdatedById = record.stockUpdatedById ?? null;
  }

  return snapshot;
}

function upgradeItemLinkSnapshotFromRecord(record: {
  id: string;
  linkedMenuItemId: string | null;
  linkedSizeId: string | null;
  itemNameSnapshot: string | null;
  sizeNameSnapshot: string | null;
  sortOrder: number;
}): MenuUpgradeItemLinkSnapshot {
  return {
    id: record.id,
    linkedMenuItemId: record.linkedMenuItemId,
    linkedSizeId: record.linkedSizeId,
    itemNameSnapshot: record.itemNameSnapshot,
    sizeNameSnapshot: record.sizeNameSnapshot,
    sortOrder: record.sortOrder,
  };
}

function upgradeOptionSnapshotFromRecord(record: {
  id: string;
  customTitle: string | null;
  extraCharge: Prisma.Decimal;
  savingsLabel: Prisma.Decimal | null;
  discountPct: Prisma.Decimal | null;
  sortOrder: number;
  linkedItems: Array<{
    id: string;
    linkedMenuItemId: string | null;
    linkedSizeId: string | null;
    itemNameSnapshot: string | null;
    sizeNameSnapshot: string | null;
    sortOrder: number;
  }>;
}): MenuUpgradeOptionSnapshot {
  return {
    id: record.id,
    customTitle: record.customTitle,
    extraCharge: Number(record.extraCharge),
    savingsLabel: record.savingsLabel != null ? Number(record.savingsLabel) : null,
    discountPct: record.discountPct != null ? Number(record.discountPct) : null,
    sortOrder: record.sortOrder,
    linkedItems: record.linkedItems
      .map(upgradeItemLinkSnapshotFromRecord)
      .sort((a, b) => a.sortOrder - b.sortOrder),
  };
}

export function itemSnapshotFromRecord(record: {
  id: string;
  categoryId: string;
  comboNum: number | null;
  name: string;
  description: string;
  price: Prisma.Decimal;
  emoji: string;
  bgColor: string;
  badge: string | null;
  mealUpgrade: Prisma.Decimal | null;
  mealSavings: Prisma.Decimal | null;
  bundleSavings: Prisma.Decimal | null;
  dealBaseMenuItemId: string | null;
  dealBaseSizeId: string | null;
  dealBaseSizeNameSnapshot: string | null;
  dealStartsAt?: Date | null;
  dealExpiresAt: Date | null;
  dealLimitMode?: DealLimitMode | null;
  dealLimitQty?: number | null;
  dealLimitLowThreshold?: number | null;
  imageUrl: string | null;
  imageAlt: string | null;
  imageFit: string;
  cardImageUrl: string | null;
  cardImageAlt: string | null;
  isActive: boolean;
  isOutOfStock: boolean;
  stockMode: MenuStockMode;
  stockQty: number | null;
  lowStockThreshold: number | null;
  stockUpdatedAt: Date | null;
  sortOrder: number;
  sizes: Array<{
    id: string;
    name: string;
    priceDelta: Prisma.Decimal;
    sortOrder: number;
  }>;
  addons: Array<{
    id: string;
    name: string;
    priceDelta: Prisma.Decimal;
    sortOrder: number;
    stockMode?: MenuStockMode | null;
    isOutOfStock?: boolean | null;
    stockQty?: number | null;
    lowStockThreshold?: number | null;
    stockUpdatedAt?: Date | null;
    stockUpdatedById?: string | null;
  }>;
  upgradeOptions: Array<{
    id: string;
    customTitle: string | null;
    extraCharge: Prisma.Decimal;
    savingsLabel: Prisma.Decimal | null;
    discountPct: Prisma.Decimal | null;
    sortOrder: number;
    linkedItems: Array<{
      id: string;
      linkedMenuItemId: string | null;
      linkedSizeId: string | null;
      itemNameSnapshot: string | null;
      sizeNameSnapshot: string | null;
      sortOrder: number;
    }>;
  }>;
}): MenuItemSnapshot {
  return {
    id: record.id,
    categoryId: record.categoryId,
    comboNum: record.comboNum,
    name: record.name,
    description: record.description,
    price: Number(record.price),
    emoji: record.emoji,
    bgColor: record.bgColor,
    badge: record.badge,
    mealUpgrade: record.mealUpgrade != null ? Number(record.mealUpgrade) : null,
    mealSavings: record.mealSavings != null ? Number(record.mealSavings) : null,
    bundleSavings: record.bundleSavings != null ? Number(record.bundleSavings) : null,
    dealBaseMenuItemId: record.dealBaseMenuItemId,
    dealBaseSizeId: record.dealBaseSizeId,
    dealBaseSizeNameSnapshot: record.dealBaseSizeNameSnapshot,
    dealStartsAt: record.dealStartsAt?.toISOString() ?? null,
    dealExpiresAt: record.dealExpiresAt?.toISOString() ?? null,
    dealLimitMode: record.dealLimitMode === "LIMITED" ? "LIMITED" : "UNLIMITED",
    dealLimitQty:
      record.dealLimitMode === "LIMITED" ? record.dealLimitQty ?? 0 : record.dealLimitQty ?? null,
    dealLimitLowThreshold: record.dealLimitLowThreshold ?? null,
    imageUrl: record.imageUrl,
    imageAlt: record.imageAlt,
    imageFit: record.imageFit === "CONTAIN" ? "CONTAIN" : "COVER",
    cardImageUrl: record.cardImageUrl,
    cardImageAlt: record.cardImageAlt,
    isActive: record.isActive,
    isOutOfStock: record.isOutOfStock,
    stockMode: record.stockMode,
    stockQty: record.stockMode === "QUANTITY" ? record.stockQty ?? 0 : null,
    lowStockThreshold:
      record.stockMode === "QUANTITY" ? record.lowStockThreshold : null,
    stockUpdatedAt: record.stockUpdatedAt?.toISOString() ?? null,
    sortOrder: record.sortOrder,
    sizes: record.sizes
      .map(modifierSnapshotFromRecord)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    addons: record.addons
      .map(modifierSnapshotFromRecord)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    upgradeOptions: record.upgradeOptions
      .map(upgradeOptionSnapshotFromRecord)
      .sort((a, b) => a.sortOrder - b.sortOrder),
  };
}

export async function captureMenuSnapshot(
  tx: MenuHistoryTx,
  outletId = DEFAULT_OUTLET_ID
): Promise<MenuSnapshot> {
  const [categories, items] = await Promise.all([
    tx.category.findMany({
      where: { outletId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    tx.menuItem.findMany({
      where: { outletId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        sizes: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
        addons: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
        upgradeOptions: {
          orderBy: { sortOrder: "asc" },
          include: {
            linkedItems: { orderBy: { sortOrder: "asc" } },
          },
        },
      },
    }),
  ]);

  return {
    categories: categories.map(categorySnapshotFromRecord),
    items: items.map(itemSnapshotFromRecord),
  };
}

export function summarizeMenuSnapshot(snapshot: MenuSnapshot) {
  return {
    categoryCount: snapshot.categories.length,
    liveCategoryCount: snapshot.categories.filter((category) => category.isActive).length,
    itemCount: snapshot.items.length,
    liveItemCount: snapshot.items.filter((item) => item.isActive).length,
  };
}

export function diagnoseMenuSnapshotDealBaseRestore(snapshot: MenuSnapshot) {
  return createSnapshotDealBaseResolver(snapshot).issues;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseModifierSnapshot(raw: unknown, field: string): MenuModifierSnapshot {
  if (!isRecord(raw)) throw new Error(`${field} is invalid`);
  if (typeof raw.id !== "string" || !raw.id) throw new Error(`${field} id is invalid`);
  if (typeof raw.name !== "string" || !raw.name) throw new Error(`${field} name is invalid`);
  if (typeof raw.priceDelta !== "number" || !Number.isFinite(raw.priceDelta)) {
    throw new Error(`${field} priceDelta is invalid`);
  }
  if (!Number.isInteger(raw.sortOrder)) throw new Error(`${field} sortOrder is invalid`);
  const priceDelta = raw.priceDelta;
  const sortOrder = Number(raw.sortOrder);
  const hasStockSnapshot =
    raw.stockMode != null ||
    raw.isOutOfStock != null ||
    raw.stockQty != null ||
    raw.lowStockThreshold != null ||
    raw.stockUpdatedAt != null ||
    raw.stockUpdatedById != null;

  if (
    raw.stockMode != null &&
    raw.stockMode !== "MANUAL" &&
    raw.stockMode !== "QUANTITY"
  ) {
    throw new Error(`${field} stock mode is invalid`);
  }
  if (
    raw.stockQty != null &&
    (!Number.isInteger(raw.stockQty) || Number(raw.stockQty) < 0)
  ) {
    throw new Error(`${field} stock quantity is invalid`);
  }
  if (
    raw.lowStockThreshold != null &&
    (!Number.isInteger(raw.lowStockThreshold) ||
      Number(raw.lowStockThreshold) < 0)
  ) {
    throw new Error(`${field} low stock threshold is invalid`);
  }
  if (
    raw.stockUpdatedAt != null &&
    typeof raw.stockUpdatedAt !== "string"
  ) {
    throw new Error(`${field} stock update date is invalid`);
  }
  if (
    raw.stockUpdatedById != null &&
    typeof raw.stockUpdatedById !== "string"
  ) {
    throw new Error(`${field} stock update actor is invalid`);
  }

  const stockMode: MenuStockMode =
    raw.stockMode === "QUANTITY" ? "QUANTITY" : "MANUAL";

  const snapshot: MenuModifierSnapshot = {
    id: raw.id,
    name: raw.name,
    priceDelta,
    sortOrder,
  };

  if (hasStockSnapshot) {
    snapshot.stockSnapshotVersion = 1;
    snapshot.stockMode = stockMode;
    snapshot.isOutOfStock =
      stockMode === "QUANTITY" ? false : Boolean(raw.isOutOfStock);
    snapshot.stockQty =
      stockMode === "QUANTITY"
        ? raw.stockQty == null
          ? 0
          : Number(raw.stockQty)
        : null;
    snapshot.lowStockThreshold =
      stockMode === "QUANTITY" && raw.lowStockThreshold != null
        ? Number(raw.lowStockThreshold)
        : null;
    snapshot.stockUpdatedAt =
      typeof raw.stockUpdatedAt === "string" ? raw.stockUpdatedAt : null;
    snapshot.stockUpdatedById =
      typeof raw.stockUpdatedById === "string" ? raw.stockUpdatedById : null;
  }

  return snapshot;
}

function parseUpgradeItemLinkSnapshot(
  raw: unknown,
  field: string
): MenuUpgradeItemLinkSnapshot {
  if (!isRecord(raw)) throw new Error(`${field} is invalid`);
  if (typeof raw.id !== "string" || !raw.id) throw new Error(`${field} id is invalid`);
  if (raw.linkedMenuItemId != null && typeof raw.linkedMenuItemId !== "string") {
    throw new Error(`${field} linkedMenuItemId is invalid`);
  }
  if (raw.linkedSizeId != null && typeof raw.linkedSizeId !== "string") {
    throw new Error(`${field} linkedSizeId is invalid`);
  }
  // itemNameSnapshot is tolerated as missing on legacy snapshots written before
  // the add_upgrade_item_name_snapshot migration. Same lifecycle as sizeNameSnapshot.
  if (raw.itemNameSnapshot != null && typeof raw.itemNameSnapshot !== "string") {
    throw new Error(`${field} itemNameSnapshot is invalid`);
  }
  if (raw.sizeNameSnapshot != null && typeof raw.sizeNameSnapshot !== "string") {
    throw new Error(`${field} sizeNameSnapshot is invalid`);
  }
  if (!Number.isInteger(raw.sortOrder)) {
    throw new Error(`${field} sortOrder is invalid`);
  }

  return {
    id: raw.id,
    linkedMenuItemId: (raw.linkedMenuItemId as string | null) ?? null,
    linkedSizeId: (raw.linkedSizeId as string | null) ?? null,
    itemNameSnapshot: (raw.itemNameSnapshot as string | null) ?? null,
    sizeNameSnapshot: (raw.sizeNameSnapshot as string | null) ?? null,
    sortOrder: Number(raw.sortOrder),
  };
}

function parseUpgradeOptionSnapshot(
  raw: unknown,
  field: string
): MenuUpgradeOptionSnapshot {
  if (!isRecord(raw)) throw new Error(`${field} is invalid`);
  if (typeof raw.id !== "string" || !raw.id) throw new Error(`${field} id is invalid`);
  if (raw.customTitle != null && typeof raw.customTitle !== "string") {
    throw new Error(`${field} customTitle is invalid`);
  }
  if (typeof raw.extraCharge !== "number" || !Number.isFinite(raw.extraCharge)) {
    throw new Error(`${field} extraCharge is invalid`);
  }
  if (
    raw.savingsLabel != null &&
    (typeof raw.savingsLabel !== "number" || !Number.isFinite(raw.savingsLabel))
  ) {
    throw new Error(`${field} savingsLabel is invalid`);
  }
  // discountPct is optional and tolerant — legacy snapshots pre-date the
  // column entirely. Treat undefined or null as "manual mode".
  if (
    raw.discountPct != null &&
    (typeof raw.discountPct !== "number" || !Number.isFinite(raw.discountPct))
  ) {
    throw new Error(`${field} discountPct is invalid`);
  }
  if (!Number.isInteger(raw.sortOrder)) {
    throw new Error(`${field} sortOrder is invalid`);
  }
  if (!Array.isArray(raw.linkedItems)) {
    throw new Error(`${field} linkedItems is invalid`);
  }

  return {
    id: raw.id,
    customTitle: (raw.customTitle as string | null) ?? null,
    extraCharge: raw.extraCharge,
    savingsLabel:
      raw.savingsLabel == null ? null : (raw.savingsLabel as number),
    discountPct: raw.discountPct == null ? null : (raw.discountPct as number),
    sortOrder: Number(raw.sortOrder),
    linkedItems: raw.linkedItems.map((link, linkIndex) =>
      parseUpgradeItemLinkSnapshot(link, `${field} link ${linkIndex + 1}`)
    ),
  };
}

export function parseMenuSnapshot(raw: unknown): MenuSnapshot {
  if (!isRecord(raw)) throw new Error("Revision snapshot is invalid");
  if (!Array.isArray(raw.categories) || !Array.isArray(raw.items)) {
    throw new Error("Revision snapshot is invalid");
  }

  const categories = raw.categories.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`Category snapshot ${index + 1} is invalid`);
    if (typeof entry.id !== "string" || !entry.id) {
      throw new Error(`Category snapshot ${index + 1} id is invalid`);
    }
    if (typeof entry.slug !== "string" || !entry.slug) {
      throw new Error(`Category snapshot ${index + 1} slug is invalid`);
    }
    if (typeof entry.name !== "string" || !entry.name) {
      throw new Error(`Category snapshot ${index + 1} name is invalid`);
    }
    if (typeof entry.icon !== "string" || !entry.icon) {
      throw new Error(`Category snapshot ${index + 1} icon is invalid`);
    }
    if (!Number.isInteger(entry.sortOrder)) {
      throw new Error(`Category snapshot ${index + 1} sortOrder is invalid`);
    }
    if (typeof entry.isActive !== "boolean") {
      throw new Error(`Category snapshot ${index + 1} visibility is invalid`);
    }
    const sortOrder = Number(entry.sortOrder);

    return {
      id: entry.id,
      slug: entry.slug,
      name: entry.name,
      icon: entry.icon,
      sortOrder,
      isActive: entry.isActive,
    } satisfies MenuCategorySnapshot;
  });

  const categoryIds = new Set(categories.map((category) => category.id));

  const items = raw.items.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`Item snapshot ${index + 1} is invalid`);
    if (typeof entry.id !== "string" || !entry.id) {
      throw new Error(`Item snapshot ${index + 1} id is invalid`);
    }
    if (typeof entry.categoryId !== "string" || !categoryIds.has(entry.categoryId)) {
      throw new Error(`Item snapshot ${index + 1} category is invalid`);
    }
    if (entry.comboNum != null && !Number.isInteger(entry.comboNum)) {
      throw new Error(`Item snapshot ${index + 1} combo number is invalid`);
    }
    if (typeof entry.name !== "string" || !entry.name) {
      throw new Error(`Item snapshot ${index + 1} name is invalid`);
    }
    if (typeof entry.description !== "string") {
      throw new Error(`Item snapshot ${index + 1} description is invalid`);
    }
    if (typeof entry.price !== "number" || !Number.isFinite(entry.price)) {
      throw new Error(`Item snapshot ${index + 1} price is invalid`);
    }
    if (typeof entry.emoji !== "string" || !entry.emoji) {
      throw new Error(`Item snapshot ${index + 1} emoji is invalid`);
    }
    if (typeof entry.bgColor !== "string" || !entry.bgColor) {
      throw new Error(`Item snapshot ${index + 1} background color is invalid`);
    }
    if (entry.badge != null && typeof entry.badge !== "string") {
      throw new Error(`Item snapshot ${index + 1} badge is invalid`);
    }
    if (entry.mealUpgrade != null && (typeof entry.mealUpgrade !== "number" || !Number.isFinite(entry.mealUpgrade))) {
      throw new Error(`Item snapshot ${index + 1} meal upgrade is invalid`);
    }
    if (entry.mealSavings != null && (typeof entry.mealSavings !== "number" || !Number.isFinite(entry.mealSavings))) {
      throw new Error(`Item snapshot ${index + 1} meal savings is invalid`);
    }
    if (
      entry.bundleSavings != null &&
      (typeof entry.bundleSavings !== "number" || !Number.isFinite(entry.bundleSavings))
    ) {
      throw new Error(`Item snapshot ${index + 1} bundle savings is invalid`);
    }
    if (
      entry.dealBaseMenuItemId != null &&
      typeof entry.dealBaseMenuItemId !== "string"
    ) {
      throw new Error(`Item snapshot ${index + 1} deal base item is invalid`);
    }
    if (
      entry.dealBaseSizeId != null &&
      typeof entry.dealBaseSizeId !== "string"
    ) {
      throw new Error(`Item snapshot ${index + 1} deal base size is invalid`);
    }
    if (
      entry.dealBaseSizeNameSnapshot != null &&
      typeof entry.dealBaseSizeNameSnapshot !== "string"
    ) {
      throw new Error(`Item snapshot ${index + 1} deal base size is invalid`);
    }
    if (entry.dealStartsAt != null && typeof entry.dealStartsAt !== "string") {
      throw new Error(`Item snapshot ${index + 1} deal start is invalid`);
    }
    if (entry.dealExpiresAt != null && typeof entry.dealExpiresAt !== "string") {
      throw new Error(`Item snapshot ${index + 1} deal expiration is invalid`);
    }
    if (
      entry.dealLimitMode != null &&
      entry.dealLimitMode !== "UNLIMITED" &&
      entry.dealLimitMode !== "LIMITED"
    ) {
      throw new Error(`Item snapshot ${index + 1} deal limit mode is invalid`);
    }
    if (
      entry.dealLimitQty != null &&
      (!Number.isInteger(entry.dealLimitQty) ||
        Number(entry.dealLimitQty) < 0 ||
        Number(entry.dealLimitQty) > DEAL_LIMIT_MAX_QTY)
    ) {
      throw new Error(`Item snapshot ${index + 1} deal limit quantity is invalid`);
    }
    if (
      entry.dealLimitLowThreshold != null &&
      (!Number.isInteger(entry.dealLimitLowThreshold) ||
        Number(entry.dealLimitLowThreshold) < 0 ||
        Number(entry.dealLimitLowThreshold) > DEAL_LIMIT_MAX_QTY)
    ) {
      throw new Error(`Item snapshot ${index + 1} deal limit low alert is invalid`);
    }
    if (entry.upgradeOptions != null && !Array.isArray(entry.upgradeOptions)) {
      throw new Error(`Item snapshot ${index + 1} upgrade options are invalid`);
    }
    if (entry.imageUrl != null && typeof entry.imageUrl !== "string") {
      throw new Error(`Item snapshot ${index + 1} image URL is invalid`);
    }
    if (entry.imageAlt != null && typeof entry.imageAlt !== "string") {
      throw new Error(`Item snapshot ${index + 1} image alt is invalid`);
    }
    if (entry.cardImageUrl != null && typeof entry.cardImageUrl !== "string") {
      throw new Error(`Item snapshot ${index + 1} card image URL is invalid`);
    }
    if (entry.cardImageAlt != null && typeof entry.cardImageAlt !== "string") {
      throw new Error(`Item snapshot ${index + 1} card image alt is invalid`);
    }
    if (
      entry.imageFit != null &&
      entry.imageFit !== "COVER" &&
      entry.imageFit !== "CONTAIN"
    ) {
      throw new Error(`Item snapshot ${index + 1} image fit is invalid`);
    }
    if (typeof entry.isActive !== "boolean") {
      throw new Error(`Item snapshot ${index + 1} visibility is invalid`);
    }
    const isOutOfStock =
      entry.isOutOfStock === undefined ? false : Boolean(entry.isOutOfStock);
    const stockMode: MenuStockMode =
      entry.stockMode === "QUANTITY" ? "QUANTITY" : "MANUAL";
    if (
      entry.stockMode != null &&
      entry.stockMode !== "MANUAL" &&
      entry.stockMode !== "QUANTITY"
    ) {
      throw new Error(`Item snapshot ${index + 1} stock mode is invalid`);
    }
    if (
      entry.stockQty != null &&
      (!Number.isInteger(entry.stockQty) || Number(entry.stockQty) < 0)
    ) {
      throw new Error(`Item snapshot ${index + 1} stock quantity is invalid`);
    }
    if (
      entry.lowStockThreshold != null &&
      (!Number.isInteger(entry.lowStockThreshold) ||
        Number(entry.lowStockThreshold) < 0)
    ) {
      throw new Error(`Item snapshot ${index + 1} low stock threshold is invalid`);
    }
    if (
      entry.stockUpdatedAt != null &&
      typeof entry.stockUpdatedAt !== "string"
    ) {
      throw new Error(`Item snapshot ${index + 1} stock update date is invalid`);
    }
    if (!Number.isInteger(entry.sortOrder)) {
      throw new Error(`Item snapshot ${index + 1} sortOrder is invalid`);
    }
    if (!Array.isArray(entry.sizes) || !Array.isArray(entry.addons)) {
      throw new Error(`Item snapshot ${index + 1} modifiers are invalid`);
    }
    const comboNum =
      entry.comboNum == null ? null : Number(entry.comboNum);
    const price = Number(entry.price);
    const mealUpgrade =
      entry.mealUpgrade == null ? null : Number(entry.mealUpgrade);
    const mealSavings =
      entry.mealSavings == null ? null : Number(entry.mealSavings);
    const bundleSavings =
      entry.bundleSavings == null ? null : Number(entry.bundleSavings);
    const dealBaseMenuItemId =
      typeof entry.dealBaseMenuItemId === "string" && entry.dealBaseMenuItemId
        ? entry.dealBaseMenuItemId
        : null;
    const dealBaseSizeId =
      typeof entry.dealBaseSizeId === "string" && entry.dealBaseSizeId
        ? entry.dealBaseSizeId
        : null;
    const dealBaseSizeNameSnapshot =
      typeof entry.dealBaseSizeNameSnapshot === "string" &&
      entry.dealBaseSizeNameSnapshot
        ? entry.dealBaseSizeNameSnapshot
        : null;
    const dealLimitMode: DealLimitMode =
      entry.dealLimitMode === "LIMITED" ? "LIMITED" : "UNLIMITED";
    const dealLimitQty =
      entry.dealLimitQty == null ? null : Number(entry.dealLimitQty);
    if (dealLimitMode === "LIMITED" && dealLimitQty == null) {
      throw new Error(`Item snapshot ${index + 1} deal limit quantity is required`);
    }
    const dealLimitLowThreshold =
      entry.dealLimitLowThreshold == null
        ? null
        : Number(entry.dealLimitLowThreshold);
    const stockQty =
      stockMode === "QUANTITY"
        ? entry.stockQty == null
          ? 0
          : Number(entry.stockQty)
        : null;
    const lowStockThreshold =
      stockMode === "QUANTITY" && entry.lowStockThreshold != null
        ? Number(entry.lowStockThreshold)
        : null;
    const sortOrder = Number(entry.sortOrder);

    const upgradeOptions = Array.isArray(entry.upgradeOptions)
      ? entry.upgradeOptions.map((option, optionIndex) =>
          parseUpgradeOptionSnapshot(
            option,
            `Item snapshot ${index + 1} upgrade option ${optionIndex + 1}`
          )
        )
      : [];

    return {
      id: entry.id,
      categoryId: entry.categoryId,
      comboNum,
      name: entry.name,
      description: entry.description,
      price,
      emoji: entry.emoji,
      bgColor: entry.bgColor,
      badge: entry.badge ?? null,
      mealUpgrade,
      mealSavings,
      bundleSavings,
      dealBaseMenuItemId,
      dealBaseSizeId,
      dealBaseSizeNameSnapshot:
        dealBaseMenuItemId && dealBaseSizeId ? dealBaseSizeNameSnapshot : null,
      dealStartsAt:
        typeof entry.dealStartsAt === "string" ? entry.dealStartsAt : null,
      dealExpiresAt:
        typeof entry.dealExpiresAt === "string" ? entry.dealExpiresAt : null,
      dealLimitMode,
      dealLimitQty,
      dealLimitLowThreshold,
      imageUrl: entry.imageUrl ?? null,
      imageAlt: entry.imageAlt ?? null,
      imageFit: entry.imageFit === "CONTAIN" ? "CONTAIN" : "COVER",
      cardImageUrl: entry.cardImageUrl ?? null,
      cardImageAlt: entry.cardImageAlt ?? null,
      isActive: entry.isActive,
      isOutOfStock,
      stockMode,
      stockQty,
      lowStockThreshold,
      stockUpdatedAt:
        typeof entry.stockUpdatedAt === "string" ? entry.stockUpdatedAt : null,
      sortOrder,
      sizes: entry.sizes.map((modifier, modifierIndex) =>
        parseModifierSnapshot(modifier, `Item snapshot ${index + 1} size ${modifierIndex + 1}`)
      ),
      addons: entry.addons.map((modifier, modifierIndex) =>
        parseModifierSnapshot(modifier, `Item snapshot ${index + 1} add-on ${modifierIndex + 1}`)
      ),
      upgradeOptions,
    } satisfies MenuItemSnapshot;
  });

  return { categories, items };
}

function parseSnapshotDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function writeMenuAuditAndRevision(
  tx: MenuHistoryTx,
  input: AuditWriteInput
) {
  await writeMenuAuditLog(tx, input);
  const result = await writeMenuRevision(tx, input);
  await bumpOutletMenuVersion(tx, input.outletId ?? DEFAULT_OUTLET_ID);
  return result;
}

export async function writeMenuAuditLog(
  tx: MenuHistoryTx,
  input: AuditWriteInput
) {
  const outletId = input.outletId ?? DEFAULT_OUTLET_ID;
  await tx.menuAuditLog.create({
    data: {
      outletId,
      actionType: input.actionType,
      targetType: input.targetType,
      targetId: input.targetId ?? undefined,
      targetLabel: input.targetLabel ?? undefined,
      actorType: MENU_HISTORY_ACTOR.type,
      actorIdentity: MENU_HISTORY_ACTOR.identity,
      beforePayload: input.beforePayload,
      afterPayload: input.afterPayload,
    },
  });
}

export async function setCurrentMenuRevision(
  tx: MenuHistoryTx,
  revisionId: string | null,
  outletId = DEFAULT_OUTLET_ID
) {
  const stateId = menuHistoryStateIdForOutlet(outletId);
  await tx.menuHistoryState.upsert({
    where: { id: stateId },
    update: {
      outletId,
      currentRevisionId: revisionId ?? null,
    },
    create: {
      id: stateId,
      outletId,
      currentRevisionId: revisionId ?? null,
    },
  });
}

export async function writeMenuRevision(
  tx: MenuHistoryTx,
  input: AuditWriteInput
) {
  const outletId = input.outletId ?? DEFAULT_OUTLET_ID;
  const snapshot = await captureMenuSnapshot(tx, outletId);

  const revision = await tx.menuRevision.create({
    data: {
      outletId,
      reason: input.actionType,
      targetType: input.targetType,
      targetId: input.targetId ?? undefined,
      targetLabel: input.targetLabel ?? undefined,
      actorType: MENU_HISTORY_ACTOR.type,
      actorIdentity: MENU_HISTORY_ACTOR.identity,
      snapshot,
      sourceRevisionId: input.sourceRevisionId ?? undefined,
    },
  });

  await setCurrentMenuRevision(tx, revision.id, outletId);

  return { revisionId: revision.id, snapshot };
}

export async function restoreMenuSnapshot(
  tx: MenuHistoryTx,
  snapshot: MenuSnapshot,
  outletId = DEFAULT_OUTLET_ID
) {
  const snapshotItemIds = snapshot.items.map((item) => item.id);
  const snapshotCategoryIds = snapshot.categories.map((category) => category.id);
  const snapshotAddonIds = snapshot.items.flatMap((item) =>
    item.addons.map((addon) => addon.id)
  );
  const currentStockByItemId = new Map(
    (
      snapshotItemIds.length > 0
        ? await tx.menuItem.findMany({
            where: { outletId, id: { in: snapshotItemIds } },
            select: {
              id: true,
              stockMode: true,
              stockQty: true,
              stockUpdatedAt: true,
              stockUpdatedById: true,
            },
          })
        : []
    ).map((item) => [item.id, item])
  );
  const currentStockByAddonId = new Map(
    (
      snapshotAddonIds.length > 0
        ? await tx.addonOption.findMany({
            where: {
              id: { in: snapshotAddonIds },
              item: { outletId },
            },
            select: {
              id: true,
              stockMode: true,
              stockQty: true,
              stockUpdatedAt: true,
              stockUpdatedById: true,
            },
          })
        : []
    ).map((addon) => [addon.id, addon])
  );

  await tx.menuItem.deleteMany({
    where: {
      outletId,
      id: snapshotItemIds.length > 0 ? { notIn: snapshotItemIds } : undefined,
    },
  });

  await tx.category.deleteMany({
    where: {
      outletId,
      id: snapshotCategoryIds.length > 0 ? { notIn: snapshotCategoryIds } : undefined,
    },
  });

  for (const category of snapshot.categories) {
    await tx.category.upsert({
      where: { id: category.id },
      update: {
        slug: category.slug,
        name: category.name,
        icon: category.icon,
        sortOrder: category.sortOrder,
        isActive: category.isActive,
        updatedAt: new Date(),
      },
      create: {
        id: category.id,
        outletId,
        slug: category.slug,
        name: category.name,
        icon: category.icon,
        sortOrder: category.sortOrder,
        isActive: category.isActive,
      },
    });
  }

  const categoryById = new Map(
    snapshot.categories.map((category) => [category.id, category])
  );
  const dealBaseResolver = createSnapshotDealBaseResolver(snapshot);

  for (const item of snapshot.items) {
    const isDeal = categoryById.get(item.categoryId)?.slug === "deals";
    const upgradeOptions = isDeal ? item.upgradeOptions : [];
    const stockFields = menuRestoreStockFields(
      item,
      isDeal,
      currentStockByItemId.get(item.id)
    );
    // Restore writes to bundleSavings only. Legacy mealUpgrade/mealSavings stay
    // alive on the parent row (until Migration 3 drops them) but are never
    // written by restore — pre-cutover snapshots get their mealSavings folded
    // into bundleSavings, and mealUpgrade gets synthesized into a zero-link
    // UpgradeOption below.
    const bundleSavingsValue =
      item.bundleSavings != null
        ? item.bundleSavings
        : item.mealSavings != null
        ? item.mealSavings
        : null;
    const dealLimitMode: DealLimitMode = isDeal
      ? item.dealLimitMode === "LIMITED"
        ? "LIMITED"
        : "UNLIMITED"
      : "UNLIMITED";
    const dealLimitQty = isDeal
      ? dealLimitMode === "LIMITED"
        ? item.dealLimitQty ?? 0
        : item.dealLimitQty ?? null
      : null;
    const dealLimitLowThreshold = isDeal
      ? item.dealLimitLowThreshold ?? null
      : null;

    await tx.menuItem.upsert({
      where: { id: item.id },
      update: {
        outletId,
        categoryId: item.categoryId,
        comboNum: item.comboNum,
        name: item.name,
        description: item.description,
        price: new Prisma.Decimal(item.price),
        emoji: item.emoji,
        bgColor: item.bgColor,
        badge: item.badge,
        bundleSavings:
          bundleSavingsValue != null ? new Prisma.Decimal(bundleSavingsValue) : null,
        dealBaseMenuItemId: null,
        dealBaseSizeId: null,
        dealBaseSizeNameSnapshot: null,
        dealStartsAt: isDeal ? parseSnapshotDate(item.dealStartsAt ?? null) : null,
        dealExpiresAt: isDeal ? parseSnapshotDate(item.dealExpiresAt) : null,
        dealLimitMode,
        dealLimitQty,
        dealLimitLowThreshold,
        dealLimitUpdatedAt: null,
        dealLimitUpdatedById: null,
        imageUrl: item.imageUrl,
        imageAlt: item.imageAlt,
        imageFit: item.imageFit,
        cardImageUrl: item.cardImageUrl,
        cardImageAlt: item.cardImageAlt,
        isActive: item.isActive,
        isOutOfStock: isDeal ? false : item.isOutOfStock,
        stockMode: stockFields.stockMode,
        stockQty: stockFields.stockQty,
        lowStockThreshold: stockFields.lowStockThreshold,
        stockUpdatedAt: stockFields.stockUpdatedAt,
        stockUpdatedById: stockFields.stockUpdatedById,
        sortOrder: item.sortOrder,
        lockVersion: { increment: 1 },
        updatedAt: new Date(),
      },
      create: {
        id: item.id,
        outletId,
        categoryId: item.categoryId,
        comboNum: item.comboNum,
        name: item.name,
        description: item.description,
        price: new Prisma.Decimal(item.price),
        emoji: item.emoji,
        bgColor: item.bgColor,
        badge: item.badge,
        bundleSavings:
          bundleSavingsValue != null ? new Prisma.Decimal(bundleSavingsValue) : null,
        dealBaseMenuItemId: null,
        dealBaseSizeId: null,
        dealBaseSizeNameSnapshot: null,
        dealStartsAt: isDeal ? parseSnapshotDate(item.dealStartsAt ?? null) : null,
        dealExpiresAt: isDeal ? parseSnapshotDate(item.dealExpiresAt) : null,
        dealLimitMode,
        dealLimitQty,
        dealLimitLowThreshold,
        dealLimitUpdatedAt: null,
        dealLimitUpdatedById: null,
        imageUrl: item.imageUrl,
        imageAlt: item.imageAlt,
        imageFit: item.imageFit,
        cardImageUrl: item.cardImageUrl,
        cardImageAlt: item.cardImageAlt,
        isActive: item.isActive,
        isOutOfStock: isDeal ? false : item.isOutOfStock,
        stockMode: stockFields.stockMode,
        stockQty: stockFields.stockQty,
        lowStockThreshold: stockFields.lowStockThreshold,
        stockUpdatedAt: stockFields.stockUpdatedAt,
        stockUpdatedById: stockFields.stockUpdatedById,
        sortOrder: item.sortOrder,
      },
    });

    const sizeIds = item.sizes.map((size) => size.id);
    await tx.sizeOption.deleteMany({
      where: {
        itemId: item.id,
        id: sizeIds.length > 0 ? { notIn: sizeIds } : undefined,
      },
    });
    for (const size of item.sizes) {
      await tx.sizeOption.upsert({
        where: { id: size.id },
        update: {
          itemId: item.id,
          name: size.name,
          priceDelta: new Prisma.Decimal(size.priceDelta),
          sortOrder: size.sortOrder,
        },
        create: {
          id: size.id,
          itemId: item.id,
          name: size.name,
          priceDelta: new Prisma.Decimal(size.priceDelta),
          sortOrder: size.sortOrder,
        },
      });
    }

    const addonIds = item.addons.map((addon) => addon.id);
    await tx.addonOption.deleteMany({
      where: {
        itemId: item.id,
        id: addonIds.length > 0 ? { notIn: addonIds } : undefined,
      },
    });
    for (const addon of item.addons) {
      const stockFields = addonRestoreStockFields(
        addon,
        currentStockByAddonId.get(addon.id)
      );
      await tx.addonOption.upsert({
        where: { id: addon.id },
        update: {
          itemId: item.id,
          name: addon.name,
          priceDelta: new Prisma.Decimal(addon.priceDelta),
          sortOrder: addon.sortOrder,
          stockMode: stockFields.stockMode,
          isOutOfStock: stockFields.isOutOfStock,
          stockQty: stockFields.stockQty,
          lowStockThreshold: stockFields.lowStockThreshold,
          stockUpdatedAt: stockFields.stockUpdatedAt,
          stockUpdatedById: stockFields.stockUpdatedById,
        },
        create: {
          id: addon.id,
          itemId: item.id,
          name: addon.name,
          priceDelta: new Prisma.Decimal(addon.priceDelta),
          sortOrder: addon.sortOrder,
          stockMode: stockFields.stockMode,
          isOutOfStock: stockFields.isOutOfStock,
          stockQty: stockFields.stockQty,
          lowStockThreshold: stockFields.lowStockThreshold,
          stockUpdatedAt: stockFields.stockUpdatedAt,
          stockUpdatedById: stockFields.stockUpdatedById,
        },
      });
    }

    const upgradeOptionIds = upgradeOptions.map((upgrade) => upgrade.id);
    await tx.upgradeOption.deleteMany({
      where: {
        itemId: item.id,
        id: upgradeOptionIds.length > 0 ? { notIn: upgradeOptionIds } : undefined,
      },
    });

    for (const upgrade of upgradeOptions) {
      await tx.upgradeOption.upsert({
        where: { id: upgrade.id },
        update: {
          itemId: item.id,
          customTitle: upgrade.customTitle,
          extraCharge: new Prisma.Decimal(upgrade.extraCharge),
          savingsLabel:
            upgrade.savingsLabel != null
              ? new Prisma.Decimal(upgrade.savingsLabel)
              : null,
          discountPct:
            upgrade.discountPct != null
              ? new Prisma.Decimal(upgrade.discountPct)
              : null,
          sortOrder: upgrade.sortOrder,
          updatedAt: new Date(),
        },
        create: {
          id: upgrade.id,
          itemId: item.id,
          customTitle: upgrade.customTitle,
          extraCharge: new Prisma.Decimal(upgrade.extraCharge),
          savingsLabel:
            upgrade.savingsLabel != null
              ? new Prisma.Decimal(upgrade.savingsLabel)
              : null,
          discountPct:
            upgrade.discountPct != null
              ? new Prisma.Decimal(upgrade.discountPct)
              : null,
          sortOrder: upgrade.sortOrder,
        },
      });

      const linkIds = upgrade.linkedItems.map((link) => link.id);
      await tx.upgradeItemLink.deleteMany({
        where: {
          upgradeOptionId: upgrade.id,
          id: linkIds.length > 0 ? { notIn: linkIds } : undefined,
        },
      });
      for (const link of upgrade.linkedItems) {
        await tx.upgradeItemLink.upsert({
          where: { id: link.id },
          update: {
            upgradeOptionId: upgrade.id,
            linkedMenuItemId: link.linkedMenuItemId,
            linkedSizeId: link.linkedSizeId,
            itemNameSnapshot: link.itemNameSnapshot,
            sizeNameSnapshot: link.sizeNameSnapshot,
            sortOrder: link.sortOrder,
          },
          create: {
            id: link.id,
            upgradeOptionId: upgrade.id,
            linkedMenuItemId: link.linkedMenuItemId,
            linkedSizeId: link.linkedSizeId,
            itemNameSnapshot: link.itemNameSnapshot,
            sizeNameSnapshot: link.sizeNameSnapshot,
            sortOrder: link.sortOrder,
          },
        });
      }
    }

    // Legacy-snapshot synthesis: pre-cutover revisions captured mealUpgrade
    // but no upgradeOptions[]. The deleteMany above wiped any live upgrades
    // (target list was empty); now create a single zero-link UpgradeOption
    // mirroring Migration 2 backfill so the operator can audit it post-restore.
    if (isDeal && upgradeOptions.length === 0 && item.mealUpgrade != null) {
      await tx.upgradeOption.create({
        data: {
          itemId: item.id,
          extraCharge: new Prisma.Decimal(item.mealUpgrade),
          sortOrder: 0,
        },
      });
    }
  }

  for (const item of snapshot.items) {
    const isDeal = categoryById.get(item.categoryId)?.slug === "deals";
    if (!isDeal) continue;

    const dealBaseMenuItemId = dealBaseResolver.getSafeBaseMenuItemId(item);
    if (!dealBaseMenuItemId) continue;
    const dealBaseSizeId = dealBaseResolver.getSafeBaseSizeId(item);
    const dealBaseSizeName = dealBaseResolver.getSafeBaseSizeName(item);

    await tx.menuItem.update({
      where: { id: item.id },
      data: {
        dealBaseMenuItemId,
        dealBaseSizeId,
        dealBaseSizeNameSnapshot: dealBaseSizeId ? dealBaseSizeName : null,
        lockVersion: { increment: 1 },
      },
    });
  }

  return captureMenuSnapshot(tx, outletId);
}
