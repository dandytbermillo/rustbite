import { prisma } from "@/lib/db";
import { DEFAULT_OUTLET_ID } from "@/lib/outlets";
import {
  itemSnapshotFromRecord,
  parseMenuSnapshot,
  type MenuItemSnapshot,
} from "@/lib/menu-history";

export type DealHistoryStatus = "hidden" | "deleted" | "historical" | "expired";

export type DealHistoryEntry = {
  historyId: string;
  sourceType: "current" | "revision" | "audit";
  sourceRevisionId: string | null;
  sourceAuditId: string | null;
  dealSnapshot: MenuItemSnapshot;
  status: DealHistoryStatus;
  lastChangedAt: string;
};

type LoadDealHistoryOptions = {
  q?: string;
  status?: "all" | DealHistoryStatus;
  limit?: number;
  outletId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asInteger(value: unknown, fallback = 0) {
  return Number.isInteger(value) ? Number(value) : fallback;
}

function asBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function parseLegacyModifier(value: unknown, index: number) {
  const row = isRecord(value) ? value : {};
  return {
    id: asString(row.id, `legacy-modifier-${index}`),
    name: asString(row.name),
    priceDelta: asNumber(row.priceDelta),
    sortOrder: asInteger(row.sortOrder, index),
  };
}

function parseLegacyUpgradeLink(value: unknown, index: number) {
  const row = isRecord(value) ? value : {};
  return {
    id: asString(row.id, `legacy-link-${index}`),
    linkedMenuItemId:
      typeof row.linkedMenuItemId === "string" ? row.linkedMenuItemId : null,
    linkedSizeId: typeof row.linkedSizeId === "string" ? row.linkedSizeId : null,
    itemNameSnapshot:
      typeof row.itemNameSnapshot === "string" ? row.itemNameSnapshot : null,
    sizeNameSnapshot:
      typeof row.sizeNameSnapshot === "string" ? row.sizeNameSnapshot : null,
    sortOrder: asInteger(row.sortOrder, index),
  };
}

function parseLegacyUpgrade(value: unknown, index: number) {
  const row = isRecord(value) ? value : {};
  const linkedItems = Array.isArray(row.linkedItems) ? row.linkedItems : [];
  return {
    id: asString(row.id, `legacy-upgrade-${index}`),
    customTitle: typeof row.customTitle === "string" ? row.customTitle : null,
    extraCharge: asNumber(row.extraCharge),
    savingsLabel:
      typeof row.savingsLabel === "number" && Number.isFinite(row.savingsLabel)
        ? row.savingsLabel
        : null,
    discountPct:
      typeof row.discountPct === "number" && Number.isFinite(row.discountPct)
        ? row.discountPct
        : null,
    sortOrder: asInteger(row.sortOrder, index),
    linkedItems: linkedItems.map(parseLegacyUpgradeLink),
  };
}

function parseLegacyItemSnapshot(raw: unknown): MenuItemSnapshot | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  const categoryId = asString(raw.categoryId);
  const name = asString(raw.name);
  if (!id || !categoryId || !name) return null;

  const sizes = Array.isArray(raw.sizes) ? raw.sizes : [];
  const addons = Array.isArray(raw.addons) ? raw.addons : [];
  const upgradeOptions = Array.isArray(raw.upgradeOptions)
    ? raw.upgradeOptions
    : [];

  return {
    id,
    categoryId,
    comboNum: typeof raw.comboNum === "number" ? raw.comboNum : null,
    name,
    description: asString(raw.description),
    price: asNumber(raw.price),
    emoji: asString(raw.emoji, "🍔"),
    bgColor: asString(raw.bgColor, "#ffe3b3"),
    badge: typeof raw.badge === "string" ? raw.badge : null,
    mealUpgrade:
      typeof raw.mealUpgrade === "number" && Number.isFinite(raw.mealUpgrade)
        ? raw.mealUpgrade
        : null,
    mealSavings:
      typeof raw.mealSavings === "number" && Number.isFinite(raw.mealSavings)
        ? raw.mealSavings
        : null,
    bundleSavings:
      typeof raw.bundleSavings === "number" && Number.isFinite(raw.bundleSavings)
        ? raw.bundleSavings
        : null,
    dealBaseMenuItemId:
      typeof raw.dealBaseMenuItemId === "string" && raw.dealBaseMenuItemId
        ? raw.dealBaseMenuItemId
        : null,
    dealBaseSizeId:
      typeof raw.dealBaseSizeId === "string" && raw.dealBaseSizeId
        ? raw.dealBaseSizeId
        : null,
    dealBaseSizeNameSnapshot:
      typeof raw.dealBaseSizeNameSnapshot === "string" &&
      raw.dealBaseSizeNameSnapshot
        ? raw.dealBaseSizeNameSnapshot
        : null,
    dealStartsAt:
      typeof raw.dealStartsAt === "string" ? raw.dealStartsAt : null,
    dealExpiresAt:
      typeof raw.dealExpiresAt === "string" ? raw.dealExpiresAt : null,
    imageUrl: typeof raw.imageUrl === "string" ? raw.imageUrl : null,
    imageAlt: typeof raw.imageAlt === "string" ? raw.imageAlt : null,
    imageFit: raw.imageFit === "CONTAIN" ? "CONTAIN" : "COVER",
    cardImageUrl:
      typeof raw.cardImageUrl === "string" ? raw.cardImageUrl : null,
    cardImageAlt:
      typeof raw.cardImageAlt === "string" ? raw.cardImageAlt : null,
    isActive: asBoolean(raw.isActive),
    isOutOfStock: false,
    stockMode: "MANUAL",
    stockQty: null,
    lowStockThreshold: null,
    stockUpdatedAt: null,
    sortOrder: asInteger(raw.sortOrder),
    sizes: sizes.map(parseLegacyModifier),
    addons: addons.map(parseLegacyModifier),
    upgradeOptions: upgradeOptions.map(parseLegacyUpgrade),
  };
}

