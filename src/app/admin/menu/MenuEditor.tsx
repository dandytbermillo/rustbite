"use client";

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Search,
  X,
} from "lucide-react";
import { BRAND } from "@/lib/brand";
import {
  defaultDealExpirationIso,
  defaultDealStartIso,
  dealExpirationIsoForLocalDateValue as fromExpirationDateInputValue,
  toDealExpirationDateInputValue as toExpirationDateInputValue,
} from "@/lib/deal-expiration";
import BadgeChip from "@/components/kiosk/BadgeChip";
import ItemVisual from "@/components/kiosk/ItemVisual";
import PreviewOverlay from "@/components/admin/PreviewOverlay";
import CategoryNavBar from "@/components/admin/CategoryNavBar";
import { EditItemModal, EditDealModal } from "@/components/admin/menu-editor";
import { lockBodyScroll } from "@/lib/body-scroll-lock";
import {
  ACCEPTED_IMAGE_CONTENT_TYPES,
  MAX_IMAGE_UPLOAD_BYTES,
} from "@/lib/image-upload-constraints";
import {
  ADMIN_IMAGE_FITS,
  ADMIN_MENU_BADGES,
  normalizeCategorySlug,
  validateCategoryInput,
  validateItemInput,
} from "@/lib/menu-admin";
import { fmt, round2 } from "@/lib/pricing";
import { isMenuItemAvailable } from "@/lib/menu-availability";
import type { MenuItemSnapshot } from "@/lib/menu-history";
import type { OutletMenuVersionDTO } from "@/lib/outlet-menu-sync";
import type { DealHistoryEntry } from "@/lib/deal-history";
import {
  buildLinkClassificationContext,
  categoryNameForItem,
  classifyLink,
  compareItemsByOrder,
  dealBaseAvailabilityReason,
  dealBaseStructuralRepairReason,
  dealExpirationState,
  dealExpirationSummary,
  dealHasCustomerAvailableUpgrade,
  dealHiddenReason,
  dealOptionIsCustomerComplete,
  dealStructuralRepairReason,
  isDealsCategory,
  isStockHiddenReason,
  itemVisibleInMenuFilter,
  type Cat,
  type Item,
  type LinkClassificationContext,
  type LinkRenderState,
  type Mod,
  type Upgrade,
  type UpgradeLink,
  type UpgradeLinkedMenuItem,
} from "@/lib/admin/menu/visibility";
import {
  isMenuFilterEmpty,
  type HistoryMethod,
  type MenuFilterState,
  type MenuFilterStructuredKey,
} from "@/lib/admin/filters/types";
import { cloneItemAsDraft } from "@/lib/admin/menu/clone-item";
import { buildFieldCatalogue } from "@/lib/admin/filters/fields";
import {
  decodeFilter,
  encodeFilterToString,
} from "@/lib/admin/filters/url-state";
import {
  buildMatchContext,
  dealNeedsAttention,
  itemMatchesFilter,
  nonDealInventoryLowNeedsAttention,
  nonDealInventoryOutNeedsAttention,
} from "@/lib/admin/filters/match";
import SearchField from "@/components/admin/menu-editor/SearchField";
import FilterBuilderModal from "@/components/admin/menu-editor/FilterBuilderModal";

const DEAL_REUSE_STORAGE_KEY = "rushbite:reuse-deal-snapshot";
const COLLAPSED_CATEGORIES_STORAGE_KEY =
  "rushbite:menu-editor:collapsed-categories";
const RELEASE_NOTE_DISMISSED_KEY =
  "rushbite:menu-editor:release-note-dismissed";
const RELEASE_NOTE_AUTO_HIDE_MS = 90_000; // 1.5 minutes
const ADMIN_MENU_VERSION_POLL_INTERVAL_MS = 5_000;
const ADMIN_MENU_SSE_STALE_MS = 30_000;

type PendingHeroState = {
  heroFile: File | null;
  removeHero: boolean;
};

type QuickEditField = "price" | "badge";

type QuickEditState = {
  itemId: string;
  field: QuickEditField;
  value: string;
} | null;

type QuickEditPatch = {
  price: number;
  badge: string | null;
  lockVersion: number;
  updatedAt: string;
};

type QuickEditResponse = QuickEditPatch & {
  id: string;
};

type CategoryDraft = Omit<Cat, "id"> & { id?: string };
type AuditEntry = {
  id: string;
  actionType: string;
  targetType: string;
  targetId: string | null;
  targetLabel: string | null;
  actorType: string;
  actorIdentity: string | null;
  createdAt: string;
};
type RevisionEntry = {
  id: string;
  reason: string;
  actorType: string;
  actorIdentity: string | null;
  sourceRevisionId: string | null;
  createdAt: string;
  targetLabel: string | null;
  targetType: string | null;
  summary: {
    categoryCount: number;
    liveCategoryCount: number;
    itemCount: number;
    liveItemCount: number;
  };
};

function formatHistoryLabel(value: string): string {
  return value.replaceAll("_", " ");
}

function describeRevisionReason(revision: RevisionEntry): string {
  const targetLabel = revision.targetLabel?.trim();

  switch (revision.reason) {
    case "ITEM_UPDATED":
      return targetLabel
        ? `Saved after updating ${targetLabel}`
        : "Saved after item update";
    case "ITEM_CREATED":
      return targetLabel
        ? `Saved after creating ${targetLabel}`
        : "Saved after item creation";
    case "ITEM_HIDDEN":
      return targetLabel
        ? `Saved after hiding ${targetLabel}`
        : "Saved after hiding an item";
    case "ITEM_DELETED":
      return targetLabel
        ? `Saved after deleting ${targetLabel}`
        : "Saved after deleting an item";
    case "CATEGORY_UPDATED":
      return targetLabel
        ? `Saved after updating category ${targetLabel}`
        : "Saved after category update";
    case "CATEGORY_CREATED":
      return targetLabel
        ? `Saved after creating category ${targetLabel}`
        : "Saved after category creation";
    case "CATEGORY_DELETED":
      return targetLabel
        ? `Saved after deleting category ${targetLabel}`
        : "Saved after category deletion";
    case "MENU_RESTORED":
      return revision.sourceRevisionId
        ? `Saved after restoring snapshot #${revision.sourceRevisionId.slice(-6)}`
        : "Saved after menu restore";
    case "MENU_REORDERED":
      return targetLabel
        ? `Saved after reordering ${targetLabel}`
        : "Saved after category reorder";
    default:
      return `Saved after ${formatHistoryLabel(revision.reason).toLowerCase()}`;
  }
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function friendlyHttpError(status: number, action: string): string {
  if (status === 400) {
    return `We couldn't ${action}. Please review the fields and try again.`;
  }
  if (status === 409) {
    return `We couldn't ${action} because this data changed in another window. Refresh the page and try again.`;
  }
  if (status === 413) {
    return `We couldn't ${action} because the upload is too large.`;
  }
  if (status === 503) {
    return `We couldn't ${action} because a required service is temporarily unavailable. Try again in a moment.`;
  }
  if (status >= 500) {
    return `We couldn't ${action} because the server hit an unexpected problem. Try again, or refresh the page and try again.`;
  }
  return `We couldn't ${action}. Please try again.`;
}

async function apiErrorMessage(
  response: Response,
  action: string,
): Promise<string> {
  const json = (await response.json().catch(() => null)) as {
    error?: unknown;
  } | null;
  const serverMessage =
    typeof json?.error === "string" ? json.error.trim() : "";
  if (serverMessage && !/^HTTP\s+\d+$/i.test(serverMessage)) {
    return serverMessage;
  }
  return friendlyHttpError(response.status, action);
}

function clientErrorMessage(err: unknown, action: string): string {
  const message = err instanceof Error ? err.message.trim() : "";
  if (
    !message ||
    /^HTTP\s+\d+$/i.test(message) ||
    message === "Failed to fetch"
  ) {
    return `We couldn't ${action}. Check your connection, refresh the page, and try again.`;
  }
  return message;
}

function modifierSummary(item: Item, isDeal = false): string {
  const parts: string[] = [];
  if (item.sizes.length > 0) {
    parts.push(
      `${item.sizes.length} size${item.sizes.length === 1 ? "" : "s"}`,
    );
  }
  if (item.addons.length > 0) {
    parts.push(
      `${item.addons.length} add-on${item.addons.length === 1 ? "" : "s"}`,
    );
  }
  if (isDeal && item.upgradeOptions.length > 0) {
    parts.push(
      `${item.upgradeOptions.length} deal option${item.upgradeOptions.length === 1 ? "" : "s"}`,
    );
  }
  if (parts.length > 0) return parts.join(" · ");
  return isDeal ? "Base item only" : "No add-ons or sizes";
}

function allowsUpgradeOptions(categories: Cat[], categoryId: string): boolean {
  return (
    categories.find((category) => category.id === categoryId)?.slug === "deals"
  );
}

function dealMatchKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function historyIncludedItems(snapshot: MenuItemSnapshot): string {
  const labels = snapshot.upgradeOptions
    .flatMap((upgrade) => upgrade.linkedItems)
    .map((link) => {
      const itemName = link.itemNameSnapshot ?? "Missing item";
      return link.sizeNameSnapshot
        ? `${itemName} · ${link.sizeNameSnapshot}`
        : itemName;
    });

  if (labels.length === 0) return "No included items recorded";
  if (labels.length <= 3) return labels.join(" + ");
  return `${labels.slice(0, 3).join(" + ")} + ${labels.length - 3} more`;
}

function makeBlankCategory(sortOrder: number): CategoryDraft {
  return {
    slug: "",
    name: "",
    icon: "🍽",
    sortOrder,
    isActive: true,
    updatedAt: "",
  };
}

function makeBlankItem(categoryId: string, sortOrder: number): Item {
  return {
    id: "new",
    categoryId,
    comboNum: null,
    name: "",
    description: "",
    price: 0,
    emoji: "🍔",
    bgColor: "#ffe3b3",
    badge: null,
    bundleSavings: null,
    dealBaseMenuItemId: null,
    dealBaseSizeId: null,
    dealBaseSizeNameSnapshot: null,
    dealStartsAt: null,
    dealExpiresAt: null,
    imageUrl: null,
    imageAlt: null,
    imageFit: "COVER",
    cardImageUrl: null,
    cardImageAlt: null,
    isActive: true,
    isOutOfStock: false,
    stockMode: "MANUAL",
    stockQty: null,
    lowStockThreshold: null,
    stockUpdatedAt: null,
    stockUpdatedById: null,
    sortOrder,
    lockVersion: 0,
    updatedAt: "",
    sizes: [],
    addons: [],
    upgradeOptions: [],
  };
}

function makeDealFromBase(
  base: Item,
  dealsCategory: Cat,
  sortOrder: number,
  comboNum: number | null,
): Item {
  const baseSize = base.sizes.find((size) => !!size.id) ?? null;
  return {
    ...makeBlankItem(dealsCategory.id, sortOrder),
    comboNum,
    name: base.name,
    description: base.description,
    price: base.price,
    emoji: base.emoji,
    bgColor: base.bgColor,
    dealBaseMenuItemId: base.id,
    dealBaseSizeId: baseSize?.id ?? null,
    dealBaseSizeNameSnapshot: baseSize?.name ?? null,
    isActive: false,
    imageUrl: base.imageUrl,
    imageAlt: base.imageAlt,
    imageFit: base.imageFit,
    cardImageUrl: base.cardImageUrl,
    cardImageAlt: base.cardImageAlt,
    dealStartsAt: defaultDealStartIso(),
    dealExpiresAt: defaultDealExpirationIso(),
    upgradeOptions: base.upgradeOptions.map((upgrade, upgradeIndex) => ({
      id: newTempId("upgrade"),
      customTitle: upgrade.customTitle,
      extraCharge: upgrade.extraCharge,
      savingsLabel: upgrade.savingsLabel,
      discountPct: upgrade.discountPct,
      sortOrder: upgradeIndex,
      linkedItems:
        upgrade.linkedItems.length > 0
          ? upgrade.linkedItems.map((link, linkIndex) => ({
              ...link,
              id: newTempId("link"),
              sortOrder: linkIndex,
            }))
          : [
              {
                id: newTempId("link"),
                linkedMenuItemId: base.id,
                linkedSizeId: baseSize?.id ?? null,
                itemNameSnapshot: base.name,
                sizeNameSnapshot: baseSize?.name ?? null,
                sortOrder: 0,
                linkedMenuItem: buildLinkedItemSummary(base),
                linkedSize: baseSize
                  ? {
                      id: baseSize.id,
                      name: baseSize.name,
                      priceDelta: baseSize.priceDelta,
                    }
                  : null,
              },
            ],
    })),
  };
}

function sanitizeHistoryUpgradeOptions(
  snapshot: MenuItemSnapshot,
  dealsCategory: Cat,
  allItems: Item[],
): Upgrade[] {
  return snapshot.upgradeOptions
    .map((upgrade) => ({
      id: newTempId("upgrade"),
      customTitle: upgrade.customTitle,
      extraCharge: upgrade.extraCharge,
      savingsLabel: upgrade.savingsLabel,
      discountPct: upgrade.discountPct ?? null,
      sortOrder: upgrade.sortOrder,
      linkedItems: upgrade.linkedItems
        .map((link): UpgradeLink | null => {
          const linkedItem =
            link.linkedMenuItemId != null
              ? (allItems.find((item) => item.id === link.linkedMenuItemId) ??
                null)
              : null;
          if (!linkedItem) return null;
          if (linkedItem.categoryId === dealsCategory.id) return null;
          if (!linkedItem.isActive) return null;

          const linkedSize =
            link.linkedSizeId != null
              ? (linkedItem.sizes.find(
                  (size) => size.id === link.linkedSizeId,
                ) ?? null)
              : null;
          if (linkedItem.sizes.length > 0 && !linkedSize) return null;
          if (linkedItem.sizes.length === 0 && link.linkedSizeId != null)
            return null;

          return {
            id: newTempId("link"),
            linkedMenuItemId: linkedItem.id,
            linkedSizeId: linkedSize?.id ?? null,
            itemNameSnapshot: linkedItem.name,
            sizeNameSnapshot: linkedSize?.name ?? null,
            sortOrder: link.sortOrder,
            linkedMenuItem: buildLinkedItemSummary(linkedItem),
            linkedSize: linkedSize
              ? {
                  id: linkedSize.id,
                  name: linkedSize.name,
                  priceDelta: linkedSize.priceDelta,
                }
              : null,
          };
        })
        .filter((link): link is UpgradeLink => link != null)
        .map((link, linkIndex) => ({ ...link, sortOrder: linkIndex })),
    }))
    .filter((upgrade) => upgrade.linkedItems.length > 0)
    .map((upgrade, upgradeIndex) => ({ ...upgrade, sortOrder: upgradeIndex }));
}

function makeDealFromHistorySnapshot(
  snapshot: MenuItemSnapshot,
  dealsCategory: Cat,
  sortOrder: number,
  comboNum: number | null,
  allItems: Item[],
  selectedBase?: Item,
): Item {
  const validBadge =
    snapshot.badge &&
    (ADMIN_MENU_BADGES as readonly string[]).includes(snapshot.badge)
      ? snapshot.badge
      : "DEAL";
  const validHistoricalBaseId =
    snapshot.dealBaseMenuItemId &&
    allItems.some(
      (item) =>
        item.id === snapshot.dealBaseMenuItemId &&
        item.categoryId !== dealsCategory.id,
    )
      ? snapshot.dealBaseMenuItemId
      : null;
  const dealBaseMenuItemId =
    selectedBase && selectedBase.categoryId !== dealsCategory.id
      ? selectedBase.id
      : validHistoricalBaseId;
  const dealBaseItem =
    selectedBase && selectedBase.categoryId !== dealsCategory.id
      ? selectedBase
      : dealBaseMenuItemId
        ? (allItems.find((item) => item.id === dealBaseMenuItemId) ?? null)
        : null;
  const dealBaseSize =
    dealBaseItem && snapshot.dealBaseSizeId
      ? (dealBaseItem.sizes.find((size) => size.id === snapshot.dealBaseSizeId) ??
        null)
      : null;

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
    dealBaseMenuItemId,
    dealBaseSizeId: dealBaseSize?.id ?? null,
    dealBaseSizeNameSnapshot: dealBaseSize?.name ?? null,
    dealStartsAt: defaultDealStartIso(),
    dealExpiresAt: defaultDealExpirationIso(),
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
    upgradeOptions: sanitizeHistoryUpgradeOptions(
      snapshot,
      dealsCategory,
      allItems,
    ),
  };
}

function applyBaseItemToDealDraft(draft: Item, base: Item): Item {
  const baseSize = base.sizes.find((size) => !!size.id) ?? null;
  return {
    ...draft,
    name: base.name,
    description: base.description,
    price: base.price,
    emoji: base.emoji,
    bgColor: base.bgColor,
    badge: "DEAL",
    dealBaseMenuItemId: base.id,
    dealBaseSizeId: baseSize?.id ?? null,
    dealBaseSizeNameSnapshot: baseSize?.name ?? null,
    imageUrl: base.imageUrl,
    imageAlt: base.imageAlt,
    imageFit: base.imageFit,
    cardImageUrl: base.cardImageUrl,
    cardImageAlt: base.cardImageAlt,
    dealStartsAt: draft.dealStartsAt,
    dealExpiresAt: draft.dealExpiresAt,
    isOutOfStock: false,
    upgradeOptions: draft.upgradeOptions.map((upgrade) => ({
      ...upgrade,
      linkedItems: [
        {
          id: upgrade.linkedItems[0]?.id ?? newTempId("link"),
          linkedMenuItemId: base.id,
          linkedSizeId: null,
          itemNameSnapshot: base.name,
          sizeNameSnapshot: null,
          sortOrder: 0,
          linkedMenuItem: buildLinkedItemSummary(base),
          linkedSize: null,
        },
      ],
    })),
  };
}

function StockBadge({
  tone,
  children,
}: {
  tone: "green" | "red";
  children: string;
}) {
  return (
    <span
      className="inline-flex items-center px-2 py-1 rounded-full text-[10px] font-black tracking-widest border whitespace-nowrap"
      style={
        tone === "red"
          ? {
              background: "#FDE2E2",
              color: "#991B1B",
              borderColor: "rgba(232,69,69,0.25)",
            }
          : {
              background: "#D1FAE5",
              color: "#047857",
              borderColor: "rgba(16,185,129,0.25)",
            }
      }
    >
      {children}
    </span>
  );
}

