"use client";

import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Eye,
  EyeOff,
  GripVertical,
  History,
  Pencil,
  Plus,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import {
  EditDealModal,
  EditItemModal,
  type Category as MenuEditorCategory,
  type HeroPending,
  type ItemModifierGroupLink,
  type ItemModifierOptionOverride,
  type Item as MenuEditorItem,
  type SaveResult,
  type SharedModifierGroup,
  type SharedModifierItemMutationResult,
  type SharedModifierOption,
  type WorkspaceAddOnManagerFocus,
} from "@/components/admin/menu-editor";
import SearchField from "@/components/admin/menu-editor/SearchField";
import FilterBuilderModal from "@/components/admin/menu-editor/FilterBuilderModal";
import DealHistoryBrowser from "@/components/admin/deals/DealHistoryBrowser";
import {
  defaultDealEndIso,
  defaultDealStartIso,
} from "@/lib/deal-schedule";
import WorkspaceModifierLibraryModal from "./WorkspaceModifierLibraryModal";
import WorkspaceOptionStockControls, {
  type WorkspaceOptionStockPatch,
} from "./WorkspaceOptionStockControls";
import type {
  AdminWorkspaceMenuSummary,
  WorkspaceMenuAddonOption,
  WorkspaceMenuCategoryOption,
  WorkspaceMenuItemRow,
  WorkspaceMenuOptionStockSummary,
} from "@/lib/admin/workspace/menu-summary";
import { makeDealDraftFromHistorySnapshot } from "@/lib/admin/menu/deal-drafts";
import type { DealHistoryEntry } from "@/lib/deal-history";
import type { AdminWorkspaceNotify } from "./AdminWorkspaceToastHost";
import type { MenuAttention } from "@/lib/admin/filters/types";
import {
  isMenuFilterEmpty,
  type HistoryMethod,
  type MenuFilterState,
  type MenuFilterStructuredKey,
} from "@/lib/admin/filters/types";
import { encodeFilter } from "@/lib/admin/filters/url-state";
import {
  normalizeCategorySlug,
  validateCategoryInput,
  validateItemInput,
} from "@/lib/menu-admin";

const WORKSPACE_MENU_REFRESH_MS = 30_000;

export type AdminWorkspaceMenuFocusRequest = {
  id: number;
  attention: MenuAttention | null;
  query: string;
  category: string | null;
  targetItemId: string | null;
  action?:
    | { type: "openDealHistory" }
    | { type: "restoreDealFromHistory"; entry: DealHistoryEntry };
};

const ATTENTION_FILTERS: Array<{
  key: MenuAttention | "all";
  label: string;
}> = [
  { key: "all", label: "All" },
  { key: "deals", label: "Deals" },
  { key: "inventory-out", label: "Out" },
  { key: "inventory-low", label: "Low" },
];

const ATTENTION_LABELS: Record<MenuAttention, string> = {
  deals: "Deals need attention",
  "inventory-out": "Items out of stock",
  "inventory-low": "Low-stock items",
};

type WorkspaceMenuEditorContext = {
  categories: MenuEditorCategory[];
  items: MenuEditorItem[];
  modifierGroups: SharedModifierGroup[];
  allowedImageHosts: string[];
  dealDefaultDiscountPct: number | null;
};

type ModifierGroupResponse = {
  group?: SharedModifierGroup;
  changed?: boolean;
};

type ModifierOptionResponse = {
  option?: SharedModifierOption;
  groupLockVersion?: number;
  changed?: boolean;
};

type ModifierGroupDeleteResponse = {
  deleted?: boolean;
  groupId?: string;
  groupName?: string;
  error?: unknown;
};

type ModifierOptionDeleteResponse = {
  deleted?: boolean;
  groupId?: string;
  groupLockVersion?: number;
  optionId?: string;
  optionName?: string;
  error?: unknown;
};

type AddonStockResponse = {
  addon?: {
    id: string;
    itemId: string;
    name: string;
    priceDelta: number;
    stockMode: "MANUAL" | "QUANTITY";
    isOutOfStock: boolean;
    stockQty: number | null;
    lowStockThreshold: number | null;
    stockUpdatedAt: string | null;
    stockUpdatedById: string | null;
    sortOrder: number;
  };
  itemLockVersion?: number;
  changed?: boolean;
};

type AddonStockEditorTarget = {
  row: WorkspaceMenuItemRow;
  addon: WorkspaceMenuAddonOption;
};

type ItemModifierLinkResponse = {
  link?: ItemModifierGroupLink;
  itemLockVersion?: number;
  changed?: boolean;
};

type ItemModifierOverrideResponse = {
  override?: ItemModifierOptionOverride | null;
  itemLockVersion?: number;
  changed?: boolean;
};

type WorkspaceCategoryDraft = {
  id?: string;
  slug: string;
  name: string;
  icon: string;
  sortOrder: number;
  isActive: boolean;
  updatedAt: string;
};

type DealHistoryApiResponse = {
  entries?: DealHistoryEntry[];
  serverNowIso?: string;
  error?: unknown;
};

function formatGeneratedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "just now";
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function displayFetchError(status: number, body: unknown): string {
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof body.error === "string"
  ) {
    return body.error;
  }
  return `workspace_menu_${status}`;
}

function friendlyHttpError(status: number, action: string): string {
  if (status === 400) {
    return `We couldn't ${action}. Please review the fields and try again.`;
  }
  if (status === 401 || status === 403) {
    return `We couldn't ${action} because this session cannot edit menu items.`;
  }
  if (status === 409) {
    return `We couldn't ${action} because this data changed in another window. Refresh the widget and try again.`;
  }
  if (status === 413) {
    return `We couldn't ${action} because the upload is too large.`;
  }
  if (status === 503) {
    return `We couldn't ${action} because a required service is temporarily unavailable. Try again in a moment.`;
  }
  if (status >= 500) {
    return `We couldn't ${action} because the server hit an unexpected problem. Try again, or refresh the widget and try again.`;
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

function apiBodyErrorMessage(
  status: number,
  body: unknown,
  action: string,
): string {
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof body.error === "string" &&
    body.error.trim()
  ) {
    return body.error.trim();
  }
  return friendlyHttpError(status, action);
}

function clientErrorMessage(err: unknown, action: string): string {
  const message = err instanceof Error ? err.message.trim() : "";
  if (
    !message ||
    /^HTTP\s+\d+$/i.test(message) ||
    message === "Failed to fetch"
  ) {
    return `We couldn't ${action}. Check your connection, refresh the widget, and try again.`;
  }
  return message;
}

function countForFilter(
  summary: AdminWorkspaceMenuSummary,
  filter: MenuAttention | null,
): number {
  if (!filter) return summary.counts.items;
  return summary.counts.attention[filter];
}

function menuFilterFromWorkspaceFilter(
  filter: AdminWorkspaceMenuSummary["filter"],
): MenuFilterState {
  return {
    ...(filter.attention?.length ? { attention: filter.attention } : {}),
    ...(filter.category?.length ? { category: filter.category } : {}),
    ...(filter.badge ? { badge: filter.badge } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.stock ? { stock: filter.stock } : {}),
    ...(filter.query ? { query: filter.query } : {}),
  };
}

function primaryAttention(filter: MenuFilterState): MenuAttention | null {
  return filter.attention?.[0] ?? null;
}

function primaryCategory(filter: MenuFilterState): string | null {
  return filter.category?.[0] ?? null;
}

function filterAllowsReorder(filter: MenuFilterState): boolean {
  const withoutCategory: MenuFilterState = { ...filter };
  delete withoutCategory.category;
  return isMenuFilterEmpty(withoutCategory);
}

function filterQuery({
  filter,
  targetItemId,
}: {
  filter: MenuFilterState;
  targetItemId: string | null;
}) {
  const params = encodeFilter(filter);
  if (targetItemId) params.set("item", targetItemId);
  return params.toString();
}

function replaceWorkspaceMenuUrl({
  filter,
  targetItemId,
  method = "replace",
}: {
  filter: MenuFilterState;
  targetItemId: string | null;
  method?: HistoryMethod;
}) {
  const params = new URLSearchParams(window.location.search);
  params.set("widget", "menu");
  params.delete("status");
  params.delete("order");
  params.delete("id");
  params.delete("attention");
  params.delete("q");
  params.delete("category");
  params.delete("badge");
  params.delete("stock");
  params.delete("status");
  params.delete("item");

  const filterParams = encodeFilter(filter);
  filterParams.forEach((value, key) => params.append(key, value));
  if (targetItemId) params.set("item", targetItemId);

  const target = `/admin/workspace?${params.toString()}`;
  if (method === "push") {
    window.history.pushState(null, "", target);
  } else {
    window.history.replaceState(null, "", target);
  }
}

function visibilityClasses(state: WorkspaceMenuItemRow["visibilityState"]) {
  if (state === "live") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (state === "scheduled") return "border-sky-200 bg-sky-50 text-sky-800";
  if (state === "expired") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-stone-200 bg-stone-100 text-stone-600";
}

function stockClasses(tone: WorkspaceMenuItemRow["stockTone"]) {
  if (tone === "green") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (tone === "amber") return "border-amber-200 bg-amber-50 text-amber-900";
  if (tone === "red") return "border-red-200 bg-red-50 text-red-800";
  return "border-stone-200 bg-stone-50 text-stone-600";
}

function rowAddOnManagerFocus(
  row: WorkspaceMenuItemRow,
): WorkspaceAddOnManagerFocus | null {
  const groups = row.sharedModifierGroups;
  if (groups.length === 0) return null;

  const itemOptionIdsByGroupId = Object.fromEntries(
    groups.map((group) => [
      group.id,
      group.options
        .filter((option) => option.isActive && !option.isHidden)
        .map((option) => option.id),
    ]),
  );
  const firstGroup = groups[0];

  return {
    source: "item-editor-stock",
    itemId: row.id,
    itemName: row.name || "this item",
    itemLinkId: firstGroup.itemLinkId || firstGroup.id,
    groupId: firstGroup.id,
    optionIds: itemOptionIdsByGroupId[firstGroup.id] ?? [],
    itemGroupIds: groups.map((group) => group.id),
    itemOptionIdsByGroupId,
  };
}

function applyWorkspaceMenuOptimisticOrder(
  rows: WorkspaceMenuItemRow[],
  order: string[] | undefined,
): WorkspaceMenuItemRow[] {
  if (!order) return rows;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const orderedRows: WorkspaceMenuItemRow[] = [];
  for (const itemId of order) {
    const row = byId.get(itemId);
    if (!row) continue;
    orderedRows.push(row);
    byId.delete(itemId);
  }
  for (const row of rows) {
    if (byId.has(row.id)) orderedRows.push(row);
  }
  return orderedRows;
}

function OptionStockBadge({ stock }: { stock: WorkspaceMenuAddonOption["stock"] }) {
  const modeLabel = stock.mode === "QUANTITY" ? "Quantity" : "Manual";
  return (
    <span
      className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest ${stockClasses(
        stock.tone,
      )}`}
      title={`${modeLabel} stock: ${stock.label}`}
    >
      {stock.label}
    </span>
  );
}

function isDealEditorItem(
  item: MenuEditorItem,
  categories: MenuEditorCategory[],
): boolean {
  return categories.find((category) => category.id === item.categoryId)?.slug === "deals";
}

function newTempId(prefix: string): string {
  return `new-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeBlankWorkspaceItem(
  categoryId: string,
  sortOrder: number,
): MenuEditorItem {
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
    dealLimitMode: "UNLIMITED",
    dealLimitQty: null,
    dealLimitLowThreshold: null,
    dealLimitUpdatedAt: null,
    dealLimitUpdatedById: null,
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
    modifierContractMode: "LEGACY",
    modifierGroupLinks: [],
    sizes: [],
    addons: [],
    upgradeOptions: [],
  };
}

function makeBlankWorkspaceCategory(sortOrder: number): WorkspaceCategoryDraft {
  return {
    slug: "",
    name: "",
    icon: "🍽",
    sortOrder,
    isActive: true,
    updatedAt: "",
  };
}

function categoryDraftFromSummary(
  category: WorkspaceMenuCategoryOption,
): WorkspaceCategoryDraft {
  return {
    id: category.id,
    slug: category.slug,
    name: category.name,
    icon: category.icon,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
    updatedAt: category.updatedAt,
  };
}

function makeBlankWorkspaceDeal({
  categoryId,
  sortOrder,
  comboNum,
  defaultDiscountPct,
}: {
  categoryId: string;
  sortOrder: number;
  comboNum: number | null;
  defaultDiscountPct: number;
}): MenuEditorItem {
  return {
    ...makeBlankWorkspaceItem(categoryId, sortOrder),
    comboNum,
    name: "",
    description: "",
    isActive: false,
    dealStartsAt: defaultDealStartIso(),
    dealExpiresAt: defaultDealEndIso(),
    upgradeOptions: [
      {
        id: newTempId("upgrade"),
        customTitle: null,
        extraCharge: 0,
        savingsLabel: null,
        discountPct: defaultDiscountPct,
        sortOrder: 0,
        linkedItems: [],
      },
    ],
  };
}

function categorySlugForItem(
  context: WorkspaceMenuEditorContext,
  item: MenuEditorItem,
): string | null {
  return (
    context.categories.find((category) => category.id === item.categoryId)?.slug ??
    null
  );
}

function sortModifierGroups(groups: SharedModifierGroup[]) {
  return [...groups].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  );
}

function sortModifierOptions(options: SharedModifierOption[]) {
  return [...options].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  );
}

function modifierOptionStockFromSummary(summary: AdminWorkspaceMenuSummary) {
  const stockByOptionId = new Map<string, WorkspaceMenuOptionStockSummary>();
  for (const section of summary.sections) {
    for (const row of section.items) {
      for (const group of row.sharedModifierGroups) {
        for (const option of group.options) {
          stockByOptionId.set(option.id, option.stock);
        }
      }
    }
  }
  return stockByOptionId;
}

function mergeModifierOptionStock(
  option: SharedModifierOption,
  stockByOptionId: Map<string, WorkspaceMenuOptionStockSummary>,
) {
  const stock = stockByOptionId.get(option.id);
  if (!stock) return option;
  if (
    option.stockMode === stock.mode &&
    option.isOutOfStock === stock.isOutOfStock &&
    option.stockQty === stock.stockQty &&
    option.lowStockThreshold === stock.lowStockThreshold
  ) {
    return option;
  }
  return {
    ...option,
    stockMode: stock.mode,
    isOutOfStock: stock.isOutOfStock,
    stockQty: stock.stockQty,
    lowStockThreshold: stock.lowStockThreshold,
  };
}

function mergeModifierGroupStock(
  group: SharedModifierGroup,
  stockByOptionId: Map<string, WorkspaceMenuOptionStockSummary>,
) {
  let changed = false;
  const options = group.options.map((option) => {
    const nextOption = mergeModifierOptionStock(option, stockByOptionId);
    if (nextOption !== option) changed = true;
    return nextOption;
  });
  return changed ? { ...group, options } : group;
}

function mergeModifierLinkStock(
  link: ItemModifierGroupLink,
  stockByOptionId: Map<string, WorkspaceMenuOptionStockSummary>,
) {
  const modifierGroup = mergeModifierGroupStock(
    link.modifierGroup,
    stockByOptionId,
  );
  return modifierGroup === link.modifierGroup ? link : { ...link, modifierGroup };
}

function sortItemModifierLinks(links: ItemModifierGroupLink[]) {
  return [...links].sort(
    (a, b) =>
      a.sortOrder - b.sortOrder ||
      a.modifierGroup.name.localeCompare(b.modifierGroup.name),
  );
}

function mergeItemModifierLink(
  item: MenuEditorItem,
  link: ItemModifierGroupLink,
  itemLockVersion: number,
): MenuEditorItem {
  const links = item.modifierGroupLinks ?? [];
  const exists = links.some((candidate) => candidate.id === link.id);
  const mergedLinks = exists
    ? links.map((candidate) => (candidate.id === link.id ? link : candidate))
    : [...links, link];
  return {
    ...item,
    lockVersion: itemLockVersion,
    updatedAt: link.updatedAt,
    modifierGroupLinks: sortItemModifierLinks(mergedLinks),
  };
}

function mergeItemModifierOverride({
  item,
  linkId,
  optionId,
  override,
  itemLockVersion,
}: {
  item: MenuEditorItem;
  linkId: string;
  optionId: string;
  override: ItemModifierOptionOverride | null;
  itemLockVersion: number;
}): MenuEditorItem {
  return {
    ...item,
    lockVersion: itemLockVersion,
    updatedAt: override?.updatedAt ?? new Date().toISOString(),
    modifierGroupLinks: (item.modifierGroupLinks ?? []).map((link) => {
      if (link.id !== linkId) return link;
      const existingOverrides = link.optionOverrides ?? [];
      const nextOverrides = override
        ? existingOverrides.some((candidate) => candidate.id === override.id)
          ? existingOverrides.map((candidate) =>
              candidate.id === override.id ? override : candidate,
            )
          : [
              ...existingOverrides.filter(
                (candidate) => candidate.modifierOptionId !== optionId,
              ),
              override,
            ]
        : existingOverrides.filter(
            (candidate) => candidate.modifierOptionId !== optionId,
          );
      return { ...link, optionOverrides: nextOverrides };
    }),
  };
}