function includedSummary(snapshot: MenuItemSnapshot) {
  return snapshot.upgradeOptions
    .flatMap((upgrade) => upgrade.linkedItems)
    .map((link) => link.itemNameSnapshot ?? link.linkedMenuItemId ?? "")
    .filter(Boolean)
    .join(" ");
}

function matchesQuery(snapshot: MenuItemSnapshot, query: string) {
  if (!query) return true;
  const haystack = [
    snapshot.name,
    snapshot.description,
    snapshot.comboNum != null ? `combo ${snapshot.comboNum}` : "",
    includedSummary(snapshot),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

export async function loadDealHistoryEntries(
  options: LoadDealHistoryOptions = {}
): Promise<DealHistoryEntry[]> {
  const query = options.q?.trim().toLowerCase() ?? "";
  const statusFilter = options.status ?? "all";
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const outletId = options.outletId ?? DEFAULT_OUTLET_ID;

  const [categories, currentItems, deletedAudits, revisions] = await Promise.all([
    prisma.category.findMany({ where: { outletId } }),
    prisma.menuItem.findMany({
      where: { outletId },
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
    prisma.menuAuditLog.findMany({
      where: {
        outletId,
        actionType: "ITEM_DELETED",
        targetType: "ITEM",
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.menuRevision.findMany({
      where: {
        outletId,
        reason: { not: "MENU_RESTORED" },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);

  const currentDealsCategory = categories.find((category) => category.slug === "deals");
  const currentDealCategoryIds = new Set(
    categories
      .filter((category) => category.slug === "deals")
      .map((category) => category.id)
  );
  const currentLiveDealIds = new Set(
    currentItems
      .filter((item) => currentDealCategoryIds.has(item.categoryId) && item.isActive)
      .map((item) => item.id)
  );
  const candidates: DealHistoryEntry[] = [];

  if (currentDealsCategory) {
    for (const item of currentItems) {
      if (item.categoryId !== currentDealsCategory.id || item.isActive) continue;
      candidates.push({
        historyId: `current-${item.id}`,
        sourceType: "current",
        sourceRevisionId: null,
        sourceAuditId: null,
        dealSnapshot: itemSnapshotFromRecord(item),
        status: "hidden",
        lastChangedAt: item.updatedAt.toISOString(),
      });
    }
  }

  for (const audit of deletedAudits) {
    const snapshot = parseLegacyItemSnapshot(audit.beforePayload);
    if (!snapshot || !currentDealCategoryIds.has(snapshot.categoryId)) continue;
    candidates.push({
      historyId: `audit-${audit.id}`,
      sourceType: "audit",
      sourceRevisionId: null,
      sourceAuditId: audit.id,
      dealSnapshot: snapshot,
      status: "deleted",
      lastChangedAt: audit.createdAt.toISOString(),
    });
  }

  for (const revision of revisions) {
    let snapshot;
    try {
      snapshot = parseMenuSnapshot(revision.snapshot);
    } catch {
      continue;
    }

    const dealCategoryIds = new Set(
      snapshot.categories
        .filter((category) => category.slug === "deals")
        .map((category) => category.id)
    );

    for (const item of snapshot.items) {
      if (!dealCategoryIds.has(item.categoryId)) continue;
      if (currentLiveDealIds.has(item.id)) continue;
      candidates.push({
        historyId: `revision-${revision.id}-${item.id}`,
        sourceType: "revision",
        sourceRevisionId: revision.id,
        sourceAuditId: null,
        dealSnapshot: item,
        status: item.isActive ? "historical" : "hidden",
        lastChangedAt: revision.createdAt.toISOString(),
      });
    }
  }

  const deduped = new Map<string, DealHistoryEntry>();
  for (const entry of candidates.sort(
    (a, b) =>
      new Date(b.lastChangedAt).getTime() - new Date(a.lastChangedAt).getTime()
  )) {
    if (deduped.has(entry.dealSnapshot.id)) continue;
    if (statusFilter !== "all" && entry.status !== statusFilter) continue;
    if (!matchesQuery(entry.dealSnapshot, query)) continue;
    deduped.set(entry.dealSnapshot.id, entry);
  }

  return [...deduped.values()].slice(0, limit);
}