export default function MenuEditor({
  categories,
  items,
  auditLogs,
  revisions,
  currentLiveRevisionId,
  serverNowIso,
  currentLiveRestoredAt,
  allowedImageHosts,
  allowPasteUrl,
  storageConfigured,
  storageDisabledReason,
  dealDefaultDiscountPct,
  dealHistoryEntries,
  canWriteMenu,
  canRestoreMenu,
  initialMenuVersion,
}: {
  categories: Cat[];
  items: Item[];
  auditLogs: AuditEntry[];
  revisions: RevisionEntry[];
  currentLiveRevisionId: string | null;
  serverNowIso: string;
  currentLiveRestoredAt: string | null;
  allowedImageHosts: string[];
  allowPasteUrl: boolean;
  storageConfigured: boolean;
  storageDisabledReason: string | null;
  dealDefaultDiscountPct: number | null;
  dealHistoryEntries: DealHistoryEntry[];
  canWriteMenu: boolean;
  canRestoreMenu: boolean;
  initialMenuVersion: OutletMenuVersionDTO;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const latestMenuRevisionRef = useRef(initialMenuVersion.revision);

  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [creatingItem, setCreatingItem] = useState(false);
  const [itemSaving, setItemSaving] = useState(false);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [quickEditState, setQuickEditState] = useState<QuickEditState>(null);
  const [quickEditBusyItemId, setQuickEditBusyItemId] = useState<string | null>(
    null,
  );
  const [quickEditErrorByItemId, setQuickEditErrorByItemId] = useState<
    Record<string, string>
  >({});
  const [quickEditPatchByItemId, setQuickEditPatchByItemId] = useState<
    Record<string, QuickEditPatch>
  >({});
  const quickEditStateRef = useRef<QuickEditState>(null);
  const quickEditCommitInFlightRef = useRef(false);
  const quickEditRequestIdRef = useRef(0);
  const priceEscapeCancelRef = useRef(false);
  const pendingMenuRefreshRevisionRef = useRef<number | null>(null);
  const pendingQuickEditRefreshRef = useRef(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [dealBaseCategory, setDealBaseCategory] = useState<Cat | null>(null);
  const [newDealBaseItem, setNewDealBaseItem] = useState<Item | null>(null);

  const [editingCategory, setEditingCategory] = useState<CategoryDraft | null>(
    null,
  );
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [categorySaving, setCategorySaving] = useState(false);
  const [previewCategorySlug, setPreviewCategorySlug] = useState<string | null>(
    null,
  );

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<MenuFilterState>({});
  const [builderOpen, setBuilderOpen] = useState(false);
  const [collapsedCategoryIds, setCollapsedCategoryIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [collapseStateLoaded, setCollapseStateLoaded] = useState(false);
  const serverNowMs = new Date(serverNowIso).getTime();

  const effectiveItems = useMemo(() => {
    if (Object.keys(quickEditPatchByItemId).length === 0) return items;
    return items.map((item) => {
      const patch = quickEditPatchByItemId[item.id];
      return patch
        ? {
            ...item,
            price: patch.price,
            badge: patch.badge,
            lockVersion: patch.lockVersion,
            updatedAt: patch.updatedAt,
          }
        : item;
    });
  }, [items, quickEditPatchByItemId]);

  useEffect(() => {
    if (Object.keys(quickEditPatchByItemId).length === 0) return;
    const itemById = new Map(items.map((item) => [item.id, item]));
    let changed = false;
    const next = { ...quickEditPatchByItemId };
    for (const [itemId, patch] of Object.entries(quickEditPatchByItemId)) {
      const serverItem = itemById.get(itemId);
      if (!serverItem) {
        delete next[itemId];
        changed = true;
        continue;
      }
      const sameValues =
        Number(serverItem.price) === Number(patch.price) &&
        (serverItem.badge ?? null) === (patch.badge ?? null);
      if (
        serverItem.lockVersion > patch.lockVersion ||
        (serverItem.lockVersion === patch.lockVersion && sameValues)
      ) {
        delete next[itemId];
        changed = true;
      }
    }
    if (changed) setQuickEditPatchByItemId(next);
  }, [items, quickEditPatchByItemId]);

  const flushPendingQuickEditRefresh = () => {
    if (quickEditStateRef.current) return;
    if (pendingQuickEditRefreshRef.current) {
      pendingQuickEditRefreshRef.current = false;
      refresh();
    }
    const pendingRevision = pendingMenuRefreshRevisionRef.current;
    if (
      pendingRevision != null &&
      pendingRevision > latestMenuRevisionRef.current
    ) {
      pendingMenuRefreshRevisionRef.current = null;
      latestMenuRevisionRef.current = pendingRevision;
      startTransition(() => router.refresh());
    } else if (pendingRevision != null) {
      pendingMenuRefreshRevisionRef.current = null;
    }
  };

  useEffect(() => {
    quickEditStateRef.current = quickEditState;
    if (!quickEditState) {
      window.setTimeout(flushPendingQuickEditRefresh, 0);
    }
    // flushPendingQuickEditRefresh intentionally reads refs and is safe to call
    // with the current render's router/startTransition closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickEditState]);

  useEffect(() => {
    latestMenuRevisionRef.current = Math.max(
      latestMenuRevisionRef.current,
      initialMenuVersion.revision,
    );
  }, [initialMenuVersion.revision]);

  // Load persisted collapse state after mount to avoid SSR hydration drift.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COLLAPSED_CATEGORIES_STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setCollapsedCategoryIds(
            new Set(
              parsed.filter(
                (value): value is string => typeof value === "string",
              ),
            ),
          );
        }
      }
    } catch {
      // ignore — bad JSON or quota error means we just start expanded
    }
    setCollapseStateLoaded(true);
  }, []);

  useEffect(() => {
    if (!collapseStateLoaded) return;
    try {
      window.localStorage.setItem(
        COLLAPSED_CATEGORIES_STORAGE_KEY,
        JSON.stringify([...collapsedCategoryIds]),
      );
    } catch {
      // ignore — storage may be disabled (private mode, quota), state still works in-memory
    }
  }, [collapseStateLoaded, collapsedCategoryIds]);

  const toggleCategoryCollapse = (categoryId: string) => {
    setCollapsedCategoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  };

  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(
    () => new Set(),
  );
  const toggleRowSelection = (itemId: string) => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };
  const clearSelection = () => setSelectedRowIds(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // Expanded rows for the read-only quick-view panel. Multiple rows can be
  // expanded at once so operators can compare items side-by-side. The view
  // is intentionally button-free — body click + EDIT button still drive the
  // editor modal; this chevron only opens a calm, distraction-free preview.
  const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(
    () => new Set(),
  );
  const toggleItemExpand = (itemId: string) => {
    setExpandedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const [showRestoreHistory, setShowRestoreHistory] = useState(false);
  const [busyRevisionId, setBusyRevisionId] = useState<string | null>(null);
  const modalOpen = Boolean(
    editingItem ||
    editingCategory ||
    showRestoreHistory ||
    dealBaseCategory ||
    previewCategorySlug,
  );

  // Body scroll lock for the legacy modal surfaces (CategoryModal, restore
  // history, deal-base picker). The new menu-editor modals + PreviewOverlay
  // already use the shared ref-counted `lockBodyScroll` directly. We use
  // the same util here so all overlays share one counter — capturing
  // body.style.overflow with separate effects led to drift when a child
  // modal's effect ran before this parent effect during mount, leaving
  // body locked after both unmounted.
  //
  // paddingRight (scrollbar compensation) stays a local concern — it's
  // visual only and doesn't affect scrollability.
  useEffect(() => {
    if (!modalOpen) return;
    const releaseBody = lockBodyScroll();
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth =
      window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    return () => {
      releaseBody();
      document.body.style.paddingRight = previousPaddingRight;
    };
  }, [modalOpen]);

  const refresh = () => startTransition(() => router.refresh());

  useEffect(() => {
    let alive = true;
    let eventSource: EventSource | null = null;
    let sseOpen = false;
    let lastSseAt = Date.now();
    const versionUrl = `/api/menu/version?outletId=${encodeURIComponent(
      initialMenuVersion.outletId,
    )}`;
    const eventsUrl = `/api/menu/events?outletId=${encodeURIComponent(
      initialMenuVersion.outletId,
    )}`;

    const refreshForRevision = (revision: number) => {
      if (!alive || revision <= latestMenuRevisionRef.current) return;
      if (quickEditStateRef.current) {
        pendingMenuRefreshRevisionRef.current = Math.max(
          pendingMenuRefreshRevisionRef.current ?? 0,
          revision,
        );
        return;
      }
      latestMenuRevisionRef.current = revision;
      startTransition(() => router.refresh());
    };

    const handleVersionPayload = (rawData: string) => {
      try {
        const version = JSON.parse(rawData) as OutletMenuVersionDTO;
        lastSseAt = Date.now();
        if (version.outletId !== initialMenuVersion.outletId) return;
        refreshForRevision(version.revision);
      } catch (err) {
        console.warn("Admin menu SSE payload was invalid", err);
      }
    };

    const checkMenuVersion = async () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      try {
        const response = await fetch(versionUrl, { cache: "no-store" });
        if (!response.ok) return;
        const version = (await response.json()) as OutletMenuVersionDTO;
        if (!alive || version.outletId !== initialMenuVersion.outletId) return;
        refreshForRevision(version.revision);
      } catch (err) {
        console.warn("Admin menu version check failed", err);
      }
    };

    if (typeof EventSource !== "undefined") {
      eventSource = new EventSource(eventsUrl);
      eventSource.onopen = () => {
        sseOpen = true;
        lastSseAt = Date.now();
      };
      eventSource.onerror = () => {
        sseOpen = false;
      };
      eventSource.addEventListener("menu_revision", (event) => {
        handleVersionPayload((event as MessageEvent<string>).data);
      });
      eventSource.addEventListener("heartbeat", () => {
        lastSseAt = Date.now();
      });
      eventSource.addEventListener("auth_expired", () => {
        sseOpen = false;
      });
      eventSource.addEventListener("reconnect", () => {
        sseOpen = false;
      });
    }

    const interval = window.setInterval(() => {
      if (!sseOpen || Date.now() - lastSseAt > ADMIN_MENU_SSE_STALE_MS) {
        void checkMenuVersion();
      }
    }, ADMIN_MENU_VERSION_POLL_INTERVAL_MS);
    const onFocus = () => void checkMenuVersion();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void checkMenuVersion();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      alive = false;
      eventSource?.close();
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [initialMenuVersion.outletId, router, startTransition]);

  const fieldCatalogue = useMemo(
    () => buildFieldCatalogue(categories),
    [categories],
  );
  const matchContext = useMemo(
    () => buildMatchContext(effectiveItems, categories, serverNowMs),
    [effectiveItems, categories, serverNowMs],
  );
  const linkClassificationContext = matchContext.linkContext;

  const updateFilter = (next: MenuFilterState, method: HistoryMethod) => {
    setFilter(next);
    const search = encodeFilterToString(next);
    const target = `${window.location.pathname}${search}${window.location.hash}`;
    if (target === window.location.pathname + window.location.search + window.location.hash) {
      return;
    }
    if (method === "push") {
      window.history.pushState({}, "", target);
    } else {
      window.history.replaceState({}, "", target);
    }
  };

  const setSingleFilter = <K extends MenuFilterStructuredKey | "query">(
    key: K,
    value: MenuFilterState[K],
    method: HistoryMethod,
  ) => {
    const next = { ...filter };
    if (value == null || value === "") {
      delete next[key];
    } else {
      (next as Record<string, unknown>)[key] = value;
    }
    updateFilter(next, method);
  };

  const clearAllFilters = () => updateFilter({}, "push");

  // Click-through filter helper for the inline category icons in deal rows
  // and the bundle-includes list. Adds the given slugs to the active
  // category multi-filter (de-duped); the parent section's slug should be
  // included in the call so the source row stays visible after the filter
  // is applied.
  const addCategoryFilters = (slugs: string[]) => {
    const current = filter.category ?? [];
    const next = [...current];
    for (const slug of slugs) {
      if (!next.includes(slug)) next.push(slug);
    }
    if (next.length === current.length) return;
    setSingleFilter("category", next, "push");
  };

  // Transient row highlight: when an operator clicks a category icon on a
  // deal row (base-item chip in BADGE column or bundle-includes chip in the
  // dropdown), we filter to surface that item's category AND visually flag
  // the actual row so they can spot it without scanning. Cleared after a
  // few seconds so it doesn't linger after attention has moved on.
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(
    null,
  );
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);
  const triggerHighlight = (itemId: string) => {
    setHighlightedItemId(itemId);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    // Defer scroll one tick so the section becomes visible after the
    // category filter update before we try to bring the row into view.
    requestAnimationFrame(() => {
      document
        .getElementById(`item-row-${itemId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedItemId(null);
      highlightTimerRef.current = null;
    }, 6000);
  };

  // Drag-to-reorder state.
  // - optimisticOrderByCategory: per-category override of the rendered item
  //   order, applied immediately on drop while the server response is in
  //   flight. Cleared when the props from the RSC re-fetch catch up.
  // - reorderPendingCategoryIds: per-category lockout that disables the grip
  //   while a request is in flight, so a second drag can't fire and force
  //   the first into a 409 race against itself.
  // Map/Set state MUST be replaced (not mutated) so React picks up the
  // change. Always clone via `new Map(prev)` / `new Set(prev)` before
  // editing — see the helpers below.
  const [optimisticOrderByCategory, setOptimisticOrderByCategory] = useState<
    Map<string, string[]>
  >(() => new Map());
  const [reorderPendingCategoryIds, setReorderPendingCategoryIds] = useState<
    Set<string>
  >(() => new Set());
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    categoryId: string;
    itemId: string;
  } | null>(null);

  const setOptimisticOrder = (categoryId: string, order: string[] | null) => {
    setOptimisticOrderByCategory((prev) => {
      const next = new Map(prev);
      if (order == null) next.delete(categoryId);
      else next.set(categoryId, order);
      return next;
    });
  };
  const setReorderPending = (categoryId: string, pending: boolean) => {
    setReorderPendingCategoryIds((prev) => {
      const next = new Set(prev);
      if (pending) next.add(categoryId);
      else next.delete(categoryId);
      return next;
    });
  };

  // Props-convergence: when the RSC re-fetch lands and the prop's item order
  // for a category matches the optimistic override exactly, clear the
  // override. This avoids a flash of old order during the gap between the
  // optimistic mutation and the server data landing.
  useEffect(() => {
    if (optimisticOrderByCategory.size === 0) return;
    let mutated = false;
    const next = new Map(optimisticOrderByCategory);
    for (const [categoryId, override] of optimisticOrderByCategory) {
      const propsOrder = items
        .filter((it) => it.categoryId === categoryId)
        .slice()
        .sort(compareItemsByOrder)
        .map((it) => it.id);
      if (propsOrder.length !== override.length) continue;
      let identical = true;
      for (let i = 0; i < override.length; i++) {
        if (propsOrder[i] !== override[i]) {
          identical = false;
          break;
        }
      }
      if (identical) {
        next.delete(categoryId);
        mutated = true;
      }
    }
    if (mutated) setOptimisticOrderByCategory(next);
  }, [items, optimisticOrderByCategory]);

  async function submitReorder(
    categoryId: string,
    expectedCurrentOrder: string[],
    orderedItemIds: string[],
    categoryUpdatedAt: string
  ) {
    if (!canWriteMenu) return;
    setReorderPending(categoryId, true);
    let res: Response;
    try {
      res = await fetch(
        `/api/admin/categories/${categoryId}/reorder`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            updatedAt: categoryUpdatedAt,
            expectedCurrentOrder,
            orderedItemIds,
          }),
        }
      );
    } catch {
      setOptimisticOrder(categoryId, null);
      setReorderPending(categoryId, false);
      window.alert(
        "Reorder failed — check your connection and try again."
      );
      return;
    }
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { changed: boolean }
        | null;
      if (body && body.changed === false) {
        // No-op on the server. Clear the override silently — the props
        // already match (since nothing changed).
        setOptimisticOrder(categoryId, null);
      } else {
        // Keep the override; props-convergence useEffect will clear it
        // once the RSC re-fetch lands.
        refresh();
      }
      setReorderPending(categoryId, false);
      return;
    }
    // Non-OK: revert UI to props-driven order, then surface the error.
    setOptimisticOrder(categoryId, null);
    setReorderPending(categoryId, false);
    if (res.status === 409) {
      const body = (await res.json().catch(() => null)) as
        | { error?: string }
        | null;
      window.alert(
        body?.error ??
          "Menu changed in another session. Reload and try again."
      );
      refresh();
      return;
    }
    window.alert("Reorder failed — try again.");
  }

  // Hydrate filter from URL on mount, and on browser Back/Forward.
  useEffect(() => {
    const hydrate = () => {
      const params = new URLSearchParams(window.location.search);
      setFilter(decodeFilter(params, fieldCatalogue));
    };
    hydrate();
    window.addEventListener("popstate", hydrate);
    return () => window.removeEventListener("popstate", hydrate);
    // Hydrate once on mount; re-derive when the catalogue grows so a
    // newly-added category becomes a valid URL value without forcing the
    // user to refresh.
  }, [fieldCatalogue]);

  useEffect(() => {
    // Defensive RBAC guard: if deal-history's USE AGAIN button somehow
    // wrote a payload for a read-only user (page-level gate bypassed by a
    // future code path), refuse to hydrate the draft and clear the dangling
    // payload so it doesn't leak into a later write-capable session in this
    // tab. Server enforcement remains authoritative.
    if (!canWriteMenu) {
      sessionStorage.removeItem(DEAL_REUSE_STORAGE_KEY);
      return;
    }
    const raw = sessionStorage.getItem(DEAL_REUSE_STORAGE_KEY);
    if (!raw) return;
    sessionStorage.removeItem(DEAL_REUSE_STORAGE_KEY);

    try {
      const payload = JSON.parse(raw) as { snapshot?: MenuItemSnapshot };
      if (!payload.snapshot) {
        throw new Error("Deal history payload is missing.");
      }

      const dealsCategory = categories.find(isDealsCategory);
      if (!dealsCategory) {
        throw new Error(
          "Deals category is missing. Recreate the Deals category before using this deal again.",
        );
      }

      const dealItems = effectiveItems.filter(
        (item) => item.categoryId === dealsCategory.id,
      );
      const nextComboNum =
        dealItems.reduce((max, item) => Math.max(max, item.comboNum ?? 0), 0) +
        1;
      const draft = makeDealFromHistorySnapshot(
        payload.snapshot,
        dealsCategory,
        dealItems.length,
        nextComboNum,
        effectiveItems,
      );

      setDealBaseCategory(null);
      setNewDealBaseItem(null);
      setEditingCategory(null);
      setCreatingCategory(false);
      setEditingItem(draft);
      setCreatingItem(true);
      setNotice(`Review "${draft.name}" before saving it as a new deal.`);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [categories, effectiveItems, canWriteMenu]);

  const sections = useMemo(() => {
    const filterIsEmpty = isMenuFilterEmpty(filter);
    return categories
      .map((category) => {
        const itemsInCategory = effectiveItems.filter(
          (item) => item.categoryId === category.id,
        );
        const visibleItems = filterIsEmpty
          ? itemsInCategory
          : itemsInCategory.filter((item) =>
              itemMatchesFilter(item, category, filter, matchContext),
            );

        return {
          category,
          items: visibleItems.sort(compareItemsByOrder),
          totalCount: itemsInCategory.length,
          activeCount: itemsInCategory.filter((item) =>
            itemVisibleInMenuFilter(
              item,
              category,
              serverNowMs,
              linkClassificationContext,
            ),
          ).length,
        };
      })
      // Drop sections that have no surviving items under the active filter.
      // The category-name free-text shortcut is honored at the item level
      // (see itemMatchesFilter); we deliberately do NOT keep an empty
      // section just because its name matches the query, because that
      // collides with structured filters (e.g. attention:deals + "bu" should
      // not surface a Burgers section header with no items).
      .filter((section) => filterIsEmpty || section.items.length > 0);
  }, [
    categories,
    effectiveItems,
    filter,
    matchContext,
    linkClassificationContext,
    serverNowMs,
  ]);

  const visibleRowIds = useMemo(() => {
    const set = new Set<string>();
    for (const section of sections) {
      for (const item of section.items) set.add(item.id);
    }
    return set;
  }, [sections]);

  const selectedVisibleCount = useMemo(() => {
    let n = 0;
    for (const id of selectedRowIds) {
      if (visibleRowIds.has(id)) n++;
    }
    return n;
  }, [selectedRowIds, visibleRowIds]);

  const selectedHiddenCount = selectedRowIds.size - selectedVisibleCount;

  const activeItemCount = effectiveItems.filter((item) => item.isActive).length;
  const hiddenItemCount = effectiveItems.length - activeItemCount;
  const visibleRevisions = revisions;

  // Deals "need attention" when they're saved as live but the customer can't
  // actually buy them — expired, expiration missing, base unavailable, or no
  // upgrade option currently has a renderable linked item. Hidden deals don't
  // count (the operator already paused them). Predicate lives in match.ts so
  // the badge count and the attention:deals filter stay in lockstep.
  const dealsNeedAttentionCount = effectiveItems.filter((it) => {
    const cat = matchContext.categoryById.get(it.categoryId);
    return cat ? dealNeedsAttention(it, cat, matchContext) : false;
  }).length;
  const inventoryOutCount = effectiveItems.filter((it) => {
    const cat = matchContext.categoryById.get(it.categoryId);
    return cat ? nonDealInventoryOutNeedsAttention(it, cat) : false;
  }).length;
  const inventoryLowCount = effectiveItems.filter((it) => {
    const cat = matchContext.categoryById.get(it.categoryId);
    return cat ? nonDealInventoryLowNeedsAttention(it, cat) : false;
  }).length;

  // For each non-deal menu item, the sorted unique list of deal comboNums
  // that reference it — either as the deal's base item OR as a linked
  // component inside one of its upgrade options. Surfaced as a small badge
  // on the row so operators see "this burger is used in Deal #3 and #5"
  // before they hide / change / out-of-stock it.
  const dealRefsByItemId = useMemo(() => {
    const map = new Map<
      string,
      Array<{
        id: string;
        comboNum: number | null;
        name: string;
        position: number;
        emoji: string;
        bgColor: string;
      }>
    >();
    const dealsCategoryIds = new Set(
      categories.filter(isDealsCategory).map((c) => c.id),
    );
    if (dealsCategoryIds.size === 0) return map;

    // Position = the deal's rank in the admin Deals list. Matches the same
    // sort the section render uses (sortOrder ASC, then name) so the
    // numbers operators see in cross-reference tooltips line up with the
    // numbers shown in the leading area of the Deals admin rows.
    const dealsSortedForPosition = effectiveItems
      .filter((it) => dealsCategoryIds.has(it.categoryId))
      .slice()
      .sort(compareItemsByOrder);
    const dealPositionById = new Map<string, number>();
    dealsSortedForPosition.forEach((deal, idx) => {
      dealPositionById.set(deal.id, idx + 1);
    });

    const addRef = (
      itemId: string,
      deal: {
        id: string;
        comboNum: number | null;
        name: string;
        position: number;
        emoji: string;
        bgColor: string;
      },
    ) => {
      const list = map.get(itemId) ?? [];
      if (!list.some((existing) => existing.id === deal.id)) {
        list.push(deal);
        map.set(itemId, list);
      }
    };

    for (const deal of effectiveItems) {
      if (!dealsCategoryIds.has(deal.categoryId)) continue;
      const position = dealPositionById.get(deal.id);
      if (position == null) continue;
      const dealInfo = {
        id: deal.id,
        comboNum: deal.comboNum,
        name: deal.name,
        position,
        emoji: deal.emoji,
        bgColor: deal.bgColor,
      };
      if (deal.dealBaseMenuItemId) {
        addRef(deal.dealBaseMenuItemId, dealInfo);
      }
      for (const upg of deal.upgradeOptions) {
        for (const link of upg.linkedItems) {
          if (link.linkedMenuItemId) {
            addRef(link.linkedMenuItemId, dealInfo);
          }
        }
      }
    }

    for (const [, list] of map) {
      list.sort((a, b) => a.position - b.position);
    }

    return map;
  }, [effectiveItems, categories]);

  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );

  const canQuickEditField = (item: Item, field: QuickEditField) => {
    if (!canWriteMenu) return false;
    const category = categoryById.get(item.categoryId);
    if (!category) return false;
    return !isDealsCategory(category) || field === "badge";
  };

  const startQuickEdit = (item: Item, field: QuickEditField) => {
    if (!canQuickEditField(item, field) || quickEditBusyItemId === item.id) return;
    priceEscapeCancelRef.current = false;
    setQuickEditErrorByItemId((prev) => {
      if (!prev[item.id]) return prev;
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
    const nextState = {
      itemId: item.id,
      field,
      value:
        field === "price"
          ? item.price.toFixed(2)
          : item.badge ?? "",
    };
    quickEditStateRef.current = nextState;
    setQuickEditState(nextState);
  };

  const cancelQuickEdit = () => {
    priceEscapeCancelRef.current = true;
    quickEditStateRef.current = null;
    setQuickEditState(null);
  };

  const normalizedQuickEditPrice = (
    raw: string,
  ): { value?: number; error?: string } => {
    if (raw.trim() === "") return { error: "price is required" };
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return { error: "price must be a valid amount 0 or greater" };
    }
    return { value: Math.round(parsed * 100) / 100 };
  };

  const queueQuickEditRefresh = () => {
    pendingQuickEditRefreshRef.current = true;
    window.setTimeout(flushPendingQuickEditRefresh, 0);
  };

  const patchQuickEditRow = (response: QuickEditResponse) => {
    setQuickEditPatchByItemId((prev) => ({
      ...prev,
      [response.id]: {
        price: response.price,
        badge: response.badge,
        lockVersion: response.lockVersion,
        updatedAt: response.updatedAt,
      },
    }));
  };

  const sameQuickEdit = (
    current: QuickEditState,
    candidate: QuickEditState,
  ) =>
    current?.itemId === candidate?.itemId &&
    current?.field === candidate?.field;

  const commitQuickEdit = async (
    item: Item,
    field: QuickEditField,
    rawValue: string,
  ) => {
    if (!canQuickEditField(item, field)) return;
    if (quickEditCommitInFlightRef.current) return;

    const submittedState: QuickEditState = {
      itemId: item.id,
      field,
      value: rawValue,
    };

    const payload: Record<string, unknown> = { lockVersion: item.lockVersion };
    if (field === "price") {
      const parsed = normalizedQuickEditPrice(rawValue);
      if (parsed.error) {
        setQuickEditErrorByItemId((prev) => ({
          ...prev,
          [item.id]: parsed.error!,
        }));
        return;
      }
      if (parsed.value === Number(item.price)) {
        setQuickEditState((prev) =>
          sameQuickEdit(prev, submittedState) ? null : prev,
        );
        return;
      }
      payload.price = parsed.value;
    } else {
      const badge = rawValue === "" ? null : rawValue;
      if ((item.badge ?? null) === badge) {
        setQuickEditState((prev) =>
          sameQuickEdit(prev, submittedState) ? null : prev,
        );
        return;
      }
      payload.badge = badge;
    }

    const requestId = ++quickEditRequestIdRef.current;
    quickEditCommitInFlightRef.current = true;
    setQuickEditBusyItemId(item.id);
    setQuickEditErrorByItemId((prev) => {
      if (!prev[item.id]) return prev;
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/admin/items/${item.id}/quick-edit`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (requestId !== quickEditRequestIdRef.current) return;

      if (!response.ok) {
        const message = await apiErrorMessage(response, "quick-edit this item");
        if (response.status === 400) {
          setQuickEditErrorByItemId((prev) => ({
            ...prev,
            [item.id]: message,
          }));
          return;
        }
        setQuickEditState((prev) =>
          sameQuickEdit(prev, submittedState) ? null : prev,
        );
        setQuickEditErrorByItemId((prev) => ({
          ...prev,
          [item.id]: message,
        }));
        if (response.status === 409 || response.status === 404) {
          queueQuickEditRefresh();
        }
        return;
      }

      const updated = (await response.json()) as QuickEditResponse;
      patchQuickEditRow(updated);
      setQuickEditState((prev) =>
        sameQuickEdit(prev, submittedState) ? null : prev,
      );
      queueQuickEditRefresh();
    } catch (err) {
      if (requestId !== quickEditRequestIdRef.current) return;
      setQuickEditErrorByItemId((prev) => ({
        ...prev,
        [item.id]: clientErrorMessage(err, "quick-edit this item"),
      }));
    } finally {
      if (requestId === quickEditRequestIdRef.current) {
        quickEditCommitInFlightRef.current = false;
        setQuickEditBusyItemId(null);
      }
    }
  };

  // Release-note toast: shows once per browser, auto-dismisses after
  // RELEASE_NOTE_AUTO_HIDE_MS, and persists "dismissed" so future loads skip
  // it. The X button also dismisses immediately.
  const [releaseNoteVisible, setReleaseNoteVisible] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(RELEASE_NOTE_DISMISSED_KEY)) return;
    } catch {
      // localStorage unavailable (private mode, quota) — show once in-memory
    }
    setReleaseNoteVisible(true);
    const t = window.setTimeout(() => {
      setReleaseNoteVisible(false);
      try {
        window.localStorage.setItem(RELEASE_NOTE_DISMISSED_KEY, "1");
      } catch {
        // ignore
      }
    }, RELEASE_NOTE_AUTO_HIDE_MS);
    return () => window.clearTimeout(t);
  }, []);
  const dismissReleaseNote = () => {
    setReleaseNoteVisible(false);
    try {
      window.localStorage.setItem(RELEASE_NOTE_DISMISSED_KEY, "1");
    } catch {
      // ignore
    }
  };

  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!overflowOpen) return;
    const handler = (event: MouseEvent) => {
      if (
        overflowRef.current &&
        !overflowRef.current.contains(event.target as Node)
      ) {
        setOverflowOpen(false);
      }
    };
    const escHandler = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOverflowOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", escHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", escHandler);
    };
  }, [overflowOpen]);

  const startNewItem = (category: Cat) => {
    setNewDealBaseItem(null);
    setEditingItem(
      makeBlankItem(
        category.id,
        effectiveItems.filter((item) => item.categoryId === category.id).length,
      ),
    );
    setCreatingItem(true);
  };

  const startNewDealFromBase = (
    dealsCategory: Cat,
    base: Item,
    historySnapshot?: MenuItemSnapshot,
  ) => {
    const dealItems = effectiveItems.filter(
      (item) => item.categoryId === dealsCategory.id,
    );
    const nextComboNum =
      dealItems.reduce((max, item) => Math.max(max, item.comboNum ?? 0), 0) + 1;
    const draft = historySnapshot
      ? makeDealFromHistorySnapshot(
          historySnapshot,
          dealsCategory,
          dealItems.length,
          nextComboNum,
          effectiveItems,
          base,
        )
      : makeDealFromBase(base, dealsCategory, dealItems.length, nextComboNum);

    setDealBaseCategory(null);
    setNewDealBaseItem(base);
    setEditingItem(draft);
    setCreatingItem(true);
    if (historySnapshot) {
      setNotice(
        `Using the latest saved setup for "${base.name}". Review before saving.`,
      );
    }
  };

  const saveItem = async (
    draft: Item,
    isNew: boolean,
    pending: PendingHeroState,
  ) => {
    if (!canWriteMenu) return;
    setError(null);
    setNotice(null);

    // Apply a pending hero-remove to the validated payload so the server
    // treats this save as a hero clear (imageUrl=null). The staged File is
    // never read by the validator — it rides along in FormData.
    const draftForValidation: Item = pending.removeHero
      ? { ...draft, imageUrl: null, imageAlt: null }
      : draft;

    const validation = validateItemInput(draftForValidation, {
      allowedImageHosts,
    });
    if (!validation.value) {
      setError(validation.error ?? "Item data is invalid");
      return;
    }

    const method = isNew ? "POST" : "PATCH";
    const url = isNew ? "/api/admin/items" : `/api/admin/items/${draft.id}`;
    const hasPendingHeroChange = !!pending.heroFile || pending.removeHero;

    try {
      setItemSaving(true);
      let response: Response;
      if (hasPendingHeroChange) {
        const itemPayload = isNew
          ? validation.value
          : { ...validation.value, lockVersion: draft.lockVersion };
        const form = new FormData();
        form.append("item", JSON.stringify(itemPayload));
        if (pending.heroFile) {
          form.append("heroFile", pending.heroFile);
        }
        response = await fetch(url, { method, body: form });
      } else {
        const payload = isNew
          ? validation.value
          : { ...validation.value, lockVersion: draft.lockVersion };
        response = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "save this item"));
      }
      const saved = (await response.json().catch(() => null)) as {
        id?: string;
      } | null;

      setSelectedItemId(saved?.id ?? draft.id);
      setEditingItem(null);
      setCreatingItem(false);
      setNewDealBaseItem(null);
      refresh();
    } catch (err) {
      setError(clientErrorMessage(err, "save this item"));
    } finally {
      setItemSaving(false);
    }
  };

  const deactivateItem = async (item: Item) => {
    if (!canWriteMenu) return;
    if (
      !confirm(
        "Hide this item from the kiosk? Historical orders will be preserved.",
      )
    ) {
      return;
    }

    try {
      setBusyItemId(item.id);
      setError(null);
      setNotice(null);
      const response = await fetch(`/api/admin/items/${item.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lockVersion: item.lockVersion }),
      });
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "hide this item"));
      }

      setEditingItem(null);
      setCreatingItem(false);
      setNewDealBaseItem(null);
      refresh();
    } catch (err) {
      setError(clientErrorMessage(err, "hide this item"));
    } finally {
      setBusyItemId(null);
    }
  };

  const reactivateItem = async (item: Item) => {
    if (!canWriteMenu) return;
    if (!confirm("Make this item live on the kiosk again?")) {
      return;
    }

    await saveItem({ ...item, isActive: true }, false, {
      heroFile: null,
      removeHero: false,
    });
  };

  const setItemStockState = async (item: Item, isOutOfStock: boolean) => {
    if (!canWriteMenu) return;
    if (item.stockMode === "QUANTITY") {
      setNotice("Quantity-tracked stock is edited from the item modal.");
      return;
    }
    setSelectedItemId(item.id);
    const message = isOutOfStock
      ? `Mark "${item.name}" as out of stock? Customers will still see it, but they cannot order it.`
      : `Mark "${item.name}" as back in stock? Customers will be able to order it again.`;
    if (!confirm(message)) {
      return;
    }

    await saveItem({ ...item, isOutOfStock }, false, {
      heroFile: null,
      removeHero: false,
    });
  };

  // Bulk action runner — used by the bottom selection bar. Confirms once,
  // fans out per-item PATCHes via Promise.allSettled (so a single network
  // failure doesn't abort the rest of the batch), reports failures, and
  // clears the selection on completion.
  // Filtered rows: a row that's selected but currently hidden by the active
  // filter is intentionally NOT acted on. The bulk bar surfaces this as
  // "X selected, Y in current view" and a helper message about skipped rows.
  const applyBulkAction = async (
    actionLabel: string,
    perItem: (item: Item) => Promise<void>,
  ) => {
    if (!canWriteMenu) return;
    const targets = effectiveItems.filter(
      (it) => selectedRowIds.has(it.id) && visibleRowIds.has(it.id),
    );
    if (targets.length === 0) return;
    if (!confirm(`${actionLabel} ${targets.length} selected item${targets.length === 1 ? "" : "s"}?`)) {
      return;
    }
    setBulkBusy(true);
    setError(null);
    setNotice(null);
    const results = await Promise.allSettled(targets.map(perItem));
    const failures = results.filter((r) => r.status === "rejected");
    setBulkBusy(false);
    if (failures.length > 0) {
      const sample =
        failures[0].status === "rejected"
          ? (failures[0].reason as Error)?.message ?? ""
          : "";
      setError(
        `${actionLabel} failed for ${failures.length} of ${results.length} item${results.length === 1 ? "" : "s"}.${sample ? ` First error: ${sample}` : ""}`,
      );
    } else {
      setNotice(
        `${actionLabel} applied to ${results.length} item${results.length === 1 ? "" : "s"}.`,
      );
    }
    clearSelection();
    refresh();
  };

  // Per-item: hide via the existing DELETE endpoint (lighter than a full
  // PATCH; matches deactivateItem's wire format). Skip already-hidden.
  const bulkHideOne = async (item: Item) => {
    if (!item.isActive) return;
    const response = await fetch(`/api/admin/items/${item.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lockVersion: item.lockVersion }),
    });
    if (!response.ok) {
      throw new Error(await apiErrorMessage(response, "hide this item"));
    }
  };

  // Per-item: PATCH the changed field through the same validator path
  // saveItem uses, so we stay consistent with single-item edits.
  const patchItemField = async (
    item: Item,
    update: Partial<Pick<Item, "isActive" | "isOutOfStock">>,
    actionLabel: string,
  ) => {
    const draft: Item = { ...item, ...update };
    const validation = validateItemInput(draft, { allowedImageHosts });
    if (!validation.value) {
      throw new Error(validation.error ?? "Item data is invalid");
    }
    const response = await fetch(`/api/admin/items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validation.value,
        lockVersion: item.lockVersion,
      }),
    });
    if (!response.ok) {
      throw new Error(await apiErrorMessage(response, actionLabel));
    }
  };

  const bulkShowOne = async (item: Item) => {
    if (item.isActive) return;
    await patchItemField(item, { isActive: true }, "show this item");
  };

  // In/out stock applies to non-deal items only — deal availability is
  // derived from upgrade renderability, not isOutOfStock. Silently skip
  // deal items in the selection.
  const bulkSetStockOne = async (item: Item, isOutOfStock: boolean) => {
    const cat = categories.find((c) => c.id === item.categoryId);
    if (cat && isDealsCategory(cat)) return;
    if (item.stockMode === "QUANTITY") return;
    if (item.isOutOfStock === isOutOfStock) return;
    await patchItemField(
      item,
      { isOutOfStock },
      isOutOfStock ? "mark this item out of stock" : "mark this item in stock",
    );
  };

  const hardDeleteItem = async (item: Item) => {
    if (!canWriteMenu) return;
    const category = categories.find((row) => row.id === item.categoryId);
    const isDeal = !!category && isDealsCategory(category);
    const noun = isDeal ? "deal" : "item";
    const confirmMessage = isDeal
      ? `Delete this deal "${item.name}" from the current Deals list?\n\nThe original base menu item is not deleted. The deal can be used again later from Deal History.`
      : `Permanently delete this ${noun} "${item.name}"?\n\nThis cannot be undone from the menu list. If this ${noun} appears in history, restoring an older menu revision can bring it back.`;

    if (!confirm(confirmMessage)) {
      return;
    }

    try {
      setBusyItemId(item.id);
      setError(null);
      setNotice(null);
      const response = await fetch(`/api/admin/items/${item.id}/hard-delete`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lockVersion: item.lockVersion }),
      });
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "delete this item"));
      }

      setEditingItem(null);
      setCreatingItem(false);
      setNewDealBaseItem(null);
      refresh();
    } catch (err) {
      setError(clientErrorMessage(err, "delete this item"));
    } finally {
      setBusyItemId(null);
    }
  };

  const saveCategory = async (draft: CategoryDraft, isNew: boolean) => {
    if (!canWriteMenu) return;
    setError(null);
    setNotice(null);

    const validation = validateCategoryInput(draft);
    if (!validation.value) {
      setError(validation.error ?? "Category data is invalid");
      return;
    }

    const method = isNew ? "POST" : "PATCH";
    const url = isNew
      ? "/api/admin/categories"
      : `/api/admin/categories/${draft.id}`;
    const payload = isNew
      ? validation.value
      : { ...validation.value, updatedAt: draft.updatedAt };

    try {
      setCategorySaving(true);
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "save this category"));
      }

      setEditingCategory(null);
      setCreatingCategory(false);
      refresh();
    } catch (err) {
      setError(clientErrorMessage(err, "save this category"));
    } finally {
      setCategorySaving(false);
    }
  };

  const deleteCategory = async (category: CategoryDraft) => {
    if (!canWriteMenu) return;
    if (!category.id) return;
    if (
      !confirm(
        `Delete category "${category.name}"? This only works when no items are assigned.`,
      )
    ) {
      return;
    }

    try {
      setCategorySaving(true);
      setError(null);
      setNotice(null);
      const response = await fetch(`/api/admin/categories/${category.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updatedAt: category.updatedAt }),
      });
      if (!response.ok) {
        throw new Error(
          await apiErrorMessage(response, "delete this category"),
        );
      }

      setEditingCategory(null);
      setCreatingCategory(false);
      refresh();
    } catch (err) {
      setError(clientErrorMessage(err, "delete this category"));
    } finally {
      setCategorySaving(false);
    }
  };

  const restoreRevision = async (revision: RevisionEntry) => {
    if (!canRestoreMenu) return;
    if (
      !confirm(
        `Restore the full menu to snapshot ${revision.id.slice(-6)}? This will replace the live category and item setup for the whole kiosk.`,
      )
    ) {
      return;
    }

    try {
      setBusyRevisionId(revision.id);
      setError(null);
      setNotice(null);
      setEditingItem(null);
      setCreatingItem(false);
      setEditingCategory(null);
      setCreatingCategory(false);

      const response = await fetch(
        `/api/admin/menu/revisions/${revision.id}/restore`,
        {
          method: "POST",
        },
      );
      if (!response.ok) {
        throw new Error(
          await apiErrorMessage(response, "restore this menu snapshot"),
        );
      }

      const json = (await response.json().catch(() => ({}))) as {
        unchanged?: boolean;
      };
      setNotice(
        json.unchanged
          ? `The live menu already matches snapshot ${revision.id.slice(-6)}.`
          : `Restored the full menu to snapshot ${revision.id.slice(-6)}.`,
      );
      setShowRestoreHistory(false);
      refresh();
    } catch (err) {
      setError(clientErrorMessage(err, "restore this menu snapshot"));
    } finally {
      setBusyRevisionId(null);
    }
  };

  return (
    <div>
      <div className="flex flex-col gap-4 mb-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="display text-4xl flex items-baseline gap-2.5">
            Menu
            <em
              className="font-normal text-2xl text-stone-400 not-italic"
              style={{
                fontFamily: "ui-serif, Georgia, serif",
                fontStyle: "italic",
                letterSpacing: 0,
              }}
            >
              live
            </em>
          </h1>
          <div className="text-sm text-stone-600 mt-2 flex items-center flex-wrap gap-x-2">
            <span>
              <span className="font-bold text-stone-900">
                {effectiveItems.length} item{effectiveItems.length === 1 ? "" : "s"}
              </span>{" "}
              across{" "}
              <span className="font-bold text-stone-900">
                {categories.length}{" "}
                {categories.length === 1 ? "category" : "categories"}
              </span>
              {hiddenItemCount > 0 && (
                <>
                  {" "}
                  <span className="text-stone-400">
                    ({hiddenItemCount} hidden)
                  </span>
                </>
              )}
            </span>
            {dealsNeedAttentionCount > 0 && (
              <>
                <span className="text-stone-300">·</span>
                <button
                  type="button"
                  onClick={() => {
                    // Replace the entire filter (don't merge): the count is
                    // computed across the full menu, so the click should
                    // surface exactly that set. Merging with prior chips
                    // (e.g., a category scope) intersects the two and can
                    // yield an empty view that contradicts the "X deals"
                    // count the operator just clicked.
                    updateFilter({ attention: ["deals"] }, "push");
                  }}
                  aria-pressed={filter.attention?.includes("deals") ?? false}
                  className="font-bold underline-offset-2 hover:underline"
                  style={{ color: BRAND.red }}
                  title="Show only the deals that need attention (clears other filters)"
                >
                  {dealsNeedAttentionCount}{" "}
                  {dealsNeedAttentionCount === 1 ? "deal needs" : "deals need"}{" "}
                  attention
                </button>
              </>
            )}
            {inventoryOutCount > 0 && (
              <>
                <span className="text-stone-300">·</span>
                <button
                  type="button"
                  onClick={() => {
                    updateFilter({ attention: ["inventory-out"] }, "push");
                  }}
                  aria-pressed={
                    filter.attention?.includes("inventory-out") ?? false
                  }
                  className="font-bold underline-offset-2 hover:underline"
                  style={{ color: "#B45309" }}
                  title="Show only non-deal items that are out of stock (clears other filters)"
                >
                  {inventoryOutCount}{" "}
                  {inventoryOutCount === 1
                    ? "item out of stock"
                    : "items out of stock"}
                </button>
              </>
            )}
            {inventoryLowCount > 0 && (
              <>
                <span className="text-stone-300">·</span>
                <button
                  type="button"
                  onClick={() => {
                    updateFilter({ attention: ["inventory-low"] }, "push");
                  }}
                  aria-pressed={
                    filter.attention?.includes("inventory-low") ?? false
                  }
                  className="font-bold underline-offset-2 hover:underline"
                  style={{ color: "#B45309" }}
                  title="Show only non-deal quantity-tracked items at or below their low-stock threshold (clears other filters)"
                >
                  {inventoryLowCount}{" "}
                  {inventoryLowCount === 1
                    ? "low-stock item"
                    : "low-stock items"}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <SearchField
            filter={filter}
            categories={categories}
            onFilterChange={updateFilter}
            setSingleFilter={setSingleFilter}
            onOpenBuilder={() => setBuilderOpen(true)}
          />

          <div className="relative" ref={overflowRef}>
            <button
              type="button"
              onClick={() => setOverflowOpen((v) => !v)}
              aria-label="More actions"
              aria-expanded={overflowOpen}
              aria-haspopup="menu"
              className="inline-flex items-center justify-center w-10 h-10 rounded-xl border border-stone-200 bg-stone-50 text-stone-700 hover:bg-[#141414] hover:text-[#FFBE0B] hover:border-[#141414] transition-colors"
            >
              <MoreHorizontal size={18} strokeWidth={2.5} />
            </button>
            {overflowOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-1.5 w-56 rounded-xl border border-stone-200 bg-white shadow-lg z-40 py-1"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowRestoreHistory(true);
                    setOverflowOpen(false);
                  }}
                  className="block w-full text-left px-3.5 py-2.5 text-sm font-bold text-stone-800 hover:bg-stone-50"
                >
                  Restore history
                </button>
              </div>
            )}
          </div>

          {canWriteMenu && (
            <button
              onClick={() => {
                setEditingCategory(makeBlankCategory(categories.length));
                setCreatingCategory(true);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-black whitespace-nowrap"
              style={{ background: BRAND.yellow, color: BRAND.black }}
            >
              <span className="text-base leading-none">+</span> New category
            </button>
          )}
        </div>
      </div>

      {!isMenuFilterEmpty(filter) && (
        <div className="mb-3 flex items-center gap-2 text-xs">
          <span className="font-bold text-stone-600">Filtered view</span>
          <button
            type="button"
            onClick={clearAllFilters}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-stone-300 bg-white font-bold text-stone-700 hover:border-stone-500"
          >
            Clear all
          </button>
        </div>
      )}

      {builderOpen && (
        <FilterBuilderModal
          filter={filter}
          categories={categories}
          setSingleFilter={setSingleFilter}
          onClose={() => setBuilderOpen(false)}
        />
      )}

      {notice && (
        <div className="mb-4 px-4 py-3 rounded-md text-sm font-bold bg-green-100 text-green-800">
          {notice}
        </div>
      )}

      {error && (
        <div className="mb-4 px-4 py-3 rounded-md text-sm font-bold bg-red-100 text-red-800">
          {error}
        </div>
      )}

      {showRestoreHistory && (
        <RestoreHistoryModal
          revisions={visibleRevisions}
          auditLogs={auditLogs}
          currentLiveRevisionId={currentLiveRevisionId}
          currentLiveRestoredAt={currentLiveRestoredAt}
          busyRevisionId={busyRevisionId}
          canRestoreMenu={canRestoreMenu}
          onClose={() => {
            if (busyRevisionId) return;
            setShowRestoreHistory(false);
          }}
          onRestore={restoreRevision}
        />
      )}

      <PreviewOverlay
        slug={previewCategorySlug}
        onClose={() => setPreviewCategorySlug(null)}
      />

      <CategoryNavBar
        categories={sections.map(({ category, totalCount }) => ({
          id: category.id,
          slug: category.slug,
          name: category.name,
          icon: category.icon,
          itemCount: totalCount,
        }))}
        disableShortcuts={modalOpen}
      />

      {sections.length === 0 ? (
        <div className="rounded-xl bg-white border border-stone-200 p-10 text-center">
          <div className="display text-3xl mb-2">No menu results</div>
          <div className="text-sm opacity-60">
            Try a different search or turn hidden items back on.
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {sections.map(
            ({ category, items: serverCategoryItems, totalCount, activeCount }) => {
              const isDeals = isDealsCategory(category);
              const isCollapsed = collapsedCategoryIds.has(category.id);
              const gridTemplate = isDeals
                ? "24px 32px minmax(0, 1fr) 110px 90px minmax(0, 1fr) 130px 100px 130px 80px 28px"
                : "24px 32px minmax(0, 1fr) 110px 90px minmax(0, 1fr) 100px 130px 80px 28px";
              const gridMinWidth = isDeals ? 1042 : 902;
              // Apply the optimistic order override (if any) so a drag's new
              // order shows immediately while the POST is in flight.
              const override = optimisticOrderByCategory.get(category.id);
              const categoryItems = override
                ? (() => {
                    const byId = new Map(serverCategoryItems.map((it) => [it.id, it]));
                    const ordered: typeof serverCategoryItems = [];
                    for (const id of override) {
                      const it = byId.get(id);
                      if (it) {
                        ordered.push(it);
                        byId.delete(id);
                      }
                    }
                    // Any items not covered by the override (rare: created
                    // mid-flight server-side) trail in their natural order.
                    for (const it of serverCategoryItems) {
                      if (byId.has(it.id)) ordered.push(it);
                    }
                    return ordered;
                  })()
                : serverCategoryItems;
              const reorderDisabled =
                !canWriteMenu ||
                !isMenuFilterEmpty(filter) ||
                reorderPendingCategoryIds.has(category.id);
              const reorderDisabledReason = !canWriteMenu
                ? "Read-only access"
                : !isMenuFilterEmpty(filter)
                  ? "Clear filters to reorder"
                  : reorderPendingCategoryIds.has(category.id)
                    ? "Reorder in progress…"
                    : "Drag to reorder";
              return (
                <section
                  key={category.id}
                  id={`cat-${category.slug}`}
                  className={`scroll-anchor rounded-2xl bg-white border overflow-hidden transition-colors ${
                    isDeals ? "border-yellow-300" : "border-stone-200"
                  }`}
                >
                  <header
                    className="px-5 py-4 flex flex-wrap items-center gap-4 border-b"
                    style={{
                      background: isDeals
                        ? "linear-gradient(180deg, #FFF4CC 0%, #FFFAEB 60%, #fff 100%)"
                        : "linear-gradient(180deg, #FAF9F5 0%, #fff 100%)",
                      borderBottomColor: isDeals
                        ? "rgba(255,190,11,0.25)"
                        : "#E8E6DF",
                    }}
                  >
                    <div
                      className="w-[52px] h-[52px] rounded-xl border flex items-center justify-center text-[28px] flex-shrink-0"
                      style={{
                        background: isDeals ? "#fff" : "#F5F4EF",
                        borderColor: isDeals
                          ? "rgba(255,190,11,0.4)"
                          : "#E8E6DF",
                        boxShadow: isDeals
                          ? "0 4px 12px -2px rgba(255,190,11,0.25)"
                          : "none",
                      }}
                    >
                      {category.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 flex-wrap">
                        <h2
                          data-cat-heading
                          tabIndex={-1}
                          className="display text-2xl focus:outline-none"
                        >
                          {category.name}
                        </h2>
                        <span
                          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-black tracking-widest border"
                          style={{
                            background: category.isActive
                              ? "#D1FAE5"
                              : "#E8E6DF",
                            color: category.isActive ? "#047857" : "#6F5E44",
                            borderColor: category.isActive
                              ? "rgba(16,185,129,0.25)"
                              : "#D8D5CC",
                          }}
                        >
                          {category.isActive && (
                            <span className="live-dot" aria-hidden="true" />
                          )}
                          {category.isActive ? "LIVE" : "HIDDEN"}
                        </span>
                      </div>
                      <div className="text-xs text-stone-500 mt-1.5 flex items-center gap-2 flex-wrap">
                        <span>
                          <strong className="text-stone-800 font-bold">
                            {activeCount}
                          </strong>{" "}
                          live
                        </span>
                        <span className="text-stone-300">/</span>
                        <span>{totalCount} total</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => setPreviewCategorySlug(category.slug)}
                        title="Preview this category as customers see it"
                        aria-label={`Preview ${category.name} as customers see it`}
                        className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-stone-300 bg-white text-stone-700 opacity-60 hover:opacity-100 focus:opacity-100 hover:bg-[#141414] hover:text-[#FFBE0B] hover:border-[#141414] transition-colors"
                      >
                        <Search size={16} strokeWidth={2.5} />
                      </button>
                      {canWriteMenu && (
                        <button
                          onClick={() => {
                            setEditingCategory(category);
                            setCreatingCategory(false);
                          }}
                          className="px-3 py-2 rounded-md text-xs font-black tracking-widest bg-white border border-stone-300 hover:bg-[#141414] hover:text-[#FFBE0B] hover:border-[#141414] transition-colors"
                        >
                          EDIT CATEGORY
                        </button>
                      )}
                      {canWriteMenu && (
                        <button
                          onClick={() => {
                            if (isDealsCategory(category)) {
                              setDealBaseCategory(category);
                              return;
                            }
                            startNewItem(category);
                          }}
                          className="px-3 py-2 rounded-md text-xs font-black tracking-widest"
                          style={{ background: BRAND.red, color: "white" }}
                        >
                          {isDealsCategory(category)
                            ? "+ ADD NEW DEAL"
                            : "+ ADD ITEM"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleCategoryCollapse(category.id)}
                        title={
                          isCollapsed
                            ? `Expand ${category.name}`
                            : `Collapse ${category.name}`
                        }
                        aria-label={
                          isCollapsed
                            ? `Expand ${category.name}`
                            : `Collapse ${category.name}`
                        }
                        aria-expanded={!isCollapsed}
                        aria-controls={`cat-${category.slug}-body`}
                        className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-stone-300 bg-white text-stone-600 hover:bg-[#141414] hover:text-[#FFBE0B] hover:border-[#141414] transition-colors"
                      >
                        <ChevronDown
                          size={16}
                          strokeWidth={2.5}
                          className="transition-transform duration-200"
                          style={{
                            transform: isCollapsed
                              ? "rotate(-90deg)"
                              : "rotate(0deg)",
                          }}
                        />
                      </button>
                    </div>
                  </header>

                  {!isCollapsed &&
                    (categoryItems.length === 0 ? (
                      <div
                        id={`cat-${category.slug}-body`}
                        className="p-8 text-center"
                      >
                        <div className="text-3xl opacity-40 mb-1">🍽️</div>
                        <div className="text-sm text-stone-600">
                          No items match the current filters.
                        </div>
                      </div>
                    ) : (
                      <div
                        id={`cat-${category.slug}-body`}
                        className="overflow-x-auto"
                      >
                        <div
                          className="grid items-center gap-4 px-5 py-2.5 text-[10px] font-black tracking-widest text-stone-500 uppercase border-b border-stone-200 bg-white"
                          style={{
                            gridTemplateColumns: gridTemplate,
                            minWidth: gridMinWidth,
                          }}
                        >
                          <span />
                          <span />
                          <span>Item</span>
                          <span>Badge</span>
                          <span className="text-right">Price</span>
                          <span>Options</span>
                          {isDeals && (
                            <span className="text-center">Expires</span>
                          )}
                          <span className="text-right">Visibility</span>
                          <span className="text-right">Stock</span>
                          <span />
                          <span />
                        </div>

                        {categoryItems.map((item, idx) => {
                          const rowIsDeal = isDeals;
                          const rowSelected = selectedItemId === item.id;
                          const rowBusy =
                            busyItemId === item.id ||
                            quickEditBusyItemId === item.id;
                          const dealHasAvailableUpgrade =
                            dealHasCustomerAvailableUpgrade(
                              item,
                              linkClassificationContext,
                            );
                          const expirationState = rowIsDeal
                            ? dealExpirationState(item, serverNowMs)
                            : "active";
                          const structuralRepairReason = rowIsDeal
                            ? dealStructuralRepairReason(
                                item,
                                linkClassificationContext,
                              )
                            : null;
                          const baseAvailabilityReason = rowIsDeal
                            ? dealBaseAvailabilityReason(
                                item,
                                linkClassificationContext,
                              )
                            : null;
                          const effectiveActive = rowIsDeal
                            ? item.isActive &&
                              !structuralRepairReason &&
                              !baseAvailabilityReason &&
                              dealHasAvailableUpgrade &&
                              expirationState === "active"
                            : item.isActive;
                          const usesQuantityStock =
                            item.stockMode === "QUANTITY";
                          const isLowStock =
                            usesQuantityStock &&
                            item.lowStockThreshold != null &&
                            (item.stockQty ?? 0) > 0 &&
                            (item.stockQty ?? 0) <= item.lowStockThreshold;
                          const hiddenReason =
                            rowIsDeal && !effectiveActive
                              ? dealHiddenReason(
                                  item,
                                  dealHasAvailableUpgrade,
                                  expirationState,
                                  structuralRepairReason ??
                                    baseAvailabilityReason,
                                  linkClassificationContext,
                                )
                              : null;
                          const expiredAlsoNeedsReason =
                            rowIsDeal &&
                            item.isActive &&
                            expirationState === "expired" &&
                            !structuralRepairReason &&
                            !baseAvailabilityReason
                              ? dealHiddenReason(
                                  item,
                                  dealHasAvailableUpgrade,
                                  "active",
                                  null,
                                  linkClassificationContext,
                                )
                              : null;
                          const secondaryVisibilityReason =
                            hiddenReason === "Expired"
                              ? expiredAlsoNeedsReason
                                ? `Also needs: ${expiredAlsoNeedsReason}`
                                : null
                              : hiddenReason;
                          const rowVisibilityState: "live" | "hidden" | "expired" =
                            rowIsDeal
                              ? !item.isActive
                                ? "hidden"
                                : expirationState === "expired"
                                  ? "expired"
                                  : effectiveActive
                                    ? "live"
                                    : "hidden"
                              : item.isActive
                                ? "live"
                                : "hidden";
                          const isLast = idx === categoryItems.length - 1;
                          const optionParts: string[] = [];
                          if (item.sizes.length > 0) {
                            optionParts.push(
                              `${item.sizes.length} ${
                                item.sizes.length === 1 ? "size" : "sizes"
                              }`,
                            );
                          }
                          if (item.addons.length > 0) {
                            optionParts.push(
                              `${item.addons.length} ${
                                item.addons.length === 1 ? "add-on" : "add-ons"
                              }`,
                            );
                          }
                          if (rowIsDeal && item.upgradeOptions.length > 0) {
                            optionParts.push(
                              `${item.upgradeOptions.length} ${
                                item.upgradeOptions.length === 1
                                  ? "deal option"
                                  : "deal options"
                              }`,
                            );
                          }
                          const rowAccent =
                            rowSelected ||
                            selectedRowIds.has(item.id) ||
                            expandedItemIds.has(item.id);
                          const rowBackground = rowSelected
                            ? "rgba(255,190,11,0.14)"
                            : rowBusy
                              ? "rgba(255,190,11,0.22)"
                              : rowIsDeal
                                ? "linear-gradient(90deg, rgba(255,190,11,0.07) 0%, rgba(255,190,11,0.02) 50%, transparent 100%)"
                                : undefined;
                          const rowChecked = selectedRowIds.has(item.id);
                          const rowExpanded = expandedItemIds.has(item.id);
                          const dealRefs =
                            dealRefsByItemId.get(item.id) ?? [];
                          const rowQuickEdit =
                            quickEditState?.itemId === item.id
                              ? quickEditState
                              : null;
                          const rowQuickEditError =
                            quickEditErrorByItemId[item.id];
                          const badgeQuickEditAllowed = canQuickEditField(
                            item,
                            "badge",
                          );
                          const priceQuickEditAllowed = canQuickEditField(
                            item,
                            "price",
                          );
                          // Leading-area badge for deal rows: shows the
                          // row's position in the rendered list (1, 2, 3…)
                          // — NOT the customer-facing comboNum. Operators
                          // see a clean sequential index for visual order
                          // while the real comboNum stays the canonical
                          // identifier everywhere else (dropdown panel,
                          // cross-reference tooltips, kiosk, receipts).
                          // Convention: row index has NO `#` prefix; real
                          // comboNum is always written as `#14` / `Combo #14`.
                          const dealRefBadge: {
                            text: string;
                            tooltip: string;
                          } | null = rowIsDeal
                            ? {
                                text: String(idx + 1),
                                tooltip:
                                  item.comboNum != null
                                    ? `Combo #${item.comboNum} — Customer-facing identifier shown on the kiosk and receipts. The leading ${idx + 1} is just this row's position in the admin list.`
                                    : `Position ${idx + 1} in Deals`,
                              }
                            : null;
                          const rowHighlighted =
                            highlightedItemId === item.id;
                          return (
                            <Fragment key={item.id}>
                              <div
                                id={`item-row-${item.id}`}
                                className={`group/row relative grid items-center gap-4 px-5 py-3 transition-colors ${
                                  isLast && !rowExpanded
                                    ? ""
                                    : "border-b border-stone-100"
                                } ${
                                  !rowSelected &&
                                  !rowBusy &&
                                  !rowIsDeal &&
                                  !rowChecked &&
                                  !rowHighlighted
                                    ? "hover:bg-stone-50"
                                    : ""
                                }`}
                                style={{
                                  gridTemplateColumns: gridTemplate,
                                  minWidth: gridMinWidth,
                                  background: rowHighlighted
                                    ? "rgba(255,190,11,0.32)"
                                    : rowChecked
                                      ? "rgba(255,190,11,0.10)"
                                      : rowBackground,
                                  boxShadow:
                                    rowHighlighted || rowAccent
                                      ? `inset 3px 0 0 ${BRAND.yellow}`
                                      : draggedItemId &&
                                          dropTarget?.categoryId === category.id &&
                                          dropTarget?.itemId === item.id &&
                                          draggedItemId !== item.id
                                        ? `inset 0 2px 0 ${BRAND.yellow}`
                                        : undefined,
                                  opacity:
                                    draggedItemId === item.id ? 0.5 : undefined,
                                }}
                                onDragOver={(e) => {
                                  if (!draggedItemId) return;
                                  if (reorderDisabled) return;
                                  e.preventDefault();
                                  e.dataTransfer.dropEffect = "move";
                                  if (
                                    dropTarget?.categoryId !== category.id ||
                                    dropTarget?.itemId !== item.id
                                  ) {
                                    setDropTarget({ categoryId: category.id, itemId: item.id });
                                  }
                                }}
                                onDrop={(e) => {
                                  if (!draggedItemId) return;
                                  if (reorderDisabled) return;
                                  e.preventDefault();
                                  // Only reorder within the same category for v1.
                                  const draggedItem = categoryItems.find(
                                    (it) => it.id === draggedItemId,
                                  );
                                  if (!draggedItem) {
                                    setDraggedItemId(null);
                                    setDropTarget(null);
                                    return;
                                  }
                                  if (draggedItemId === item.id) {
                                    setDraggedItemId(null);
                                    setDropTarget(null);
                                    return;
                                  }
                                  const beforeOrder = categoryItems.map((it) => it.id);
                                  const fromIdx = beforeOrder.indexOf(draggedItemId);
                                  const toIdx = beforeOrder.indexOf(item.id);
                                  if (fromIdx < 0 || toIdx < 0) {
                                    setDraggedItemId(null);
                                    setDropTarget(null);
                                    return;
                                  }
                                  const newOrder = beforeOrder.slice();
                                  newOrder.splice(fromIdx, 1);
                                  newOrder.splice(toIdx, 0, draggedItemId);
                                  setOptimisticOrder(category.id, newOrder);
                                  setDraggedItemId(null);
                                  setDropTarget(null);
                                  void submitReorder(
                                    category.id,
                                    beforeOrder,
                                    newOrder,
                                    category.updatedAt,
                                  );
                                }}
                              >
                                {dealRefBadge && (
                                  <div
                                    className={`absolute pointer-events-none flex items-center transition-opacity ${
                                      rowChecked
                                        ? "opacity-0"
                                        : "opacity-100 group-hover/row:opacity-0"
                                    }`}
                                    style={{
                                      left: 20,
                                      top: 0,
                                      bottom: 0,
                                      width: 80,
                                    }}
                                    title={dealRefBadge.tooltip}
                                  >
                                    <span className="mono text-[10.5px] font-bold text-stone-400 whitespace-nowrap">
                                      {dealRefBadge.text}
                                    </span>
                                  </div>
                                )}
                                <button
                                  type="button"
                                  draggable={!reorderDisabled}
                                  aria-label={`Drag to reorder ${item.name}`}
                                  title={reorderDisabledReason}
                                  disabled={reorderDisabled}
                                  onDragStart={(e) => {
                                    if (reorderDisabled) {
                                      e.preventDefault();
                                      return;
                                    }
                                    setDraggedItemId(item.id);
                                    e.dataTransfer.effectAllowed = "move";
                                    e.dataTransfer.setData("text/plain", item.id);
                                  }}
                                  onDragEnd={() => {
                                    setDraggedItemId(null);
                                    setDropTarget(null);
                                  }}
                                  className={`flex items-center justify-center text-stone-400 opacity-0 group-hover/row:opacity-100 transition-opacity bg-transparent border-0 p-0 ${
                                    reorderDisabled
                                      ? "!opacity-30 cursor-not-allowed"
                                      : "cursor-grab active:cursor-grabbing"
                                  }`}
                                >
                                  <GripVertical size={14} strokeWidth={2.5} />
                                </button>
                                {canWriteMenu ? (
                                  <button
                                    type="button"
                                    onClick={() => toggleRowSelection(item.id)}
                                    aria-label={
                                      rowChecked
                                        ? `Deselect ${item.name}`
                                        : `Select ${item.name}`
                                    }
                                    aria-pressed={rowChecked}
                                    className={`flex items-center justify-center w-[18px] h-[18px] rounded-[5px] border transition-all ${
                                      rowChecked
                                        ? "opacity-100 bg-stone-900 border-stone-900 text-white"
                                        : "opacity-0 group-hover/row:opacity-100 bg-white border-stone-300 text-transparent hover:border-stone-500"
                                    }`}
                                  >
                                    <Check size={11} strokeWidth={3} />
                                  </button>
                                ) : (
                                  <div aria-hidden="true" />
                                )}
                                <div className="flex items-center gap-3 min-w-0">
                                  <div
                                    className="w-[44px] h-[44px] rounded-[10px] overflow-hidden flex-shrink-0 border"
                                    style={{
                                      background: rowIsDeal
                                        ? "#FFF4CC"
                                        : "#F5F4EF",
                                      borderColor: rowIsDeal
                                        ? "rgba(255,190,11,0.35)"
                                        : "#E8E6DF",
                                    }}
                                  >
                                    <ItemVisual item={item} size="sidebar" />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="font-bold text-sm text-stone-900 truncate">
                                      {item.name}
                                    </div>
                                    {item.description && (
                                      <div className="text-xs text-stone-500 truncate mt-0.5">
                                        {item.description}
                                      </div>
                                    )}
                                  </div>
                                </div>

                                <div className="flex flex-col items-start gap-1 min-w-0">
                                  <div className="inline-flex items-center gap-1.5 flex-nowrap whitespace-nowrap">
                                    {rowQuickEdit?.field === "badge" ? (
                                      <select
                                        autoFocus
                                        value={rowQuickEdit.value}
                                        disabled={quickEditBusyItemId === item.id}
                                        onChange={(e) => {
                                          const nextValue = e.target.value;
                                          setQuickEditState((prev) =>
                                            prev?.itemId === item.id &&
                                            prev.field === "badge"
                                              ? { ...prev, value: nextValue }
                                              : prev,
                                          );
                                          void commitQuickEdit(
                                            item,
                                            "badge",
                                            nextValue,
                                          );
                                        }}
                                        onBlur={() => {
                                          setQuickEditState((prev) =>
                                            prev?.itemId === item.id &&
                                            prev.field === "badge"
                                              ? null
                                              : prev,
                                          );
                                        }}
                                        className="max-w-[120px] rounded-md border border-stone-300 bg-white px-2 py-1 text-[11px] font-black tracking-widest uppercase focus:outline-none focus:ring-2"
                                        style={
                                          {
                                            "--tw-ring-color": BRAND.yellow,
                                          } as React.CSSProperties
                                        }
                                        aria-label={`Edit badge for ${item.name}`}
                                      >
                                        <option value="">None</option>
                                        {ADMIN_MENU_BADGES.filter(
                                          (badge) => rowIsDeal || badge !== "DEAL",
                                        ).map((badge) => (
                                          <option key={badge} value={badge}>
                                            {badge}
                                          </option>
                                        ))}
                                      </select>
                                    ) : item.badge ? (
                                      <button
                                        type="button"
                                        onClick={() => startQuickEdit(item, "badge")}
                                        disabled={!badgeQuickEditAllowed}
                                        title={
                                          badgeQuickEditAllowed
                                            ? `Quick-edit badge for ${item.name}`
                                            : undefined
                                        }
                                        className="inline-flex items-center p-0 bg-transparent border-0 disabled:cursor-default"
                                      >
                                        <span
                                          className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-black tracking-widest border"
                                          style={{
                                            background: "#FEF3C7",
                                            color: "#92400E",
                                            borderColor: "rgba(245,158,11,0.3)",
                                          }}
                                        >
                                          {item.badge}
                                        </span>
                                      </button>
                                    ) : null}
                                    {/* Deal rows keep the base category shortcut
                                        here. Base availability now lives in the
                                        Stock column so there is one place for
                                        orderability state. */}
                                    {rowIsDeal &&
                                      item.dealBaseMenuItemId &&
                                      (() => {
                                        const baseItem =
                                          linkClassificationContext.itemById.get(
                                            item.dealBaseMenuItemId,
                                          );
                                        if (!baseItem) return null;
                                        const baseCat =
                                          linkClassificationContext.categoryById.get(
                                            baseItem.categoryId,
                                          );
                                        return (
                                          <>
                                            {baseCat && (
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  addCategoryFilters([
                                                    baseCat.slug,
                                                    category.slug,
                                                  ]);
                                                  triggerHighlight(
                                                    baseItem.id,
                                                  );
                                                }}
                                                className="inline-flex items-center justify-center w-6 h-6 rounded-md border border-stone-200 bg-white text-base leading-none hover:bg-[#141414] hover:border-[#141414] transition-colors"
                                                title={`Filter to ${baseCat.name} and highlight ${baseItem.name}`}
                                                aria-label={`Filter to ${baseCat.name} and highlight ${baseItem.name}`}
                                              >
                                                {baseCat.icon}
                                              </button>
                                            )}
                                          </>
                                        );
                                      })()}
                                  </div>
                                  {!rowIsDeal && dealRefs.length > 0 && (
                                    <span
                                      className="inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-bold whitespace-nowrap"
                                      style={{
                                        background: "#F5F4EF",
                                        color: "#6F5E44",
                                        borderColor: "#D8D5CC",
                                      }}
                                      title={`Used in ${dealRefs
                                        .map((d) => `${d.position} — ${d.name}`)
                                        .join(", ")}`}
                                    >
                                      In {dealRefs.length}{" "}
                                      {dealRefs.length === 1 ? "deal" : "deals"}
                                    </span>
                                  )}
                                  {!item.badge &&
                                    (badgeQuickEditAllowed ? (
                                      <button
                                        type="button"
                                        onClick={() => startQuickEdit(item, "badge")}
                                        disabled={quickEditBusyItemId === item.id}
                                        className="text-stone-400 hover:text-stone-900 rounded px-1 py-0.5 disabled:opacity-50"
                                        title={`Quick-edit badge for ${item.name}`}
                                      >
                                        —
                                      </button>
                                    ) : (
                                      <span className="text-stone-300">—</span>
                                    ))}
                                  {rowQuickEditError &&
                                    rowQuickEdit?.field === "badge" && (
                                      <span className="text-[10px] font-bold text-red-600 whitespace-normal">
                                        {rowQuickEditError}
                                      </span>
                                    )}
                                </div>

                                <div className="flex flex-col items-end gap-1">
                                  {rowQuickEdit?.field === "price" ? (
                                    <input
                                      autoFocus
                                      type="text"
                                      inputMode="decimal"
                                      value={rowQuickEdit.value}
                                      disabled={quickEditBusyItemId === item.id}
                                      onChange={(e) => {
                                        const nextValue = e.target.value;
                                        setQuickEditState((prev) =>
                                          prev?.itemId === item.id &&
                                          prev.field === "price"
                                            ? { ...prev, value: nextValue }
                                            : prev,
                                        );
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          e.preventDefault();
                                          void commitQuickEdit(
                                            item,
                                            "price",
                                            rowQuickEdit.value,
                                          );
                                        }
                                        if (e.key === "Escape") {
                                          e.preventDefault();
                                          cancelQuickEdit();
                                        }
                                      }}
                                      onBlur={() => {
                                        if (priceEscapeCancelRef.current) {
                                          priceEscapeCancelRef.current = false;
                                          return;
                                        }
                                        void commitQuickEdit(
                                          item,
                                          "price",
                                          rowQuickEdit.value,
                                        );
                                      }}
                                      aria-label={`Edit base price for ${item.name}`}
                                      className="w-[86px] rounded-md border border-stone-300 bg-white px-2 py-1 text-right text-sm font-bold focus:outline-none focus:ring-2"
                                      style={
                                        {
                                          "--tw-ring-color": BRAND.yellow,
                                          fontFamily: "JetBrains Mono, monospace",
                                        } as React.CSSProperties
                                      }
                                    />
                                  ) : priceQuickEditAllowed ? (
                                    <button
                                      type="button"
                                      onClick={() => startQuickEdit(item, "price")}
                                      disabled={quickEditBusyItemId === item.id}
                                      className="group/price inline-flex flex-col items-end rounded-md px-1 py-0.5 hover:bg-stone-100 disabled:opacity-50"
                                      title={`Quick-edit base price for ${item.name}`}
                                    >
                                      <span
                                        className="mono font-bold text-sm text-right"
                                        style={{
                                          color: rowIsDeal ? "#8a6500" : undefined,
                                        }}
                                      >
                                        {fmt(item.price)}
                                      </span>
                                      {item.sizes.length > 0 && (
                                        <span className="text-[9px] font-black tracking-widest uppercase text-stone-400 group-hover/price:text-stone-600">
                                          Base price
                                        </span>
                                      )}
                                    </button>
                                  ) : (
                                    <div
                                      className="mono font-bold text-sm text-right"
                                      style={{
                                        color: rowIsDeal ? "#8a6500" : undefined,
                                      }}
                                    >
                                      {fmt(item.price)}
                                    </div>
                                  )}
                                  {rowQuickEditError &&
                                    (!rowQuickEdit ||
                                      rowQuickEdit.field === "price") && (
                                      <span className="max-w-[140px] text-right text-[10px] font-bold text-red-600">
                                        {rowQuickEditError}
                                      </span>
                                    )}
                                </div>

                                <div className="flex flex-wrap items-center gap-1">
                                  {optionParts.length === 0 ? (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded border border-dashed border-stone-300 text-[11px] font-semibold text-stone-400">
                                      {rowIsDeal
                                        ? "Base item only"
                                        : "No add-ons or sizes"}
                                    </span>
                                  ) : (
                                    optionParts.map((part) => (
                                      <span
                                        key={part}
                                        className="inline-flex items-center px-1.5 py-0.5 rounded border border-stone-200 bg-stone-50 text-[11px] font-semibold text-stone-700"
                                      >
                                        {part}
                                      </span>
                                    ))
                                  )}
                                </div>

                                {isDeals && (
                                  <div className="text-center">
                                    <span className="text-[10px] font-black tracking-widest text-stone-500">
                                      {dealExpirationSummary(item, serverNowMs)}
                                    </span>
                                  </div>
                                )}

                                <div className="flex flex-col items-end gap-1">
                                  <span
                                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-black tracking-widest border"
                                    style={{
                                      background: rowVisibilityState === "hidden"
                                        ? "#E8E6DF"
                                        : rowVisibilityState === "expired"
                                          ? "#FEF3C7"
                                          : "#D1FAE5",
                                      color: rowVisibilityState === "hidden"
                                        ? "#6F5E44"
                                        : rowVisibilityState === "expired"
                                          ? "#92400E"
                                          : "#047857",
                                      borderColor: rowVisibilityState === "hidden"
                                        ? "#D8D5CC"
                                        : rowVisibilityState === "expired"
                                          ? "rgba(245,158,11,0.3)"
                                          : "rgba(16,185,129,0.25)",
                                    }}
                                  >
                                    {rowVisibilityState === "live" && (
                                      <span
                                        className="live-dot"
                                        aria-hidden="true"
                                      />
                                    )}
                                    {rowVisibilityState === "hidden"
                                      ? "HIDDEN"
                                      : rowVisibilityState === "expired"
                                        ? "EXPIRED"
                                        : "LIVE"}
                                  </span>
                                  {secondaryVisibilityReason && (
                                    <span
                                      className={`max-w-[200px] text-[10px] font-bold leading-tight text-right ${
                                        isStockHiddenReason(
                                          secondaryVisibilityReason,
                                        )
                                          ? "text-red-700"
                                          : "text-stone-500"
                                      }`}
                                    >
                                      {secondaryVisibilityReason}
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center justify-end gap-1.5">
                                  {(() => {
                                    if (rowIsDeal) {
                                      const baseItem = item.dealBaseMenuItemId
                                        ? linkClassificationContext.itemById.get(
                                            item.dealBaseMenuItemId,
                                          )
                                        : null;
                                      if (!baseItem) {
                                        return (
                                          <span className="text-stone-300 text-[10px]">
                                            —
                                          </span>
                                        );
                                      }
                                      if (!baseItem.isActive) {
                                        return (
                                          <StockBadge tone="red">
                                            Base hidden
                                          </StockBadge>
                                        );
                                      }
                                      if (!isMenuItemAvailable(baseItem)) {
                                        return (
                                          <StockBadge tone="red">
                                            Base out
                                          </StockBadge>
                                        );
                                      }
                                      return (
                                        <StockBadge tone="green">
                                          Base ok
                                        </StockBadge>
                                      );
                                    }

                                    if (usesQuantityStock) {
                                      const qty = item.stockQty ?? 0;
                                      if (qty <= 0) {
                                        return (
                                          <StockBadge tone="red">
                                            Out · 0 left
                                          </StockBadge>
                                        );
                                      }
                                      return (
                                        <span
                                          className={`mono text-[10px] font-black ${
                                            isLowStock
                                              ? "text-amber-700"
                                              : "text-stone-500"
                                          }`}
                                        >
                                          {isLowStock ? "LOW · " : ""}
                                          {qty} left
                                        </span>
                                      );
                                    }

                                    if (!item.isActive) {
                                      return (
                                        <span className="text-stone-300 text-[10px]">
                                          —
                                        </span>
                                      );
                                    }

                                    return (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (!canWriteMenu) return;
                                          setItemStockState(
                                            item,
                                            !item.isOutOfStock,
                                          );
                                        }}
                                        disabled={
                                          busyItemId === item.id ||
                                          !canWriteMenu
                                        }
                                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-[10px] font-black tracking-widest uppercase transition-transform hover:-translate-y-0.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                                        aria-label={
                                          item.isOutOfStock
                                            ? `Mark ${item.name} in stock`
                                            : `Mark ${item.name} out of stock`
                                        }
                                        title={
                                          !canWriteMenu
                                            ? "Read-only access"
                                            : item.isOutOfStock
                                              ? "Mark in stock"
                                              : "Mark out of stock"
                                        }
                                        style={{
                                          background: item.isOutOfStock
                                            ? "#FDE2E2"
                                            : "#D1FAE5",
                                          color: item.isOutOfStock
                                            ? BRAND.redDark
                                            : "#047857",
                                          borderColor: item.isOutOfStock
                                            ? "rgba(232,69,69,0.25)"
                                            : "rgba(16,185,129,0.25)",
                                        }}
                                      >
                                        <span>
                                          {item.isOutOfStock
                                            ? "Out of stock"
                                            : "In stock"}
                                        </span>
                                      </button>
                                    );
                                  })()}
                                </div>

                                <div className="text-right flex items-center justify-end gap-1">
                                  {canWriteMenu && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelectedItemId(item.id);
                                        setNewDealBaseItem(null);
                                        setEditingItem(item);
                                        setCreatingItem(false);
                                      }}
                                      disabled={busyItemId === item.id}
                                      title={`Edit ${item.name}`}
                                      aria-label={`Edit ${item.name}`}
                                      className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-transparent text-stone-600 hover:bg-[#141414] hover:text-[#FFBE0B] hover:border-[#141414] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                      <Pencil size={14} strokeWidth={2.5} />
                                    </button>
                                  )}
                                  {canWriteMenu && !isDealsCategory(category) && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const draft = cloneItemAsDraft(
                                          item,
                                          effectiveItems.filter((it) => it.categoryId === item.categoryId),
                                        );
                                        setSelectedItemId(null);
                                        setNewDealBaseItem(null);
                                        setEditingItem(draft);
                                        setCreatingItem(true);
                                      }}
                                      disabled={busyItemId === item.id}
                                      title={`Duplicate ${item.name}`}
                                      aria-label={`Duplicate ${item.name}`}
                                      className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-transparent text-stone-600 hover:bg-[#141414] hover:text-[#FFBE0B] hover:border-[#141414] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                      <Copy size={14} strokeWidth={2.5} />
                                    </button>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => toggleItemExpand(item.id)}
                                  aria-label={
                                    rowExpanded
                                      ? "Collapse details"
                                      : "Expand details"
                                  }
                                  aria-expanded={rowExpanded}
                                  title={
                                    rowExpanded
                                      ? "Collapse details"
                                      : "Expand details"
                                  }
                                  className="inline-flex items-center justify-center w-7 h-7 rounded-md text-stone-400 border border-transparent hover:bg-[#141414] hover:text-[#FFBE0B] hover:border-[#141414] transition-colors"
                                >
                                  <ChevronDown
                                    size={16}
                                    strokeWidth={2.5}
                                    className="transition-transform duration-200"
                                    style={{
                                      transform: rowExpanded
                                        ? "rotate(180deg)"
                                        : "rotate(0deg)",
                                    }}
                                  />
                                </button>
                              </div>
                              {rowExpanded && (
                                <div
                                  className={`px-6 py-5 ${
                                    isLast ? "" : "border-b border-stone-100"
                                  }`}
                                  style={{
                                    background: rowIsDeal
                                      ? "linear-gradient(180deg, #fff 0%, #FFFAEB 100%)"
                                      : "linear-gradient(180deg, #fff 0%, #FAF9F5 100%)",
                                    minWidth: gridMinWidth,
                                    // Continue the parent row's left accent
                                    // through the dropdown so the row + its
                                    // expanded content read as one visual unit.
                                    boxShadow: `inset 3px 0 0 ${BRAND.yellow}`,
                                  }}
                                >
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="space-y-4">
                                      <div>
                                        <div className="text-[10px] font-black tracking-widest text-stone-500 uppercase mb-2">
                                          Description
                                        </div>
                                        <div className="bg-white border border-stone-200 rounded-lg px-3.5 py-3 text-sm text-stone-800 leading-relaxed">
                                          {item.description || (
                                            <span className="text-stone-400 italic">
                                              No description
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                      {item.sizes.length > 0 && (
                                        <div>
                                          <div className="text-[10px] font-black tracking-widest text-stone-500 uppercase mb-2">
                                            Sizes
                                          </div>
                                          <div className="bg-white border border-stone-200 rounded-lg px-3.5 py-3">
                                            <div className="flex flex-wrap gap-1.5">
                                              {item.sizes.map((size) => (
                                                <span
                                                  key={size.id ?? size.name}
                                                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-stone-200 bg-stone-50 text-[12px]"
                                                >
                                                  <span className="font-bold text-stone-900">
                                                    {size.name}
                                                  </span>
                                                  <span className="mono text-stone-500">
                                                    {size.priceDelta > 0
                                                      ? `+${fmt(size.priceDelta)}`
                                                      : size.priceDelta < 0
                                                        ? `−${fmt(Math.abs(size.priceDelta))}`
                                                        : "+$0.00"}
                                                  </span>
                                                </span>
                                              ))}
                                            </div>
                                          </div>
                                        </div>
                                      )}
                                      {!rowIsDeal &&
                                        item.sizes.length === 0 &&
                                        item.addons.length === 0 && (
                                          <div className="bg-white border border-stone-200 rounded-lg px-3.5 py-3 text-sm text-stone-400 italic">
                                            Base item only — no sizes or add-ons configured.
                                          </div>
                                        )}
                                    </div>
                                    <div className="space-y-4">
                                      {!rowIsDeal && item.addons.length > 0 && (
                                        <div>
                                          <div className="text-[10px] font-black tracking-widest text-stone-500 uppercase mb-2">
                                            Add-ons
                                          </div>
                                          <div className="bg-white border border-stone-200 rounded-lg px-3.5 py-3">
                                            <div className="flex flex-wrap gap-1.5">
                                              {item.addons.map((addon) => (
                                                <span
                                                  key={addon.id ?? addon.name}
                                                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-stone-200 bg-stone-50 text-[12px]"
                                                >
                                                  <span className="font-bold text-stone-900">
                                                    {addon.name}
                                                  </span>
                                                  <span className="mono text-stone-500">
                                                    +{fmt(addon.priceDelta)}
                                                  </span>
                                                </span>
                                              ))}
                                            </div>
                                          </div>
                                        </div>
                                      )}
                                      {!rowIsDeal && dealRefs.length > 0 && (
                                        <div>
                                          <div className="text-[10px] font-black tracking-widest text-stone-500 uppercase mb-2">
                                            Used in deals
                                          </div>
                                          <div className="bg-white border border-stone-200 rounded-lg px-3.5 py-3">
                                            <ul className="space-y-2 text-sm">
                                              {dealRefs.map((d) => (
                                                <li
                                                  key={d.id}
                                                  className="flex items-center gap-2"
                                                  title={
                                                    d.comboNum != null
                                                      ? `Customer-facing: Combo #${d.comboNum}`
                                                      : undefined
                                                  }
                                                >
                                                  <span className="mono text-[11px] font-bold flex-shrink-0 text-stone-500 w-4 text-right">
                                                    {d.position}
                                                  </span>
                                                  <span
                                                    className="inline-flex items-center justify-center w-7 h-7 rounded-md flex-shrink-0 text-base border border-stone-200"
                                                    style={{
                                                      background:
                                                        d.bgColor || "#F5F4EF",
                                                    }}
                                                    aria-hidden="true"
                                                  >
                                                    {d.emoji || "🍽️"}
                                                  </span>
                                                  <span className="font-bold text-stone-900 truncate">
                                                    {d.name}
                                                  </span>
                                                </li>
                                              ))}
                                            </ul>
                                          </div>
                                        </div>
                                      )}
                                      {rowIsDeal &&
                                        item.upgradeOptions.length > 0 && (
                                          <div>
                                            <div className="text-[10px] font-black tracking-widest text-stone-500 uppercase mb-2">
                                              Bundle includes
                                            </div>
                                            <div className="space-y-2">
                                              {item.upgradeOptions.map(
                                                (opt, optIdx) => (
                                                  <div
                                                    key={opt.id ?? optIdx}
                                                    className="bg-white border border-stone-200 rounded-lg px-3.5 py-3"
                                                  >
                                                    {opt.linkedItems.length === 0 ? (
                                                      <div className="text-xs text-stone-400 italic">
                                                        No items linked
                                                      </div>
                                                    ) : (
                                                      <>
                                                      <ul className="space-y-1.5 text-sm">
                                                        {opt.linkedItems.map(
                                                          (link) => {
                                                            const linkState =
                                                              classifyLink(link);
                                                            const linkBadge =
                                                              describeLinkIssue(
                                                                linkState,
                                                              );
                                                            const basePrice =
                                                              link.linkedMenuItem
                                                                ?.price ?? null;
                                                            const sizeDelta =
                                                              link.linkedSize
                                                                ?.priceDelta ?? 0;
                                                            const effectivePrice =
                                                              basePrice != null
                                                                ? basePrice +
                                                                  sizeDelta
                                                                : null;
                                                            const linkEmoji =
                                                              link.linkedMenuItem
                                                                ?.emoji ?? null;
                                                            const linkBg =
                                                              link.linkedMenuItem
                                                                ?.bgColor ??
                                                              "#F5F4EF";
                                                            // Resolve the linked item's category so the
                                                            // dropdown shows which category each bundle
                                                            // item belongs to (e.g., "Chicken Nuggets"
                                                            // is from Sides). Mirrors the base-item icon
                                                            // chip in the BADGE column.
                                                            const linkedFullItem = link.linkedMenuItemId
                                                              ? linkClassificationContext.itemById.get(
                                                                  link.linkedMenuItemId,
                                                                )
                                                              : null;
                                                            const linkedCategory = linkedFullItem
                                                              ? linkClassificationContext.categoryById.get(
                                                                  linkedFullItem.categoryId,
                                                                )
                                                              : null;
                                                            return (
                                                              <li
                                                                key={
                                                                  link.id ??
                                                                  link.linkedMenuItemId ??
                                                                  link.itemNameSnapshot
                                                                }
                                                                className="flex items-center justify-between gap-2 flex-wrap"
                                                              >
                                                                <span className="inline-flex items-center gap-2 min-w-0">
                                                                  <span
                                                                    className="inline-flex items-center justify-center w-7 h-7 rounded-md flex-shrink-0 text-base border border-stone-200"
                                                                    style={{
                                                                      background:
                                                                        linkBg,
                                                                    }}
                                                                    aria-hidden="true"
                                                                  >
                                                                    {linkEmoji ??
                                                                      "🍽️"}
                                                                  </span>
                                                                  <span className="font-bold text-stone-900">
                                                                    {link.itemNameSnapshot ??
                                                                      "—"}
                                                                    {link.sizeNameSnapshot && (
                                                                      <span className="text-stone-500 font-medium">
                                                                        {" · "}
                                                                        {
                                                                          link.sizeNameSnapshot
                                                                        }
                                                                      </span>
                                                                    )}
                                                                  </span>
                                                                  {linkedCategory && (
                                                                    <button
                                                                      type="button"
                                                                      onClick={(
                                                                        e,
                                                                      ) => {
                                                                        e.stopPropagation();
                                                                        addCategoryFilters(
                                                                          [
                                                                            linkedCategory.slug,
                                                                            category.slug,
                                                                          ],
                                                                        );
                                                                        if (
                                                                          link.linkedMenuItemId
                                                                        ) {
                                                                          triggerHighlight(
                                                                            link.linkedMenuItemId,
                                                                          );
                                                                        }
                                                                      }}
                                                                      className="inline-flex items-center justify-center w-5 h-5 rounded-md border border-stone-200 bg-white text-sm leading-none flex-shrink-0 hover:bg-[#141414] hover:border-[#141414] transition-colors"
                                                                      title={`Filter to ${linkedCategory.name} and highlight ${link.itemNameSnapshot ?? "linked item"}`}
                                                                      aria-label={`Filter to ${linkedCategory.name} and highlight ${link.itemNameSnapshot ?? "linked item"}`}
                                                                    >
                                                                      {linkedCategory.icon}
                                                                    </button>
                                                                  )}
                                                                </span>
                                                                <span className="inline-flex items-center gap-2 flex-shrink-0">
                                                                  {effectivePrice !=
                                                                    null && (
                                                                    <span className="mono text-xs text-stone-500">
                                                                      {fmt(
                                                                        effectivePrice,
                                                                      )}
                                                                    </span>
                                                                  )}
                                                                  {linkBadge && (
                                                                    <span
                                                                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-black tracking-widest border whitespace-nowrap"
                                                                      style={
                                                                        linkBadge.style
                                                                      }
                                                                    >
                                                                      {linkBadge.label}
                                                                    </span>
                                                                  )}
                                                                </span>
                                                              </li>
                                                            );
                                                          },
                                                        )}
                                                      </ul>
                                                      {(() => {
                                                        const itemsTotal = opt.linkedItems.reduce(
                                                          (sum, link) => {
                                                            const base =
                                                              link.linkedMenuItem?.price ?? 0;
                                                            const size =
                                                              link.linkedSize?.priceDelta ?? 0;
                                                            return sum + base + size;
                                                          },
                                                          0,
                                                        );
                                                        const customerPays =
                                                          opt.discountPct != null
                                                            ? round2(
                                                                itemsTotal *
                                                                  (1 - opt.discountPct / 100),
                                                              )
                                                            : Number(opt.extraCharge);
                                                        const save =
                                                          opt.discountPct != null
                                                            ? round2(
                                                                itemsTotal *
                                                                  (opt.discountPct / 100),
                                                              )
                                                            : opt.savingsLabel != null
                                                              ? Number(opt.savingsLabel)
                                                              : null;
                                                        return (
                                                          <div className="mt-3 pt-3 border-t border-stone-200 text-xs space-y-0.5">
                                                            <div className="flex justify-between text-stone-600">
                                                              <span>Items normally total</span>
                                                              <span className="mono">
                                                                {fmt(itemsTotal)}
                                                              </span>
                                                            </div>
                                                            {opt.discountPct != null && (
                                                              <div className="flex justify-between text-stone-600">
                                                                <span>
                                                                  Discount ({opt.discountPct}%)
                                                                </span>
                                                                <span className="mono">
                                                                  −{fmt(save ?? 0)}
                                                                </span>
                                                              </div>
                                                            )}
                                                            <div className="flex justify-between font-bold text-stone-900 pt-1 border-t border-dashed border-stone-200">
                                                              <span>Customer pays</span>
                                                              <span className="mono">
                                                                {fmt(customerPays)}
                                                              </span>
                                                            </div>
                                                            {save != null && save > 0 && (
                                                              <div
                                                                className="flex justify-between font-bold"
                                                                style={{ color: BRAND.red }}
                                                              >
                                                                <span>
                                                                  &quot;Save&quot; tag shown to
                                                                  customer
                                                                </span>
                                                                <span className="mono">
                                                                  Save {fmt(save)}
                                                                </span>
                                                              </div>
                                                            )}
                                                          </div>
                                                        );
                                                      })()}
                                                      </>
                                                    )}
                                                  </div>
                                                ),
                                              )}
                                            </div>
                                          </div>
                                        )}
                                      {hiddenReason && (
                                        <div>
                                          <div className="text-[10px] font-black tracking-widest text-stone-500 uppercase mb-2">
                                            Hidden reason
                                          </div>
                                          <div
                                            className="border rounded-lg px-3.5 py-3 text-sm font-bold"
                                            style={
                                              isStockHiddenReason(hiddenReason)
                                                ? {
                                                    background: "#FDE2E2",
                                                    color: "#991B1B",
                                                    borderColor:
                                                      "rgba(232,69,69,0.25)",
                                                  }
                                                : {
                                                    background: "#FEF3C7",
                                                    color: "#92400E",
                                                    borderColor:
                                                      "rgba(245,158,11,0.3)",
                                                  }
                                            }
                                          >
                                            {hiddenReason}
                                          </div>
                                        </div>
                                      )}
                                      {rowIsDeal &&
                                        item.upgradeOptions.length === 0 && (
                                          <div className="bg-white border border-stone-200 rounded-lg px-3.5 py-3 text-sm text-stone-400 italic">
                                            No deal option configured.
                                          </div>
                                        )}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </Fragment>
                          );
                        })}
                      </div>
                    ))}
                </section>
              );
            },
          )}
        </div>
      )}

      {dealBaseCategory && canWriteMenu && (
        <DealBasePickerModal
          dealsCategory={dealBaseCategory}
          allItems={effectiveItems}
          categories={categories}
          dealHistoryEntries={dealHistoryEntries}
          onCancel={() => setDealBaseCategory(null)}
          onPick={(base, historySnapshot) =>
            startNewDealFromBase(dealBaseCategory, base, historySnapshot)
          }
        />
      )}

      {editingItem &&
        canWriteMenu &&
        (allowsUpgradeOptions(categories, editingItem.categoryId) &&
        creatingItem ? (
          // Creating a NEW deal still uses the legacy ItemModal because it
          // owns the base-item picker (the operator picks a base before any
          // fields are populated). Editing existing deals routes to the new
          // EditDealModal below.
          <ItemModal
            item={editingItem}
            isNew={creatingItem}
            categories={categories}
            allItems={effectiveItems}
            allCategories={categories}
            initialDealBaseItem={creatingItem ? newDealBaseItem : null}
            saving={itemSaving}
            busyDeleting={busyItemId === editingItem.id}
            allowedImageHosts={allowedImageHosts}
            allowPasteUrl={allowPasteUrl}
            storageConfigured={storageConfigured}
            storageDisabledReason={storageDisabledReason}
            dealDefaultDiscountPct={dealDefaultDiscountPct}
            onCancel={() => {
              if (itemSaving || busyItemId === editingItem.id) return;
              setEditingItem(null);
              setCreatingItem(false);
              setNewDealBaseItem(null);
            }}
            onSave={(next, pending) => saveItem(next, creatingItem, pending)}
            onDelete={() =>
              editingItem.isActive
                ? deactivateItem(editingItem)
                : reactivateItem(editingItem)
            }
            onStockToggle={() =>
              setItemStockState(editingItem, !editingItem.isOutOfStock)
            }
            onHardDelete={() => hardDeleteItem(editingItem)}
          />
        ) : allowsUpgradeOptions(categories, editingItem.categoryId) ? (
          // Editing an existing deal: new EditDealModal. The new modal does
          // not change the base item — that flow remains in the legacy
          // creation path until the picker is ported.
          <EditDealModal
            mode="edit"
            item={editingItem}
            categories={categories}
            allItems={effectiveItems}
            allowedImageHosts={allowedImageHosts}
            saving={itemSaving}
            busyDeleting={busyItemId === editingItem.id}
            defaultDiscountPct={dealDefaultDiscountPct ?? 12}
            canWriteMenu={canWriteMenu}
            onCancel={() => {
              if (itemSaving || busyItemId === editingItem.id) return;
              setEditingItem(null);
              setCreatingItem(false);
              setNewDealBaseItem(null);
            }}
            onSave={async (next, pending) => {
              try {
                await saveItem(
                  next as unknown as Parameters<typeof saveItem>[0],
                  creatingItem,
                  pending,
                );
                return { ok: true as const, item: next };
              } catch (err) {
                return {
                  ok: false as const,
                  error: (err as Error).message ?? "Save failed",
                };
              }
            }}
            onHide={async () => {
              if (editingItem.isActive) await deactivateItem(editingItem);
              else await reactivateItem(editingItem);
            }}
            onDelete={async () => {
              await deactivateItem(editingItem);
            }}
          />
        ) : (
          // Non-deal items render the new EditItemModal from
          // `@/components/admin/menu-editor`.
          <EditItemModal
            mode={creatingItem ? "create" : "edit"}
            item={editingItem}
            categories={categories}
            allowedImageHosts={allowedImageHosts}
            saving={itemSaving}
            busyDeleting={busyItemId === editingItem.id}
            canWriteMenu={canWriteMenu}
            onCancel={() => {
              if (itemSaving || busyItemId === editingItem.id) return;
              setEditingItem(null);
              setCreatingItem(false);
              setNewDealBaseItem(null);
            }}
            onSave={async (next, pending) => {
              try {
                // The skeleton's modifier types use optional `id` (newly-added
                // rows have no id yet); the local `Mod` requires `id: string`.
                // The validator normalizes both shapes identically at runtime,
                // so this cast is TS-only.
                await saveItem(
                  next as unknown as Parameters<typeof saveItem>[0],
                  creatingItem,
                  pending,
                );
                return { ok: true as const, item: next };
              } catch (err) {
                return {
                  ok: false as const,
                  error: (err as Error).message ?? "Save failed",
                };
              }
            }}
            onHide={async () => {
              if (editingItem.isActive) await deactivateItem(editingItem);
              else await reactivateItem(editingItem);
            }}
            onDelete={async () => {
              await deactivateItem(editingItem);
            }}
            onHardDelete={() => hardDeleteItem(editingItem)}
          />
        ))}

      {editingCategory && canWriteMenu && (
        <CategoryModal
          category={editingCategory}
          isNew={creatingCategory}
          saving={categorySaving}
          assignedItemCount={
            effectiveItems.filter((item) => item.categoryId === editingCategory.id)
              .length
          }
          onCancel={() => {
            if (categorySaving) return;
            setEditingCategory(null);
            setCreatingCategory(false);
          }}
          onSave={(next) => saveCategory(next, creatingCategory)}
          onDelete={() => deleteCategory(editingCategory)}
        />
      )}

      {selectedRowIds.size > 0 && canWriteMenu && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 w-full max-w-3xl px-4 pointer-events-none"
          role="region"
          aria-label="Bulk actions"
        >
          <div
            className="pointer-events-auto rounded-xl shadow-lg px-3 py-2.5 flex items-center gap-2 flex-wrap"
            style={{ background: BRAND.black, color: "white" }}
          >
            <span className="inline-flex items-center gap-2 pl-1 pr-1">
              <span
                className="inline-flex items-center justify-center min-w-[26px] px-2 py-0.5 rounded-md text-xs font-black"
                style={{ background: BRAND.yellow, color: BRAND.black }}
              >
                {selectedRowIds.size}
              </span>
              <span className="text-sm font-bold">
                selected
                {selectedHiddenCount > 0 && (
                  <span className="ml-1 text-stone-300 font-medium">
                    ({selectedVisibleCount} in current view)
                  </span>
                )}
              </span>
            </span>
            <span className="h-5 w-px bg-stone-700 mx-1" aria-hidden />
            <button
              type="button"
              onClick={() =>
                applyBulkAction("Show", (item) => bulkShowOne(item))
              }
              disabled={bulkBusy}
              className="px-3 py-1.5 rounded-md text-xs font-bold hover:bg-stone-800 disabled:opacity-40 transition-colors"
            >
              Show
            </button>
            <button
              type="button"
              onClick={() =>
                applyBulkAction("Hide", (item) => bulkHideOne(item))
              }
              disabled={bulkBusy}
              className="px-3 py-1.5 rounded-md text-xs font-bold hover:bg-stone-800 disabled:opacity-40 transition-colors"
            >
              Hide
            </button>
            <span className="h-5 w-px bg-stone-700 mx-1" aria-hidden />
            <button
              type="button"
              onClick={() =>
                applyBulkAction("Mark in stock", (item) =>
                  bulkSetStockOne(item, false),
                )
              }
              disabled={bulkBusy}
              className="px-3 py-1.5 rounded-md text-xs font-bold hover:bg-stone-800 disabled:opacity-40 transition-colors"
              title="Non-deal items only — deals derive availability from upgrades"
            >
              Mark in stock
            </button>
            <button
              type="button"
              onClick={() =>
                applyBulkAction("Mark out of stock", (item) =>
                  bulkSetStockOne(item, true),
                )
              }
              disabled={bulkBusy}
              className="px-3 py-1.5 rounded-md text-xs font-bold hover:bg-stone-800 disabled:opacity-40 transition-colors"
              title="Non-deal items only — deals derive availability from upgrades"
            >
              Mark out of stock
            </button>
            <span className="h-5 w-px bg-stone-700 mx-1" aria-hidden />
            <button
              type="button"
              onClick={() => {
                // TODO: wire bulk move-to-category. Needs a category picker
                // dialog + per-item PATCH of categoryId. Skip deals semantics
                // (you can't move a non-deal into the Deals category without
                // also setting dealBaseMenuItemId).
              }}
              disabled={bulkBusy}
              className="px-3 py-1.5 rounded-md text-xs font-bold hover:bg-stone-800 disabled:opacity-40 transition-colors"
              title="Not wired yet"
            >
              Move to…
            </button>
            <button
              type="button"
              onClick={() => {
                // TODO: wire bulk delete. Needs FK protection (block deletion
                // when an item is referenced as a deal's dealBaseMenuItemId
                // or has order history) and confirm-twice UX since hard delete
                // is irreversible from the menu list.
              }}
              disabled={bulkBusy}
              className="px-3 py-1.5 rounded-md text-xs font-bold hover:bg-red-900 disabled:opacity-40 transition-colors text-red-300 hover:text-red-100"
              title="Not wired yet"
            >
              Delete
            </button>
            <span className="h-5 w-px bg-stone-700 mx-1" aria-hidden />
            <button
              type="button"
              onClick={clearSelection}
              disabled={bulkBusy}
              aria-label="Clear selection"
              title="Clear selection"
              className="inline-flex items-center justify-center w-7 h-7 rounded-md text-stone-400 hover:text-white hover:bg-stone-800 disabled:opacity-40 transition-colors"
            >
              <X size={14} strokeWidth={2.5} />
            </button>
          </div>
          {selectedHiddenCount > 0 && (
            <div
              className="pointer-events-auto mt-1.5 text-center text-[11px] font-bold text-stone-300"
              role="status"
            >
              {selectedHiddenCount} selected{" "}
              {selectedHiddenCount === 1 ? "row is" : "rows are"} outside the
              current filter and will not be changed.
            </div>
          )}
        </div>
      )}

      {releaseNoteVisible && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 w-full max-w-3xl px-4 pointer-events-none"
          role="status"
          aria-live="polite"
        >
          <div className="pointer-events-auto rounded-xl border border-stone-200 bg-white shadow-lg px-4 py-3 flex items-start gap-3">
            <div className="flex-1 text-sm text-stone-700 leading-relaxed">
              <span className="font-bold text-stone-900">Heads up · </span>
              Hidden categories and items stay editable here, but they do not
              appear on the kiosk menu. New item saves now persist sizes and
              add-ons on first create, not just after a later edit. Every
              category/item change now also writes menu history and a full
              revision snapshot.
            </div>
            <button
              type="button"
              onClick={dismissReleaseNote}
              aria-label="Dismiss"
              title="Dismiss"
              className="flex-shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full text-stone-500 hover:text-stone-900 hover:bg-stone-100 transition-colors"
            >
              <X size={14} strokeWidth={2.5} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RestoreHistoryModal({
  revisions,
  auditLogs,
  currentLiveRevisionId,
  currentLiveRestoredAt,
  busyRevisionId,
  canRestoreMenu,
  onClose,
  onRestore,
}: {
  revisions: RevisionEntry[];
  auditLogs: AuditEntry[];
  currentLiveRevisionId: string | null;
  currentLiveRestoredAt: string | null;
  busyRevisionId: string | null;
  canRestoreMenu: boolean;
  onClose: () => void;
  onRestore: (revision: RevisionEntry) => Promise<void>;
}) {
  const [tab, setTab] = useState<"snapshots" | "activity">("snapshots");

  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-5xl w-full max-h-[92vh] overflow-y-auto">
        <div className="px-5 py-4 flex items-center justify-between border-b border-stone-200">
          <div>
            <div className="display text-xl">Restore History</div>
            <div className="text-xs font-black tracking-widest opacity-50 mt-1">
              Choose a saved menu snapshot to restore, or review the activity
              log.
            </div>
          </div>
          <button onClick={onClose} className="text-sm font-bold opacity-60">
            CLOSE
          </button>
        </div>

        <div className="px-5 pt-4">
          <div className="inline-flex rounded-xl border border-stone-200 bg-stone-100 p-1">
            <button
              onClick={() => setTab("snapshots")}
              className="px-4 py-2 rounded-lg text-xs font-black tracking-widest"
              style={{
                background: tab === "snapshots" ? "white" : "transparent",
                color: BRAND.black,
              }}
            >
              SNAPSHOTS
            </button>
            <button
              onClick={() => setTab("activity")}
              className="px-4 py-2 rounded-lg text-xs font-black tracking-widest"
              style={{
                background: tab === "activity" ? "white" : "transparent",
                color: BRAND.black,
              }}
            >
              ACTIVITY
            </button>
          </div>
        </div>

        <div className="p-5 space-y-3">
          {tab === "snapshots" ? (
            revisions.length === 0 ? (
              <div className="rounded-xl border border-stone-200 bg-stone-50 p-6 text-sm opacity-60">
                No restore history recorded yet.
              </div>
            ) : (
              revisions.map((revision) => {
                const isCurrentLiveSnapshot =
                  revision.id === currentLiveRevisionId;
                const isCurrentBecauseRestored =
                  isCurrentLiveSnapshot && !!currentLiveRestoredAt;

                return (
                  <div
                    key={revision.id}
                    className="rounded-xl border border-stone-100 bg-stone-50 px-4 py-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2 text-sm font-black">
                          <span>
                            Full Menu Snapshot · #{revision.id.slice(-6)}
                          </span>
                          {isCurrentLiveSnapshot && (
                            <span
                              className="px-2 py-1 rounded-full text-[10px] font-black tracking-widest"
                              style={{
                                background: "#D7F5DA",
                                color: "#20552A",
                              }}
                            >
                              CURRENT LIVE MENU
                            </span>
                          )}
                        </div>
                        <div className="text-xs font-bold opacity-70 mt-2">
                          {describeRevisionReason(revision)}
                        </div>
                        <div className="text-xs opacity-60 mt-1">
                          {formatTimestamp(revision.createdAt)}
                          {revision.actorIdentity
                            ? ` · ${revision.actorIdentity}`
                            : ""}
                        </div>
                      </div>
                      {canRestoreMenu && (
                        <button
                          onClick={() => onRestore(revision)}
                          disabled={
                            busyRevisionId === revision.id ||
                            isCurrentLiveSnapshot
                          }
                          className="px-4 py-3 rounded-md text-[11px] font-black tracking-widest disabled:opacity-40"
                          style={{ background: BRAND.red, color: "white" }}
                        >
                          {isCurrentLiveSnapshot
                            ? "LIVE NOW"
                            : busyRevisionId === revision.id
                              ? "RESTORING..."
                              : "RESTORE MENU"}
                        </button>
                      )}
                    </div>
                    <div className="text-xs opacity-70 mt-3">
                      {revision.summary.categoryCount} categories ·{" "}
                      {revision.summary.liveCategoryCount}/
                      {revision.summary.categoryCount} live categories ·{" "}
                      {revision.summary.liveItemCount}/
                      {revision.summary.itemCount} live items
                    </div>
                    {isCurrentLiveSnapshot && (
                      <div className="text-[11px] font-bold opacity-60 mt-2">
                        {isCurrentBecauseRestored
                          ? `This snapshot currently matches the live menu because it was restored at ${formatTimestamp(
                              currentLiveRestoredAt!,
                            )}.`
                          : "This snapshot currently matches the live menu."}
                      </div>
                    )}
                  </div>
                );
              })
            )
          ) : auditLogs.length === 0 ? (
            <div className="rounded-xl border border-stone-200 bg-stone-50 p-6 text-sm opacity-60">
              No menu changes recorded yet.
            </div>
          ) : (
            auditLogs.map((entry) => (
              <div
                key={entry.id}
                className="rounded-xl border border-stone-100 bg-stone-50 px-4 py-4"
              >
                <div className="text-sm font-black">
                  {formatHistoryLabel(entry.actionType)}
                  {entry.targetLabel ? ` · ${entry.targetLabel}` : ""}
                </div>
                <div className="text-xs opacity-60 mt-1">
                  {formatTimestamp(entry.createdAt)} ·{" "}
                  {entry.actorIdentity ?? entry.actorType}
                </div>
                <div className="text-[11px] font-bold opacity-60 mt-2">
                  {entry.targetType}
                  {entry.targetId ? ` · ${entry.targetId.slice(-6)}` : ""}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function DealBasePickerModal({
  dealsCategory,
  allItems,
  categories,
  dealHistoryEntries,
  onPick,
  onCancel,
}: {
  dealsCategory: Cat;
  allItems: Item[];
  categories: Cat[];
  dealHistoryEntries: DealHistoryEntry[];
  onPick: (base: Item, historySnapshot?: MenuItemSnapshot) => void;
  onCancel: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [includeHiddenItems, setIncludeHiddenItems] = useState(false);
  const trimmedQuery = searchQuery.trim().toLowerCase();
  const categoryById = new Map(
    categories.map((category) => [category.id, category]),
  );

  const filtered = allItems.filter((item) => {
    if (item.categoryId === dealsCategory.id) return false;
    if (!includeHiddenItems && !item.isActive) return false;
    if (!trimmedQuery) return true;
    return (
      item.name.toLowerCase().includes(trimmedQuery) ||
      item.description.toLowerCase().includes(trimmedQuery) ||
      (item.badge ?? "").toLowerCase().includes(trimmedQuery)
    );
  });

  const grouped: Map<string, Item[]> = new Map();
  for (const item of filtered) {
    const list = grouped.get(item.categoryId) ?? [];
    list.push(item);
    grouped.set(item.categoryId, list);
  }

  const selectedItem =
    selectedItemId != null
      ? (allItems.find((item) => item.id === selectedItemId) ?? null)
      : null;
  const selectedSavedSetups = selectedItem
    ? dealHistoryEntries.filter(
        (entry) =>
          dealMatchKey(entry.dealSnapshot.name) ===
            dealMatchKey(selectedItem.name) &&
          entry.dealSnapshot.upgradeOptions.some(
            (upgrade) => upgrade.linkedItems.length > 0,
          ),
      )
    : [];
  const latestSavedSetup = selectedSavedSetups[0] ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-200 flex items-start justify-between shrink-0">
          <div>
            <div className="display text-lg leading-tight">
              Choose base item for this deal
            </div>
            <div className="text-[10px] opacity-60 mt-0.5">
              Pick one existing menu item to prefill the new deal.
            </div>
          </div>
          <button
            onClick={onCancel}
            className="text-xs font-black tracking-widest opacity-70 hover:opacity-100"
            aria-label="Cancel"
          >
            CANCEL ✕
          </button>
        </div>

        <div className="px-5 py-3 border-b border-stone-200 shrink-0">
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search base items..."
            className="border border-stone-300 rounded-md px-3 py-2 w-full text-sm"
          />
          <label className="mt-2 flex items-center gap-2 text-[10px] font-black tracking-widest text-stone-600">
            <input
              type="checkbox"
              checked={includeHiddenItems}
              onChange={(event) => setIncludeHiddenItems(event.target.checked)}
            />
            Include hidden base items for repair
          </label>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-5">
          {categories
            .filter((category) => grouped.has(category.id))
            .map((category) => {
              const itemsInCategory = (grouped.get(category.id) ?? []).sort(
                compareItemsByOrder,
              );
              return (
                <div key={category.id}>
                  <div className="text-xs font-black tracking-widest opacity-60 mb-2">
                    {category.icon} {category.name.toUpperCase()}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {itemsInCategory.map((item) => {
                      const selected = selectedItemId === item.id;
                      const categoryLabel =
                        categoryById.get(item.categoryId)?.name ??
                        "Unknown category";
                      const stockLabel = !item.isActive
                        ? "Hidden"
                        : !isMenuItemAvailable(item)
                          ? "Out of stock"
                          : "In stock";
                      return (
                        <button
                          key={item.id}
                          onClick={() => setSelectedItemId(item.id)}
                          className={`w-full flex items-center gap-2 border rounded-md px-3 py-2 text-left transition ${
                            selected
                              ? "border-2 border-black bg-yellow-50"
                              : "border-stone-300 hover:bg-stone-50"
                          }`}
                        >
                          <div
                            className="w-8 h-8 rounded-md flex items-center justify-center text-base flex-shrink-0"
                            style={{ background: item.bgColor }}
                          >
                            {item.emoji}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-bold truncate">
                              {item.name}
                              {selected && <span className="ml-1">✓</span>}
                            </div>
                            <div className="text-[10px] mono opacity-60">
                              {fmt(item.price)}
                              {` · ${categoryLabel}`}
                              {` · ${stockLabel}`}
                              {item.sizes.length > 0 &&
                                ` · ${item.sizes.length} size${
                                  item.sizes.length === 1 ? "" : "s"
                                }`}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          {filtered.length === 0 && (
            <div className="text-sm opacity-60 italic">
              No base items found.
            </div>
          )}
        </div>

        <div className="border-t border-stone-200 px-5 py-3 bg-white shrink-0">
          <div className="space-y-3">
            {selectedItem && latestSavedSetup && (
              <div className="rounded-lg border-2 border-yellow-300 bg-yellow-50 px-4 py-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-[10px] font-black tracking-widest text-yellow-900">
                      SAVED SETUP FOUND
                    </div>
                    <div className="mt-1 text-xs font-bold leading-snug text-yellow-950">
                      {historyIncludedItems(latestSavedSetup.dealSnapshot)}
                    </div>
                    <div className="mt-1 text-[10px] font-bold opacity-60">
                      Last changed:{" "}
                      {formatTimestamp(latestSavedSetup.lastChangedAt)}
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      onPick(selectedItem, latestSavedSetup.dealSnapshot)
                    }
                    className="shrink-0 rounded-md px-4 py-2 text-xs font-black tracking-widest"
                    style={{ background: BRAND.black, color: "white" }}
                  >
                    USE SAVED SETUP
                  </button>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-bold opacity-60">
                {selectedItem ? selectedItem.name : "No base item selected"}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={onCancel}
                  className="px-4 py-2 rounded-md text-xs font-black tracking-widest border border-stone-300"
                >
                  CANCEL
                </button>
                <button
                  onClick={() => selectedItem && onPick(selectedItem)}
                  disabled={!selectedItem}
                  className="px-4 py-2 rounded-md text-xs font-black tracking-widest disabled:opacity-40"
                  style={{ background: BRAND.red, color: "white" }}
                >
                  USE BASE ITEM
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ItemModal({
  item,
  isNew,
  categories,
  allItems,
  allCategories,
  initialDealBaseItem,
  saving,
  busyDeleting,
  allowedImageHosts,
  allowPasteUrl,
  storageConfigured,
  storageDisabledReason,
  dealDefaultDiscountPct,
  onSave,
  onCancel,
  onDelete,
  onStockToggle,
  onHardDelete,
}: {
  item: Item;
  isNew: boolean;
  categories: Cat[];
  allItems: Item[];
  allCategories: Cat[];
  initialDealBaseItem: Item | null;
  saving: boolean;
  busyDeleting: boolean;
  allowedImageHosts: string[];
  allowPasteUrl: boolean;
  storageConfigured: boolean;
  storageDisabledReason: string | null;
  dealDefaultDiscountPct: number | null;
  onSave: (next: Item, pending: PendingHeroState) => Promise<void>;
  onCancel: () => void;
  onDelete: () => Promise<void>;
  onStockToggle: () => Promise<void>;
  onHardDelete: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Item>(item);
  const [imageError, setImageError] = useState<string | null>(null);
  const [heroPasteUrlDraft, setHeroPasteUrlDraft] = useState<string>("");
  const [cardPasteUrlDraft, setCardPasteUrlDraft] = useState<string>("");
  const [pendingHeroFile, setPendingHeroFile] = useState<File | null>(null);
  const [heroPreviewUrl, setHeroPreviewUrl] = useState<string | null>(null);
  const [removeHero, setRemoveHero] = useState(false);
  const [dealBaseItem, setDealBaseItem] = useState<Item | null>(
    initialDealBaseItem,
  );
  const [changingDealBase, setChangingDealBase] = useState(false);
  const [visibilityTouched, setVisibilityTouched] = useState(false);
  const linkClassificationContext = useMemo(
    () => buildLinkClassificationContext(allItems, allCategories),
    [allItems, allCategories],
  );
  const [initialDealHadCustomerAvailableUpgrade] = useState(() =>
    dealHasCustomerAvailableUpgrade(item, linkClassificationContext),
  );
  const [initialDealBlockedByExpiration] = useState(() => {
    if (!item.dealExpiresAt) return true;
    const expiresAt = new Date(item.dealExpiresAt).getTime();
    return !Number.isFinite(expiresAt) || expiresAt <= Date.now();
  });
  const upgradeOptionsAllowed = allowsUpgradeOptions(
    allCategories,
    draft.categoryId,
  );
  const dealCategory = allCategories.find(
    (category) => category.id === draft.categoryId,
  );
  const editingDeal = !!dealCategory && isDealsCategory(dealCategory);
  const saveDraft: Item = upgradeOptionsAllowed
    ? draft
    : { ...draft, upgradeOptions: [] };
  const validation = validateItemInput(saveDraft, { allowedImageHosts });
  const itemNoun = editingDeal ? "DEAL" : "ITEM";
  const showHardDelete = !isNew && (editingDeal || !item.isActive);
  const dealExpirationError =
    editingDeal && !draft.dealExpiresAt ? "Deal expiration is required" : null;
  const dealBaseError =
    editingDeal && !draft.dealBaseMenuItemId
      ? "Deal base item is required"
      : null;
  const dealBaseRepairError = editingDeal
    ? dealBaseStructuralRepairReason(draft, linkClassificationContext)
    : null;
  const dealRepairError = editingDeal
    ? dealStructuralRepairReason(draft, linkClassificationContext)
    : null;
  const dealBaseAvailability = editingDeal
    ? dealBaseAvailabilityReason(draft, linkClassificationContext)
    : null;
  const displayedDealBaseCategory = dealBaseItem
    ? categoryNameForItem(dealBaseItem, linkClassificationContext)
    : null;
  const displayedDealBaseStatus = dealBaseItem
    ? !dealBaseItem.isActive
      ? "Hidden"
      : !isMenuItemAvailable(dealBaseItem)
        ? "Out of stock"
        : "In stock"
    : null;
  const canSave =
    !saving &&
    !busyDeleting &&
    !validation.error &&
    !dealExpirationError &&
    !dealBaseError &&
    !dealRepairError;

  // Revoke the outstanding blob URL if the modal unmounts without going
  // through Cancel or SAVE (e.g. route change, error boundary). Keyed on the
  // URL so a new preview during the same modal session cleans up its
  // predecessor.
  useEffect(() => {
    if (!heroPreviewUrl) return;
    return () => URL.revokeObjectURL(heroPreviewUrl);
  }, [heroPreviewUrl]);

  useEffect(() => {
    setDealBaseItem(initialDealBaseItem);
  }, [initialDealBaseItem]);

  // Preview-only projection — never validated, never sent to the server. The
  // blob URL lives here so `draft.imageUrl` stays as the server-managed URL
  // (or null). Nulling the card fields matches the hero-only rendering model
  // even for items that still carry legacy card-image values in `draft`.
  const previewItem: Item = {
    ...draft,
    imageUrl: removeHero ? null : (heroPreviewUrl ?? draft.imageUrl),
    imageAlt: removeHero ? null : draft.imageAlt,
    cardImageUrl: null,
    cardImageAlt: null,
  };

  // Upload needs working storage. Staging is local-only, so it's safe even
  // for new items that don't have a row yet — the multipart POST creates the
  // row and uploads the file together.
  const uploadDisabled = !storageConfigured;
  const nonUploadDisabled = false;
  const imageDisabledReason = !storageConfigured
    ? (storageDisabledReason ??
      "Image upload is disabled — storage is not configured.")
    : null;

  const handleImageUpload = (file: File) => {
    setImageError(null);

    const contentType = file.type.toLowerCase();
    if (
      !(ACCEPTED_IMAGE_CONTENT_TYPES as readonly string[]).includes(contentType)
    ) {
      setImageError(
        `Image must be one of ${ACCEPTED_IMAGE_CONTENT_TYPES.join(", ")}`,
      );
      return;
    }
    if (file.size <= 0 || file.size > MAX_IMAGE_UPLOAD_BYTES) {
      setImageError(
        `Image must be between 1 and ${MAX_IMAGE_UPLOAD_BYTES} bytes`,
      );
      return;
    }

    // Revoke the previous preview before creating a new one so a rapid
    // re-pick doesn't leak a blob URL.
    if (heroPreviewUrl) {
      URL.revokeObjectURL(heroPreviewUrl);
    }
    setHeroPreviewUrl(URL.createObjectURL(file));
    setPendingHeroFile(file);
    setRemoveHero(false);
    // Do not touch draft.imageUrl / draft.imageFit — the operator's dropdown
    // is the sole authority for fit, and the server-managed URL in draft
    // keeps validateItemInput/canSave honest.
  };

  const handleImageRemove = () => {
    setImageError(null);
    if (heroPreviewUrl) {
      URL.revokeObjectURL(heroPreviewUrl);
    }
    setHeroPreviewUrl(null);
    setPendingHeroFile(null);
    setRemoveHero(true);
  };

  const applyPasteUrl = (target: "hero" | "card") => {
    if (!allowPasteUrl) return;
    setImageError(null);
    const trimmed =
      target === "card" ? cardPasteUrlDraft.trim() : heroPasteUrlDraft.trim();
    if (!trimmed) {
      setDraft((prev) =>
        target === "card"
          ? { ...prev, cardImageUrl: null }
          : { ...prev, imageUrl: null },
      );
      if (target === "card") {
        setCardPasteUrlDraft("");
      } else {
        setHeroPasteUrlDraft("");
      }
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      setImageError("Pasted URL is not a valid URL");
      return;
    }
    if (parsed.protocol !== "https:") {
      setImageError("Pasted URL must use https");
      return;
    }
    if (!allowedImageHosts.includes(parsed.host.toLowerCase())) {
      setImageError("Pasted URL host is not on the allowlist");
      return;
    }
    setDraft((prev) =>
      target === "card"
        ? { ...prev, cardImageUrl: trimmed }
        : { ...prev, imageUrl: trimmed },
    );
    if (target === "card") {
      setCardPasteUrlDraft("");
    } else {
      setHeroPasteUrlDraft("");
    }
  };

  const chooseDealBase = (base: Item) => {
    if (heroPreviewUrl) {
      URL.revokeObjectURL(heroPreviewUrl);
    }
    setHeroPreviewUrl(null);
    setPendingHeroFile(null);
    setRemoveHero(false);
    setHeroPasteUrlDraft("");
    setCardPasteUrlDraft("");
    setDealBaseItem(base);
    setDraft((prev) => applyBaseItemToDealDraft(prev, base));
    setChangingDealBase(false);
  };

  const setDraftUpgradeOptions = (upgradeOptions: Upgrade[]) => {
    setDraft((prev) => {
      const next = { ...prev, upgradeOptions };
      if (
        editingDeal &&
        !visibilityTouched &&
        !prev.isActive &&
        !initialDealHadCustomerAvailableUpgrade &&
        dealHasCustomerAvailableUpgrade(next, linkClassificationContext)
      ) {
        return { ...next, isActive: true };
      }
      return next;
    });
  };

  const setDraftDealExpiration = (value: string) => {
    const dealExpiresAt = fromExpirationDateInputValue(value);
    setDraft((prev) => {
      const next = { ...prev, dealExpiresAt };
      if (
        editingDeal &&
        !visibilityTouched &&
        !prev.isActive &&
        initialDealBlockedByExpiration &&
        dealExpiresAt != null &&
        dealHasCustomerAvailableUpgrade(prev, linkClassificationContext)
      ) {
        return { ...next, isActive: true };
      }
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[92vh] overflow-hidden flex flex-col">
        <div className="px-5 py-4 flex items-center justify-between border-b border-stone-200 shrink-0">
          <div>
            <div className="display text-xl">
              {isNew
                ? editingDeal
                  ? "New deal"
                  : "New item"
                : editingDeal
                  ? "Edit deal"
                  : "Edit item"}{" "}
              · <span className="opacity-60">{draft.name || "—"}</span>
            </div>
            <div className="text-xs font-black tracking-widest opacity-50 mt-1">
              {editingDeal
                ? "Configure pricing, bundled items, visibility, and sort order."
                : "Configure pricing, add-ons, visibility, and sort order."}
            </div>
          </div>
          <button onClick={onCancel} className="text-sm font-bold opacity-60">
            CLOSE
          </button>
        </div>

        <div className="p-5 grid md:grid-cols-2 gap-4 overflow-y-auto overscroll-contain min-h-0 flex-1">
          {editingDeal && (
            <Field label="Base menu item" full>
              <div
                className={`rounded-xl border p-3 flex items-center justify-between gap-3 ${
                  dealBaseRepairError
                    ? "border-red-300 bg-red-50"
                    : dealBaseAvailability
                      ? "border-amber-300 bg-amber-50"
                      : "border-stone-200 bg-stone-50"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
                    style={{
                      background: dealBaseItem?.bgColor ?? draft.bgColor,
                    }}
                  >
                    {dealBaseItem?.emoji ?? draft.emoji}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-black tracking-widest opacity-60">
                      {isNew && dealBaseItem
                        ? "THIS DEAL WAS PREFILLED FROM"
                        : "USE AN EXISTING ITEM AS THIS DEAL'S BASE"}
                    </div>
                    <div className="text-sm font-black truncate">
                      {dealBaseItem?.name ||
                        draft.name ||
                        "No base item selected"}
                    </div>
                    <div className="text-xs mono opacity-60">
                      {fmt(dealBaseItem?.price ?? draft.price)}
                      {displayedDealBaseCategory &&
                        ` · ${displayedDealBaseCategory}`}
                      {displayedDealBaseStatus &&
                        ` · ${displayedDealBaseStatus}`}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setChangingDealBase(true)}
                  className="shrink-0 rounded-md border border-stone-300 px-3 py-2 text-xs font-black tracking-widest hover:bg-white"
                >
                  CHANGE BASE ITEM
                </button>
              </div>
              <div className="text-xs opacity-60 mt-2">
                Changing the base replaces the deal name, description, price,
                emoji, color, and images. Combo number, sort order, and deal
                settings stay intact.
              </div>
              {dealBaseRepairError && (
                <div className="mt-2 text-xs font-bold text-red-700">
                  {dealBaseRepairError}. Choose the real non-deal menu item
                  behind this deal before saving.
                </div>
              )}
              {!dealBaseRepairError && dealBaseAvailability && (
                <div className="mt-2 text-xs font-bold text-amber-800">
                  {dealBaseAvailability}. The deal stays hidden until the base
                  item is available again.
                </div>
              )}
            </Field>
          )}

          <Field label="Category">
            <select
              value={draft.categoryId}
              onChange={(e) => {
                const categoryId = e.target.value;
                setDraft((prev) => ({
                  ...prev,
                  categoryId,
                  upgradeOptions: allowsUpgradeOptions(
                    allCategories,
                    categoryId,
                  )
                    ? prev.upgradeOptions
                    : [],
                }));
              }}
              className="border border-stone-300 rounded-md px-3 py-2 w-full text-sm"
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.icon} {category.name}
                  {category.isActive ? "" : " (hidden)"}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Name">
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="border border-stone-300 rounded-md px-3 py-2 w-full text-sm"
            />
          </Field>

          {changingDealBase && dealCategory && (
            <DealBasePickerModal
              dealsCategory={dealCategory}
              allItems={allItems}
              categories={allCategories}
              dealHistoryEntries={[]}
              onCancel={() => setChangingDealBase(false)}
              onPick={chooseDealBase}
            />
          )}

          <Field label="Description" full>
            <textarea
              value={draft.description}
              onChange={(e) =>
                setDraft({ ...draft, description: e.target.value })
              }
              rows={3}
              className="border border-stone-300 rounded-md px-3 py-2 w-full text-sm"
            />
          </Field>

          <Field label="Base price">
            <input
              type="number"
              step="0.01"
              min="0"
              value={draft.price}
              onChange={(e) =>
                setDraft({ ...draft, price: Number(e.target.value) })
              }
              className="border border-stone-300 rounded-md px-3 py-2 w-full text-sm mono"
            />
          </Field>

          {!editingDeal && (
            <Field label="Combo number">
              <input
                type="number"
                min="1"
                value={draft.comboNum ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    comboNum:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                className="border border-stone-300 rounded-md px-3 py-2 w-full text-sm mono"
              />
            </Field>
          )}

          <Field label="Emoji">
            <input
              value={draft.emoji}
              onChange={(e) => setDraft({ ...draft, emoji: e.target.value })}
              className="border border-stone-300 rounded-md px-3 py-2 w-full text-sm"
            />
          </Field>

          <Field label="Background color">
            <div className="flex gap-2 items-center">
              <input
                type="color"
                value={draft.bgColor}
                onChange={(e) =>
                  setDraft({ ...draft, bgColor: e.target.value.toLowerCase() })
                }
                className="w-11 h-10 rounded"
              />
              <input
                value={draft.bgColor}
                onChange={(e) =>
                  setDraft({ ...draft, bgColor: e.target.value })
                }
                className="border border-stone-300 rounded-md px-3 py-2 text-sm mono flex-1"
              />
            </div>
          </Field>

          <Field label="Product image" full asLabel={false}>
            <div className="space-y-3">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                  <div className="text-[11px] font-black tracking-widest opacity-60 mb-3">
                    MENU CARD
                  </div>
                  <div className="relative overflow-hidden rounded-2xl border border-stone-200 bg-white">
                    {draft.badge && (
                      <div className="absolute top-3 left-3 z-10">
                        <BadgeChip
                          badge={
                            draft.badge as (typeof ADMIN_MENU_BADGES)[number]
                          }
                        />
                      </div>
                    )}
                    {draft.comboNum != null && (
                      <div
                        className="absolute top-3 right-3 z-10 display text-2xl px-3 py-1 rounded-lg"
                        style={{ background: BRAND.black, color: BRAND.yellow }}
                      >
                        #{draft.comboNum}
                      </div>
                    )}
                    <div className="relative h-40 overflow-hidden">
                      <ItemVisual item={previewItem} size="card" />
                    </div>
                    <div className="p-4">
                      <div className="display text-xl mb-1 leading-tight">
                        {draft.name || "Unnamed item"}
                      </div>
                      <div className="text-xs opacity-60 mb-3 line-clamp-2 min-h-[32px]">
                        {draft.description ||
                          "Description will appear on the kiosk here."}
                      </div>
                      <div className="flex items-end justify-between">
                        <div>
                          {draft.bundleSavings != null && (
                            <div className="text-[10px] font-black tracking-widest line-through opacity-40">
                              Save {fmt(draft.bundleSavings)}
                            </div>
                          )}
                          <div
                            className="display text-2xl"
                            style={{ color: BRAND.red }}
                          >
                            {fmt(draft.price || 0)}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 space-y-3">
                  <div className="text-[11px] font-black tracking-widest opacity-60">
                    CUSTOMIZE HERO IMAGE
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {previewItem.imageUrl && (
                      <div className="relative w-24 h-24 rounded-xl overflow-hidden border border-stone-200 bg-white">
                        <ItemVisual item={previewItem} size="hero" />
                      </div>
                    )}
                    <div className="flex flex-col gap-2">
                      <label
                        className={`inline-flex items-center gap-2 px-3 py-2 rounded-md text-xs font-black tracking-widest ${
                          uploadDisabled
                            ? "bg-stone-200 text-stone-500 cursor-not-allowed"
                            : "bg-stone-900 text-white cursor-pointer"
                        }`}
                      >
                        {previewItem.imageUrl
                          ? "REPLACE HERO IMAGE"
                          : "UPLOAD HERO IMAGE"}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          disabled={uploadDisabled}
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleImageUpload(file);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      {previewItem.imageUrl && (
                        <button
                          type="button"
                          disabled={nonUploadDisabled}
                          onClick={() => handleImageRemove()}
                          className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-xs font-black tracking-widest bg-stone-100 text-stone-700 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          REMOVE HERO IMAGE
                        </button>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-black tracking-widest opacity-60 mb-1">
                      MENU CARD DISPLAY
                    </div>
                    <select
                      value={draft.imageFit}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          imageFit:
                            e.target.value === "CONTAIN" ? "CONTAIN" : "COVER",
                        })
                      }
                      className="border border-stone-300 rounded-md px-3 py-2 w-full text-sm"
                    >
                      {ADMIN_IMAGE_FITS.map((fit) => (
                        <option key={fit} value={fit}>
                          {fit === "COVER"
                            ? "The menu card · fill frame"
                            : "The menu card · fit inside frame"}
                        </option>
                      ))}
                    </select>
                    <div className="text-xs opacity-60 mt-1">
                      This hero image is reused on the menu card. Choose “fit
                      inside frame” for PNG illustrations or sticker-style art.
                      Keep “fill frame” for real food photos.
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-black tracking-widest opacity-60 mb-1">
                      HERO IMAGE ALT (optional)
                    </div>
                    <input
                      value={draft.imageAlt ?? ""}
                      onChange={(e) =>
                        setDraft({ ...draft, imageAlt: e.target.value })
                      }
                      maxLength={200}
                      placeholder="Shown to screen-readers. Defaults to item name if blank."
                      className="border border-stone-300 rounded-md px-3 py-2 w-full text-sm"
                    />
                  </div>
                  {allowPasteUrl && (
                    <div>
                      <div className="text-[11px] font-black tracking-widest opacity-60 mb-1">
                        PASTE HERO IMAGE URL
                      </div>
                      <div className="flex gap-2">
                        <input
                          value={heroPasteUrlDraft}
                          onChange={(e) => setHeroPasteUrlDraft(e.target.value)}
                          placeholder="https://allowlisted-host.example.com/photo.webp"
                          className="border border-stone-300 rounded-md px-3 py-2 flex-1 text-sm mono"
                          disabled={nonUploadDisabled}
                        />
                        <button
                          type="button"
                          onClick={() => applyPasteUrl("hero")}
                          disabled={
                            nonUploadDisabled || !heroPasteUrlDraft.trim()
                          }
                          className="px-3 py-2 rounded-md text-xs font-black tracking-widest bg-stone-900 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          APPLY
                        </button>
                      </div>
                      <div className="text-[11px] opacity-60 mt-1">
                        Must be https and on the allowlisted host list. Saves on
                        next SAVE ITEM.
                      </div>
                    </div>
                  )}
                  <div className="text-xs opacity-60">
                    {modifierSummary(saveDraft, editingDeal)}
                  </div>
                </div>
              </div>
              {imageDisabledReason && (
                <div className="text-xs opacity-70">{imageDisabledReason}</div>
              )}
              {imageError && (
                <div className="text-xs font-bold text-red-700">
                  {imageError}
                </div>
              )}
            </div>
          </Field>

          <Field label="Badge">
            <select
              value={draft.badge ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  badge: e.target.value === "" ? null : e.target.value,
                })
              }
              className="border border-stone-300 rounded-md px-3 py-2 w-full text-sm"
            >
              <option value="">— none —</option>
              {ADMIN_MENU_BADGES.map((badge) => (
                <option key={badge} value={badge}>
                  {badge}
                </option>
              ))}
            </select>
          </Field>

          <Field label="BUNDLE SAVINGS (optional)">
            <input
              type="number"
              step="0.01"
              min="0"
              value={draft.bundleSavings ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  bundleSavings:
                    e.target.value === "" ? null : Number(e.target.value),
                })
              }
              className="border border-stone-300 rounded-md px-3 py-2 w-full text-sm mono"
            />
            <p className="text-[10px] tracking-wide opacity-60 mt-1 leading-snug">
              Shown as &ldquo;Save $X&rdquo; on the menu tile, struck-through
              next to the price. Does not affect checkout total.
            </p>
          </Field>

          {!editingDeal && (
            <Field label="Sort order">
              <input
                type="number"
                min="0"
                value={draft.sortOrder}
                onChange={(e) =>
                  setDraft({ ...draft, sortOrder: Number(e.target.value) })
                }
                className="border border-stone-300 rounded-md px-3 py-2 w-full text-sm mono"
              />
            </Field>
          )}

          <Field label="Live on kiosk" full>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-bold">
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={(e) => {
                    setVisibilityTouched(true);
                    setDraft({ ...draft, isActive: e.target.checked });
                  }}
                />
                Visible to customers
              </label>
              {!editingDeal && (
                <>
                  <label className="flex items-center gap-2 text-sm font-bold">
                    <input
                      type="checkbox"
                      checked={draft.isOutOfStock}
                      onChange={(e) =>
                        setDraft({ ...draft, isOutOfStock: e.target.checked })
                      }
                    />
                    Out of stock
                  </label>
                  <div className="text-xs opacity-60">
                    Out-of-stock items stay visible on the kiosk with an OUT OF
                    STOCK badge, but customers cannot add them to an order.
                  </div>
                </>
              )}
              {editingDeal && (
                <div className="text-xs opacity-60">
                  Deals are shown or hidden automatically based on expiration
                  and whether at least one included item is currently available
                  to customers.
                </div>
              )}
            </div>
          </Field>

          {editingDeal && (
            <Field label="Deal expiration" full>
              <input
                type="date"
                value={toExpirationDateInputValue(draft.dealExpiresAt)}
                onChange={(e) => setDraftDealExpiration(e.target.value)}
                className={`rounded-md px-3 py-2 w-full text-sm mono ${
                  dealExpirationError
                    ? "border-2 border-red-400 bg-red-50"
                    : "border border-stone-300"
                }`}
              />
              <p className="text-[10px] tracking-wide opacity-60 mt-1 leading-snug">
                Required for deals. The deal is available through this date,
                then customers stop seeing it and the admin table shows HIDDEN /
                Expired.
              </p>
            </Field>
          )}

          <ModList
            title="Sizes"
            rows={draft.sizes}
            onChange={(sizes) => setDraft({ ...draft, sizes })}
          />

          <ModList
            title="Add-ons"
            rows={draft.addons}
            onChange={(addons) => setDraft({ ...draft, addons })}
          />

          {upgradeOptionsAllowed && (
            <UpgradeOptionsList
              rows={draft.upgradeOptions}
              parentItemId={item.id}
              parentItemName={draft.name}
              allItems={allItems}
              categories={allCategories}
              editingDeal={editingDeal}
              dealDefaultDiscountPct={dealDefaultDiscountPct}
              classificationContext={linkClassificationContext}
              onChange={setDraftUpgradeOptions}
            />
          )}
        </div>

        <div className="px-5 py-4 border-t border-stone-200 bg-stone-50 flex flex-col gap-3 md:flex-row md:items-center md:justify-between shrink-0">
          <div>
            {!isNew && (
              <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <button
                  onClick={onDelete}
                  disabled={saving || busyDeleting}
                  className="text-xs font-black tracking-widest disabled:opacity-40"
                  style={{ color: BRAND.red }}
                >
                  {item.isActive ? `HIDE ${itemNoun}` : `UNHIDE ${itemNoun}`}
                </button>
                {item.isActive && !editingDeal && (
                  <button
                    onClick={onStockToggle}
                    disabled={saving || busyDeleting}
                    className="text-xs font-black tracking-widest disabled:opacity-40"
                    style={{ color: item.isOutOfStock ? "#20552A" : BRAND.red }}
                  >
                    {item.isOutOfStock ? "MARK IN STOCK" : "MARK OUT OF STOCK"}
                  </button>
                )}
                {showHardDelete && (
                  <button
                    onClick={onHardDelete}
                    disabled={saving || busyDeleting}
                    className="text-xs font-black tracking-widest disabled:opacity-40"
                    style={{ color: BRAND.red }}
                  >
                    DELETE {itemNoun}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 md:items-end">
            {(validation.error ||
              dealExpirationError ||
              dealBaseError ||
              dealRepairError) && (
              <div className="text-xs font-bold text-red-700">
                {validation.error ??
                  dealExpirationError ??
                  dealBaseError ??
                  dealRepairError}
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={onCancel}
                disabled={saving || busyDeleting}
                className="px-4 py-2 rounded-md text-xs font-black tracking-widest bg-white border border-stone-300 disabled:opacity-40"
              >
                CANCEL
              </button>
              <button
                onClick={() =>
                  onSave(saveDraft, {
                    heroFile: pendingHeroFile,
                    removeHero,
                  })
                }
                disabled={!canSave}
                className="px-5 py-2 rounded-md text-xs font-black tracking-widest disabled:opacity-40"
                style={{ background: BRAND.red, color: "white" }}
              >
                {saving ? "SAVING..." : "SAVE ITEM"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CategoryModal({
  category,
  isNew,
  assignedItemCount,
  saving,
  onSave,
  onCancel,
  onDelete,
}: {
  category: CategoryDraft;
  isNew: boolean;
  assignedItemCount: number;
  saving: boolean;
  onSave: (next: CategoryDraft) => Promise<void>;
  onCancel: () => void;
  onDelete: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<CategoryDraft>(category);
  const validation = validateCategoryInput(draft);

  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-xl w-full">
        <div className="px-5 py-4 flex items-center justify-between border-b border-stone-200">
          <div>
            <div className="display text-xl">
              {isNew ? "New category" : "Edit category"} ·{" "}
              <span className="opacity-60">{draft.name || "—"}</span>
            </div>
            <div className="text-xs font-black tracking-widest opacity-50 mt-1">
              Categories control the kiosk tabs and grouping order.
            </div>
          </div>
          <button onClick={onCancel} className="text-sm font-bold opacity-60">
            CLOSE
          </button>
        </div>

        <div className="p-5 grid md:grid-cols-2 gap-4">
          <Field label="Name">
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="border border-stone-300 rounded-md px-3 py-2 w-full text-sm"
            />
          </Field>

          <Field label="Icon">
            <input
              value={draft.icon}
              onChange={(e) => setDraft({ ...draft, icon: e.target.value })}
              className="border border-stone-300 rounded-md px-3 py-2 w-full text-sm"
            />
          </Field>

          <Field label="Slug">
            <input
              value={draft.slug}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  slug: normalizeCategorySlug(e.target.value),
                })
              }
              className="border border-stone-300 rounded-md px-3 py-2 w-full text-sm mono"
            />
          </Field>

          <Field label="Sort order">
            <input
              type="number"
              min="0"
              value={draft.sortOrder}
              onChange={(e) =>
                setDraft({ ...draft, sortOrder: Number(e.target.value) })
              }
              className="border border-stone-300 rounded-md px-3 py-2 w-full text-sm mono"
            />
          </Field>

          <Field label="Live on kiosk" full>
            <label className="flex items-center gap-2 text-sm font-bold">
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(e) =>
                  setDraft({ ...draft, isActive: e.target.checked })
                }
              />
              Show this category on the kiosk
            </label>
          </Field>

          <div className="md:col-span-2 rounded-xl border border-stone-200 bg-stone-50 p-4">
            <div className="text-xs font-black tracking-widest opacity-60 mb-2">
              CATEGORY STATUS
            </div>
            <div className="text-sm font-bold">
              {assignedItemCount} assigned item
              {assignedItemCount === 1 ? "" : "s"} ·{" "}
              {draft.isActive ? "visible on kiosk" : "hidden from kiosk"}
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-stone-200 bg-stone-50 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            {!isNew && (
              <button
                onClick={onDelete}
                disabled={saving || assignedItemCount > 0}
                className="text-xs font-black tracking-widest disabled:opacity-40"
                style={{ color: BRAND.red }}
              >
                DELETE CATEGORY
              </button>
            )}
            {!isNew && assignedItemCount > 0 && (
              <div className="text-[11px] font-bold opacity-60 mt-2">
                Move or hide the assigned items before deleting this category.
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 md:items-end">
            {validation.error && (
              <div className="text-xs font-bold text-red-700">
                {validation.error}
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={onCancel}
                disabled={saving}
                className="px-4 py-2 rounded-md text-xs font-black tracking-widest bg-white border border-stone-300 disabled:opacity-40"
              >
                CANCEL
              </button>
              <button
                onClick={() => onSave(draft)}
                disabled={saving || !!validation.error}
                className="px-5 py-2 rounded-md text-xs font-black tracking-widest disabled:opacity-40"
                style={{ background: BRAND.red, color: "white" }}
              >
                {saving ? "SAVING..." : "SAVE CATEGORY"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  full,
  asLabel = true,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
  asLabel?: boolean;
}) {
  const Wrapper = asLabel ? "label" : "div";
  return (
    <Wrapper
      className={`text-xs font-black tracking-widest opacity-70 ${
        full ? "md:col-span-2" : ""
      }`}
    >
      {label.toUpperCase()}
      <div className="mt-1 font-normal normal-case">{children}</div>
    </Wrapper>
  );
}

function ModList({
  title,
  rows,
  onChange,
}: {
  title: string;
  rows: Mod[];
  onChange: (rows: Mod[]) => void;
}) {
  const add = () =>
    onChange([...rows, { id: `new-${Date.now()}`, name: "", priceDelta: 0 }]);
  const set = (index: number, next: Partial<Mod>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...next } : row)));
  const del = (index: number) => onChange(rows.filter((_, i) => i !== index));

  return (
    <div className="md:col-span-2">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-black tracking-widest opacity-70">
          {title.toUpperCase()}
        </div>
        <button
          onClick={add}
          className="text-xs font-black tracking-widest"
          style={{ color: BRAND.red }}
        >
          + ADD
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="text-xs opacity-60 italic">None configured.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={row.id} className="grid grid-cols-[1fr_120px_auto] gap-2">
              <input
                value={row.name}
                onChange={(e) => set(index, { name: e.target.value })}
                placeholder="Name"
                className="border border-stone-300 rounded-md px-3 py-2 text-sm"
              />
              <input
                type="number"
                step="0.01"
                min="0"
                value={row.priceDelta}
                onChange={(e) =>
                  set(index, { priceDelta: Number(e.target.value) })
                }
                className="border border-stone-300 rounded-md px-3 py-2 text-sm mono"
              />
              <button
                onClick={() => del(index)}
                className="px-3 text-sm font-bold opacity-60 hover:opacity-100"
                aria-label={`Remove ${title} option`}
              >
                REMOVE
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function newTempId(prefix: string): string {
  return `new-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isLinkBroken(
  link: UpgradeLink,
  context?: LinkClassificationContext,
): boolean {
  return classifyLink(link, context).kind !== "ok";
}

function blocksPickerSave(
  link: UpgradeLink,
  context?: LinkClassificationContext,
): boolean {
  const state = classifyLink(link, context);
  return state.kind !== "ok" && state.kind !== "out-of-stock-item";
}

// Per-link status badge for the read-only quick-view panel. Returns null
// when the link is fine ("ok"); otherwise returns a label + color tokens.
// Red tokens for stock/visibility issues (the most common reason a deal
// can't currently be sold); amber for structural repair issues that need
// an admin to fix before the deal can ship.
function describeLinkIssue(
  state: LinkRenderState,
): { label: string; style: { background: string; color: string; borderColor: string } } | null {
  switch (state.kind) {
    case "out-of-stock-item":
      return {
        label: "Out of stock",
        style: {
          background: "#FDE2E2",
          color: "#991B1B",
          borderColor: "rgba(232,69,69,0.25)",
        },
      };
    case "inactive-item":
      return {
        label: "Hidden",
        style: {
          background: "#E8E6DF",
          color: "#6F5E44",
          borderColor: "#D8D5CC",
        },
      };
    case "missing-item":
      return {
        label: "Missing",
        style: {
          background: "#FEF3C7",
          color: "#92400E",
          borderColor: "rgba(245,158,11,0.3)",
        },
      };
    case "nested-deal-item":
      return {
        label: "Nested deal",
        style: {
          background: "#FEF3C7",
          color: "#92400E",
          borderColor: "rgba(245,158,11,0.3)",
        },
      };
    case "size-lost":
      return {
        label: "Size missing",
        style: {
          background: "#FEF3C7",
          color: "#92400E",
          borderColor: "rgba(245,158,11,0.3)",
        },
      };
    case "needs-size":
      return {
        label: "Needs size",
        style: {
          background: "#FEF3C7",
          color: "#92400E",
          borderColor: "rgba(245,158,11,0.3)",
        },
      };
    default:
      return null;
  }
}

function autoTitleFromLinks(links: UpgradeLink[]): string {
  const parts = links
    .map((l) => l.linkedMenuItem?.name)
    .filter((n): n is string => !!n)
    .map((n) =>
      n
        .replace(/ · [^·]+$/, "")
        .trim()
        .toUpperCase(),
    )
    .filter((n) => n.length > 0);
  if (parts.length === 0) return "ADD";
  return `ADD ${parts.join(" + ")}`;
}

type SelectedRow = UpgradeLink & { isExisting: boolean };

function buildLinkedItemSummary(item: Item): UpgradeLinkedMenuItem {
  return {
    id: item.id,
    name: item.name,
    emoji: item.emoji,
    bgColor: item.bgColor,
    isActive: item.isActive,
    isOutOfStock: item.isOutOfStock,
    stockMode: item.stockMode,
    stockQty: item.stockQty,
    price: item.price,
    sizeCount: item.sizes.length,
  };
}

// Structural equality for linked-items lists: positional, by stable identity.
// Used by handlePickerSave to detect a true no-op picker close so we don't
// overwrite saved prices on every Done click.
function linkedItemsEqual(a: UpgradeLink[], b: UpgradeLink[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.linkedMenuItemId !== y.linkedMenuItemId) return false;
    if (x.linkedSizeId !== y.linkedSizeId) return false;
    if (x.sortOrder !== y.sortOrder) return false;
  }
  return true;
}

function computeIncludedTotal(
  linkedItems: UpgradeLink[],
  context?: LinkClassificationContext,
): number {
  // Only count links the customer can actually buy right now. Out-of-stock,
  // inactive, missing, or size-incomplete items don't ship as part of the
  // bundle, so they shouldn't inflate the discount-% denominator. This matches
  // the kiosk's isUpgradeRenderable filter at hydration.
  return round2(
    linkedItems.reduce((sum, link) => {
      if (classifyLink(link, context).kind !== "ok") return sum;
      const base = link.linkedMenuItem?.price ?? 0;
      const delta = link.linkedSize?.priceDelta ?? 0;
      return sum + base + delta;
    }, 0),
  );
}

// Compute extraCharge + savingsLabel from a discount %, in a way that always
// sums back to the included total (savings first, extraCharge as the remainder).
function computeAutoPrices(
  includedTotal: number,
  pct: number,
): { extraCharge: number; savingsLabel: number | null } {
  const clamped = Math.max(0, Math.min(100, pct));
  if (includedTotal <= 0) {
    return { extraCharge: 0, savingsLabel: null };
  }
  const savings = round2((includedTotal * clamped) / 100);
  const extraCharge = round2(includedTotal - savings);
  return {
    extraCharge,
    savingsLabel: savings > 0 ? savings : null,
  };
}

// Back-compute the discount % from the saved extraCharge against the current
// included total. Round to 1 decimal place so typing a clean "15" on a bundle
// total like $18.48 doesn't round-trip to "14.99" through 2-decimal storage.
// Note: when items exist and extraCharge is 0, the implied 100% is preserved
// (server still rejects a $0 charge with linked items, so the red warning
// remains the right signal).
function effectiveDiscountPct(
  upgrade: Upgrade,
  includedTotal: number,
  fallback: number | null,
): number {
  if (includedTotal <= 0) {
    return fallback ?? 0;
  }
  const pct = ((includedTotal - upgrade.extraCharge) / includedTotal) * 100;
  if (!Number.isFinite(pct)) return fallback ?? 0;
  return Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
}

// Detect when stored numbers don't fit any reasonable discount on the current
// items — happens when items changed after extraCharge/savingsLabel were saved
// (e.g. legacy data, or removing a linked item without re-typing the discount).
// Two flags so the caller can render a precise warning:
//   savingsExceedsTotal — savingsLabel > includedTotal (mathematically impossible)
//   pctImplausible      — implied discount > 50% (industry-typical max is ~30%)
function detectLegacyMismatch(
  upgrade: Upgrade,
  includedTotal: number,
): { savingsExceedsTotal: boolean; pctImplausible: boolean } {
  if (includedTotal <= 0) {
    return { savingsExceedsTotal: false, pctImplausible: false };
  }
  const savingsExceedsTotal =
    upgrade.savingsLabel != null &&
    upgrade.savingsLabel > includedTotal + 0.005;
  const rawPct = ((includedTotal - upgrade.extraCharge) / includedTotal) * 100;
  const pctImplausible = Number.isFinite(rawPct) && rawPct > 50;
  return { savingsExceedsTotal, pctImplausible };
}

function UpgradeOptionsList({
  rows,
  parentItemId,
  parentItemName,
  allItems,
  categories,
  editingDeal,
  dealDefaultDiscountPct,
  classificationContext,
  onChange,
}: {
  rows: Upgrade[];
  parentItemId: string;
  parentItemName: string;
  allItems: Item[];
  categories: Cat[];
  editingDeal: boolean;
  dealDefaultDiscountPct: number | null;
  classificationContext: LinkClassificationContext;
  onChange: (rows: Upgrade[]) => void;
}) {
  const [pickerForUpgradeId, setPickerForUpgradeId] = useState<string | null>(
    null,
  );

  const updateUpgrade = (upgradeId: string, next: Partial<Upgrade>) => {
    onChange(rows.map((u) => (u.id === upgradeId ? { ...u, ...next } : u)));
  };

  // Auto-resync: when items change on a deal upgrade that already has its own
  // discountPct (operator's typed intent or a value from a prior save), keep
  // the derived extraCharge / savingsLabel in lockstep with discountPct ×
  // current included total. Without this, SAVE would persist stale dollars
  // even though the field shows the right percent.
  //
  // We deliberately DO NOT seed discountPct from the Settings default for
  // legacy NULL rows. Doing so created a cascade illusion — opening any deal
  // mirrored the current Settings value into the field and the dollars below,
  // and a subsequent SAVE would lock that in. Legacy rows must stay frozen
  // until the operator explicitly types a value or clicks USE DEFAULT.
  useEffect(() => {
    if (!editingDeal) return;
    const updates = new Map<string, Partial<Upgrade>>();
    for (const upgrade of rows) {
      if (upgrade.discountPct == null) continue;
      const total = computeIncludedTotal(
        upgrade.linkedItems,
        classificationContext,
      );
      if (total <= 0) continue;
      const next = computeAutoPrices(total, upgrade.discountPct);
      const needsUpdate =
        upgrade.extraCharge !== next.extraCharge ||
        (upgrade.savingsLabel ?? null) !== (next.savingsLabel ?? null);
      if (needsUpdate) {
        updates.set(upgrade.id, {
          extraCharge: next.extraCharge,
          savingsLabel: next.savingsLabel,
        });
      }
    }
    if (updates.size > 0) {
      onChange(
        rows.map((u) =>
          updates.has(u.id) ? { ...u, ...updates.get(u.id)! } : u,
        ),
      );
    }
  }, [rows, editingDeal, onChange, classificationContext]);

  const addUpgrade = () => {
    onChange([
      ...rows,
      {
        id: newTempId("upgrade"),
        customTitle: null,
        extraCharge: 0,
        savingsLabel: null,
        // Deal upgrades start in discount-% mode; non-deal upgrades start in
        // manual mode (null). The editor flips this based on editingDeal.
        discountPct: editingDeal ? (dealDefaultDiscountPct ?? 15) : null,
        sortOrder: rows.length,
        linkedItems: [],
      },
    ]);
  };

  const removeUpgrade = (upgradeId: string) => {
    if (!confirm("Remove this deal option?")) return;
    onChange(rows.filter((u) => u.id !== upgradeId));
  };

  const handlePickerSave = (
    upgradeId: string,
    nextLinkedItems: UpgradeLink[],
  ) => {
    if (editingDeal) {
      const upgrade = rows.find((u) => u.id === upgradeId);
      if (upgrade) {
        // Only recompute extraCharge/savingsLabel when the linked items
        // actually changed. Pure "Done with no changes" must not touch saved
        // prices — that overwrote legacy savingsLabel values in earlier
        // versions and produced absurd states like Save $31.47 on a $25.98
        // bundle.
        if (linkedItemsEqual(upgrade.linkedItems, nextLinkedItems)) {
          setPickerForUpgradeId(null);
          return;
        }
        // Items changed: keep the discount % stable across the change by
        // re-deriving extraCharge + savingsLabel from the current effective
        // pct applied to the new included total. discountPct is also written
        // through so the persisted intent survives the save.
        const oldTotal = computeIncludedTotal(
          upgrade.linkedItems,
          classificationContext,
        );
        const pct =
          upgrade.discountPct != null
            ? upgrade.discountPct
            : effectiveDiscountPct(upgrade, oldTotal, dealDefaultDiscountPct);
        const newTotal = computeIncludedTotal(
          nextLinkedItems,
          classificationContext,
        );
        const next = computeAutoPrices(newTotal, pct);
        onChange(
          rows.map((u) =>
            u.id === upgradeId
              ? {
                  ...u,
                  linkedItems: nextLinkedItems,
                  extraCharge: next.extraCharge,
                  savingsLabel: next.savingsLabel,
                  discountPct: pct,
                }
              : u,
          ),
        );
        setPickerForUpgradeId(null);
        return;
      }
    }
    updateUpgrade(upgradeId, { linkedItems: nextLinkedItems });
    setPickerForUpgradeId(null);
  };

  return (
    <div className="md:col-span-2">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-black tracking-widest opacity-70">
          DEAL OPTIONS
        </div>
        <button
          onClick={addUpgrade}
          className="text-xs font-black tracking-widest"
          style={{ color: BRAND.red }}
        >
          + ADD DEAL OPTION
        </button>
      </div>

      <p className="text-[10px] tracking-wide opacity-60 mb-3 leading-snug">
        A deal option is one complete bundle choice. Pick the required menu
        items that ship together; the kiosk auto-titles the option from those
        items.
      </p>

      {rows.length === 0 ? (
        <div className="text-xs opacity-60 italic">None configured.</div>
      ) : (
        <div className="space-y-4">
          {rows.map((upgrade) => {
            const optionComplete = dealOptionIsCustomerComplete(
              upgrade,
              classificationContext,
            );
            const customerVisibleLinks = optionComplete
              ? upgrade.linkedItems
              : [];
            const renderTitle = upgrade.customTitle?.trim()
              ? upgrade.customTitle.trim()
              : autoTitleFromLinks(customerVisibleLinks);
            const needsExtraCharge =
              upgrade.linkedItems.length > 0 && !(upgrade.extraCharge > 0);
            const hiddenFromKiosk = customerVisibleLinks.length === 0;
            const includedTotal = computeIncludedTotal(
              upgrade.linkedItems,
              classificationContext,
            );
            const currentPct = effectiveDiscountPct(
              upgrade,
              includedTotal,
              dealDefaultDiscountPct,
            );
            const mismatch = editingDeal
              ? detectLegacyMismatch(upgrade, includedTotal)
              : { savingsExceedsTotal: false, pctImplausible: false };
            return (
              <div
                key={upgrade.id}
                className="rounded-xl border border-stone-300 bg-white p-4 space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs font-black tracking-widest">
                      DEAL OPTION
                    </div>
                    <div className="text-[10px] opacity-60">
                      Customers choose this complete deal bundle
                    </div>
                  </div>
                  <button
                    onClick={() => removeUpgrade(upgrade.id)}
                    className="text-xs font-black tracking-widest opacity-70 hover:opacity-100"
                    style={{ color: BRAND.red }}
                  >
                    REMOVE
                  </button>
                </div>

                <div>
                  <div className="text-[10px] font-black tracking-widest opacity-60 mb-1">
                    REQUIRED ITEMS IN THIS OPTION
                  </div>
                  {upgrade.linkedItems.length === 0 ? (
                    <div className="text-xs opacity-60 italic">
                      No required items yet — click EDIT REQUIRED ITEMS to add
                      at least one and make this deal option visible on the
                      kiosk.
                    </div>
                  ) : (
                    <ul className="space-y-1">
                      {upgrade.linkedItems.map((link) => {
                        const state = classifyLink(link, classificationContext);
                        return (
                          <li
                            key={link.id}
                            className="flex items-center justify-between gap-3 text-sm border border-stone-200 rounded-md px-3 py-2"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {link.linkedMenuItem && (
                                <div
                                  className="w-7 h-7 rounded-md flex items-center justify-center text-base flex-shrink-0"
                                  style={{
                                    background: link.linkedMenuItem.bgColor,
                                  }}
                                >
                                  {link.linkedMenuItem.emoji}
                                </div>
                              )}
                              <div className="min-w-0">
                                <div className="font-bold truncate">
                                  {link.linkedMenuItem?.name ??
                                    (link.itemNameSnapshot
                                      ? `(was ${link.itemNameSnapshot})`
                                      : "(deleted item)")}
                                  {link.linkedSize && (
                                    <span className="opacity-60 font-normal">
                                      {" "}
                                      · {link.linkedSize.name}
                                    </span>
                                  )}
                                </div>
                                {state.kind === "ok" && link.linkedMenuItem && (
                                  <div className="text-[10px] mono opacity-60">
                                    {fmt(
                                      link.linkedMenuItem.price +
                                        (link.linkedSize?.priceDelta ?? 0),
                                    )}
                                  </div>
                                )}
                                {state.kind === "missing-item" && (
                                  <div className="text-[10px] font-black tracking-widest text-red-700">
                                    {state.rememberedItemName
                                      ? `MISSING ITEM — WAS ${state.rememberedItemName.toUpperCase()}`
                                      : "MISSING ITEM"}
                                  </div>
                                )}
                                {state.kind === "nested-deal-item" && (
                                  <div className="text-[10px] font-black tracking-widest text-red-700">
                                    NESTED DEAL — REPLACE OR REMOVE
                                  </div>
                                )}
                                {state.kind === "inactive-item" && (
                                  <div className="text-[10px] font-black tracking-widest text-orange-700">
                                    INACTIVE ITEM
                                  </div>
                                )}
                                {state.kind === "out-of-stock-item" && (
                                  <div className="text-[10px] font-black tracking-widest text-red-700">
                                    OUT OF STOCK — HIDDEN UNTIL RESTOCKED
                                  </div>
                                )}
                                {state.kind === "size-lost" && (
                                  <div className="text-[10px] font-black tracking-widest text-orange-700">
                                    SIZE &ldquo;{state.rememberedSizeName}
                                    &rdquo; GONE
                                  </div>
                                )}
                                {state.kind === "needs-size" && (
                                  <div className="text-[10px] font-black tracking-widest text-orange-700">
                                    NEEDS A SIZE
                                  </div>
                                )}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <button
                    onClick={() => setPickerForUpgradeId(upgrade.id)}
                    className="mt-2 w-full text-xs font-black tracking-widest border border-dashed border-stone-300 rounded-md py-2 hover:bg-stone-50"
                  >
                    EDIT REQUIRED ITEMS
                  </button>
                </div>

                {editingDeal ? (
                  <div>
                    {(mismatch.savingsExceedsTotal ||
                      mismatch.pctImplausible) && (
                      <div className="mb-2 rounded-md border-2 border-amber-400 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 leading-snug">
                        <div className="font-black mb-1">
                          ⚠ THIS UPGRADE&apos;S SAVED PRICES LOOK WRONG
                        </div>
                        <div className="opacity-90">
                          {mismatch.savingsExceedsTotal ? (
                            <>
                              Saved &ldquo;Save&rdquo; is{" "}
                              <span className="mono">
                                {fmt(upgrade.savingsLabel ?? 0)}
                              </span>{" "}
                              but the linked items only total{" "}
                              <span className="mono">{fmt(includedTotal)}</span>{" "}
                              — you can&apos;t save more than the items cost.
                            </>
                          ) : (
                            <>
                              Saved values imply a{" "}
                              <span className="mono">{currentPct}%</span>{" "}
                              discount, well above industry-typical (10–20%).
                              Likely leftover data from when the linked items
                              were different.
                            </>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const resetPct =
                              dealDefaultDiscountPct != null
                                ? dealDefaultDiscountPct
                                : 15;
                            const next = computeAutoPrices(
                              includedTotal,
                              resetPct,
                            );
                            updateUpgrade(upgrade.id, {
                              extraCharge: next.extraCharge,
                              savingsLabel: next.savingsLabel,
                              discountPct: resetPct,
                            });
                          }}
                          className="mt-2 rounded-md bg-amber-600 px-3 py-1.5 text-[10px] font-black tracking-widest text-white hover:bg-amber-700"
                        >
                          RESET TO{" "}
                          {dealDefaultDiscountPct != null
                            ? `${dealDefaultDiscountPct}%`
                            : "15%"}
                        </button>
                      </div>
                    )}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label
                          htmlFor={`discount-pct-${upgrade.id}`}
                          className="text-xs font-black tracking-widest opacity-70"
                        >
                          DISCOUNT %
                        </label>
                        {dealDefaultDiscountPct != null &&
                          (() => {
                            // Compare against what the field is showing — for
                            // legacy NULL rows that's the back-computed implied
                            // % from saved dollars (so the button doesn't claim
                            // "already at default" on a 15%-implied row).
                            const displayedPct =
                              upgrade.discountPct ??
                              (includedTotal > 0
                                ? effectiveDiscountPct(
                                    upgrade,
                                    includedTotal,
                                    null,
                                  )
                                : null);
                            const atDefault =
                              displayedPct != null &&
                              Math.abs(displayedPct - dealDefaultDiscountPct) <
                                0.005;
                            return (
                              <button
                                type="button"
                                disabled={atDefault}
                                onClick={() => {
                                  const next = computeAutoPrices(
                                    includedTotal,
                                    dealDefaultDiscountPct,
                                  );
                                  updateUpgrade(upgrade.id, {
                                    extraCharge: next.extraCharge,
                                    savingsLabel: next.savingsLabel,
                                    discountPct: dealDefaultDiscountPct,
                                  });
                                }}
                                title={
                                  atDefault
                                    ? "Already at the Settings default"
                                    : "Set discount to the Settings default"
                                }
                                className="text-[10px] font-black tracking-widest hover:underline disabled:opacity-30 disabled:cursor-not-allowed disabled:no-underline"
                                style={{ color: BRAND.red }}
                              >
                                USE DEFAULT ({dealDefaultDiscountPct}%)
                              </button>
                            );
                          })()}
                      </div>
                      <div className="font-normal normal-case">
                        <input
                          id={`discount-pct-${upgrade.id}`}
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          // Display rules:
                          //   - Persisted discountPct: show it. Operator typing
                          //     and auto-resync are the only things that change
                          //     it.
                          //   - Legacy NULL row: show the back-computed implied
                          //     % from the saved dollars so a 15%-era deal
                          //     reads as 15, NOT the current Settings default.
                          //     This is display-only — no state mutation — so
                          //     the row stays NULL (and dollars stay frozen)
                          //     until the operator types or clicks USE DEFAULT.
                          //   - No saved dollars and no items: empty field,
                          //     placeholder hints at the Settings default.
                          value={
                            upgrade.discountPct != null
                              ? String(upgrade.discountPct)
                              : includedTotal > 0
                                ? String(
                                    effectiveDiscountPct(
                                      upgrade,
                                      includedTotal,
                                      null,
                                    ),
                                  )
                                : ""
                          }
                          placeholder={
                            upgrade.discountPct == null &&
                            dealDefaultDiscountPct != null
                              ? String(dealDefaultDiscountPct)
                              : undefined
                          }
                          onChange={(e) => {
                            const raw = e.target.value;
                            const parsed = raw === "" ? 0 : Number(raw);
                            const pct = Number.isFinite(parsed)
                              ? Math.max(0, Math.min(100, parsed))
                              : 0;
                            const next = computeAutoPrices(includedTotal, pct);
                            // Persist the operator's intent (discountPct) along
                            // with the derived dollar amounts. The server will
                            // recompute dollars at every hydration / checkout
                            // from this %, so it survives stock toggles and
                            // linked-item price changes.
                            updateUpgrade(upgrade.id, {
                              extraCharge: next.extraCharge,
                              savingsLabel: next.savingsLabel,
                              discountPct: pct,
                            });
                          }}
                          className={`rounded-md px-3 py-2 w-full text-sm mono ${
                            needsExtraCharge
                              ? "border-2 border-red-400 bg-red-50"
                              : "border border-stone-300"
                          }`}
                        />
                        <p className="text-[10px] tracking-wide opacity-60 mt-1 leading-snug">
                          How much off the included items total. Customer pays{" "}
                          <span className="mono">
                            {fmt(upgrade.extraCharge)}
                          </span>{" "}
                          and sees{" "}
                          {upgrade.savingsLabel != null &&
                          upgrade.savingsLabel > 0 ? (
                            <>
                              <span className="mono">
                                Save {fmt(upgrade.savingsLabel)}
                              </span>
                              .
                            </>
                          ) : (
                            <>no savings label.</>
                          )}{" "}
                          Items normally total{" "}
                          <span className="mono">{fmt(includedTotal)}</span>.
                        </p>
                        {needsExtraCharge && (
                          <p className="text-[10px] font-bold text-red-700 mt-1 leading-snug">
                            Save is blocked until extra charge is greater than
                            $0.00. Pick at least one required item or lower
                            the discount.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <Field
                      label={
                        upgrade.linkedItems.length > 0
                          ? "EXTRA CHARGE (REQUIRED)"
                          : "EXTRA CHARGE"
                      }
                    >
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={upgrade.extraCharge}
                        onChange={(e) =>
                          updateUpgrade(upgrade.id, {
                            extraCharge: Number(e.target.value),
                          })
                        }
                        className={`rounded-md px-3 py-2 w-full text-sm mono ${
                          needsExtraCharge
                            ? "border-2 border-red-400 bg-red-50"
                            : "border border-stone-300"
                        }`}
                      />
                      {needsExtraCharge ? (
                        <p className="text-[10px] font-bold text-red-700 mt-1 leading-snug">
                          Enter the amount customers pay extra. Save is blocked
                          until this is greater than $0.00.
                        </p>
                      ) : (
                        <p className="text-[10px] tracking-wide opacity-60 mt-1 leading-snug">
                          What customers pay extra when they pick this deal
                          option. Applies once per selection.
                        </p>
                      )}
                    </Field>
                    <Field label="SAVINGS LABEL (optional)">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={upgrade.savingsLabel ?? ""}
                        onChange={(e) =>
                          updateUpgrade(upgrade.id, {
                            savingsLabel:
                              e.target.value === ""
                                ? null
                                : Number(e.target.value),
                          })
                        }
                        className="border border-stone-300 rounded-md px-3 py-2 w-full text-sm mono"
                      />
                      <p className="text-[10px] tracking-wide opacity-60 mt-1 leading-snug">
                        Shown as &ldquo;Save $X&rdquo; on the deal option card. Does
                        not affect checkout total. Leave blank to hide.
                      </p>
                    </Field>
                  </div>
                )}

                <details className="border border-stone-200 rounded-md">
                  <summary className="px-3 py-2 text-xs font-black tracking-widest opacity-70 cursor-pointer">
                    ADVANCED OPTIONS
                  </summary>
                  <div className="px-3 pb-3">
                    <Field label="CUSTOM TITLE">
                      <input
                        type="text"
                        maxLength={80}
                        value={upgrade.customTitle ?? ""}
                        onChange={(e) =>
                          updateUpgrade(upgrade.id, {
                            customTitle:
                              e.target.value.length === 0
                                ? null
                                : e.target.value,
                          })
                        }
                        placeholder="(use auto-title from required items)"
                        className="border border-stone-300 rounded-md px-3 py-2 w-full text-sm"
                      />
                      <p className="text-[10px] tracking-wide opacity-60 mt-1 leading-snug">
                        Override the auto-generated title. Shown to customers
                        instead of the items&apos; names. Leave blank to use the
                        auto-title.
                      </p>
                    </Field>
                  </div>
                </details>

                <div className="rounded-lg bg-stone-50 p-3">
                  <div className="text-[10px] font-black tracking-widest opacity-60 mb-2">
                    {hiddenFromKiosk
                      ? "CUSTOMERS WILL NOT SEE THIS"
                      : "CUSTOMERS WILL SEE THIS"}
                  </div>
                  {hiddenFromKiosk ? (
                    <div className="rounded-xl border-2 border-red-200 bg-red-50 p-4">
                      <div className="text-xs font-black tracking-widest text-red-800">
                        HIDDEN FROM KIOSK
                      </div>
                      <p className="mt-1 text-xs font-bold leading-snug text-red-800/80">
                        This deal option is hidden because at least one
                        required item is unavailable or needs repair. Repair,
                        replace, remove, or restock the required items to show
                        this option again.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-xl border-2 border-stone-200 p-4 bg-white">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="display text-base leading-tight line-clamp-2">
                            {renderTitle}
                          </div>
                          <div className="mt-2 text-[10px] font-black tracking-widest opacity-50">
                            INCLUDES
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          {needsExtraCharge ? (
                            <div className="text-[10px] font-black tracking-widest text-red-700">
                              SET PRICE
                            </div>
                          ) : (
                            <div
                              className="display text-sm"
                              style={{ color: BRAND.red }}
                            >
                              +{fmt(upgrade.extraCharge)}
                            </div>
                          )}
                          {upgrade.savingsLabel != null && (
                            <div className="text-[10px] font-black tracking-widest opacity-60">
                              Save {fmt(upgrade.savingsLabel)}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="mt-3 divide-y divide-stone-200/80">
                        {customerVisibleLinks.map((link) => {
                          const itemName =
                            link.linkedMenuItem?.name ??
                            link.itemNameSnapshot ??
                            "Missing item";
                          const itemBg =
                            link.linkedMenuItem?.bgColor ?? "#f5f5f4";
                          const itemEmoji = link.linkedMenuItem?.emoji ?? "?";
                          return (
                            <div
                              key={link.id}
                              className="grid grid-cols-[2.5rem_1fr] items-center gap-3 py-2 first:pt-0 last:pb-0"
                            >
                              <div
                                className="w-8 h-8 rounded-lg flex items-center justify-center text-base"
                                style={{ background: itemBg }}
                              >
                                {itemEmoji}
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-black leading-tight truncate">
                                  {itemName}
                                  {link.linkedSize && (
                                    <span className="font-normal opacity-60">
                                      {" "}
                                      · {link.linkedSize.name}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {pickerForUpgradeId &&
        (() => {
          const upgrade = rows.find((u) => u.id === pickerForUpgradeId);
          if (!upgrade) return null;
          return (
            <MultiSelectPickerModal
              upgrade={upgrade}
              parentItemId={parentItemId}
              parentItemName={parentItemName}
              allItems={allItems}
              categories={categories}
              classificationContext={classificationContext}
              onSave={(next) => handlePickerSave(upgrade.id, next)}
              onCancel={() => setPickerForUpgradeId(null)}
            />
          );
        })()}
    </div>
  );
}

function MultiSelectPickerModal({
  upgrade,
  parentItemId,
  parentItemName,
  allItems,
  categories,
  classificationContext,
  onSave,
  onCancel,
}: {
  upgrade: Upgrade;
  parentItemId: string;
  parentItemName: string;
  allItems: Item[];
  categories: Cat[];
  classificationContext: LinkClassificationContext;
  onSave: (next: UpgradeLink[]) => void;
  onCancel: () => void;
}) {
  // Modal-local selection state. Initialized from upgrade.linkedItems —
  // identity by row id is preserved across the modal session so the audit-
  // window carve-out and stable cart references hold.
  const [selectedRows, setSelectedRows] = useState<SelectedRow[]>(() =>
    upgrade.linkedItems
      .slice()
      // Three-level tiebreak (sortOrder, name-snapshot, id) mirrors
      // compareItemsByOrder so this picker's order matches the rest of
      // the admin UI even when sortOrder collides.
      .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        const byName = (a.itemNameSnapshot ?? "").localeCompare(
          b.itemNameSnapshot ?? "",
        );
        if (byName !== 0) return byName;
        return a.id.localeCompare(b.id);
      })
      .map((link) => ({ ...link, isExisting: true })),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [selectedCollapsed, setSelectedCollapsed] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  // Replace mode: when set, the next grid pick replaces this row in place
  // (preserves row id, refreshes linkedMenuItemId / linkedSizeId / snapshots).
  // Used to repair broken rows (missing or inactive linked items) without
  // churning the UpgradeItemLink.id.
  const [replaceTargetRowId, setReplaceTargetRowId] = useState<string | null>(
    null,
  );

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const replacingRow = replaceTargetRowId
    ? (selectedRows.find((r) => r.id === replaceTargetRowId) ?? null)
    : null;

  // Helpers -------------------------------------------------------------

  const findRowByMenuItemId = (menuItemId: string, excludeRowId?: string) =>
    selectedRows.find(
      (r) => r.id !== excludeRowId && r.linkedMenuItemId === menuItemId,
    );

  const findRowByPair = (
    menuItemId: string,
    sizeId: string | null,
    excludeRowId?: string,
  ) =>
    selectedRows.find(
      (r) =>
        r.id !== excludeRowId &&
        r.linkedMenuItemId === menuItemId &&
        r.linkedSizeId === sizeId,
    );

  const flashDuplicate = (msg: string) => {
    setDuplicateWarning(msg);
    setTimeout(() => setDuplicateWarning(null), 3000);
  };

  const removeRow = (rowId: string) => {
    setSelectedRows((prev) => prev.filter((r) => r.id !== rowId));
    if (replaceTargetRowId === rowId) setReplaceTargetRowId(null);
  };

  const moveRow = (rowId: string, direction: "up" | "down") => {
    setSelectedRows((prev) => {
      const idx = prev.findIndex((r) => r.id === rowId);
      if (idx < 0) return prev;
      const swapWith = direction === "up" ? idx - 1 : idx + 1;
      if (swapWith < 0 || swapWith >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
      return next.map((r, i) => ({ ...r, sortOrder: i }));
    });
  };

  const enterReplaceMode = (rowId: string) => {
    setReplaceTargetRowId(rowId);
    setExpandedItemId(null);
  };

  const exitReplaceMode = () => {
    setReplaceTargetRowId(null);
    setExpandedItemId(null);
  };

  // Replace the target row in place. Preserves the row id (so the API's
  // syncUpgradeOptions does an UPDATE not a DELETE+INSERT), refreshes
  // linkedMenuItemId / linkedSizeId / both snapshots / linkedMenuItem /
  // linkedSize hydrations from the new picked target.
  const replaceRow = (rowId: string, item: Item, sizeId: string | null) => {
    const size = sizeId
      ? (item.sizes.find((s) => s.id === sizeId) ?? null)
      : null;
    if (sizeId && !size) return;

    // Dup check: any other row already has this menuItemId? Block.
    const collision = findRowByMenuItemId(item.id, rowId);
    if (collision) {
      flashDuplicate(`${item.name} is already in this deal option.`);
      return;
    }

    setSelectedRows((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? {
              ...r,
              linkedMenuItemId: item.id,
              linkedSizeId: size?.id ?? null,
              itemNameSnapshot: item.name,
              sizeNameSnapshot: size?.name ?? null,
              linkedMenuItem: buildLinkedItemSummary(item),
              linkedSize: size
                ? {
                    id: size.id,
                    name: size.name,
                    priceDelta: size.priceDelta,
                  }
                : null,
            }
          : r,
      ),
    );
    exitReplaceMode();
  };

  const toggleUnsizedItem = (item: Item) => {
    if (replaceTargetRowId) {
      replaceRow(replaceTargetRowId, item, null);
      return;
    }
    const existing = findRowByMenuItemId(item.id);
    if (existing) {
      removeRow(existing.id);
      return;
    }
    setSelectedRows((prev) => [
      ...prev,
      {
        id: newTempId("link"),
        isExisting: false,
        linkedMenuItemId: item.id,
        linkedSizeId: null,
        itemNameSnapshot: item.name,
        sizeNameSnapshot: null,
        sortOrder: prev.length,
        linkedMenuItem: buildLinkedItemSummary(item),
        linkedSize: null,
      },
    ]);
  };

  const pickSizeForItem = (item: Item, sizeId: string) => {
    const size = item.sizes.find((s) => s.id === sizeId);
    if (!size) return;

    if (replaceTargetRowId) {
      replaceRow(replaceTargetRowId, item, sizeId);
      return;
    }

    const existingExactPair = findRowByPair(item.id, sizeId);
    if (existingExactPair) {
      // Click same size again → deselect.
      removeRow(existingExactPair.id);
      return;
    }

    const existingItemRow = findRowByMenuItemId(item.id);
    if (existingItemRow) {
      // Switch size on an existing row — preserve the row id (one row per
      // menu item per upgrade; size changes mutate that row).
      setSelectedRows((prev) =>
        prev.map((r) =>
          r.id === existingItemRow.id
            ? {
                ...r,
                linkedSizeId: size.id,
                sizeNameSnapshot: size.name,
                linkedSize: {
                  id: size.id,
                  name: size.name,
                  priceDelta: size.priceDelta,
                },
              }
            : r,
        ),
      );
      return;
    }

    setSelectedRows((prev) => [
      ...prev,
      {
        id: newTempId("link"),
        isExisting: false,
        linkedMenuItemId: item.id,
        linkedSizeId: size.id,
        itemNameSnapshot: item.name,
        sizeNameSnapshot: size.name,
        sortOrder: prev.length,
        linkedMenuItem: buildLinkedItemSummary(item),
        linkedSize: {
          id: size.id,
          name: size.name,
          priceDelta: size.priceDelta,
        },
      },
    ]);
  };

  // Filter the picker grid ---------------------------------------------

  const dealsCategoryIds = new Set(
    categories
      .filter((category) => isDealsCategory(category))
      .map((category) => category.id),
  );
  const filtered = allItems.filter((it) => {
    if (it.id === parentItemId) return false;
    if (dealsCategoryIds.has(it.categoryId)) return false;
    if (!it.isActive) return false;
    if (!trimmedQuery) return true;
    return (
      it.name.toLowerCase().includes(trimmedQuery) ||
      it.description.toLowerCase().includes(trimmedQuery)
    );
  });

  const grouped: Map<string, Item[]> = new Map();
  for (const it of filtered) {
    const list = grouped.get(it.categoryId) ?? [];
    list.push(it);
    grouped.set(it.categoryId, list);
  }

  // Classify selected rows ----------------------------------------------

  const saveBlockingRows = selectedRows.filter((row) =>
    blocksPickerSave(row, classificationContext),
  );
  const selectableRows = selectedRows.filter(
    (row) => !blocksPickerSave(row, classificationContext),
  );
  const blockingRowsWillBeDropped =
    saveBlockingRows.length > 0 && selectableRows.length > 0;

  // Empty list still blocks because otherwise the admin would commit an empty
  // linkedItems[] and only fail later at SAVE ITEM. Blocking repair rows only
  // block when they are the whole selection; once the admin picks at least one
  // saveable row, Done prunes those invalid links and keeps the valid/OOS rows.
  const blockDoneReason: string | null =
    selectableRows.length === 0
      ? "Add at least one required item, or click Cancel and use the deal option card's REMOVE button to delete this deal option."
      : null;
  const canSave = blockDoneReason === null;

  const handleDone = () => {
    if (!canSave) return;
    const next: UpgradeLink[] = selectableRows.map((r, i) => {
      const { isExisting, ...link } = r;
      void isExisting;
      return { ...link, sortOrder: i };
    });
    onSave(next);
  };

  // Render --------------------------------------------------------------

  const renderSelectedRow = (row: SelectedRow) => {
    const state = classifyLink(row, classificationContext);
    const broken = state.kind !== "ok";
    // Replace is offered for missing/inactive (item-level repair). Size-lost
    // and needs-size are repaired by picking a size on the row's existing
    // item, which already preserves row id via pickSizeForItem's switch path.
    const offerReplace =
      state.kind === "missing-item" ||
      state.kind === "nested-deal-item" ||
      state.kind === "inactive-item" ||
      state.kind === "out-of-stock-item";
    const isReplaceTarget = replaceTargetRowId === row.id;
    const borderClass = isReplaceTarget
      ? "border-yellow-500 bg-yellow-50"
      : broken
        ? "border-red-400 bg-red-50"
        : "border-stone-200 bg-white";
    return (
      <li
        key={row.id}
        className={`flex items-center justify-between gap-2 text-sm rounded-md px-3 py-2 border-2 ${borderClass}`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {row.linkedMenuItem && (
            <div
              className="w-7 h-7 rounded-md flex items-center justify-center text-base flex-shrink-0"
              style={{ background: row.linkedMenuItem.bgColor }}
            >
              {row.linkedMenuItem.emoji}
            </div>
          )}
          <div className="min-w-0">
            <div className="font-bold truncate">
              {row.linkedMenuItem?.name ??
                (row.itemNameSnapshot
                  ? `(was ${row.itemNameSnapshot})`
                  : "(deleted item)")}
              {row.linkedSize && (
                <span className="opacity-60 font-normal">
                  {" "}
                  · {row.linkedSize.name}
                </span>
              )}
            </div>
            {isReplaceTarget && (
              <div className="text-[10px] font-black tracking-widest text-yellow-800">
                REPLACING — PICK A REPLACEMENT BELOW
              </div>
            )}
            {!isReplaceTarget && state.kind === "ok" && row.linkedMenuItem && (
              <div className="text-[10px] mono opacity-60">
                {fmt(
                  row.linkedMenuItem.price + (row.linkedSize?.priceDelta ?? 0),
                )}
              </div>
            )}
            {!isReplaceTarget && state.kind === "missing-item" && (
              <div className="text-[10px] font-black tracking-widest text-red-700">
                {state.rememberedItemName
                  ? `MISSING — REPLACE OR REMOVE`
                  : `LINKED ITEM DELETED — REPLACE OR REMOVE`}
              </div>
            )}
            {!isReplaceTarget && state.kind === "nested-deal-item" && (
              <div className="text-[10px] font-black tracking-widest text-red-700">
                NESTED DEAL — REPLACE OR REMOVE
              </div>
            )}
            {!isReplaceTarget && state.kind === "inactive-item" && (
              <div className="text-[10px] font-black tracking-widest text-orange-700">
                INACTIVE ITEM — REPLACE OR REMOVE
              </div>
            )}
            {!isReplaceTarget && state.kind === "out-of-stock-item" && (
              <div className="text-[10px] font-black tracking-widest text-red-700">
                OUT OF STOCK — HIDDEN UNTIL RESTOCKED
              </div>
            )}
            {!isReplaceTarget && state.kind === "size-lost" && (
              <div className="text-[10px] font-black tracking-widest text-orange-700">
                SIZE &ldquo;{state.rememberedSizeName}&rdquo; GONE — PICK A NEW
                SIZE BELOW
              </div>
            )}
            {!isReplaceTarget && state.kind === "needs-size" && (
              <div className="text-[10px] font-black tracking-widest text-orange-700">
                PICK A SIZE BELOW
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {offerReplace && !isReplaceTarget && (
            <button
              onClick={() => enterReplaceMode(row.id)}
              className="text-[10px] font-black tracking-widest opacity-80 hover:opacity-100 px-2 py-1 rounded border border-yellow-500"
              style={{ color: "#7a5400" }}
            >
              REPLACE
            </button>
          )}
          {isReplaceTarget && (
            <button
              onClick={exitReplaceMode}
              className="text-[10px] font-black tracking-widest opacity-80 hover:opacity-100 px-2 py-1 rounded border border-stone-400"
            >
              CANCEL REPLACE
            </button>
          )}
          {!isReplaceTarget && (
            <>
              <button
                onClick={() => moveRow(row.id, "up")}
                className="text-xs font-black tracking-widest opacity-50 hover:opacity-100 px-1"
                aria-label="Move up"
              >
                ▲
              </button>
              <button
                onClick={() => moveRow(row.id, "down")}
                className="text-xs font-black tracking-widest opacity-50 hover:opacity-100 px-1"
                aria-label="Move down"
              >
                ▼
              </button>
              <button
                onClick={() => removeRow(row.id)}
                className="text-[10px] font-black tracking-widest opacity-70 hover:opacity-100 ml-1"
                style={{ color: BRAND.red }}
              >
                REMOVE
              </button>
            </>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-200 flex items-start justify-between shrink-0">
          <div>
            <div className="display text-lg leading-tight">
              Pick required items for this deal option
            </div>
            <div className="text-[10px] opacity-60 mt-0.5">
              {parentItemName
                ? `Editing ${parentItemName}'s required deal items`
                : "Editing this deal option"}
            </div>
          </div>
          <button
            onClick={onCancel}
            className="text-xs font-black tracking-widest opacity-70 hover:opacity-100"
            aria-label="Cancel"
          >
            CANCEL ✕
          </button>
        </div>

        {/* Sticky Selected section */}
        <div className="border-b border-stone-200 bg-stone-50 px-5 py-3 shrink-0">
          <button
            type="button"
            onClick={() => setSelectedCollapsed((value) => !value)}
            className="w-full flex items-center justify-between gap-3 mb-2 text-left"
            aria-expanded={!selectedCollapsed}
          >
            <span className="inline-flex items-center gap-2 text-[10px] font-black tracking-widest opacity-60">
              {selectedCollapsed ? (
                <ChevronRight size={14} strokeWidth={3} />
              ) : (
                <ChevronDown size={14} strokeWidth={3} />
              )}
              SELECTED FOR THIS UPGRADE ({selectedRows.length})
            </span>
            <span className="text-[10px] font-black tracking-widest opacity-50">
              {selectedCollapsed ? "SHOW" : "HIDE"}
            </span>
          </button>

          {selectedCollapsed ? (
            <div className="text-xs opacity-60 truncate">
              {selectedRows.length === 0
                ? "No items selected."
                : selectedRows
                    .map(
                      (row) =>
                        row.linkedMenuItem?.name ??
                        row.itemNameSnapshot ??
                        "Missing item",
                    )
                    .join(" + ")}
            </div>
          ) : (
            <>
              {saveBlockingRows.length > 0 && (
                <div className="mb-3">
                  <div className="text-[10px] font-black tracking-widest text-red-700 mb-2">
                    NEEDS REPAIR ({saveBlockingRows.length})
                  </div>
                  <ul className="space-y-1">
                    {saveBlockingRows.map(renderSelectedRow)}
                  </ul>
                </div>
              )}
              {selectedRows.length === 0 && (
                <div className="text-[10px] opacity-60 italic mb-2">
                  Tap items below to add them
                </div>
              )}
              {selectableRows.length > 0 ? (
                <ul className="space-y-1">
                  {selectableRows.map(renderSelectedRow)}
                </ul>
              ) : (
                saveBlockingRows.length === 0 && (
                  <div className="text-xs opacity-60 italic">No items yet.</div>
                )
              )}
            </>
          )}
        </div>

        {/* Replace-mode banner */}
        {replacingRow && (
          <div className="px-5 py-2 bg-yellow-100 border-b border-yellow-300 flex items-center justify-between gap-3 shrink-0">
            <div className="text-xs font-bold text-yellow-900">
              Replacing{" "}
              {replacingRow.itemNameSnapshot ??
                replacingRow.linkedMenuItem?.name ??
                "(missing item)"}
              … pick a replacement below.
            </div>
            <button
              onClick={exitReplaceMode}
              className="text-[10px] font-black tracking-widest opacity-80 hover:opacity-100 px-2 py-1 rounded border border-yellow-600"
              style={{ color: "#7a5400" }}
            >
              CANCEL REPLACE
            </button>
          </div>
        )}

        {/* Search */}
        <div className="px-5 py-3 border-b border-stone-200 shrink-0">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search items…"
            className="border border-stone-300 rounded-md px-3 py-2 w-full text-sm"
          />
          {duplicateWarning && (
            <div className="mt-2 text-xs font-bold text-red-700">
              {duplicateWarning}
            </div>
          )}
        </div>

        {/* Picker grid */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-5">
          {categories
            .filter((c) => grouped.has(c.id))
            .map((category) => {
              const itemsInCat = grouped.get(category.id) ?? [];
              return (
                <div key={category.id}>
                  <div className="text-xs font-black tracking-widest opacity-60 mb-2">
                    {category.icon} {category.name.toUpperCase()}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {itemsInCat.map((it) => {
                      const hasSizes = it.sizes.length > 0;
                      const selectedRow = findRowByMenuItemId(it.id);
                      const isSelected = !!selectedRow;
                      const isExpanded = expandedItemId === it.id;
                      const isUnavailable = !isMenuItemAvailable(it);
                      // Span-2 when this card is expanded for size pick
                      const cardCol =
                        hasSizes && isExpanded ? "col-span-2" : "";
                      return (
                        <div key={it.id} className={cardCol}>
                          <button
                            onClick={() => {
                              if (isUnavailable) return;
                              if (hasSizes) {
                                setExpandedItemId(isExpanded ? null : it.id);
                              } else {
                                toggleUnsizedItem(it);
                              }
                            }}
                            disabled={isUnavailable}
                            className={`w-full flex items-center gap-2 border rounded-md px-3 py-2 text-left transition ${
                              isSelected
                                ? "border-2 border-black bg-yellow-50"
                                : isUnavailable
                                  ? "border-stone-300 bg-red-50/60 cursor-not-allowed"
                                  : "border-stone-300 hover:bg-stone-50"
                            }`}
                          >
                            <div
                              className="w-8 h-8 rounded-md flex items-center justify-center text-base flex-shrink-0"
                              style={{ background: it.bgColor }}
                            >
                              {it.emoji}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-bold truncate">
                                {it.name}
                                {isSelected && !hasSizes && (
                                  <span className="ml-1">✓</span>
                                )}
                              </div>
                              <div className="text-[10px] mono opacity-60">
                                {fmt(it.price)}
                                {hasSizes &&
                                  ` · ${it.sizes.length} size${
                                    it.sizes.length === 1 ? "" : "s"
                                  }`}
                                {isSelected && selectedRow.linkedSize && (
                                  <span className="ml-1 font-black tracking-widest">
                                    ·{" "}
                                    {selectedRow.linkedSize.name.toUpperCase()}{" "}
                                    ✓
                                  </span>
                                )}
                              </div>
                              {isUnavailable && (
                                <div className="text-[9px] font-black tracking-widest text-red-700">
                                  OUT OF STOCK
                                </div>
                              )}
                            </div>
                          </button>
                          {hasSizes && isExpanded && !isUnavailable && (
                            <div className="mt-2 grid grid-cols-3 gap-2 px-2">
                              {it.sizes.map((size) => {
                                const isPickedSize =
                                  selectedRow?.linkedSizeId === size.id;
                                return (
                                  <button
                                    key={size.id}
                                    onClick={() => pickSizeForItem(it, size.id)}
                                    className={`text-xs font-bold rounded-md px-3 py-2 border transition ${
                                      isPickedSize
                                        ? "border-2 border-black bg-yellow-100"
                                        : "border-stone-300 hover:bg-stone-100"
                                    }`}
                                  >
                                    <div>{size.name}</div>
                                    <div className="mono text-[10px] opacity-70">
                                      {fmt(it.price + size.priceDelta)}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          {filtered.length === 0 && (
            <div className="text-sm opacity-60 italic">No matches.</div>
          )}
        </div>

        {/* Sticky footer */}
        <div className="border-t border-stone-200 px-5 py-3 bg-white shrink-0">
          {blockDoneReason && (
            <div className="mb-2 text-xs font-bold text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {blockDoneReason}
            </div>
          )}
          {blockingRowsWillBeDropped && (
            <div className="mb-2 text-xs font-bold text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              {saveBlockingRows.length} broken item
              {saveBlockingRows.length === 1 ? "" : "s"} will be removed when
              you save this deal option.
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-bold opacity-60">
              {selectedRows.length} selected
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onCancel}
                className="px-4 py-2 rounded-md text-xs font-black tracking-widest border border-stone-300"
              >
                CANCEL
              </button>
              <button
                onClick={handleDone}
                disabled={!canSave}
                className="px-4 py-2 rounded-md text-xs font-black tracking-widest disabled:opacity-40"
                style={{ background: BRAND.black, color: "white" }}
              >
                DONE
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