type ItemModifierOverrideFields = {
  isHidden: boolean;
  priceDeltaOverride: number | null;
  sortOrderOverride: number | null;
};

function itemModifierOverrideFields(
  override: ItemModifierOptionOverride | null | undefined,
): ItemModifierOverrideFields {
  return {
    isHidden: override?.isHidden ?? false,
    priceDeltaOverride: override?.priceDeltaOverride ?? null,
    sortOrderOverride: override?.sortOrderOverride ?? null,
  };
}

function itemModifierOverrideFieldsEqual(
  a: ItemModifierOverrideFields,
  b: ItemModifierOverrideFields,
) {
  return (
    a.isHidden === b.isHidden &&
    a.priceDeltaOverride === b.priceDeltaOverride &&
    a.sortOrderOverride === b.sortOrderOverride
  );
}

function isEmptyItemModifierOverrideFields(fields: ItemModifierOverrideFields) {
  return (
    !fields.isHidden &&
    fields.priceDeltaOverride == null &&
    fields.sortOrderOverride == null
  );
}

function DetailPill({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 px-2 py-1.5">
      <div className="text-[9px] font-black uppercase tracking-widest text-stone-400">
        {label}
      </div>
      <div className="mt-0.5 text-xs font-black text-stone-800">{value}</div>
    </div>
  );
}

function EmptyDetail({ children }: { children: string }) {
  return (
    <div className="rounded-lg border border-dashed border-stone-200 bg-white px-3 py-2 text-xs font-bold text-stone-400">
      {children}
    </div>
  );
}

function CategoryField({
  label,
  children,
  full = false,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <label
      className={`text-[10px] font-black uppercase tracking-widest text-stone-500 ${
        full ? "md:col-span-2" : ""
      }`}
    >
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function WorkspaceCategoryModal({
  draft,
  mode,
  assignedItemCount,
  saving,
  onChange,
  onCancel,
  onSave,
}: {
  draft: WorkspaceCategoryDraft;
  mode: "create" | "edit";
  assignedItemCount: number;
  saving: boolean;
  onChange: (next: WorkspaceCategoryDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const validation = validateCategoryInput(draft);
  const title = mode === "create" ? "Create category" : "Edit category";

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (!saving) onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel, saving]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="workspace-menu-category-modal"
        className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-stone-200 px-5 py-4">
          <div className="min-w-0">
            <div className="text-lg font-black text-stone-950">
              {title}
              <span className="text-stone-400"> · </span>
              <span className="text-stone-500">{draft.name || "-"}</span>
            </div>
            <div className="mt-1 text-[10px] font-black uppercase tracking-widest text-stone-400">
              Uses secured category routes and permission checks.
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-stone-500 hover:bg-stone-100 disabled:opacity-50"
          >
            Close
          </button>
        </div>

        <div className="grid gap-4 p-5 md:grid-cols-2">
          <CategoryField label="Name">
            <input
              value={draft.name}
              data-testid="workspace-menu-category-name"
              onChange={(event) => onChange({ ...draft, name: event.target.value })}
              className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm font-bold text-stone-900 outline-none focus:border-stone-900"
            />
          </CategoryField>
          <CategoryField label="Icon">
            <input
              value={draft.icon}
              data-testid="workspace-menu-category-icon"
              onChange={(event) => onChange({ ...draft, icon: event.target.value })}
              className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm font-bold text-stone-900 outline-none focus:border-stone-900"
            />
          </CategoryField>
          <CategoryField label="Slug">
            <input
              value={draft.slug}
              data-testid="workspace-menu-category-slug"
              onChange={(event) =>
                onChange({
                  ...draft,
                  slug: normalizeCategorySlug(event.target.value),
                })
              }
              className="mono w-full rounded-lg border border-stone-200 px-3 py-2 text-sm font-bold text-stone-900 outline-none focus:border-stone-900"
            />
          </CategoryField>
          <CategoryField label="Sort order">
            <input
              type="number"
              min={0}
              value={draft.sortOrder}
              data-testid="workspace-menu-category-sort-order"
              onChange={(event) =>
                onChange({ ...draft, sortOrder: Number(event.target.value) })
              }
              className="mono w-full rounded-lg border border-stone-200 px-3 py-2 text-sm font-bold text-stone-900 outline-none focus:border-stone-900"
            />
          </CategoryField>
          <CategoryField label="Live on kiosk" full>
            <label className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm font-bold normal-case text-stone-800">
              <input
                type="checkbox"
                checked={draft.isActive}
                data-testid="workspace-menu-category-live"
                onChange={(event) =>
                  onChange({ ...draft, isActive: event.target.checked })
                }
              />
              Show this category on the kiosk
            </label>
          </CategoryField>
          <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 md:col-span-2">
            <div className="text-[10px] font-black uppercase tracking-widest text-stone-400">
              Category status
            </div>
            <div className="mt-1 text-sm font-bold text-stone-800">
              {assignedItemCount} assigned item
              {assignedItemCount === 1 ? "" : "s"} ·{" "}
              {draft.isActive ? "visible on kiosk" : "hidden from kiosk"}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-stone-200 bg-stone-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-h-4 text-xs font-bold text-red-700">
            {validation.error ?? ""}
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="rounded-full border border-stone-200 bg-white px-4 py-2 text-[10px] font-black uppercase tracking-widest text-stone-800 hover:border-stone-400 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="workspace-menu-save-category"
              onClick={onSave}
              disabled={saving || !!validation.error}
              className="rounded-full bg-stone-950 px-5 py-2 text-[10px] font-black uppercase tracking-widest text-yellow-300 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save category"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkspaceDealHistoryModal({
  entries,
  serverNowIso,
  loading,
  error,
  canWriteMenu,
  restoringHistoryId,
  onClose,
  onRefresh,
  onUseAgain,
}: {
  entries: DealHistoryEntry[];
  serverNowIso: string;
  loading: boolean;
  error: string | null;
  canWriteMenu: boolean;
  restoringHistoryId: string | null;
  onClose: () => void;
  onRefresh: () => void;
  onUseAgain: (entry: DealHistoryEntry) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !restoringHistoryId) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Deal history"
        data-testid="workspace-menu-deal-history-modal"
        className="flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b-4 border-yellow-300 px-5 py-4">
          <div className="min-w-0">
            <div className="text-lg font-black text-stone-950">
              Restore a previous deal
            </div>
            <div className="mt-1 text-[10px] font-black uppercase tracking-widest text-stone-400">
              Opens a new Workspace draft. Nothing changes until you save.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading || restoringHistoryId != null}
              className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-4 py-2 text-[10px] font-black uppercase tracking-widest text-stone-700 hover:border-stone-400 disabled:opacity-50"
            >
              <RefreshCw
                size={13}
                strokeWidth={2.5}
                className={loading ? "animate-spin" : ""}
                aria-hidden
              />
              Refresh
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={restoringHistoryId != null}
              className="rounded-full border border-stone-200 bg-white px-4 py-2 text-[10px] font-black uppercase tracking-widest text-stone-700 hover:border-stone-400 disabled:opacity-50"
            >
              Close
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {loading && entries.length === 0 ? (
            <div className="rounded-xl border border-stone-200 bg-stone-50 p-8 text-center text-sm font-black text-stone-600">
              Loading deal history...
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
              {error}
            </div>
          ) : (
            <DealHistoryBrowser
              entries={entries}
              serverNowIso={serverNowIso}
              canWriteMenu={canWriteMenu}
              title="Deal history"
              subtitle="Choose a previous setup and restore it as an editable Workspace draft."
              showTitle={false}
              useAgainLabel="Restore as draft"
              restoringHistoryId={restoringHistoryId}
              onUseAgain={onUseAgain}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function WorkspaceAddonStockModal({
  target,
  busy,
  onClose,
  onSave,
}: {
  target: AddonStockEditorTarget;
  busy: boolean;
  onClose: () => void;
  onSave: (patch: WorkspaceOptionStockPatch) => void | Promise<void>;
}) {
  const { row, addon } = target;
  const dialogTitle = `workspace-addon-stock-title-${addon.id}`;
  const stockModeLabel =
    addon.stock.mode === "QUANTITY"
      ? `${addon.stock.stockQty ?? 0} on hand`
      : addon.stock.isOutOfStock
        ? "Manual out"
        : "Manual in";

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={dialogTitle}
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-stone-100 px-5 py-4">
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-widest text-stone-500">
              Item-specific add-on stock
            </div>
            <h2
              id={dialogTitle}
              className="mt-1 truncate text-2xl font-black text-stone-950"
            >
              {addon.name}
            </h2>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-xs font-bold text-stone-500">
              <span className="truncate">{row.name}</span>
              <span className="text-stone-300">·</span>
              <span className="mono">{addon.priceDeltaLabel}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full border border-stone-200 bg-white px-4 py-2 text-[10px] font-black uppercase tracking-widest text-stone-700 hover:border-stone-400 disabled:opacity-50"
          >
            Close
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-widest text-stone-500">
                Current stock
              </div>
              <div className="mt-1 text-sm font-black text-stone-900">
                {stockModeLabel}
              </div>
            </div>
            <OptionStockBadge stock={addon.stock} />
          </div>

          <WorkspaceOptionStockControls
            value={addon.stock}
            busy={busy}
            disabled={busy}
            onSave={onSave}
          />
        </div>
      </div>
    </div>
  );
}

function MenuRow({
  row,
  target,
  open,
  onToggle,
  canWriteMenu,
  editorLoading,
  stockBusy,
  visibilityBusy,
  reorderBusy,
  canReorder,
  dragging,
  dropTarget,
  onEdit,
  onToggleVisibility,
  onQuickStock,
  onEditAddonStock,
  onOpenAddOns,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  row: WorkspaceMenuItemRow;
  target: boolean;
  open: boolean;
  onToggle: () => void;
  canWriteMenu: boolean;
  editorLoading: boolean;
  stockBusy: boolean;
  visibilityBusy: boolean;
  reorderBusy: boolean;
  canReorder: boolean;
  dragging: boolean;
  dropTarget: boolean;
  onEdit: (itemId: string) => void;
  onToggleVisibility: (itemId: string) => void;
  onQuickStock: (itemId: string) => void;
  onEditAddonStock: (
    row: WorkspaceMenuItemRow,
    addon: WorkspaceMenuAddonOption,
  ) => void;
  onOpenAddOns: (row: WorkspaceMenuItemRow) => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: (event: DragEvent<HTMLButtonElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
}) {
  const canQuickToggleStock =
    canWriteMenu &&
    !row.isDeal &&
    row.visibilityState === "live";
  const canToggleItemVisibility = canWriteMenu && !row.isDeal;
  const rowHidden = row.visibilityState === "hidden";
  const unavailableForSale =
    !row.isDeal &&
    row.visibilityState === "live" &&
    row.stockDetails.manualOutOfStock;

  return (
    <div
      data-testid={target ? "workspace-menu-target-row" : "workspace-menu-row"}
      data-workspace-menu-category-id={row.categoryId}
      data-workspace-menu-item-id={row.id}
      aria-current={target ? "true" : undefined}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`overflow-hidden rounded-xl border ${
        // Outer card: border colors only. The active tint is applied to
        // the header strip below (and not the body) so inner sub-cards
        // — Sizes / Add-on sets / Deal — keep full contrast on a
        // neutral background. The yellow left rail is the primary
        // signal that says "this whole card is the active one."
        open
          ? "border-yellow-200 bg-white"
          : target
            ? "border-yellow-400 bg-white"
            : row.attention.length > 0
              ? "border-yellow-200 bg-white"
              : rowHidden
                ? "border-stone-200 bg-stone-50"
                : "border-stone-200 bg-white"
      } ${
        // Active-card accents. The left bar marks the open row at a
        // glance. The target ring (URL-focused row) layers on top — if
        // a row is both targeted and open, the ring wraps the card.
        open ? "border-l-4 border-l-yellow-500" : ""
      } ${target ? "ring-2 ring-yellow-300 ring-offset-2" : ""} ${
        dropTarget ? "ring-2 ring-yellow-300 ring-offset-1" : ""
      }`}
      style={{
        opacity: dragging ? 0.55 : undefined,
        boxShadow: dropTarget ? "inset 0 3px 0 #facc15" : undefined,
      }}
    >
      <div
        // Header gets the active tint when open. Outer card stays white
        // and body returns to neutral — only the title strip is
        // highlighted, so the inner sub-cards aren't competing with a
        // full yellow wash.
        className={`grid w-full grid-cols-[24px_minmax(0,1fr)] items-center gap-2 px-3 py-3 text-left ${
          open ? "bg-yellow-50" : ""
        }`}
      >
        {canReorder ? (
          <button
            type="button"
            data-no-drag
            data-testid="workspace-menu-reorder-handle"
            draggable={!reorderBusy}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            disabled={reorderBusy}
            aria-label={`Drag to reorder ${row.name}`}
            title={reorderBusy ? "Reorder in progress..." : "Drag to reorder"}
            className="flex h-9 w-6 cursor-grab items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
          >
            <GripVertical size={15} strokeWidth={2.5} aria-hidden />
          </button>
        ) : (
          <span aria-hidden />
        )}
        <button
          type="button"
          onClick={onToggle}
          className="grid w-full grid-cols-[44px_minmax(0,1fr)_92px_120px_112px_24px] items-center gap-3 text-left"
          aria-expanded={open}
          aria-controls={`workspace-menu-detail-${row.id}`}
        >
          <div
            className={`flex h-9 w-9 items-center justify-center text-2xl ${
              rowHidden ? "opacity-70 grayscale" : ""
            }`}
            aria-hidden
          >
            {row.emoji}
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <div
                className={`truncate text-sm font-black ${
                  rowHidden ? "text-stone-600" : "text-stone-950"
                }`}
              >
                {row.name}
              </div>
              {row.badge && (
                <span className="rounded-full border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-stone-600">
                  {row.badge}
                </span>
              )}
              {row.attention.map((attention) => (
                <span
                  key={attention}
                  data-testid="workspace-menu-attention-chip"
                  className="rounded-full border border-yellow-200 bg-yellow-50 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-amber-900"
                >
                  {ATTENTION_LABELS[attention]}
                </span>
              ))}
            </div>
            {/* Category prefix was here ("Burgers · …"); dropped because
                the row is rendered visually indented under its category
                card, so the parent is communicated by position rather than
                by repeating the name in every subtitle. */}
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold text-stone-500">
              {row.description && (
                <span className="truncate">{row.description}</span>
              )}
              {row.optionSummary.length > 0 && (
                <>
                  {row.description && (
                    <span className="text-stone-300">·</span>
                  )}
                  <span>{row.optionSummary.join(" · ")}</span>
                </>
              )}
              {row.dealExpiresLabel && (
                <>
                  {(row.description || row.optionSummary.length > 0) && (
                    <span className="text-stone-300">·</span>
                  )}
                  <span>{row.dealExpiresLabel}</span>
                </>
              )}
            </div>
          </div>
          <div className="mono text-right text-sm font-black text-stone-950">
            {row.priceLabel}
          </div>
          <div className="flex flex-col items-end gap-1">
            <span
              className={`rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-widest ${visibilityClasses(
                row.visibilityState,
              )}`}
            >
              {row.visibilityState}
            </span>
            {rowHidden && !row.isDeal ? (
              <span className="max-w-[128px] text-right text-[10px] font-bold leading-tight text-stone-500">
                Not on kiosk
              </span>
            ) : row.visibilityReason ? (
              <span className="max-w-[128px] text-right text-[10px] font-bold leading-tight text-stone-500">
                {row.visibilityReason}
              </span>
            ) : null}
          </div>
          <div className="flex flex-col items-end gap-1 text-right">
            <span
              className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-widest ${stockClasses(
                row.stockTone,
              )}`}
            >
              {row.stockLabel}
            </span>
            {unavailableForSale && (
              <span className="max-w-[128px] text-right text-[10px] font-bold leading-tight text-stone-500">
                Cannot order
              </span>
            )}
          </div>
          <ChevronDown
            size={16}
            strokeWidth={2.5}
            className="text-stone-400 transition-transform"
            style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
            aria-hidden
          />
        </button>
      </div>

      {open && (
        // Body bg is neutral so inner sub-cards (Sizes / Add-on sets /
        // Deal) keep full contrast. The yellow left rail on the outer
        // card already binds header + body as one active block, so the
        // body itself doesn't need the tint.
        <div
          id={`workspace-menu-detail-${row.id}`}
          data-testid="workspace-menu-row-detail"
          className="border-t border-stone-100 bg-stone-50/70 px-3 py-3"
        >
          {rowHidden && !row.isDeal && (
            <div
              data-testid="workspace-menu-item-hidden-helper"
              className="mb-3 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-bold text-stone-600"
            >
              Customers cannot see this item on the kiosk.
            </div>
          )}
          {unavailableForSale && (
            <div
              data-testid="workspace-menu-item-out-of-stock-helper"
              className="mb-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs font-bold text-red-800"
            >
              Customers can see this item, but cannot order it.
            </div>
          )}
          <div
            className={`mb-3 flex flex-wrap items-center gap-3 ${
              row.isDeal ? "justify-end" : "justify-between"
            }`}
          >
            {!row.isDeal && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <DetailPill label="Stock mode" value={row.stockDetails.mode} />
                <DetailPill
                  label="Qty"
                  value={
                    row.stockDetails.qty == null
                      ? "-"
                      : String(row.stockDetails.qty)
                  }
                />
                <DetailPill
                  label="Low threshold"
                  value={
                    row.stockDetails.lowStockThreshold == null
                      ? "-"
                      : String(row.stockDetails.lowStockThreshold)
                  }
                />
                <DetailPill
                  label={
                    row.stockDetails.mode === "QUANTITY"
                      ? "Selling"
                      : "Manual stock"
                  }
                  value={
                    row.stockDetails.mode === "QUANTITY"
                      ? row.stockDetails.manualOutOfStock
                        ? "Paused"
                        : "Selling"
                      : row.stockDetails.manualOutOfStock
                        ? "Out"
                        : "Available"
                  }
                />
              </div>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {canQuickToggleStock && (
                <button
                  type="button"
                  data-no-drag
                  data-testid="workspace-menu-quick-stock"
                  onClick={(event) => {
                    event.stopPropagation();
                    onQuickStock(row.id);
                  }}
                  disabled={stockBusy}
                  aria-label={
                    row.stockDetails.mode === "QUANTITY"
                      ? row.stockDetails.manualOutOfStock
                        ? `Resume selling ${row.name}`
                        : `Pause selling ${row.name}`
                      : row.stockDetails.manualOutOfStock
                        ? `Mark ${row.name} in stock`
                        : `Mark ${row.name} out of stock`
                  }
                  title={
                    row.stockDetails.mode === "QUANTITY"
                      ? row.stockDetails.manualOutOfStock
                        ? "Resume selling"
                        : "Pause selling"
                      : row.stockDetails.manualOutOfStock
                        ? "Mark in stock"
                        : "Mark out of stock"
                  }
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-[10px] font-black uppercase tracking-widest transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 ${
                    row.stockDetails.manualOutOfStock
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-red-200 bg-red-50 text-red-800"
                  }`}
                >
                  {stockBusy
                    ? "Updating"
                    : row.stockDetails.mode === "QUANTITY"
                      ? row.stockDetails.manualOutOfStock
                        ? "Resume selling"
                        : "Pause selling"
                      : row.stockDetails.manualOutOfStock
                        ? "Mark in stock"
                        : "Mark out of stock"}
                </button>
              )}
              {canToggleItemVisibility && (
                <button
                  type="button"
                  data-no-drag
                  data-testid="workspace-menu-toggle-item-visibility"
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleVisibility(row.id);
                  }}
                  disabled={visibilityBusy}
                  aria-label={
                    rowHidden
                      ? `Show item ${row.name}`
                      : `Hide item ${row.name}`
                  }
                  title={rowHidden ? "Show item" : "Hide item"}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-[10px] font-black uppercase tracking-widest transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 ${
                    rowHidden
                      ? "border-stone-300 bg-white text-stone-700 hover:border-stone-500"
                      : "border-stone-200 bg-white text-stone-700 hover:border-stone-400"
                  }`}
                >
                  {visibilityBusy ? (
                    "Updating"
                  ) : rowHidden ? (
                    <>
                      <EyeOff size={12} strokeWidth={2.5} aria-hidden />
                      Show item
                    </>
                  ) : (
                    <>
                      <Eye size={12} strokeWidth={2.5} aria-hidden />
                      Hide item
                    </>
                  )}
                </button>
              )}
              {canWriteMenu && (
                <button
                  type="button"
                  data-no-drag
                  data-testid="workspace-menu-edit-item"
                  onClick={(event) => {
                    event.stopPropagation();
                    onEdit(row.id);
                  }}
                  disabled={editorLoading}
                  className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-stone-800 hover:border-stone-400 disabled:opacity-60"
                >
                  <Pencil size={12} strokeWidth={2.5} aria-hidden />
                  {editorLoading ? "Opening" : "Edit"}
                </button>
              )}
              {canWriteMenu && !row.isDeal && (
                <button
                  type="button"
                  data-no-drag
                  data-testid="workspace-menu-open-addons"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenAddOns(row);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-stone-800 hover:border-stone-400"
                >
                  <SlidersHorizontal size={12} strokeWidth={2.5} aria-hidden />
                  Manage Add-ons
                </button>
              )}
            </div>
          </div>

          <div
            className={`grid gap-3 ${
              row.isDeal ? "lg:grid-cols-1" : "lg:grid-cols-3"
            }`}
          >
            {!row.isDeal && (
              <>
                <div>
                  <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-stone-500">
                    Sizes
                  </div>
                  {row.sizeOptions.length > 0 ? (
                    <div className="space-y-1.5">
                      {row.sizeOptions.map((size) => (
                        <div
                          key={size.id}
                          className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs"
                        >
                          <span className="font-black text-stone-800">
                            {size.name}
                          </span>
                          <span className="mono font-black text-stone-600">
                            {size.priceDeltaLabel}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyDetail>No sizes.</EmptyDetail>
                  )}
                </div>

                <div>
                  <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-stone-500">
                    Add-on sets
                  </div>
                  {row.sharedModifierGroups.length > 0 ? (
                    <div className="space-y-2">
                      {row.sharedModifierGroups
                        .map((group) => ({
                          group,
                          // Inline preview renders the same option subset the
                          // kiosk shows for this item: isActive && !isHidden.
                          // Out-of-stock options stay visible (with their
                          // OptionStockBadge) because the kiosk renders those
                          // disabled, not hidden. Hidden/inactive options are
                          // managed in the Edit Item modal and the Add-ons
                          // manager respectively; the visibleOptionCount/
                          // activeOptionCount badge on the header already
                          // signals "some options are unavailable or not
                          // orderable" (it counts hidden AND out-of-stock out
                          // of active).
                          previewOptions: group.options.filter(
                            (option) => option.isActive && !option.isHidden,
                          ),
                        }))
                        .filter(({ previewOptions }) => previewOptions.length > 0)
                        .map(({ group, previewOptions }) => (
                          // Set card — matches the recommended preset used by
                          // SharedModifiersWorkspacePanel (the Edit Item
                          // modal): stone-100 tinted header band + 1px
                          // separator + white option rows.
                          <div
                            key={group.id}
                            className="overflow-hidden rounded-lg border border-stone-200 bg-white text-xs"
                          >
                            <div className="border-b border-stone-200 bg-stone-100 px-3 py-2">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate font-black text-stone-900">
                                    {group.name}
                                  </div>
                                  <div className="mt-0.5 text-[10px] font-bold text-stone-500">
                                    {group.selectionLabel} · {group.ruleLabel}
                                  </div>
                                </div>
                                <span
                                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${
                                    group.visibleOptionCount > 0
                                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                      : "border-amber-200 bg-amber-50 text-amber-900"
                                  }`}
                                >
                                  {group.visibleOptionCount}/{group.activeOptionCount}
                                </span>
                              </div>
                              {group.description && (
                                <div className="mt-1 text-[11px] font-semibold text-stone-600">
                                  {group.description}
                                </div>
                              )}
                            </div>
                            <div className="space-y-1.5 px-3 py-2">
                              {previewOptions.slice(0, 4).map((option) => (
                                // Filtered options are guaranteed
                                // visible-and-active; no muted branch.
                                <div
                                  key={option.id}
                                  className="flex items-center justify-between gap-2 rounded-md border border-stone-100 bg-white px-2 py-1.5"
                                >
                                  <span className="min-w-0 truncate font-bold text-stone-700">
                                    {option.name}
                                  </span>
                                  <div className="flex shrink-0 items-center gap-1.5">
                                    <OptionStockBadge stock={option.stock} />
                                    {option.hasPriceOverride && (
                                      <span className="rounded-full border border-yellow-200 bg-yellow-50 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest text-stone-700">
                                        Custom
                                      </span>
                                    )}
                                    <span className="mono font-black text-stone-600">
                                      {option.effectivePriceDeltaLabel}
                                    </span>
                                  </div>
                                </div>
                              ))}
                              {previewOptions.length > 4 && (
                                <div className="text-[10px] font-bold text-stone-500">
                                  +{previewOptions.length - 4} more option
                                  {previewOptions.length - 4 === 1 ? "" : "s"}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      {row.sharedModifierGroups.every((group) =>
                        group.options.every(
                          (option) => !option.isActive || option.isHidden,
                        ),
                      ) && (
                        <EmptyDetail>No visible add-on options.</EmptyDetail>
                      )}
                    </div>
                  ) : (
                    <EmptyDetail>No add-on sets.</EmptyDetail>
                  )}
                </div>
              </>
            )}

            <div>
              <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-stone-500">
                {row.isDeal ? "Deal contents" : "Deal"}
              </div>
              {row.isDeal ? (
                <div className="space-y-2">
                  {row.baseItem && (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs">
                      <span className="font-black uppercase tracking-widest text-stone-500">
                        Base item
                      </span>
                      <span className="font-black text-stone-900">
                        {row.baseItem.name}
                        {row.baseItem.sizeName
                          ? ` · ${row.baseItem.sizeName}`
                          : ""}
                      </span>
                      {(row.baseItem.statusLabel !== "Live" ||
                        row.baseItem.stockLabel !== "Base ok") && (
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${stockClasses(
                            row.baseItem.tone,
                          )}`}
                        >
                          {row.baseItem.stockLabel !== "Base ok"
                            ? row.baseItem.stockLabel
                            : row.baseItem.statusLabel}
                        </span>
                      )}
                    </div>
                  )}
                  {row.dealOptions.length > 0 ? (
                    row.dealOptions.map((option) => (
                      <div
                        key={option.id}
                        className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="min-w-0 truncate font-black text-stone-900">
                            {option.title}
                          </span>
                          <span className="mono font-black text-stone-600">
                            {option.extraChargeLabel}
                          </span>
                        </div>
                        {option.savingsLabel && (
                          <div className="mt-1 text-[10px] font-bold text-emerald-700">
                            {option.savingsLabel}
                          </div>
                        )}
                        <div className="mt-2 space-y-1.5">
                          {option.linkedItems.map((linked) => (
                            <div
                              key={linked.id}
                              className="flex items-center justify-between gap-3 rounded-md bg-stone-50 px-2 py-1.5"
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                <span
                                  data-testid="workspace-menu-deal-linked-icon"
                                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-stone-200 text-base"
                                  style={{ background: linked.bgColor }}
                                  aria-hidden
                                >
                                  {linked.emoji}
                                </span>
                                <span className="min-w-0 truncate font-bold text-stone-700">
                                  {linked.name}
                                  {linked.sizeName ? ` · ${linked.sizeName}` : ""}
                                </span>
                              </div>
                              <span className="shrink-0 text-[10px] font-black uppercase tracking-widest text-stone-500">
                                {linked.priceLabel ?? linked.statusLabel}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  ) : (
                    <EmptyDetail>No deal options.</EmptyDetail>
                  )}
                </div>
              ) : (
                <EmptyDetail>Standard item.</EmptyDetail>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminWorkspaceMenuWidget({
  summary: initialSummary,
  focusRequest,
  canWriteMenu,
  notify,
}: {
  summary: AdminWorkspaceMenuSummary;
  focusRequest: AdminWorkspaceMenuFocusRequest | null;
  canWriteMenu: boolean;
  notify: AdminWorkspaceNotify;
}) {
  const initialFilterState = menuFilterFromWorkspaceFilter(initialSummary.filter);
  const [summary, setSummary] = useState(initialSummary);
  const [filterState, setFilterState] =
    useState<MenuFilterState>(initialFilterState);
  const [selectedAttention, setSelectedAttention] = useState<MenuAttention | null>(
    primaryAttention(initialFilterState),
  );
  const [queryText, setQueryText] = useState(initialFilterState.query ?? "");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(
    primaryCategory(initialFilterState),
  );
  const [targetItemId, setTargetItemId] = useState<string | null>(
    initialSummary.filter.targetItemId,
  );
  const [openItemId, setOpenItemId] = useState<string | null>(
    initialSummary.filter.targetItemId,
  );
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editorContext, setEditorContext] =
    useState<WorkspaceMenuEditorContext | null>(null);
  const [editingItem, setEditingItem] = useState<MenuEditorItem | null>(null);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("edit");
  const [editingCategory, setEditingCategory] =
    useState<WorkspaceCategoryDraft | null>(null);
  const [categoryBaseline, setCategoryBaseline] =
    useState<WorkspaceCategoryDraft | null>(null);
  const [categoryMode, setCategoryMode] = useState<"create" | "edit">("edit");
  const [editorLoadingItemId, setEditorLoadingItemId] = useState<string | null>(
    null,
  );
  const [createLoading, setCreateLoading] = useState<"item" | "deal" | null>(
    null,
  );
  const [editorError, setEditorError] = useState<string | null>(null);
  const [itemSaving, setItemSaving] = useState(false);
  const [categorySaving, setCategorySaving] = useState(false);
  const [categoryBusyId, setCategoryBusyId] = useState<string | null>(null);
  const [reorderCategoryId, setReorderCategoryId] = useState<string | null>(null);
  const [optimisticOrderByCategory, setOptimisticOrderByCategory] = useState<
    Map<string, string[]>
  >(() => new Map());
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const draggedItemIdRef = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    categoryId: string;
    itemId: string;
  } | null>(null);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [quickStockItemId, setQuickStockItemId] = useState<string | null>(null);
  const [addonStockBusyKey, setAddonStockBusyKey] = useState<string | null>(null);
  const [addonStockEditor, setAddonStockEditor] =
    useState<AddonStockEditorTarget | null>(null);
  const [dealHistoryOpen, setDealHistoryOpen] = useState(false);
  const [dealHistoryEntries, setDealHistoryEntries] = useState<DealHistoryEntry[]>(
    [],
  );
  const [dealHistoryServerNowIso, setDealHistoryServerNowIso] = useState(
    initialSummary.generatedAt,
  );
  const [dealHistoryLoading, setDealHistoryLoading] = useState(false);
  const [dealHistoryError, setDealHistoryError] = useState<string | null>(null);
  const [restoringHistoryId, setRestoringHistoryId] = useState<string | null>(null);
  const [modifierLibraryOpen, setModifierLibraryOpen] = useState(false);
  const [modifierLibraryFocusGroupId, setModifierLibraryFocusGroupId] = useState<
    string | null
  >(null);
  const [modifierLibraryFocusContext, setModifierLibraryFocusContext] =
    useState<WorkspaceAddOnManagerFocus | null>(null);
  const [modifierLibraryLoading, setModifierLibraryLoading] = useState(false);
  const [modifierLibraryError, setModifierLibraryError] = useState<string | null>(
    null,
  );
  const [sharedModifierBusyKey, setSharedModifierBusyKey] = useState<
    string | null
  >(null);
  const [filterBuilderOpen, setFilterBuilderOpen] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const filterStateRef = useRef<MenuFilterState>(initialFilterState);
  const selectedAttentionRef = useRef<MenuAttention | null>(
    primaryAttention(initialFilterState),
  );
  const queryRef = useRef(initialFilterState.query ?? "");
  const selectedCategoryRef = useRef<string | null>(
    primaryCategory(initialFilterState),
  );
  const targetItemIdRef = useRef<string | null>(initialSummary.filter.targetItemId);
  const handledFocusRequestRef = useRef<number | null>(null);
  const refreshRef = useRef<
    ((
      filter?: MenuFilterState,
      itemId?: string | null,
    ) => Promise<void>) | null
  >(null);

  // Toolbar push-toggle (proposal demo at
  // docs/proposal/widget-sticky-headers-option-c.html). The toolbar lives in
  // its own height-toggled slot ABOVE the scroll area. At scrollTop=0 the
  // toolbar is visible naturally. When scrolled past ~160 px the toolbar
  // collapses and a top-center "Show toolbar" button appears. Click toggles
  // the manual override (which pushes the toolbar back in without scrolling).
  // manualOpen resets to false whenever the user scrolls back to the top so
  // the next scroll-down behaves the same way (toolbar collapses).
  const menuScrollRef = useRef<HTMLDivElement | null>(null);
  const [showSummon, setShowSummon] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const toolbarOpen = !showSummon || manualOpen;

  function setOptimisticOrder(categoryId: string, order: string[] | null) {
    setOptimisticOrderByCategory((current) => {
      const next = new Map(current);
      if (order) next.set(categoryId, order);
      else next.delete(categoryId);
      return next;
    });
  }

  function clearReorderDragState() {
    draggedItemIdRef.current = null;
    setDraggedItemId(null);
    setDropTarget(null);
  }

  useEffect(() => {
    if (optimisticOrderByCategory.size === 0) return;
    const next = new Map(optimisticOrderByCategory);
    let changed = false;

    for (const [categoryId, order] of optimisticOrderByCategory) {
      const section = summary.sections.find(
        (candidate) => candidate.category.id === categoryId,
      );
      if (!section || section.items.length !== order.length) continue;
      const currentOrder = section.items.map((row) => row.id);
      if (currentOrder.every((itemId, index) => itemId === order[index])) {
        next.delete(categoryId);
        changed = true;
      }
    }

    if (changed) setOptimisticOrderByCategory(next);
  }, [optimisticOrderByCategory, summary.sections]);

  function menuItemNoun(item: MenuEditorItem): "Deal" | "Item" {
    return editorContext && isDealEditorItem(item, editorContext.categories)
      ? "Deal"
      : "Item";
  }

  function notifyAfterModalClose(toast: Parameters<AdminWorkspaceNotify>[0]) {
    window.setTimeout(() => notify(toast), 160);
  }

  function applyEditorItemUpdate(updatedItem: MenuEditorItem) {
    setEditingItem((current) =>
      current?.id === updatedItem.id ? updatedItem : current,
    );
    setEditorContext((current) =>
      current
        ? {
            ...current,
            items: current.items.map((candidate) =>
              candidate.id === updatedItem.id ? updatedItem : candidate,
            ),
          }
        : current,
    );
  }

  function applyEditorItemLockVersion(itemId: string, itemLockVersion: number) {
    setEditingItem((current) =>
      current?.id === itemId
        ? { ...current, lockVersion: itemLockVersion }
        : current,
    );
    setEditorContext((current) =>
      current
        ? {
            ...current,
            items: current.items.map((candidate) =>
              candidate.id === itemId
                ? { ...candidate, lockVersion: itemLockVersion }
                : candidate,
            ),
          }
        : current,
    );
  }

  function applyModifierGroupUpdate(updatedGroup: SharedModifierGroup) {
    setEditorContext((current) => {
      if (!current) return current;
      const existingGroup = current.modifierGroups.find(
        (group) => group.id === updatedGroup.id,
      );
      const mergedGroup: SharedModifierGroup = {
        ...(existingGroup ?? {
	          activeItemLinkCount: 0,
	          totalItemLinkCount: 0,
	          attachmentHistoryCount: 0,
	          optionOverrideCount: 0,
	          canHardDelete: true,
	        }),
        ...updatedGroup,
        activeItemLinkCount:
          updatedGroup.activeItemLinkCount ??
          existingGroup?.activeItemLinkCount ??
          0,
	        totalItemLinkCount:
	          updatedGroup.totalItemLinkCount ??
	          existingGroup?.totalItemLinkCount ??
	          0,
	        attachmentHistoryCount:
	          updatedGroup.attachmentHistoryCount ??
	          existingGroup?.attachmentHistoryCount ??
	          0,
	        optionOverrideCount:
	          updatedGroup.optionOverrideCount ??
	          existingGroup?.optionOverrideCount ??
          0,
        canHardDelete:
          updatedGroup.canHardDelete ??
          existingGroup?.canHardDelete ??
          true,
      };
      const exists = current.modifierGroups.some(
        (group) => group.id === updatedGroup.id,
      );
      return {
        ...current,
        modifierGroups: sortModifierGroups(
          exists
            ? current.modifierGroups.map((group) =>
                group.id === updatedGroup.id ? mergedGroup : group,
              )
            : [...current.modifierGroups, mergedGroup],
        ),
        items: current.items.map((item) => ({
          ...item,
          modifierGroupLinks: (item.modifierGroupLinks ?? []).map((link) =>
            link.modifierGroupId === updatedGroup.id
              ? { ...link, modifierGroup: mergedGroup }
              : link,
          ),
        })),
      };
    });
    setEditingItem((current) =>
      current
        ? {
            ...current,
            modifierGroupLinks: (current.modifierGroupLinks ?? []).map((link) =>
              link.modifierGroupId === updatedGroup.id
                ? { ...link, modifierGroup: { ...link.modifierGroup, ...updatedGroup } }
                : link,
            ),
          }
        : current,
    );
  }

  function applyModifierOptionUpdate(
    groupId: string,
    option: SharedModifierOption,
    groupLockVersion: number,
  ) {
    setEditorContext((current) => {
      if (!current) return current;
      const group = current.modifierGroups.find((candidate) => candidate.id === groupId);
      if (!group) return current;
      const optionExists = group.options.some(
        (candidate) => candidate.id === option.id,
      );
      const updatedGroup: SharedModifierGroup = {
        ...group,
        lockVersion: groupLockVersion,
        updatedAt: option.updatedAt,
        options: (optionExists
          ? group.options.map((candidate) =>
              candidate.id === option.id ? option : candidate,
            )
          : [...group.options, option]
        ).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
      };
      const groups = current.modifierGroups.map((candidate) =>
        candidate.id === groupId ? updatedGroup : candidate,
      );
      return {
        ...current,
        modifierGroups: sortModifierGroups(groups),
        items: current.items.map((item) => ({
          ...item,
          modifierGroupLinks: (item.modifierGroupLinks ?? []).map((link) =>
            link.modifierGroupId === groupId
              ? { ...link, modifierGroup: updatedGroup }
              : link,
          ),
        })),
      };
    });
    setEditingItem((current) => {
      if (!current) return current;
      return {
        ...current,
        modifierGroupLinks: (current.modifierGroupLinks ?? []).map((link) => {
          if (link.modifierGroupId !== groupId) return link;
          const optionExists = link.modifierGroup.options.some(
            (candidate) => candidate.id === option.id,
          );
          const updatedGroup = {
            ...link.modifierGroup,
            lockVersion: groupLockVersion,
            updatedAt: option.updatedAt,
            options: (optionExists
              ? link.modifierGroup.options.map((candidate) =>
                  candidate.id === option.id ? option : candidate,
                )
              : [...link.modifierGroup.options, option]
            ).sort(
              (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
            ),
          };
          return { ...link, modifierGroup: updatedGroup };
        }),
      };
    });
  }

  function removeModifierGroup(groupId: string) {
    setEditorContext((current) =>
      current
        ? {
            ...current,
            modifierGroups: current.modifierGroups.filter(
              (group) => group.id !== groupId,
            ),
            items: current.items.map((item) => ({
              ...item,
              modifierGroupLinks: (item.modifierGroupLinks ?? []).filter(
                (link) => link.modifierGroupId !== groupId,
              ),
            })),
          }
        : current,
    );
    setEditingItem((current) =>
      current
        ? {
            ...current,
            modifierGroupLinks: (current.modifierGroupLinks ?? []).filter(
              (link) => link.modifierGroupId !== groupId,
            ),
          }
        : current,
    );
  }

  function removeModifierOption(
    groupId: string,
    optionId: string,
    groupLockVersion: number,
  ) {
    setEditorContext((current) => {
      if (!current) return current;
      const group = current.modifierGroups.find((candidate) => candidate.id === groupId);
      if (!group) return current;
      const updatedGroup: SharedModifierGroup = {
        ...group,
        lockVersion: groupLockVersion,
        options: group.options.filter((option) => option.id !== optionId),
      };
      return {
        ...current,
        modifierGroups: sortModifierGroups(
          current.modifierGroups.map((candidate) =>
            candidate.id === groupId ? updatedGroup : candidate,
          ),
        ),
        items: current.items.map((item) => ({
          ...item,
          modifierGroupLinks: (item.modifierGroupLinks ?? []).map((link) =>
            link.modifierGroupId === groupId
              ? {
                  ...link,
                  modifierGroup: updatedGroup,
                  optionOverrides: (link.optionOverrides ?? []).filter(
                    (override) => override.modifierOptionId !== optionId,
                  ),
                }
              : link,
          ),
        })),
      };
    });
    setEditingItem((current) => {
      if (!current) return current;
      return {
        ...current,
        modifierGroupLinks: (current.modifierGroupLinks ?? []).map((link) =>
          link.modifierGroupId === groupId
            ? {
                ...link,
                modifierGroup: {
                  ...link.modifierGroup,
                  lockVersion: groupLockVersion,
                  options: link.modifierGroup.options.filter(
                    (option) => option.id !== optionId,
                  ),
                },
                optionOverrides: (link.optionOverrides ?? []).filter(
                  (override) => override.modifierOptionId !== optionId,
                ),
              }
            : link,
        ),
      };
    });
  }

  function applyCategoryUpdate(savedCategory: WorkspaceMenuCategoryOption) {
    setSummary((current) => ({
      ...current,
      categories: current.categories.map((category) =>
        category.id === savedCategory.id ? savedCategory : category,
      ),
      sections: current.sections.map((section) =>
        section.category.id === savedCategory.id
          ? {
              ...section,
              category: {
                ...section.category,
                slug: savedCategory.slug,
                name: savedCategory.name,
                icon: savedCategory.icon,
                isActive: savedCategory.isActive,
              },
            }
          : section,
      ),
    }));
    setEditorContext((current) =>
      current
        ? {
            ...current,
            categories: current.categories.map((category) =>
              category.id === savedCategory.id
                ? {
                    ...category,
                    slug: savedCategory.slug,
                    name: savedCategory.name,
                    icon: savedCategory.icon,
                    sortOrder: savedCategory.sortOrder,
                    isActive: savedCategory.isActive,
                  }
                : category,
            ),
          }
        : current,
    );
  }

  useEffect(() => {
    const nextFilter = menuFilterFromWorkspaceFilter(initialSummary.filter);
    setSummary(initialSummary);
    setFilterState(nextFilter);
    setSelectedAttention(primaryAttention(nextFilter));
    setQueryText(nextFilter.query ?? "");
    setSelectedCategory(primaryCategory(nextFilter));
    setTargetItemId(initialSummary.filter.targetItemId);
    setOpenItemId(initialSummary.filter.targetItemId);
    filterStateRef.current = nextFilter;
    selectedAttentionRef.current = primaryAttention(nextFilter);
    queryRef.current = nextFilter.query ?? "";
    selectedCategoryRef.current = primaryCategory(nextFilter);
    targetItemIdRef.current = initialSummary.filter.targetItemId;
    setRefreshError(null);
  }, [initialSummary]);

  useEffect(() => {
    const stockByOptionId = modifierOptionStockFromSummary(summary);
    if (stockByOptionId.size === 0) return;

    setEditorContext((current) => {
      if (!current) return current;
      let changed = false;
      const modifierGroups = current.modifierGroups.map((group) => {
        const nextGroup = mergeModifierGroupStock(group, stockByOptionId);
        if (nextGroup !== group) changed = true;
        return nextGroup;
      });
      const items = current.items.map((item) => {
        let itemChanged = false;
        const modifierGroupLinks = (item.modifierGroupLinks ?? []).map((link) => {
          const nextLink = mergeModifierLinkStock(link, stockByOptionId);
          if (nextLink !== link) itemChanged = true;
          return nextLink;
        });
        if (!itemChanged) return item;
        changed = true;
        return { ...item, modifierGroupLinks };
      });
      return changed ? { ...current, modifierGroups, items } : current;
    });

    setEditingItem((current) => {
      if (!current) return current;
      let changed = false;
      const modifierGroupLinks = (current.modifierGroupLinks ?? []).map((link) => {
        const nextLink = mergeModifierLinkStock(link, stockByOptionId);
        if (nextLink !== link) changed = true;
        return nextLink;
      });
      return changed ? { ...current, modifierGroupLinks } : current;
    });
  }, [summary]);

  useEffect(() => {
    let closed = false;

    async function refresh(
      filter = filterStateRef.current,
      itemId = targetItemIdRef.current,
    ) {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      setRefreshing(true);
      try {
        const query = filterQuery({
          filter,
          targetItemId: itemId,
        });
        const response = await fetch(
          `/api/admin/workspace/menu/summary${query ? `?${query}` : ""}`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(displayFetchError(response.status, body));
        }
        if (!closed) {
          setSummary(body as AdminWorkspaceMenuSummary);
          setRefreshError(null);
        }
      } catch (error) {
        if (!controller.signal.aborted && !closed) {
          setRefreshError((error as Error).message);
        }
      } finally {
        if (requestRef.current === controller) {
          requestRef.current = null;
          if (!closed) setRefreshing(false);
        }
      }
    }

    refreshRef.current = refresh;
    return () => {
      closed = true;
      requestRef.current?.abort();
      requestRef.current = null;
      if (refreshRef.current === refresh) refreshRef.current = null;
    };
  }, []);

  useEffect(() => {
    const pollInterval = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void refreshRef.current?.();
    }, WORKSPACE_MENU_REFRESH_MS);

    function refreshWhenVisible() {
      if (document.visibilityState === "hidden") return;
      void refreshRef.current?.();
    }

    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      clearInterval(pollInterval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  useEffect(() => {
    if (!focusRequest) return;
    if (handledFocusRequestRef.current === focusRequest.id) return;

    handledFocusRequestRef.current = focusRequest.id;
    const nextFilter: MenuFilterState = {
      ...(focusRequest.attention ? { attention: [focusRequest.attention] } : {}),
      ...(focusRequest.query.trim() ? { query: focusRequest.query.trim() } : {}),
      ...(focusRequest.category ? { category: [focusRequest.category] } : {}),
    };
    filterStateRef.current = nextFilter;
    selectedAttentionRef.current = primaryAttention(nextFilter);
    queryRef.current = nextFilter.query ?? "";
    selectedCategoryRef.current = primaryCategory(nextFilter);
    targetItemIdRef.current = focusRequest.targetItemId;
    setFilterState(nextFilter);
    setSelectedAttention(primaryAttention(nextFilter));
    setQueryText(nextFilter.query ?? "");
    setSelectedCategory(primaryCategory(nextFilter));
    setTargetItemId(focusRequest.targetItemId);
    setOpenItemId(focusRequest.targetItemId);
    void refreshRef.current?.(nextFilter, focusRequest.targetItemId);
    if (focusRequest.action?.type === "openDealHistory") {
      openDealHistory();
    } else if (focusRequest.action?.type === "restoreDealFromHistory") {
      void restoreDealFromHistory(focusRequest.action.entry);
    }
  }, [focusRequest]);

  // Toggle the summon button + reset manual override based on scroll position.
  // Threshold of 160 px is enough that the toolbar (title row + actions + chips
  // + search ≈ 200 px) is mostly out of view before the button fades in.
  // Resetting manualOpen at the top ensures the next scroll-down behaves the
  // same way (auto-collapse) — otherwise a user who clicked Show, scrolled to
  // top, then scrolled down would find the toolbar still wedged open.
  useEffect(() => {
    const el = menuScrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const scrolled = el.scrollTop > 160;
      setShowSummon(scrolled);
      if (!scrolled) setManualOpen(false);
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  function updateWorkspaceFilter(
    nextFilter: MenuFilterState,
    method: HistoryMethod,
    nextTargetItemId: string | null = null,
  ) {
    const normalized: MenuFilterState = {
      ...(nextFilter.attention?.length ? { attention: nextFilter.attention } : {}),
      ...(nextFilter.category?.length ? { category: nextFilter.category } : {}),
      ...(nextFilter.badge ? { badge: nextFilter.badge } : {}),
      ...(nextFilter.status ? { status: nextFilter.status } : {}),
      ...(nextFilter.stock ? { stock: nextFilter.stock } : {}),
      ...(nextFilter.query?.trim() ? { query: nextFilter.query.trim() } : {}),
    };
    filterStateRef.current = normalized;
    selectedAttentionRef.current = primaryAttention(normalized);
    queryRef.current = normalized.query ?? "";
    selectedCategoryRef.current = primaryCategory(normalized);
    targetItemIdRef.current = nextTargetItemId;
    setFilterState(normalized);
    setSelectedAttention(primaryAttention(normalized));
    setQueryText(normalized.query ?? "");
    setSelectedCategory(primaryCategory(normalized));
    setTargetItemId(nextTargetItemId);
    setOpenItemId(nextTargetItemId);
    replaceWorkspaceMenuUrl({
      filter: normalized,
      targetItemId: nextTargetItemId,
      method,
    });
    void refreshRef.current?.(normalized, nextTargetItemId);
  }

  const setSingleFilter = <K extends MenuFilterStructuredKey | "query">(
    key: K,
    value: MenuFilterState[K],
    method: HistoryMethod,
  ) => {
    const next = { ...filterStateRef.current };
    if (value == null || value === "") {
      delete next[key];
    } else {
      (next as Record<string, unknown>)[key] = value;
    }
    updateWorkspaceFilter(next, method);
  };

  function clearAllFilters() {
    updateWorkspaceFilter({}, "push");
  }

  function selectAttention(attention: MenuAttention | null) {
    updateWorkspaceFilter(attention ? { attention: [attention] } : {}, "push");
  }

  function selectCategory(category: string | null) {
    const next = { ...filterStateRef.current };
    if (category) next.category = [category];
    else delete next.category;
    updateWorkspaceFilter(next, "push");
  }

  function refreshAfterItemRemoved(itemId: string) {
    const wasTarget = targetItemIdRef.current === itemId;
    const nextTarget = wasTarget ? null : targetItemIdRef.current;
    if (wasTarget) {
      targetItemIdRef.current = null;
      setTargetItemId(null);
      replaceWorkspaceMenuUrl({
        filter: filterStateRef.current,
        targetItemId: null,
      });
    }
    setOpenItemId((current) => (current === itemId ? null : current));
    void refreshRef.current?.(filterStateRef.current, nextTarget);
  }

  async function loadEditorContext(
    action: string,
  ): Promise<WorkspaceMenuEditorContext> {
    const response = await fetch("/api/admin/workspace/menu/editor-context", {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(await apiErrorMessage(response, action));
    }
    const rawContext = (await response.json()) as WorkspaceMenuEditorContext;
    const context = {
      ...rawContext,
      modifierGroups: rawContext.modifierGroups ?? [],
      items: rawContext.items.map((item) => ({
        ...item,
        modifierContractMode: item.modifierContractMode ?? "LEGACY",
        modifierGroupLinks: item.modifierGroupLinks ?? [],
      })),
    };
    setEditorContext(context);
    return context;
  }

  async function loadEditorItem(
    itemId: string,
    action: string,
  ): Promise<{ context: WorkspaceMenuEditorContext; item: MenuEditorItem }> {
    const context = await loadEditorContext(action);
    const item = context.items.find((candidate) => candidate.id === itemId);
    if (!item) {
      throw new Error(
        "This menu item is no longer available. Refresh the widget and try again.",
      );
    }
    return { context, item };
  }

  function activeModifierGroupLinks(item: MenuEditorItem): ItemModifierGroupLink[] {
    return (item.modifierGroupLinks ?? []).filter((link) => link.isActive);
  }

  function isDraftModifierGroup(groupId: string) {
    return groupId.startsWith("new-group-");
  }

  async function createDraftModifierGroupOnSave(
    link: ItemModifierGroupLink,
    sortOrder: number,
  ): Promise<SharedModifierGroup> {
    const draftGroup = link.modifierGroup;
    const options = sortModifierOptions(
      draftGroup.options.filter((option) => option.isActive),
    );
    if (options.length === 0) {
      throw new Error("Add-on set needs at least one option.");
    }

    const groupResponse = await fetch("/api/admin/modifier-groups", {
      method: "POST",
      referrer: window.location.href,
      referrerPolicy: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: draftGroup.name,
        description: draftGroup.description,
        selectionMode: draftGroup.selectionMode,
        minSelect: draftGroup.minSelect,
        maxSelect: draftGroup.maxSelect,
        sortOrder,
        isActive: true,
      }),
    });
    const groupBody = (await groupResponse.json().catch(() => ({}))) as ModifierGroupResponse;
    if (!groupResponse.ok || !groupBody.group) {
      throw new Error(
        apiBodyErrorMessage(
          groupResponse.status,
          groupBody,
          "create this add-on set",
        ),
      );
    }

    let savedGroup: SharedModifierGroup = groupBody.group;
    for (const [index, option] of options.entries()) {
      const optionResponse = await fetch(
        `/api/admin/modifier-groups/${savedGroup.id}/options`,
        {
          method: "POST",
          referrer: window.location.href,
          referrerPolicy: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lockVersion: savedGroup.lockVersion,
            name: option.name,
            priceDelta: option.priceDelta,
            sortOrder: index,
            isActive: true,
            stockMode: option.stockMode ?? "MANUAL",
            isOutOfStock: Boolean(option.isOutOfStock),
            stockQty:
              option.stockMode === "QUANTITY" ? option.stockQty ?? 0 : null,
            lowStockThreshold:
              option.stockMode === "QUANTITY"
                ? option.lowStockThreshold ?? null
                : null,
          }),
        },
      );
      const optionBody = (await optionResponse.json().catch(() => ({}))) as ModifierOptionResponse;
      if (
        !optionResponse.ok ||
        !optionBody.option ||
        optionBody.groupLockVersion == null
      ) {
        throw new Error(
          apiBodyErrorMessage(
            optionResponse.status,
            optionBody,
            "create this add-on option",
          ),
        );
      }
      savedGroup = {
        ...savedGroup,
        lockVersion: optionBody.groupLockVersion,
        updatedAt: optionBody.option.updatedAt,
        options: sortModifierOptions([...savedGroup.options, optionBody.option]),
      };
    }

    applyModifierGroupUpdate(savedGroup);
    return savedGroup;
  }

  async function syncDraftModifierGroupLinksOnSave({
    originalItem,
    draftItem,
    savedItem,
  }: {
    originalItem: MenuEditorItem;
    draftItem: MenuEditorItem;
    savedItem: MenuEditorItem;
  }): Promise<MenuEditorItem> {
    const originalActive = activeModifierGroupLinks(originalItem);
    const draftActive = activeModifierGroupLinks(draftItem);
    const originalGroupIds = new Set(
      originalActive.map((link) => link.modifierGroupId),
    );
    const draftGroupIds = new Set(draftActive.map((link) => link.modifierGroupId));
    const linksToDetach = originalActive.filter(
      (link) => !draftGroupIds.has(link.modifierGroupId),
    );
    const linksToAttach = draftActive.filter(
      (link) => !originalGroupIds.has(link.modifierGroupId),
    );
    const hasOptionOverrideChanges = draftActive.some((draftLink) => {
      const originalLink = originalActive.find(
        (candidate) => candidate.modifierGroupId === draftLink.modifierGroupId,
      );
      const originalOverrides = new Map(
        (originalLink?.optionOverrides ?? []).map((override) => [
          override.modifierOptionId,
          override,
        ]),
      );
      const draftOverrides = new Map(
        (draftLink.optionOverrides ?? []).map((override) => [
          override.modifierOptionId,
          override,
        ]),
      );
      const optionIds = new Set([
        ...originalOverrides.keys(),
        ...draftOverrides.keys(),
      ]);
      return [...optionIds].some((optionId) => {
        if (optionId.startsWith("new-option-")) return false;
        return !itemModifierOverrideFieldsEqual(
          itemModifierOverrideFields(originalOverrides.get(optionId)),
          itemModifierOverrideFields(draftOverrides.get(optionId)),
        );
      });
    });

    if (
      linksToDetach.length === 0 &&
      linksToAttach.length === 0 &&
      !hasOptionOverrideChanges
    ) {
      return savedItem;
    }

    let currentItem: MenuEditorItem = {
      ...savedItem,
      modifierGroupLinks:
        savedItem.modifierGroupLinks ?? originalItem.modifierGroupLinks ?? [],
    };

    setSharedModifierBusyKey("save:item-add-on-sets");
    try {
      for (const link of linksToDetach) {
        const response = await fetch(
          `/api/admin/items/${currentItem.id}/modifier-groups/${link.id}`,
          {
            method: "DELETE",
            referrer: window.location.href,
            referrerPolicy: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lockVersion: currentItem.lockVersion }),
          },
        );
        const body = (await response.json().catch(() => ({}))) as ItemModifierLinkResponse;
        if (!response.ok || !body.link || body.itemLockVersion == null) {
          throw new Error(
            apiBodyErrorMessage(
              response.status,
              body,
              "save this item's add-on sets",
            ),
          );
        }
        currentItem = mergeItemModifierLink(
          currentItem,
          body.link,
          body.itemLockVersion,
        );
      }

      let createdGroupCount = 0;
      for (const link of linksToAttach) {
        const modifierGroup = isDraftModifierGroup(link.modifierGroupId)
          ? await createDraftModifierGroupOnSave(
              link,
              (editorContext?.modifierGroups.length ?? 0) + createdGroupCount++,
            )
          : link.modifierGroup;
        const activeLinkCount = activeModifierGroupLinks(currentItem).length;
        const response = await fetch(
          `/api/admin/items/${currentItem.id}/modifier-groups`,
          {
            method: "POST",
            referrer: window.location.href,
            referrerPolicy: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              lockVersion: currentItem.lockVersion,
              modifierGroupId: modifierGroup.id,
              sortOrder: activeLinkCount,
              minSelectOverride: link.minSelectOverride,
              maxSelectOverride: link.maxSelectOverride,
              isActive: true,
            }),
          },
        );
        const body = (await response.json().catch(() => ({}))) as ItemModifierLinkResponse;
        if (!response.ok || !body.link || body.itemLockVersion == null) {
          throw new Error(
            apiBodyErrorMessage(
              response.status,
              body,
              "save this item's add-on sets",
            ),
          );
        }
        currentItem = mergeItemModifierLink(
          currentItem,
          body.link,
          body.itemLockVersion,
        );
      }

      for (const draftLink of draftActive) {
        const persistedLink = activeModifierGroupLinks(currentItem).find(
          (candidate) => candidate.modifierGroupId === draftLink.modifierGroupId,
        );
        if (!persistedLink || persistedLink.id.startsWith("new-link-")) {
          continue;
        }

        const originalLink = originalActive.find(
          (candidate) => candidate.modifierGroupId === draftLink.modifierGroupId,
        );
        const originalOverrides = new Map(
          (originalLink?.optionOverrides ?? []).map((override) => [
            override.modifierOptionId,
            override,
          ]),
        );
        const draftOverrides = new Map(
          (draftLink.optionOverrides ?? []).map((override) => [
            override.modifierOptionId,
            override,
          ]),
        );
        const optionIds = new Set([
          ...originalOverrides.keys(),
          ...draftOverrides.keys(),
        ]);

        for (const optionId of optionIds) {
          if (optionId.startsWith("new-option-")) continue;
          const originalOverride = originalOverrides.get(optionId) ?? null;
          const draftOverride = draftOverrides.get(optionId) ?? null;
          const originalFields = itemModifierOverrideFields(originalOverride);
          const draftFields = itemModifierOverrideFields(draftOverride);
          if (itemModifierOverrideFieldsEqual(originalFields, draftFields)) {
            continue;
          }

          if (isEmptyItemModifierOverrideFields(draftFields)) {
            const response = await fetch(
              `/api/admin/items/${currentItem.id}/modifier-groups/${persistedLink.id}/options/${optionId}`,
              {
                method: "DELETE",
                referrer: window.location.href,
                referrerPolicy: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ lockVersion: currentItem.lockVersion }),
              },
            );
            const body = (await response.json().catch(() => ({}))) as ItemModifierOverrideResponse;
            if (!response.ok || body.itemLockVersion == null) {
              throw new Error(
                apiBodyErrorMessage(
                  response.status,
                  body,
                  "save this item's add-on option visibility",
                ),
              );
            }
            currentItem = mergeItemModifierOverride({
              item: currentItem,
              linkId: persistedLink.id,
              optionId,
              override: null,
              itemLockVersion: body.itemLockVersion,
            });
            continue;
          }

          const response = await fetch(
            `/api/admin/items/${currentItem.id}/modifier-groups/${persistedLink.id}/options/${optionId}`,
            {
              method: "PATCH",
              referrer: window.location.href,
              referrerPolicy: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                lockVersion: currentItem.lockVersion,
                isHidden: draftFields.isHidden,
                priceDeltaOverride: draftFields.priceDeltaOverride,
                sortOrderOverride: draftFields.sortOrderOverride,
              }),
            },
          );
          const body = (await response.json().catch(() => ({}))) as ItemModifierOverrideResponse;
          if (!response.ok || body.itemLockVersion == null) {
            throw new Error(
              apiBodyErrorMessage(
                response.status,
                body,
                "save this item's add-on option visibility",
              ),
            );
          }
          currentItem = mergeItemModifierOverride({
            item: currentItem,
            linkId: persistedLink.id,
            optionId,
            override: body.override ?? null,
            itemLockVersion: body.itemLockVersion,
          });
        }
      }

      try {
        const loaded = await loadEditorItem(
          currentItem.id,
          "refresh saved add-on sets",
        );
        return loaded.item;
      } catch {
        return currentItem;
      }
    } finally {
      setSharedModifierBusyKey(null);
    }
  }

  async function openEditor(itemId: string) {
    if (!canWriteMenu) return;
    setEditorLoadingItemId(itemId);
    setEditorError(null);
    try {
      const { item } = await loadEditorItem(itemId, "open this item editor");
      setEditorMode("edit");
      setEditingItem(item);
    } catch (error) {
      setEditorError(clientErrorMessage(error, "open this item editor"));
    } finally {
      setEditorLoadingItemId(null);
    }
  }

  async function startCreateItem() {
    if (!canWriteMenu) return;
    setCreateLoading("item");
    setEditorError(null);
    try {
      const context = await loadEditorContext("start a new item");
      const nonDealCategories = context.categories.filter(
        (category) => category.slug !== "deals",
      );
      const selectedNonDealCategory =
        selectedCategoryRef.current != null
          ? nonDealCategories.find(
              (category) => category.slug === selectedCategoryRef.current,
            ) ?? null
          : null;
      const category =
        selectedNonDealCategory ??
        nonDealCategories.find((candidate) => candidate.isActive) ??
        nonDealCategories[0] ??
        null;
      if (!category) {
        throw new Error(
          "Create a non-deal category before adding Workspace items.",
        );
      }
      const sortOrder = context.items.filter(
        (item) => item.categoryId === category.id,
      ).length;
      setEditorMode("create");
      setEditingItem(makeBlankWorkspaceItem(category.id, sortOrder));
    } catch (error) {
      const message = clientErrorMessage(error, "start a new item");
      setEditorError(message);
      window.alert(message);
    } finally {
      setCreateLoading(null);
    }
  }

  async function startCreateDeal() {
    if (!canWriteMenu) return;
    setCreateLoading("deal");
    setEditorError(null);
    try {
      const context = await loadEditorContext("start a new deal");
      const dealsCategory =
        context.categories.find((category) => category.slug === "deals") ?? null;
      if (!dealsCategory) {
        throw new Error(
          "Create a Deals category before adding Workspace deals.",
        );
      }
      const dealItems = context.items.filter(
        (item) => item.categoryId === dealsCategory.id,
      );
      const usedComboNums = dealItems
        .map((item) => item.comboNum)
        .filter((value): value is number => typeof value === "number");
      const nextComboNum =
        usedComboNums.length > 0 ? Math.max(...usedComboNums) + 1 : 1;
      setEditorMode("create");
      setEditingItem(
        makeBlankWorkspaceDeal({
          categoryId: dealsCategory.id,
          sortOrder: dealItems.length,
          comboNum: nextComboNum,
          defaultDiscountPct: context.dealDefaultDiscountPct ?? 12,
        }),
      );
    } catch (error) {
      const message = clientErrorMessage(error, "start a new deal");
      setEditorError(message);
      window.alert(message);
    } finally {
      setCreateLoading(null);
    }
  }

  async function loadDealHistory() {
    setDealHistoryLoading(true);
    setDealHistoryError(null);
    try {
      const response = await fetch("/api/admin/deals/history?limit=100", {
        cache: "no-store",
      });
      const body = (await response.json().catch(() => ({}))) as DealHistoryApiResponse;
      if (!response.ok) {
        throw new Error(displayFetchError(response.status, body));
      }
      setDealHistoryEntries(body.entries ?? []);
      setDealHistoryServerNowIso(body.serverNowIso ?? new Date().toISOString());
    } catch (error) {
      setDealHistoryError(
        clientErrorMessage(error, "load deal history for Workspace"),
      );
    } finally {
      setDealHistoryLoading(false);
    }
  }

  function openDealHistory() {
    setDealHistoryOpen(true);
    void loadDealHistory();
  }

  async function openModifierLibrary(
    groupId?: string,
    focusContext?: WorkspaceAddOnManagerFocus,
  ) {
    if (!canWriteMenu) return;
    setModifierLibraryFocusGroupId(groupId ?? null);
    setModifierLibraryFocusContext(focusContext ?? null);
    setModifierLibraryOpen(true);
    setModifierLibraryError(null);
    setModifierLibraryLoading(true);
    try {
      await loadEditorContext("open Add-ons");
    } catch (error) {
      setModifierLibraryError(
        clientErrorMessage(error, "open Add-ons"),
      );
    } finally {
      setModifierLibraryLoading(false);
    }
  }

  async function refreshModifierLibrary() {
    setModifierLibraryLoading(true);
    setModifierLibraryError(null);
    try {
      await loadEditorContext("refresh Add-ons");
    } catch (error) {
      setModifierLibraryError(
        clientErrorMessage(error, "refresh Add-ons"),
      );
    } finally {
      setModifierLibraryLoading(false);
    }
  }

  async function createModifierGroupWithFirstOption(input: {
    group: {
      name: string;
      description: string | null;
      selectionMode: SharedModifierGroup["selectionMode"];
      minSelect: number;
      maxSelect: number | null;
    };
    firstOption: {
      name: string;
      priceDelta: number;
      stockMode: "MANUAL" | "QUANTITY";
      isOutOfStock: boolean;
      stockQty: number | null;
      lowStockThreshold: number | null;
    };
  }): Promise<SharedModifierGroup | null> {
    if (!canWriteMenu) return null;
    setSharedModifierBusyKey("group:create");
    setModifierLibraryError(null);
    try {
      const response = await fetch(
        "/api/admin/modifier-groups/with-first-option",
        {
          method: "POST",
          referrer: window.location.href,
          referrerPolicy: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            group: {
              ...input.group,
              sortOrder: editorContext?.modifierGroups.length ?? 0,
              isActive: true,
            },
            firstOption: {
              ...input.firstOption,
              sortOrder: 0,
              isActive: true,
            },
          }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as ModifierGroupResponse;
      if (!response.ok || !body.group) {
        throw new Error(
          apiBodyErrorMessage(response.status, body, "create this add-on set"),
        );
      }
      applyModifierGroupUpdate(body.group);
      notify({ message: `Add-on set created: ${body.group.name}` });
      return body.group;
    } catch (error) {
      const message = clientErrorMessage(error, "create this add-on set");
      setModifierLibraryError(message);
      window.alert(message);
      return null;
    } finally {
      setSharedModifierBusyKey(null);
    }
  }

  async function updateModifierGroup(
    group: SharedModifierGroup,
    fields: Partial<{
      name: string;
      description: string | null;
      selectionMode: SharedModifierGroup["selectionMode"];
      minSelect: number;
      maxSelect: number | null;
      isActive: boolean;
    }>,
  ) {
    if (!canWriteMenu) return;
    setSharedModifierBusyKey(`group:${group.id}`);
    setModifierLibraryError(null);
    try {
      const response = await fetch(`/api/admin/modifier-groups/${group.id}`, {
        method: "PATCH",
        referrer: window.location.href,
        referrerPolicy: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lockVersion: group.lockVersion, ...fields }),
      });
      const body = (await response.json().catch(() => ({}))) as ModifierGroupResponse;
      if (!response.ok || !body.group) {
        throw new Error(
          apiBodyErrorMessage(response.status, body, "update this add-on set"),
        );
      }
      applyModifierGroupUpdate(body.group);
      notify({ message: `Add-on set saved: ${body.group.name}` });
      void refreshRef.current?.();
    } catch (error) {
      const message = clientErrorMessage(error, "update this add-on set");
      setModifierLibraryError(message);
      window.alert(message);
    } finally {
      setSharedModifierBusyKey(null);
    }
  }

  async function saveModifierGroupDraft(
    group: SharedModifierGroup,
    input: {
      group: {
        name: string;
        description: string | null;
        selectionMode: SharedModifierGroup["selectionMode"];
        minSelect: number;
        maxSelect: number | null;
      };
      options: Array<{
        id: string;
        name: string;
        priceDelta: number;
        isActive: boolean;
        stockMode: "MANUAL" | "QUANTITY";
        isOutOfStock: boolean;
        stockQty: number | null;
        lowStockThreshold: number | null;
      }>;
    },
  ) {
    if (!canWriteMenu) return;
    setSharedModifierBusyKey(`group:${group.id}`);
    setModifierLibraryError(null);
    try {
      const response = await fetch(`/api/admin/modifier-groups/${group.id}/save`, {
        method: "PATCH",
        referrer: window.location.href,
        referrerPolicy: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lockVersion: group.lockVersion, ...input }),
      });
      const body = (await response.json().catch(() => ({}))) as ModifierGroupResponse;
      if (!response.ok || !body.group) {
        throw new Error(
          apiBodyErrorMessage(response.status, body, "save this add-on set"),
        );
      }
      applyModifierGroupUpdate(body.group);
      notify({ message: `Add-on set saved: ${body.group.name}` });
      void refreshRef.current?.();
    } catch (error) {
      const message = clientErrorMessage(error, "save this add-on set");
      setModifierLibraryError(message);
      window.alert(message);
    } finally {
      setSharedModifierBusyKey(null);
    }
  }

  async function deactivateModifierGroup(group: SharedModifierGroup) {
    if (!canWriteMenu) return;
    if (!window.confirm(`Hide "${group.name}"? Attached items will stop using it.`)) {
      return;
    }
    setSharedModifierBusyKey(`group:${group.id}`);
    setModifierLibraryError(null);
    try {
      const response = await fetch(`/api/admin/modifier-groups/${group.id}`, {
        method: "DELETE",
        referrer: window.location.href,
        referrerPolicy: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lockVersion: group.lockVersion }),
      });
      const body = (await response.json().catch(() => ({}))) as ModifierGroupResponse;
      if (!response.ok || !body.group) {
        throw new Error(
          apiBodyErrorMessage(
            response.status,
            body,
            "hide this add-on set",
          ),
        );
      }
      applyModifierGroupUpdate(body.group);
      notify({ message: `Add-on set hidden: ${body.group.name}` });
      void refreshRef.current?.();
    } catch (error) {
      const message = clientErrorMessage(error, "hide this add-on set");
      setModifierLibraryError(message);
      window.alert(message);
    } finally {
      setSharedModifierBusyKey(null);
    }
  }

  async function hardDeleteModifierGroup(group: SharedModifierGroup) {
    if (!canWriteMenu) return;
    if (
      !window.confirm(
        `Delete "${group.name}" permanently? This is only allowed for add-on sets that were never attached to a menu item.`,
      )
    ) {
      return;
    }
    setSharedModifierBusyKey(`group:${group.id}:delete`);
    setModifierLibraryError(null);
    try {
      const response = await fetch(
        `/api/admin/modifier-groups/${group.id}/hard-delete`,
        {
          method: "POST",
          referrer: window.location.href,
          referrerPolicy: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lockVersion: group.lockVersion }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as ModifierGroupDeleteResponse;
      if (!response.ok || !body.deleted) {
        throw new Error(
          apiBodyErrorMessage(response.status, body, "delete this add-on set"),
        );
      }
      removeModifierGroup(body.groupId ?? group.id);
      notify({ message: `Add-on set deleted: ${body.groupName ?? group.name}` });
      void refreshRef.current?.();
    } catch (error) {
      const message = clientErrorMessage(error, "delete this add-on set");
      setModifierLibraryError(message);
      window.alert(message);
    } finally {
      setSharedModifierBusyKey(null);
    }
  }

  async function createModifierOption(
    group: SharedModifierGroup,
    input: { name: string; priceDelta: number },
  ) {
    if (!canWriteMenu) return;
    setSharedModifierBusyKey(`option:create:${group.id}`);
    setModifierLibraryError(null);
    try {
      const response = await fetch(`/api/admin/modifier-groups/${group.id}/options`, {
        method: "POST",
        referrer: window.location.href,
        referrerPolicy: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lockVersion: group.lockVersion,
          name: input.name,
          priceDelta: input.priceDelta,
          sortOrder: group.options.length,
          isActive: true,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as ModifierOptionResponse;
      if (!response.ok || !body.option || body.groupLockVersion == null) {
        throw new Error(
          apiBodyErrorMessage(response.status, body, "create this add-on option"),
        );
      }
      applyModifierOptionUpdate(group.id, body.option, body.groupLockVersion);
      notify({ message: `Add-on option created: ${body.option.name}` });
      void refreshRef.current?.();
    } catch (error) {
      const message = clientErrorMessage(error, "create this add-on option");
      setModifierLibraryError(message);
      window.alert(message);
    } finally {
      setSharedModifierBusyKey(null);
    }
  }

  async function updateModifierOption(
    group: SharedModifierGroup,
    option: SharedModifierOption,
    fields: Partial<{
      name: string;
      priceDelta: number;
      isActive: boolean;
    }>,
  ) {
    if (!canWriteMenu) return;
    setSharedModifierBusyKey(`option:${option.id}`);
    setModifierLibraryError(null);
    try {
      const response = await fetch(
        `/api/admin/modifier-groups/${group.id}/options/${option.id}`,
        {
          method: "PATCH",
          referrer: window.location.href,
          referrerPolicy: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lockVersion: group.lockVersion, ...fields }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as ModifierOptionResponse;
      if (!response.ok || !body.option || body.groupLockVersion == null) {
        throw new Error(
          apiBodyErrorMessage(response.status, body, "update this add-on option"),
        );
      }
      applyModifierOptionUpdate(group.id, body.option, body.groupLockVersion);
      notify({ message: `Add-on option saved: ${body.option.name}` });
      void refreshRef.current?.();
    } catch (error) {
      const message = clientErrorMessage(error, "update this add-on option");
      setModifierLibraryError(message);
      window.alert(message);
    } finally {
      setSharedModifierBusyKey(null);
    }
  }

  async function deactivateModifierOption(
    group: SharedModifierGroup,
    option: SharedModifierOption,
  ) {
    if (!canWriteMenu) return;
    setSharedModifierBusyKey(`option:${option.id}`);
    setModifierLibraryError(null);
    try {
      const response = await fetch(
        `/api/admin/modifier-groups/${group.id}/options/${option.id}`,
        {
          method: "DELETE",
          referrer: window.location.href,
          referrerPolicy: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lockVersion: group.lockVersion }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as ModifierOptionResponse;
      if (!response.ok || !body.option || body.groupLockVersion == null) {
        throw new Error(
          apiBodyErrorMessage(
            response.status,
            body,
            "hide this add-on option",
          ),
        );
      }
      applyModifierOptionUpdate(group.id, body.option, body.groupLockVersion);
      notify({ message: `Add-on option hidden: ${body.option.name}` });
      void refreshRef.current?.();
    } catch (error) {
      const message = clientErrorMessage(error, "hide this add-on option");
      setModifierLibraryError(message);
      window.alert(message);
    } finally {
      setSharedModifierBusyKey(null);
    }
  }

  async function hardDeleteModifierOption(
    group: SharedModifierGroup,
    option: SharedModifierOption,
  ) {
    if (!canWriteMenu) return;
    if (
      !window.confirm(
        `Delete "${option.name}" permanently? This is only allowed before the add-on set has ever been attached to a menu item.`,
      )
    ) {
      return;
    }
    setSharedModifierBusyKey(`option:${option.id}:delete`);
    setModifierLibraryError(null);
    try {
      const response = await fetch(
        `/api/admin/modifier-groups/${group.id}/options/${option.id}/hard-delete`,
        {
          method: "POST",
          referrer: window.location.href,
          referrerPolicy: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lockVersion: group.lockVersion }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as ModifierOptionDeleteResponse;
      if (!response.ok || !body.deleted || body.groupLockVersion == null) {
        throw new Error(
          apiBodyErrorMessage(response.status, body, "delete this add-on option"),
        );
      }
      removeModifierOption(
        body.groupId ?? group.id,
        body.optionId ?? option.id,
        body.groupLockVersion,
      );
      notify({ message: `Add-on option deleted: ${body.optionName ?? option.name}` });
      void refreshRef.current?.();
    } catch (error) {
      const message = clientErrorMessage(error, "delete this add-on option");
      setModifierLibraryError(message);
      window.alert(message);
    } finally {
      setSharedModifierBusyKey(null);
    }
  }

  async function restoreDealFromHistory(entry: DealHistoryEntry) {
    if (!canWriteMenu) return;
    setRestoringHistoryId(entry.historyId);
    setEditorError(null);
    try {
      const context = await loadEditorContext("restore this deal");
      const dealsCategory =
        context.categories.find((category) => category.slug === "deals") ?? null;
      if (!dealsCategory) {
        throw new Error(
          "Create a Deals category before restoring Workspace deals.",
        );
      }

      const dealItems = context.items.filter(
        (item) => item.categoryId === dealsCategory.id,
      );
      const usedComboNums = dealItems
        .map((item) => item.comboNum)
        .filter((value): value is number => typeof value === "number");
      const nextComboNum =
        usedComboNums.length > 0 ? Math.max(...usedComboNums) + 1 : 1;

      setEditorMode("create");
      setEditingItem(
        makeDealDraftFromHistorySnapshot({
          snapshot: entry.dealSnapshot,
          dealsCategory,
          allItems: context.items,
          categories: context.categories,
          sortOrder: dealItems.length,
          comboNum: nextComboNum,
          defaultDiscountPct: context.dealDefaultDiscountPct ?? 12,
        }),
      );
      setDealHistoryOpen(false);
    } catch (error) {
      const message = clientErrorMessage(error, "restore this deal");
      setEditorError(message);
      window.alert(message);
    } finally {
      setRestoringHistoryId(null);
    }
  }

  function startCreateCategory() {
    if (!canWriteMenu) return;
    const draft = makeBlankWorkspaceCategory(summary.categories.length);
    setCategoryMode("create");
    setCategoryBaseline(draft);
    setEditingCategory(draft);
    setEditorError(null);
  }

  function openCategoryEditor(category: WorkspaceMenuCategoryOption) {
    if (!canWriteMenu) return;
    const draft = categoryDraftFromSummary(category);
    setCategoryMode("edit");
    setCategoryBaseline(draft);
    setEditingCategory(draft);
    setEditorError(null);
  }

  function closeCategoryEditor() {
    if (categorySaving) return;
    const dirty =
      !!editingCategory &&
      !!categoryBaseline &&
      JSON.stringify(editingCategory) !== JSON.stringify(categoryBaseline);
    if (
      dirty &&
      !window.confirm("Discard unsaved category changes? Your changes will not be saved.")
    ) {
      return;
    }
    setEditingCategory(null);
    setCategoryBaseline(null);
    setCategoryMode("edit");
  }

  async function saveCategoryDraft(
    draft: WorkspaceCategoryDraft,
    mode: "create" | "edit",
    action: string,
  ): Promise<WorkspaceMenuCategoryOption> {
    const validation = validateCategoryInput(draft);
    if (!validation.value) {
      throw new Error(validation.error ?? "Category data is invalid");
    }
    const response = await fetch(
      mode === "create" ? "/api/admin/categories" : `/api/admin/categories/${draft.id}`,
      {
        method: mode === "create" ? "POST" : "PATCH",
        referrer: window.location.href,
        referrerPolicy: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "create"
            ? validation.value
            : { ...validation.value, updatedAt: draft.updatedAt },
        ),
      },
    );
    if (!response.ok) {
      throw new Error(await apiErrorMessage(response, action));
    }
    return (await response.json()) as WorkspaceMenuCategoryOption;
  }

  async function saveCategory() {
    if (!canWriteMenu || !editingCategory) return;
    const previousSlug =
      editingCategory.id != null
        ? summary.categories.find((category) => category.id === editingCategory.id)
            ?.slug ?? null
        : null;
    try {
      setCategorySaving(true);
      setEditorError(null);
      const saved = await saveCategoryDraft(
        editingCategory,
        categoryMode,
        "save this category",
      );
      const savedCategoryMode = categoryMode;
      applyCategoryUpdate(saved);
      setEditingCategory(null);
      setCategoryBaseline(null);
      setCategoryMode("edit");
      notifyAfterModalClose({
        message:
          savedCategoryMode === "create"
            ? `Category created: ${saved.name}`
            : `Category saved: ${saved.name}`,
      });
      if (categoryMode === "create") {
        updateWorkspaceFilter({}, "replace");
        return;
      }
      if (
        previousSlug &&
        filterStateRef.current.category?.includes(previousSlug)
      ) {
        updateWorkspaceFilter(
          {
            ...filterStateRef.current,
            category: filterStateRef.current.category.map((slug) =>
              slug === previousSlug ? saved.slug : slug,
            ),
          },
          "replace",
          targetItemIdRef.current,
        );
        return;
      }
      void refreshRef.current?.();
    } catch (error) {
      const message = clientErrorMessage(error, "save this category");
      setEditorError(message);
      window.alert(message);
    } finally {
      setCategorySaving(false);
    }
  }

  async function toggleCategoryActive(category: WorkspaceMenuCategoryOption) {
    if (!canWriteMenu) return;
    const next = {
      ...categoryDraftFromSummary(category),
      isActive: !category.isActive,
    };
    try {
      setCategoryBusyId(category.id);
      setEditorError(null);
      const saved = await saveCategoryDraft(
        next,
        "edit",
        category.isActive ? "hide this category" : "show this category",
      );
      applyCategoryUpdate(saved);
      notify({
        message: category.isActive
          ? `Category hidden: ${category.name}`
          : `Category shown: ${category.name}`,
      });
      void refreshRef.current?.();
    } catch (error) {
      const message = clientErrorMessage(
        error,
        category.isActive ? "hide this category" : "show this category",
      );
      setEditorError(message);
      window.alert(message);
    } finally {
      setCategoryBusyId(null);
    }
  }

  async function reorderItemsInCategory({
    category,
    rows,
    orderedItemIds,
  }: {
    category: WorkspaceMenuCategoryOption;
    rows: WorkspaceMenuItemRow[];
    orderedItemIds: string[];
  }) {
    if (!canWriteMenu || reorderCategoryId) return;
    const expectedCurrentOrder = rows.map((row) => row.id);
    if (
      orderedItemIds.length !== expectedCurrentOrder.length ||
      orderedItemIds.every((itemId, index) => itemId === expectedCurrentOrder[index])
    ) {
      return;
    }

    try {
      setOptimisticOrder(category.id, orderedItemIds);
      setReorderCategoryId(category.id);
      setEditorError(null);
      const response = await fetch(`/api/admin/categories/${category.id}/reorder`, {
        method: "POST",
        referrer: window.location.href,
        referrerPolicy: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updatedAt: category.updatedAt,
          expectedCurrentOrder,
          orderedItemIds,
        }),
      });
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "reorder these items"));
      }
      notify({ message: `Menu order saved: ${category.name}` });
      void refreshRef.current?.();
    } catch (error) {
      setOptimisticOrder(category.id, null);
      const message = clientErrorMessage(error, "reorder these items");
      setEditorError(message);
      window.alert(message);
    } finally {
      setReorderCategoryId(null);
    }
  }

  async function saveEditorItem(
    draft: MenuEditorItem,
    pending: HeroPending,
    allowedImageHosts = editorContext?.allowedImageHosts ?? [],
    feedback: { toast?: boolean; message?: string; closeEditor?: boolean } = {},
  ): Promise<SaveResult> {
    if (!canWriteMenu) {
      return { ok: false, error: "Read-only access cannot edit menu items." };
    }
    const draftForValidation = pending.removeHero
      ? { ...draft, imageUrl: null, imageAlt: null }
      : draft;
    const validation = validateItemInput(draftForValidation, {
      allowedImageHosts,
    });
    if (!validation.value) {
      return {
        ok: false,
        error: validation.error ?? "Item data is invalid",
      };
    }

    const hasPendingHeroChange = !!pending.heroFile || pending.removeHero;
    const isCreate = editorMode === "create";
    const saveAction = isCreate ? "create this item" : "save this item";
    const itemPayload = isCreate
      ? validation.value
      : {
          ...validation.value,
          lockVersion: draft.lockVersion,
        };
    try {
      setItemSaving(true);
      let response: Response;
      if (hasPendingHeroChange) {
        const form = new FormData();
        form.append("item", JSON.stringify(itemPayload));
        if (pending.heroFile) {
          form.append("heroFile", pending.heroFile);
        }
        response = await fetch(
          isCreate ? "/api/admin/items" : `/api/admin/items/${draft.id}`,
          {
            method: isCreate ? "POST" : "PATCH",
            referrer: window.location.href,
            referrerPolicy: "same-origin",
            body: form,
          },
        );
      } else {
        response = await fetch(
          isCreate ? "/api/admin/items" : `/api/admin/items/${draft.id}`,
          {
            method: isCreate ? "POST" : "PATCH",
            referrer: window.location.href,
            referrerPolicy: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(itemPayload),
          },
        );
      }
      if (!response.ok) {
        return {
          ok: false,
          error: await apiErrorMessage(response, saveAction),
          conflict: response.status === 409,
        };
      }
      const saved = (await response.json().catch(() => null)) as
        | MenuEditorItem
        | null;
      let savedItem = saved?.id ? saved : draft;
      const originalItem = editingItem ?? draft;
      savedItem = await syncDraftModifierGroupLinksOnSave({
        originalItem,
        draftItem: draft,
        savedItem,
      });
      const shouldCloseEditor = isCreate || feedback.closeEditor !== false;
      if (shouldCloseEditor) {
        setEditingItem(null);
      } else {
        applyEditorItemUpdate(savedItem);
      }
      setEditorMode("edit");
      setEditorError(null);
      if (feedback.toast !== false) {
        const noun = menuItemNoun(savedItem);
        const toast = {
          message:
            feedback.message ??
            (isCreate
              ? `${noun} created: ${savedItem.name}`
              : `${noun} saved: ${savedItem.name}`),
        };
        if (shouldCloseEditor) {
          notifyAfterModalClose(toast);
        } else {
          notify(toast);
        }
      }
      if (isCreate) {
        const nextCategory = editorContext
          ? categorySlugForItem(editorContext, savedItem)
          : null;
        updateWorkspaceFilter(
          nextCategory ? { category: [nextCategory] } : {},
          "replace",
          savedItem.id,
        );
      } else {
        void refreshRef.current?.();
      }
      return { ok: true, item: savedItem };
    } catch (error) {
      return {
        ok: false,
        error: clientErrorMessage(error, saveAction),
      };
    } finally {
      setItemSaving(false);
    }
  }

  async function hideEditorItem(
    item: MenuEditorItem,
    allowedImageHosts = editorContext?.allowedImageHosts ?? [],
  ): Promise<MenuEditorItem | void> {
    if (!canWriteMenu) return;
    if (item.isActive) {
      if (
        !window.confirm(
          "Hide this item from the kiosk? Historical orders will be preserved.",
        )
      ) {
        return;
      }
      try {
        setBusyItemId(item.id);
        setEditorError(null);
        const response = await fetch(`/api/admin/items/${item.id}`, {
          method: "DELETE",
          referrer: window.location.href,
          referrerPolicy: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lockVersion: item.lockVersion }),
        });
        if (!response.ok) {
          throw new Error(await apiErrorMessage(response, "hide this item"));
        }
        let updatedItem: MenuEditorItem = {
          ...item,
          isActive: false,
          lockVersion: item.lockVersion + 1,
          updatedAt: new Date().toISOString(),
        };
        try {
          const loaded = await loadEditorItem(
            item.id,
            "refresh this hidden item",
          );
          updatedItem = loaded.item;
        } catch {
          // The hide already succeeded. Keep the editor usable with the
          // expected optimistic version if the refresh endpoint is unavailable.
        }
        applyEditorItemUpdate(updatedItem);
        notify({
          message: `${menuItemNoun(item)} hidden from kiosk: ${item.name}`,
        });
        void refreshRef.current?.();
        return updatedItem;
      } catch (error) {
        const message = clientErrorMessage(error, "hide this item");
        setEditorError(message);
        window.alert(message);
      } finally {
        setBusyItemId(null);
      }
      return;
    }

    if (!window.confirm("Make this item live on the kiosk again?")) {
      return;
    }
    const result = await saveEditorItem(
      { ...item, isActive: true },
      { heroFile: null, removeHero: false },
      allowedImageHosts,
      {
        message: `${menuItemNoun(item)} shown on kiosk: ${item.name}`,
        closeEditor: false,
      },
    );
    if (!result.ok) {
      setEditorError(result.error);
      window.alert(result.error);
      return;
    }
    return result.item;
  }

  async function toggleRowItemVisibility(itemId: string) {
    if (!canWriteMenu || busyItemId === itemId) return;
    try {
      const { context, item } = await loadEditorItem(
        itemId,
        "update this item visibility",
      );
      await hideEditorItem(item, context.allowedImageHosts);
    } catch (error) {
      const message = clientErrorMessage(error, "update this item visibility");
      setEditorError(message);
      window.alert(message);
    }
  }

  async function updateItemModifierOverride(
    item: MenuEditorItem,
    linkId: string,
    optionId: string,
    fields: {
      isHidden?: boolean;
      priceDeltaOverride?: number | null;
      sortOrderOverride?: number | null;
    },
  ): Promise<SharedModifierItemMutationResult> {
    if (!canWriteMenu) {
      return { ok: false, error: "Read-only access cannot edit menu items." };
    }
    setSharedModifierBusyKey(`override:${linkId}:${optionId}`);
    setEditorError(null);
    try {
      const response = await fetch(
        `/api/admin/items/${item.id}/modifier-groups/${linkId}/options/${optionId}`,
        {
          method: "PATCH",
          referrer: window.location.href,
          referrerPolicy: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lockVersion: item.lockVersion, ...fields }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as ItemModifierOverrideResponse;
      if (!response.ok || body.itemLockVersion == null) {
        return {
          ok: false,
          error: apiBodyErrorMessage(response.status, body, "update this item override"),
          conflict: response.status === 409,
        };
      }
      const updatedItem = mergeItemModifierOverride({
        item,
        linkId,
        optionId,
        override: body.override ?? null,
        itemLockVersion: body.itemLockVersion,
      });
      applyEditorItemUpdate(updatedItem);
      notify({ message: "Add-on option override saved." });
      void refreshRef.current?.();
      return { ok: true, item: updatedItem };
    } catch (error) {
      return {
        ok: false,
        error: clientErrorMessage(error, "update this item override"),
      };
    } finally {
      setSharedModifierBusyKey(null);
    }
  }

  async function clearItemModifierOverride(
    item: MenuEditorItem,
    linkId: string,
    optionId: string,
  ): Promise<SharedModifierItemMutationResult> {
    if (!canWriteMenu) {
      return { ok: false, error: "Read-only access cannot edit menu items." };
    }
    setSharedModifierBusyKey(`clear-override:${linkId}:${optionId}`);
    setEditorError(null);
    try {
      const response = await fetch(
        `/api/admin/items/${item.id}/modifier-groups/${linkId}/options/${optionId}`,
        {
          method: "DELETE",
          referrer: window.location.href,
          referrerPolicy: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lockVersion: item.lockVersion }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as ItemModifierOverrideResponse;
      if (!response.ok || body.itemLockVersion == null) {
        return {
          ok: false,
          error: apiBodyErrorMessage(response.status, body, "clear this item override"),
          conflict: response.status === 409,
        };
      }
      const updatedItem = mergeItemModifierOverride({
        item,
        linkId,
        optionId,
        override: null,
        itemLockVersion: body.itemLockVersion,
      });
      applyEditorItemUpdate(updatedItem);
      notify({ message: "Add-on option override reset." });
      void refreshRef.current?.();
      return { ok: true, item: updatedItem };
    } catch (error) {
      return {
        ok: false,
        error: clientErrorMessage(error, "clear this item override"),
      };
    } finally {
      setSharedModifierBusyKey(null);
    }
  }

  async function quickToggleStock(itemId: string) {
    if (!canWriteMenu) return;
    setQuickStockItemId(itemId);
    setEditorError(null);
    try {
      const { context, item } = await loadEditorItem(
        itemId,
        "update this item stock",
      );
      if (isDealEditorItem(item, context.categories)) {
        throw new Error(
          "Deal availability is derived from linked items. Edit the linked item stock instead.",
        );
      }
      if (!item.isActive) {
        throw new Error("Hidden items must be made live before stock can be toggled.");
      }

      const nextOutOfStock = !item.isOutOfStock;
      const quantityTracked = item.stockMode === "QUANTITY";
      const confirmed = window.confirm(
        quantityTracked
          ? nextOutOfStock
            ? `Pause selling "${item.name}"? Quantity will stay at ${item.stockQty ?? 0}, but customers cannot order it.`
            : `Resume selling "${item.name}"? Customers will be able to order it again.`
          : nextOutOfStock
            ? `Mark "${item.name}" as out of stock? Customers will still see it, but they cannot order it.`
            : `Mark "${item.name}" as back in stock? Customers will be able to order it again.`,
      );
      if (!confirmed) return;

      const result = await saveEditorItem(
        { ...item, isOutOfStock: nextOutOfStock },
        { heroFile: null, removeHero: false },
        context.allowedImageHosts,
        {
          message: nextOutOfStock
            ? quantityTracked
              ? `Selling paused: ${item.name}`
              : `Stock updated: ${item.name} is out of stock`
            : quantityTracked
              ? `Selling resumed: ${item.name}`
              : `Stock updated: ${item.name} is in stock`,
        },
      );
      if (!result.ok) {
        throw new Error(result.error);
      }
    } catch (error) {
      const message = clientErrorMessage(error, "update this item stock");
      setEditorError(message);
      window.alert(message);
    } finally {
      setQuickStockItemId(null);
    }
  }

  async function updateAddonStock(
    row: WorkspaceMenuItemRow,
    addon: WorkspaceMenuAddonOption,
    patch: WorkspaceOptionStockPatch,
  ): Promise<boolean> {
    if (!canWriteMenu) return false;
    setAddonStockBusyKey(addon.id);
    setEditorError(null);
    try {
      const context =
        editorContext ?? (await loadEditorContext("update this add-on stock"));
      const item = context.items.find((candidate) => candidate.id === row.id);
      if (!item) {
        throw new Error("Item is no longer available. Refresh the widget and try again.");
      }
      const response = await fetch(
        `/api/admin/items/${row.id}/addons/${addon.id}/stock`,
        {
          method: "PATCH",
          referrer: window.location.href,
          referrerPolicy: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lockVersion: item.lockVersion, ...patch }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as AddonStockResponse;
      if (!response.ok || !body.addon || body.itemLockVersion == null) {
        throw new Error(
          apiBodyErrorMessage(response.status, body, "update this add-on stock"),
        );
      }
      applyEditorItemLockVersion(row.id, body.itemLockVersion);
      void refreshRef.current?.();
      return true;
    } catch (error) {
      const message = clientErrorMessage(error, "update this add-on stock");
      setEditorError(message);
      window.alert(message);
      return false;
    } finally {
      setAddonStockBusyKey(null);
    }
  }

  async function hardDeleteEditorItem(item: MenuEditorItem) {
    if (!canWriteMenu) return;
    const noun =
      editorContext && isDealEditorItem(item, editorContext.categories)
        ? "deal"
        : "item";
    if (
      !window.confirm(
        `Permanently delete this ${noun} "${item.name}"?\n\nThis cannot be undone from the menu list.`,
      )
    ) {
      return;
    }

    try {
      setBusyItemId(item.id);
      setEditorError(null);
      const response = await fetch(`/api/admin/items/${item.id}/hard-delete`, {
        method: "DELETE",
        referrer: window.location.href,
        referrerPolicy: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lockVersion: item.lockVersion }),
      });
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "delete this item"));
      }
      setEditingItem(null);
      notifyAfterModalClose({ message: `${noun} deleted: ${item.name}` });
      refreshAfterItemRemoved(item.id);
    } catch (error) {
      const message = clientErrorMessage(error, "delete this item");
      setEditorError(message);
      window.alert(message);
    } finally {
      setBusyItemId(null);
    }
  }

  const editingIsDeal =
    !!editingItem &&
    !!editorContext &&
    isDealEditorItem(editingItem, editorContext.categories);
  const categoryById = new Map(
    summary.categories.map((category) => [category.id, category]),
  );
  const assignedItemCount =
    editingCategory?.id != null
      ? (categoryById.get(editingCategory.id)?.itemCount ?? 0)
      : 0;

  return (
    <div className="relative grid h-full grid-rows-[auto_1fr] bg-white">
      {/* Floating summon button — appears once the toolbar has scrolled out of
          view. Click toggles manualOpen which pushes the toolbar slot back in
          (no scroll change). Click again to collapse. */}
      <button
        type="button"
        onClick={() => setManualOpen((v) => !v)}
        aria-label={manualOpen ? "Hide menu toolbar" : "Show menu toolbar"}
        aria-expanded={manualOpen}
        data-testid="workspace-menu-summon-toolbar"
        className={`absolute left-1/2 top-2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-stone-300 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-stone-800 shadow-lg transition-opacity hover:border-stone-500 hover:bg-stone-50 ${
          showSummon ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <span aria-hidden>{manualOpen ? "▴" : "▾"}</span>
        <span>{manualOpen ? "Hide toolbar" : "Show toolbar"}</span>
      </button>

      {/* Toolbar slot — height-toggled push. Outside the scroll area so it
          can show/hide without affecting scrollTop. Border-bottom only when
          open (collapses with the slot). */}
      <div
        data-testid="workspace-menu-toolbar-slot"
        className={`overflow-hidden bg-white transition-[max-height] duration-200 ease-out ${
          toolbarOpen ? "max-h-[480px] border-b border-stone-200" : "max-h-0"
        }`}
      >
        <div className="p-3">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-stone-500">
              Menu
            </div>
            <div className="mt-1 text-xs font-semibold text-stone-500">
              {summary.counts.items} items · {summary.counts.live} live · refreshed{" "}
              {formatGeneratedAt(summary.generatedAt)}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {canWriteMenu && (
              <>
                <button
                  type="button"
                  data-testid="workspace-menu-create-category"
                  onClick={startCreateCategory}
                  disabled={categorySaving}
                  className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-stone-800 hover:border-stone-400 disabled:opacity-60"
                >
                  <Plus size={12} strokeWidth={2.5} aria-hidden />
                  Add category
                </button>
                <button
                  type="button"
                  data-testid="workspace-menu-create-item"
                  onClick={() => void startCreateItem()}
                  disabled={createLoading != null}
                  className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-stone-800 hover:border-stone-400 disabled:opacity-60"
                >
                  <Plus size={12} strokeWidth={2.5} aria-hidden />
                  {createLoading === "item" ? "Opening" : "Add item"}
                </button>
                <button
                  type="button"
                  data-testid="workspace-menu-create-deal"
                  onClick={() => void startCreateDeal()}
                  disabled={createLoading != null}
                  className="inline-flex items-center gap-2 rounded-full border border-stone-900 bg-stone-950 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-yellow-300 hover:bg-black disabled:opacity-60"
                >
                  <Plus size={12} strokeWidth={2.5} aria-hidden />
                  {createLoading === "deal" ? "Opening" : "Add deal"}
                </button>
                <button
                  type="button"
                  data-testid="workspace-menu-modifier-library"
                  onClick={() => void openModifierLibrary()}
                  disabled={modifierLibraryLoading || sharedModifierBusyKey != null}
                  className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-stone-800 hover:border-stone-400 disabled:opacity-60"
                >
                  <SlidersHorizontal size={12} strokeWidth={2.5} aria-hidden />
                  {modifierLibraryLoading ? "Loading" : "Add-ons"}
                </button>
                <button
                  type="button"
                  data-testid="workspace-menu-deal-history"
                  onClick={openDealHistory}
                  disabled={dealHistoryLoading}
                  className="inline-flex items-center gap-2 rounded-full border border-yellow-300 bg-yellow-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-stone-900 hover:border-yellow-400 disabled:opacity-60"
                >
                  <History size={12} strokeWidth={2.5} aria-hidden />
                  {dealHistoryLoading ? "Loading" : "Deal history"}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => void refreshRef.current?.()}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-stone-700 hover:border-stone-400 disabled:opacity-60"
            >
              <RefreshCw
                size={12}
                strokeWidth={2.5}
                className={refreshing ? "animate-spin" : ""}
                aria-hidden
              />
              Refresh
            </button>
          </div>
        </div>

        <div className="mb-3 flex flex-wrap gap-2">
          {ATTENTION_FILTERS.map((filter) => {
            const attention = filter.key === "all" ? null : filter.key;
            const active = selectedAttention === attention;
            return (
              <button
                key={filter.key}
                type="button"
                onClick={() => selectAttention(attention)}
                data-testid={`workspace-menu-filter-${filter.key}`}
                aria-pressed={active}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-black uppercase tracking-widest transition-colors ${
                  active
                    ? "border-stone-900 bg-stone-900 text-white"
                    : "border-stone-200 bg-white text-stone-700 hover:border-stone-400"
                }`}
              >
                {filter.label}
                <span
                  className={`inline-flex h-4 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] ${
                    active ? "bg-white/15 text-white" : "bg-stone-100 text-stone-500"
                  }`}
                >
                  {countForFilter(summary, attention)}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mb-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_240px]">
          <SearchField
            filter={filterState}
            categories={summary.categories}
            onFilterChange={updateWorkspaceFilter}
            setSingleFilter={setSingleFilter}
            onOpenBuilder={() => setFilterBuilderOpen(true)}
            inputTestId="workspace-menu-search"
          />

          <select
            value={selectedCategory ?? ""}
            onChange={(event) => selectCategory(event.target.value || null)}
            data-testid="workspace-menu-category-filter"
            className="h-10 rounded-full border border-stone-200 bg-white px-3 text-xs font-black text-stone-700 outline-none hover:border-stone-400"
            aria-label="Filter menu category"
          >
            <option value="">All categories</option>
            {summary.categories.map((category) => (
              <option key={category.id} value={category.slug}>
                {category.name} ({category.itemCount})
              </option>
            ))}
          </select>
        </div>
        </div>
      </div>

      {/* Scroll area — owns the rows card, errors, footer. The bordered
          section moved here so the toolbar can push above it without joining
          the same scroll context. */}
      <div
        ref={menuScrollRef}
        data-testid="workspace-menu-real-data"
        className="admin-widget-scroll overflow-auto overscroll-contain"
      >
        <section className="rounded-xl border border-stone-200 bg-white p-3 shadow-sm">
        {refreshError && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
            <AlertTriangle
              size={14}
              strokeWidth={2.5}
              className="mt-0.5 shrink-0"
              aria-hidden
            />
            <span>Menu refresh failed: {refreshError}</span>
          </div>
        )}

        {editorError && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-800">
            <AlertTriangle
              size={14}
              strokeWidth={2.5}
              className="mt-0.5 shrink-0"
              aria-hidden
            />
            <span>{editorError}</span>
          </div>
        )}

        {summary.sections.length > 0 ? (
          <div className="space-y-5">
            {summary.sections.map((section) => {
              const categoryOption = categoryById.get(section.category.id) ?? null;
              const categoryHidden = !section.category.isActive;
              const renderedItems = applyWorkspaceMenuOptimisticOrder(
                section.items,
                optimisticOrderByCategory.get(section.category.id),
              );
              const reorderEnabled =
                !!categoryOption &&
                canWriteMenu &&
                section.totalCount > 1 &&
                section.items.length === section.totalCount &&
                filterAllowsReorder(filterState) &&
                !targetItemIdRef.current;
              return (
                <div
                  key={section.category.id}
                  data-testid="workspace-menu-category-section"
                  data-category-slug={section.category.slug}
                  className="rounded-xl border border-stone-200"
                >
                  {/* Category section header. Hidden categories need explicit
                      customer-impact copy here because a hidden category
                      suppresses every child item on the kiosk. */}
                  <div
                    className={`sticky top-0 z-[5] flex flex-wrap items-center justify-between gap-3 rounded-t-xl border-b border-l-4 px-3 py-3 shadow-sm ${
                      categoryHidden
                        ? "border-stone-200 border-l-stone-400 bg-stone-100"
                        : "border-stone-200 border-l-yellow-400 bg-yellow-50"
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-xl ${
                          categoryHidden
                            ? "border-stone-300 bg-stone-50 opacity-70 grayscale"
                            : "border-stone-200 bg-white"
                        }`}
                        aria-hidden
                      >
                        {section.category.icon}
                      </span>
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span
                            className={`truncate text-base font-black ${
                              categoryHidden ? "text-stone-700" : "text-stone-950"
                            }`}
                          >
                            {section.category.name}
                          </span>
                          {categoryHidden && (
                            <span
                              data-testid="workspace-menu-category-hidden-pill"
                              className="rounded-full border border-stone-300 bg-white px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-stone-700"
                            >
                              HIDDEN FROM KIOSK
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] font-semibold text-stone-600">
                          {categoryHidden
                            ? `Hidden · ${section.totalCount} item${
                                section.totalCount === 1 ? "" : "s"
                              }`
                            : `${section.activeCount} live / ${section.totalCount} total`}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      {canWriteMenu && categoryOption ? (
                        <>
                          <button
                            type="button"
                            data-testid="workspace-menu-edit-category"
                            onClick={() => openCategoryEditor(categoryOption)}
                            disabled={categorySaving}
                            aria-label={`Edit category ${section.category.name}`}
                            title="Edit category"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-600 hover:border-stone-400 hover:text-stone-900 disabled:opacity-60"
                          >
                            <Pencil size={14} strokeWidth={2.5} aria-hidden />
                          </button>
                          <button
                            type="button"
                            data-testid="workspace-menu-toggle-category"
                            onClick={() => void toggleCategoryActive(categoryOption)}
                            disabled={
                              categoryBusyId === categoryOption.id || categorySaving
                            }
                            aria-label={
                              section.category.isActive
                                ? `Hide category ${section.category.name}`
                                : `Show category ${section.category.name}`
                            }
                            aria-pressed={section.category.isActive}
                            title={
                              categoryHidden ? "Show category" : "Hide category"
                            }
                            className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border px-3 text-[10px] font-black uppercase tracking-widest disabled:opacity-60 ${
                              categoryHidden
                                ? "border-stone-300 bg-white text-stone-700 hover:border-stone-500"
                                : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-400"
                            }`}
                          >
                            {categoryHidden ? (
                              <>
                                <EyeOff size={14} strokeWidth={2.5} aria-hidden />
                                Show
                              </>
                            ) : (
                              <>
                                <Eye size={14} strokeWidth={2.5} aria-hidden />
                                Hide
                              </>
                            )}
                          </button>
                        </>
                      ) : (
                        <span
                          className={`rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-widest ${
                            !categoryHidden
                              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                              : "border-stone-200 bg-stone-100 text-stone-600"
                          }`}
                        >
                          {categoryHidden ? "HIDDEN FROM KIOSK" : "Live"}
                        </span>
                      )}
                    </div>
                  </div>
                  {categoryHidden && (
                    <div
                      data-testid="workspace-menu-category-hidden-helper"
                      className="border-b border-stone-200 bg-stone-50 px-3 py-2 text-xs font-bold text-stone-600"
                    >
                      Customers cannot see this category or its items on the kiosk.
                    </div>
                  )}
                  {renderedItems.length > 0 ? (
                  <div className="overflow-x-auto py-2 pl-9 pr-2">
                    <div className="min-w-[790px] space-y-2 border-l-2 border-stone-200 pl-3">
                      {renderedItems.map((row) => (
                        <MenuRow
                          key={row.id}
                          row={row}
                          target={targetItemId === row.id}
                          open={openItemId === row.id}
                          canWriteMenu={canWriteMenu}
                          editorLoading={editorLoadingItemId === row.id}
                          stockBusy={quickStockItemId === row.id}
                          visibilityBusy={busyItemId === row.id}
                          reorderBusy={reorderCategoryId === section.category.id}
                          canReorder={reorderEnabled}
                          dragging={draggedItemId === row.id}
                          dropTarget={
                            draggedItemId != null &&
                            draggedItemId !== row.id &&
                            dropTarget?.categoryId === section.category.id &&
                            dropTarget.itemId === row.id
                          }
                          onEdit={(itemId) => void openEditor(itemId)}
                          onToggleVisibility={(itemId) =>
                            void toggleRowItemVisibility(itemId)
                          }
                          onQuickStock={(itemId) => void quickToggleStock(itemId)}
                          onEditAddonStock={(item, addon) =>
                            setAddonStockEditor({ row: item, addon })
                          }
                          onOpenAddOns={(item) => {
                            const focus = rowAddOnManagerFocus(item);
                            void openModifierLibrary(
                              focus?.groupId,
                              focus ?? undefined,
                            );
                          }}
                          onDragStart={(event) => {
                            if (!reorderEnabled) {
                              event.preventDefault();
                              return;
                            }
                            draggedItemIdRef.current = row.id;
                            setDraggedItemId(row.id);
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", row.id);
                          }}
                          onDragEnd={(event) => {
                            const activeDraggedItemId = draggedItemIdRef.current;
                            const pointerTargetElement = document.elementFromPoint(
                              event.clientX,
                              event.clientY,
                            );
                            const pointerTargetRow =
                              pointerTargetElement?.closest<HTMLElement>(
                                "[data-workspace-menu-item-id]",
                              );
                            const pointerTargetItemId =
                              pointerTargetRow?.dataset.workspaceMenuCategoryId ===
                              section.category.id
                                ? pointerTargetRow.dataset.workspaceMenuItemId
                                : null;
                            if (
                              categoryOption &&
                              activeDraggedItemId &&
                              pointerTargetItemId &&
                              pointerTargetItemId !== activeDraggedItemId &&
                              reorderEnabled
                            ) {
                              const expectedCurrentOrder = renderedItems.map(
                                (item) => item.id,
                              );
                              const fromIndex = expectedCurrentOrder.indexOf(
                                activeDraggedItemId,
                              );
                              const toIndex =
                                expectedCurrentOrder.indexOf(pointerTargetItemId);
                              if (fromIndex >= 0 && toIndex >= 0) {
                                const orderedItemIds = [...expectedCurrentOrder];
                                orderedItemIds.splice(fromIndex, 1);
                                orderedItemIds.splice(
                                  toIndex,
                                  0,
                                  activeDraggedItemId,
                                );
                                clearReorderDragState();
                                void reorderItemsInCategory({
                                  category: categoryOption,
                                  rows: renderedItems,
                                  orderedItemIds,
                                });
                                return;
                              }
                            }
                            clearReorderDragState();
                          }}
                          onDragOver={(event) => {
                            const activeDraggedItemId =
                              draggedItemIdRef.current ||
                              event.dataTransfer.getData("text/plain");
                            if (!activeDraggedItemId || !reorderEnabled) return;
                            if (
                              !renderedItems.some(
                                (item) => item.id === activeDraggedItemId,
                              )
                            ) {
                              return;
                            }
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "move";
                            if (
                              dropTarget?.categoryId !== section.category.id ||
                              dropTarget.itemId !== row.id
                            ) {
                              const nextDropTarget = {
                                categoryId: section.category.id,
                                itemId: row.id,
                              };
                              setDropTarget(nextDropTarget);
                            }
                          }}
                          onDrop={(event) => {
                            const activeDraggedItemId =
                              draggedItemIdRef.current ||
                              event.dataTransfer.getData("text/plain");
                            if (
                              !categoryOption ||
                              !activeDraggedItemId ||
                              !reorderEnabled
                            ) {
                              clearReorderDragState();
                              return;
                            }
                            event.preventDefault();
                            const expectedCurrentOrder = renderedItems.map(
                              (item) => item.id,
                            );
                            const fromIndex = expectedCurrentOrder.indexOf(
                              activeDraggedItemId,
                            );
                            const toIndex = expectedCurrentOrder.indexOf(row.id);
                            if (
                              fromIndex < 0 ||
                              toIndex < 0 ||
                              activeDraggedItemId === row.id
                            ) {
                              clearReorderDragState();
                              return;
                            }
                            const orderedItemIds = [...expectedCurrentOrder];
                            orderedItemIds.splice(fromIndex, 1);
                            orderedItemIds.splice(toIndex, 0, activeDraggedItemId);
                            clearReorderDragState();
                            void reorderItemsInCategory({
                              category: categoryOption,
                              rows: renderedItems,
                              orderedItemIds,
                            });
                          }}
                          onToggle={() =>
                            setOpenItemId((current) =>
                              current === row.id ? null : row.id,
                            )
                          }
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="px-3 py-6 text-center text-sm font-bold text-stone-500">
                    No rows in this category.
                  </div>
                )}
              </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-3 py-6 text-center">
            <div className="text-sm font-black text-stone-950">
              No menu results
            </div>
            <div className="mt-1 text-xs font-semibold text-stone-500">
              Clear filters or adjust the search terms.
            </div>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-stone-500">
            <span>
              Showing {summary.sections.reduce((sum, section) => sum + section.items.length, 0)} rows.
            </span>
            {!isMenuFilterEmpty(filterState) && (
              <button
                type="button"
                onClick={clearAllFilters}
                className="rounded-full border border-stone-300 bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-stone-700 hover:border-stone-500"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>
      </section>

      {editingCategory && (
        <WorkspaceCategoryModal
          draft={editingCategory}
          mode={categoryMode}
          assignedItemCount={assignedItemCount}
          saving={categorySaving}
          onChange={setEditingCategory}
          onCancel={closeCategoryEditor}
          onSave={() => void saveCategory()}
        />
      )}

      {filterBuilderOpen && (
        <FilterBuilderModal
          filter={filterState}
          categories={summary.categories}
          setSingleFilter={setSingleFilter}
          onClose={() => setFilterBuilderOpen(false)}
        />
      )}

      {dealHistoryOpen && (
        <WorkspaceDealHistoryModal
          entries={dealHistoryEntries}
          serverNowIso={dealHistoryServerNowIso}
          loading={dealHistoryLoading}
          error={dealHistoryError}
          canWriteMenu={canWriteMenu}
          restoringHistoryId={restoringHistoryId}
          onClose={() => {
            if (restoringHistoryId) return;
            setDealHistoryOpen(false);
          }}
          onRefresh={() => void loadDealHistory()}
          onUseAgain={(entry) => void restoreDealFromHistory(entry)}
        />
      )}

      {addonStockEditor && (
        <WorkspaceAddonStockModal
          target={addonStockEditor}
          busy={addonStockBusyKey === addonStockEditor.addon.id}
          onClose={() => {
            if (addonStockBusyKey) return;
            setAddonStockEditor(null);
          }}
          onSave={async (patch) => {
            const saved = await updateAddonStock(
              addonStockEditor.row,
              addonStockEditor.addon,
              patch,
            );
            if (!saved) return;
            const name = addonStockEditor.addon.name;
            setAddonStockEditor(null);
            notifyAfterModalClose({ message: `Add-on stock saved: ${name}` });
          }}
        />
      )}

      {editingItem && editorContext && (
        editingIsDeal ? (
          <EditDealModal
            mode={editorMode}
            item={editingItem}
            categories={editorContext.categories}
            allItems={editorContext.items}
            allowedImageHosts={editorContext.allowedImageHosts}
            saving={itemSaving}
            busyDeleting={busyItemId === editingItem.id}
            defaultDiscountPct={editorContext.dealDefaultDiscountPct ?? 12}
            canWriteMenu={canWriteMenu}
            onCancel={() => {
              if (itemSaving || busyItemId === editingItem.id) return;
              setEditorMode("edit");
              setEditingItem(null);
            }}
            onSave={saveEditorItem}
            onHide={() => hideEditorItem(editingItem)}
            onDelete={async () => {
              await hideEditorItem(editingItem);
            }}
            onHardDelete={() => hardDeleteEditorItem(editingItem)}
          />
        ) : (
          <EditItemModal
            mode={editorMode}
            item={editingItem}
            categories={editorContext.categories}
            allowedImageHosts={editorContext.allowedImageHosts}
            saving={itemSaving}
            busyDeleting={busyItemId === editingItem.id}
            canWriteMenu={canWriteMenu}
            onCancel={() => {
              if (itemSaving || busyItemId === editingItem.id) return;
              setEditorMode("edit");
              setEditingItem(null);
            }}
            onSave={saveEditorItem}
            onHide={() => hideEditorItem(editingItem)}
            onDelete={async () => {
              await hideEditorItem(editingItem);
            }}
            onHardDelete={() => hardDeleteEditorItem(editingItem)}
            sharedModifiers={{
              groups: editorContext.modifierGroups,
              busyKey: sharedModifierBusyKey,
              onOpenLibrary: openModifierLibrary,
            }}
          />
        )
      )}

      {modifierLibraryOpen && (
        <WorkspaceModifierLibraryModal
          groups={editorContext?.modifierGroups ?? []}
          focusedGroupId={modifierLibraryFocusGroupId}
          focusContext={modifierLibraryFocusContext}
          loading={modifierLibraryLoading}
          error={modifierLibraryError}
          busyKey={sharedModifierBusyKey}
          onClose={() => {
            if (sharedModifierBusyKey) return;
            setModifierLibraryOpen(false);
            setModifierLibraryFocusGroupId(null);
            setModifierLibraryFocusContext(null);
          }}
          onRefresh={refreshModifierLibrary}
          onCreateGroupWithFirstOption={createModifierGroupWithFirstOption}
          onUpdateGroup={updateModifierGroup}
          onDeactivateGroup={deactivateModifierGroup}
          onHardDeleteGroup={hardDeleteModifierGroup}
          onSaveGroupDraft={saveModifierGroupDraft}
          onCreateOption={(group, input) =>
            createModifierOption(group, input)
          }
          onHardDeleteOption={hardDeleteModifierOption}
        />
      )}
      </div>
    </div>
  );
}
