import { LOCAL_IMAGE_URL_HERO_RE } from "./image-urls";
import { isMenuItemAvailable, type MenuStockMode } from "./menu-availability";
import { hasOptionStockFields } from "./option-stock";
import type { Badge, DealLimitMode, ImageFit } from "./types";
import { DEAL_LIMIT_MAX_QTY } from "./deal-selling-limits";

export const ADMIN_MENU_BADGES: Array<Exclude<Badge, null>> = [
  "NEW",
  "POPULAR",
  "DEAL",
  "HOT",
];

export const ADMIN_IMAGE_FITS: ImageFit[] = ["COVER", "CONTAIN"];

export type AdminModifierInput = {
  id?: string;
  name: string;
  priceDelta: number;
};

export type AdminCategoryInput = {
  slug: string;
  name: string;
  icon: string;
  sortOrder: number;
  isActive: boolean;
};

export type AdminUpgradeItemLinkInput = {
  id?: string;
  linkedMenuItemId: string | null;
  linkedSizeId: string | null;
  itemNameSnapshot?: string | null;
  sizeNameSnapshot?: string | null;
  sortOrder: number;
};

export type AdminUpgradeOptionInput = {
  id?: string;
  customTitle: string | null;
  extraCharge: number;
  savingsLabel: number | null;
  // Operator's intent in % (0-100), nullable. When set, the persisted
  // extraCharge/savingsLabel are derived from it at every kiosk hydration and
  // checkout. Non-deal upgrades leave this null and use the manual amounts.
  discountPct: number | null;
  sortOrder: number;
  linkedItems: AdminUpgradeItemLinkInput[];
};

export type AdminItemInput = {
  categoryId: string;
  comboNum: number | null;
  name: string;
  description: string;
  price: number;
  emoji: string;
  bgColor: string;
  badge: Exclude<Badge, null> | null;
  bundleSavings: number | null;
  dealBaseMenuItemId: string | null;
  dealBaseSizeId: string | null;
  dealBaseSizeNameSnapshot: string | null;
  dealStartsAt: Date | null;
  dealExpiresAt: Date | null;
  dealLimitMode: DealLimitMode;
  dealLimitQty: number | null;
  dealLimitLowThreshold: number | null;
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
  sortOrder: number;
  sizes: AdminModifierInput[];
  addons: AdminModifierInput[];
  upgradeOptions: AdminUpgradeOptionInput[];
};

export function normalizeDealShellStockInput(
  itemInput: AdminItemInput,
  isDeal: boolean
): AdminItemInput {
  if (!isDeal) return itemInput;

  return {
    ...itemInput,
    isOutOfStock: false,
    stockMode: "MANUAL",
    stockQty: null,
    lowStockThreshold: null,
  };
}

function dormantWholeNumber(value: number | null | undefined): number | null {
  return Number.isInteger(value) && (value as number) >= 0 ? (value as number) : null;
}

export function preserveManualItemStockInput(
  itemInput: AdminItemInput,
  current: Pick<
    AdminItemInput,
    "stockMode" | "isOutOfStock" | "stockQty" | "lowStockThreshold"
  >,
  isDeal: boolean
): AdminItemInput {
  const normalized = normalizeDealShellStockInput(itemInput, isDeal);
  if (isDeal || normalized.stockMode === "QUANTITY") return normalized;

  return {
    ...normalized,
    stockQty: dormantWholeNumber(current.stockQty),
    lowStockThreshold: dormantWholeNumber(current.lowStockThreshold),
  };
}

export type OptimisticUpdatedAtInput = {
  date: Date;
  iso: string;
};

export type AdminItemQuickEditInput = {
  lockVersion: number;
  price?: number;
  badge?: Exclude<Badge, null> | null;
  fields: {
    price: boolean;
    badge: boolean;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseMenuItemLockVersion(
  raw: unknown
): { value?: number; error?: string } {
  if (!isRecord(raw)) return { error: "Invalid payload" };

  const value = raw.lockVersion;
  if (value === undefined || value === null || value === "") {
    return { error: "lockVersion is required" };
  }
  if (typeof value !== "number" && typeof value !== "string") {
    return { error: "lockVersion must be a whole number 0 or greater" };
  }

  if (typeof value === "string" && value.trim() === "") {
    return { error: "lockVersion is required" };
  }

  const parsed = typeof value === "number" ? value : Number(value.trim());
  if (!Number.isInteger(parsed) || parsed < 0) {
    return { error: "lockVersion must be a whole number 0 or greater" };
  }

  return { value: parsed };
}

export function parseOptimisticUpdatedAt(
  raw: unknown
): { value?: OptimisticUpdatedAtInput; error?: string } {
  if (!isRecord(raw)) return { error: "Invalid payload" };

  const updatedAt = toTrimmedString(raw.updatedAt);
  if (!updatedAt) {
    return { error: "updatedAt is required" };
  }

  const parsed = new Date(updatedAt);
  if (Number.isNaN(parsed.getTime())) {
    return { error: "updatedAt is invalid" };
  }

  return {
    value: {
      date: parsed,
      iso: parsed.toISOString(),
    },
  };
}

function parseNonNegativeInteger(
  value: unknown,
  field: string,
  fallback = 0
): { value?: number; error?: string } {
  if (value === undefined || value === null || value === "") {
    return { value: fallback };
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return { error: `${field} must be a whole number 0 or greater` };
  }

  return { value: parsed };
}

function parsePositiveIntegerOrNull(
  value: unknown,
  field: string
): { value?: number | null; error?: string } {
  if (value === undefined || value === null || value === "") {
    return { value: null };
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return { error: `${field} must be a whole number greater than 0` };
  }

  return { value: parsed };
}

function parseNonNegativeIntegerOrNull(
  value: unknown,
  field: string
): { value?: number | null; error?: string } {
  if (value === undefined || value === null || value === "") {
    return { value: null };
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return { error: `${field} must be a whole number 0 or greater` };
  }

  return { value: parsed };
}

function parseStockMode(value: unknown): { value?: MenuStockMode; error?: string } {
  const normalized =
    value === undefined || value === null || value === ""
      ? "MANUAL"
      : String(value).trim().toUpperCase();
  if (normalized === "MANUAL" || normalized === "QUANTITY") {
    return { value: normalized };
  }
  return { error: "stock mode is invalid" };
}

function parseDealLimitMode(
  value: unknown
): { value?: DealLimitMode; error?: string } {
  const normalized =
    value === undefined || value === null || value === ""
      ? "UNLIMITED"
      : String(value).trim().toUpperCase();
  if (normalized === "UNLIMITED" || normalized === "LIMITED") {
    return { value: normalized };
  }
  return { error: "deal limit mode is invalid" };
}

function validateDealLimitNumber(
  value: number | null | undefined,
  field: string
): { error?: string } {
  if (value == null) return {};
  if (value > DEAL_LIMIT_MAX_QTY) {
    return { error: `${field} must be ${DEAL_LIMIT_MAX_QTY} or less` };
  }
  return {};
}

function parseMoney(
  value: unknown,
  field: string,
  options?: { allowNull?: boolean }
): { value?: number | null; error?: string } {
  if (value === undefined || value === null || value === "") {
    return options?.allowNull ? { value: null } : { error: `${field} is required` };
  }
  if (typeof value !== "number" && typeof value !== "string") {
    return { error: `${field} must be a valid amount 0 or greater` };
  }
  if (typeof value === "string" && value.trim() === "") {
    return options?.allowNull ? { value: null } : { error: `${field} is required` };
  }

  const parsed = typeof value === "number" ? value : Number(value.trim());
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { error: `${field} must be a valid amount 0 or greater` };
  }

  return { value: Math.round(parsed * 100) / 100 };
}

function parseBadge(value: unknown): { value?: Exclude<Badge, null> | null; error?: string } {
  if (value === undefined || value === null) return { value: null };
  if (typeof value !== "string") return { error: "badge is invalid" };

  const normalized = value.trim().toUpperCase();
  if (!normalized) return { value: null };
  if (!ADMIN_MENU_BADGES.includes(normalized as Exclude<Badge, null>)) {
    return { error: "badge is invalid" };
  }

  return { value: normalized as Exclude<Badge, null> };
}

export function validateItemQuickEditInput(
  raw: unknown
): { value?: AdminItemQuickEditInput; error?: string } {
  if (!isRecord(raw)) return { error: "Invalid payload" };

  const allowedKeys = new Set(["lockVersion", "price", "badge"]);
  for (const key of Object.keys(raw)) {
    if (!allowedKeys.has(key)) {
      return { error: `${key} is not allowed` };
    }
  }

  const lockVersion = parseMenuItemLockVersion(raw);
  if (lockVersion.error) return { error: lockVersion.error };

  const hasPrice = Object.prototype.hasOwnProperty.call(raw, "price");
  const hasBadge = Object.prototype.hasOwnProperty.call(raw, "badge");
  if (!hasPrice && !hasBadge) {
    return { error: "price or badge is required" };
  }

  const next: AdminItemQuickEditInput = {
    lockVersion: lockVersion.value as number,
    fields: {
      price: hasPrice,
      badge: hasBadge,
    },
  };

  if (hasPrice) {
    const priceCheck = parseMoney(raw.price, "price");
    if (priceCheck.error) return { error: priceCheck.error };
    next.price = priceCheck.value as number;
  }

  if (hasBadge) {
    const badgeCheck = parseBadge(raw.badge);
    if (badgeCheck.error) return { error: badgeCheck.error };
    next.badge = badgeCheck.value as Exclude<Badge, null> | null;
  }

  return { value: next };
}

function parseOptionalDateTime(
  value: unknown,
  field: string
): { value?: Date | null; error?: string } {
  if (value === undefined || value === null || value === "") {
    return { value: null };
  }
  if (typeof value !== "string" && !(value instanceof Date)) {
    return { error: `${field} must be a valid date and time` };
  }

  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { error: `${field} must be a valid date and time` };
  }

  return { value: parsed };
}

function normalizeModifierId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("new-")) return undefined;
  return trimmed;
}

function validateModifiers(
  raw: unknown,
  field: string
): { value?: AdminModifierInput[]; error?: string } {
  if (raw === undefined || raw === null) {
    return { value: [] };
  }

  if (!Array.isArray(raw)) {
    return { error: `${field} must be a list` };
  }

  const next: AdminModifierInput[] = [];
  const names = new Set<string>();
  const ids = new Set<string>();

  for (const [index, row] of raw.entries()) {
    if (!isRecord(row)) {
      return { error: `${field} row ${index + 1} is invalid` };
    }
    if (hasOptionStockFields(row)) {
      return {
        error: `${field} row ${index + 1} stock fields must use the stock controls`,
      };
    }

    const id = normalizeModifierId(row.id);
    const name = toTrimmedString(row.name);
    const priceCheck = parseMoney(row.priceDelta, `${field} price`, {
      allowNull: false,
    });
    if (priceCheck.error) return { error: `${field} row ${index + 1}: ${priceCheck.error}` };

    if (!name && priceCheck.value === 0) {
      continue;
    }

    if (!name) {
      return { error: `${field} row ${index + 1} needs a name` };
    }

    if (name.length > 40) {
      return { error: `${field} row ${index + 1} name is too long` };
    }

    const normalizedName = name.toLowerCase();
    if (names.has(normalizedName)) {
      return { error: `${field} contains duplicate option names` };
    }
    names.add(normalizedName);

    if (id) {
      if (ids.has(id)) {
        return { error: `${field} contains duplicate option ids` };
      }
      ids.add(id);
    }

    next.push({
      id,
      name,
      priceDelta: priceCheck.value as number,
    });
  }

  return { value: next };
}

function normalizeUpgradeId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("new-")) return undefined;
  return trimmed;
}

export function validateUpgradeOptions(
  raw: unknown,
  field: string
): { value?: AdminUpgradeOptionInput[]; error?: string } {
  if (raw === undefined || raw === null) {
    return { value: [] };
  }

  if (!Array.isArray(raw)) {
    return { error: `${field} must be a list` };
  }

  const next: AdminUpgradeOptionInput[] = [];
  const upgradeIds = new Set<string>();

  for (const [index, row] of raw.entries()) {
    if (!isRecord(row)) {
      return { error: `${field} row ${index + 1} is invalid` };
    }

    const id = normalizeUpgradeId(row.id);
    if (id) {
      if (upgradeIds.has(id)) {
        return { error: `${field} contains duplicate option ids` };
      }
      upgradeIds.add(id);
    }

    const extraChargeCheck = parseMoney(row.extraCharge, `${field} row ${index + 1} extra charge`, {
      allowNull: false,
    });
    if (extraChargeCheck.error) return { error: extraChargeCheck.error };

    const savingsLabelCheck = parseMoney(row.savingsLabel, `${field} row ${index + 1} savings label`, {
      allowNull: true,
    });
    if (savingsLabelCheck.error) return { error: savingsLabelCheck.error };

    // discountPct: nullable. When set (deal mode), the server recomputes
    // extraCharge/savingsLabel at hydration / checkout from current items;
    // null means manual mode (extraCharge typed by operator stays canonical).
    let discountPct: number | null = null;
    const discountRaw = row.discountPct;
    if (discountRaw !== undefined && discountRaw !== null) {
      const n = typeof discountRaw === "number" ? discountRaw : Number(discountRaw);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return {
          error: `${field} row ${index + 1} discount % must be between 0 and 100`,
        };
      }
      discountPct = Math.round(n * 100) / 100; // clamp to 2 decimal places (DB precision)
    }

    const customTitleRaw = row.customTitle;
    let customTitle: string | null = null;
    if (customTitleRaw != null && customTitleRaw !== "") {
      if (typeof customTitleRaw !== "string") {
        return { error: `${field} row ${index + 1} custom title must be text` };
      }
      const trimmed = customTitleRaw.trim();
      if (trimmed.length === 0) {
        customTitle = null;
      } else if (trimmed.length > 80) {
        return { error: `${field} row ${index + 1} custom title must be 80 characters or fewer` };
      } else {
        customTitle = trimmed;
      }
    }

    const sortOrderCheck = parseNonNegativeInteger(
      row.sortOrder,
      `${field} row ${index + 1} sort order`,
      0
    );
    if (sortOrderCheck.error) return { error: sortOrderCheck.error };

    const linksRaw = row.linkedItems;
    if (linksRaw !== undefined && linksRaw !== null && !Array.isArray(linksRaw)) {
      return { error: `${field} row ${index + 1} linked items must be a list` };
    }

    const linkedItems: AdminUpgradeItemLinkInput[] = [];
    const linkIds = new Set<string>();
    const seenPairs = new Set<string>();

    if (Array.isArray(linksRaw)) {
      for (const [linkIndex, linkRow] of linksRaw.entries()) {
        if (!isRecord(linkRow)) {
          return {
            error: `${field} row ${index + 1} linked item ${linkIndex + 1} is invalid`,
          };
        }

        const linkId = normalizeUpgradeId(linkRow.id);
        if (linkId) {
          if (linkIds.has(linkId)) {
            return {
              error: `${field} row ${index + 1} contains duplicate linked-item ids`,
            };
          }
          linkIds.add(linkId);
        }

        const linkedMenuItemRaw = linkRow.linkedMenuItemId;
        const linkedMenuItemId =
          typeof linkedMenuItemRaw === "string" && linkedMenuItemRaw.trim().length > 0
            ? linkedMenuItemRaw.trim()
            : null;

        const linkedSizeRaw = linkRow.linkedSizeId;
        const linkedSizeId =
          typeof linkedSizeRaw === "string" && linkedSizeRaw.trim().length > 0
            ? linkedSizeRaw.trim()
            : null;

        const linkSortOrderCheck = parseNonNegativeInteger(
          linkRow.sortOrder,
          `${field} row ${index + 1} linked item ${linkIndex + 1} sort order`,
          linkIndex
        );
        if (linkSortOrderCheck.error) return { error: linkSortOrderCheck.error };

        // itemNameSnapshot is structural input only — never trusted for live
        // links. enrichUpgradeOptions recomputes from linkedMenuItem.name when
        // a live item is loaded, and only preserves client value for unchanged
        // broken rows under the audit-window carve-out.
        const itemNameSnapshotRaw = linkRow.itemNameSnapshot;
        let itemNameSnapshot: string | null | undefined = undefined;
        if (itemNameSnapshotRaw === null) {
          itemNameSnapshot = null;
        } else if (typeof itemNameSnapshotRaw === "string") {
          const trimmed = itemNameSnapshotRaw.trim();
          if (trimmed.length === 0) {
            itemNameSnapshot = null;
          } else if (trimmed.length > 120) {
            return {
              error: `${field} row ${index + 1} linked item ${linkIndex + 1} item name snapshot must be 120 characters or fewer`,
            };
          } else {
            itemNameSnapshot = trimmed;
          }
        } else if (itemNameSnapshotRaw !== undefined) {
          return {
            error: `${field} row ${index + 1} linked item ${linkIndex + 1} item name snapshot must be text`,
          };
        }

        // One row per linkedMenuItemId per upgrade. Switching size mutates the
        // existing row (same UpgradeItemLink.id) instead of creating a second
        // row. Picker UI enforces this; the server enforces it here so a
        // crafted POST can't sneak in two sizes of the same item.
        if (linkedMenuItemId != null) {
          if (seenPairs.has(linkedMenuItemId)) {
            return {
              error: `${field} row ${index + 1} cannot include the same item more than once`,
            };
          }
          seenPairs.add(linkedMenuItemId);
        }

        linkedItems.push({
          id: linkId,
          linkedMenuItemId,
          linkedSizeId,
          itemNameSnapshot,
          sortOrder: linkSortOrderCheck.value as number,
        });
      }
    }

    next.push({
      id,
      customTitle,
      extraCharge: extraChargeCheck.value as number,
      savingsLabel: savingsLabelCheck.value as number | null,
      discountPct,
      sortOrder: sortOrderCheck.value as number,
      linkedItems,
    });
  }

  return { value: next };
}

export type EnrichedUpgradeItemLink = AdminUpgradeItemLinkInput & {
  itemNameSnapshot: string | null;
  sizeNameSnapshot: string | null;
};

export type EnrichedUpgradeOption = Omit<AdminUpgradeOptionInput, "linkedItems"> & {
  linkedItems: EnrichedUpgradeItemLink[];
};

export type UpgradeEnrichmentContext = {
  parentItemId: string | null;
  existingUpgradeOptions: Array<{
    id: string;
    customTitle: string | null;
    extraCharge: number | string;
    savingsLabel: number | string | null;
    discountPct: number | string | null;
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
  loadMenuItem: (
    menuItemId: string
  ) => Promise<{
    id: string;
    name: string;
    isActive: boolean;
    isOutOfStock: boolean;
    stockMode?: MenuStockMode | null;
    stockQty?: number | null;
    category?: { slug: string } | null;
    sizes: Array<{ id: string; name: string }>;
  } | null>;
};

function decimalLike(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (value && typeof (value as { toString?: () => string }).toString === "function") {
    return Number((value as { toString: () => string }).toString());
  }
  return Number.NaN;
}

function isUpgradeOptionUnchanged(
  parsed: AdminUpgradeOptionInput,
  existing: UpgradeEnrichmentContext["existingUpgradeOptions"][number]
): boolean {
  if ((parsed.customTitle ?? null) !== (existing.customTitle ?? null)) return false;
  if (Number(parsed.extraCharge) !== decimalLike(existing.extraCharge)) return false;
  if (
    (parsed.savingsLabel ?? null) !==
    (existing.savingsLabel == null ? null : decimalLike(existing.savingsLabel))
  ) {
    return false;
  }
  if (
    (parsed.discountPct ?? null) !==
    (existing.discountPct == null ? null : decimalLike(existing.discountPct))
  ) {
    return false;
  }
  if (parsed.sortOrder !== existing.sortOrder) return false;
  if (parsed.linkedItems.length !== existing.linkedItems.length) return false;

  const parsedLinks = [...parsed.linkedItems].sort((a, b) => a.sortOrder - b.sortOrder);
  const existingLinks = [...existing.linkedItems].sort((a, b) => a.sortOrder - b.sortOrder);
  for (let i = 0; i < parsedLinks.length; i++) {
    const p = parsedLinks[i];
    const e = existingLinks[i];
    if ((p.id ?? null) !== e.id) return false;
    if (p.linkedMenuItemId !== e.linkedMenuItemId) return false;
    if (p.linkedSizeId !== e.linkedSizeId) return false;
    if (p.sortOrder !== e.sortOrder) return false;
  }
  return true;
}

export async function enrichUpgradeOptions(
  parsed: AdminUpgradeOptionInput[],
  context: UpgradeEnrichmentContext
): Promise<{ value?: EnrichedUpgradeOption[]; error?: string }> {
  const result: EnrichedUpgradeOption[] = [];
  const existingById = new Map(context.existingUpgradeOptions.map((u) => [u.id, u]));

  for (const [index, option] of parsed.entries()) {
    const fieldLabel = `upgrade option ${index + 1}`;
    const existing = option.id ? existingById.get(option.id) : undefined;
    const isUnchanged = !!(existing && isUpgradeOptionUnchanged(option, existing));

    if (option.linkedItems.length === 0 && !isUnchanged) {
      return {
        error: `${fieldLabel} needs at least one linked item`,
      };
    }

    if (option.linkedItems.length > 0 && Number(option.extraCharge) <= 0) {
      return {
        error: `${fieldLabel} extra charge must be greater than $0.00`,
      };
    }

    const enrichedLinks: EnrichedUpgradeItemLink[] = [];

    for (const [linkIndex, link] of option.linkedItems.entries()) {
      const linkLabel = `${fieldLabel} linked item ${linkIndex + 1}`;
      const existingLink =
        existing && link.id ? existing.linkedItems.find((l) => l.id === link.id) : undefined;
      const linkUnchanged =
        !!existingLink &&
        existingLink.linkedMenuItemId === link.linkedMenuItemId &&
        existingLink.linkedSizeId === link.linkedSizeId &&
        existingLink.sortOrder === link.sortOrder;

      // Carve-out: an unchanged link can persist with whatever state it already has,
      // including null linkedMenuItemId / linkedSizeId / sizeNameSnapshot / itemNameSnapshot from cascade.
      // Both snapshot fields preserve verbatim from the existing row — never recomputed.
      if (linkUnchanged) {
        enrichedLinks.push({
          ...link,
          itemNameSnapshot: existingLink.itemNameSnapshot,
          sizeNameSnapshot: existingLink.sizeNameSnapshot,
        });
        continue;
      }

      if (link.linkedMenuItemId == null) {
        return { error: `${linkLabel} must reference a menu item` };
      }

      if (
        context.parentItemId != null &&
        link.linkedMenuItemId === context.parentItemId
      ) {
        return { error: `${linkLabel} cannot reference the parent item itself` };
      }

      const linkedMenuItem = await context.loadMenuItem(link.linkedMenuItemId);
      if (!linkedMenuItem) {
        return { error: `${linkLabel} references an unknown menu item` };
      }
      if (linkedMenuItem.category?.slug === "deals") {
        return { error: `${linkLabel} cannot reference another deal` };
      }
      if (!linkedMenuItem.isActive) {
        return { error: `${linkLabel} references an inactive menu item` };
      }
      if (!isMenuItemAvailable(linkedMenuItem)) {
        enrichedLinks.push({
          ...link,
          itemNameSnapshot: linkedMenuItem.name,
          sizeNameSnapshot:
            existingLink?.linkedMenuItemId === link.linkedMenuItemId &&
            existingLink.linkedSizeId === link.linkedSizeId
              ? existingLink.sizeNameSnapshot
              : null,
        });
        continue;
      }
      let sizeNameSnapshot: string | null = null;
      if (linkedMenuItem.sizes.length > 0) {
        if (link.linkedSizeId == null) {
          return { error: `${linkLabel} must specify a size` };
        }
        const chosenSize = linkedMenuItem.sizes.find((s) => s.id === link.linkedSizeId);
        if (!chosenSize) {
          return { error: `${linkLabel} size does not belong to its menu item` };
        }
        sizeNameSnapshot = chosenSize.name;
      } else if (link.linkedSizeId != null) {
        return {
          error: `${linkLabel} cannot specify a size — its menu item has no sizes`,
        };
      }

      // Recompute itemNameSnapshot from live linkedMenuItem.name — never trust client-supplied
      // value when a live link exists. Trust boundary parallel to sizeNameSnapshot.
      enrichedLinks.push({
        ...link,
        itemNameSnapshot: linkedMenuItem.name,
        sizeNameSnapshot,
      });
    }

    result.push({
      ...option,
      linkedItems: enrichedLinks,
    });
  }

  return { value: result };
}

export function normalizeCategorySlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function validateCategoryInput(
  raw: unknown
): { value?: AdminCategoryInput; error?: string } {
  if (!isRecord(raw)) return { error: "Invalid category payload" };

  const slug = normalizeCategorySlug(String(raw.slug ?? ""));
  const name = toTrimmedString(raw.name);
  const icon = toTrimmedString(raw.icon);
  const sortOrderCheck = parseNonNegativeInteger(raw.sortOrder, "sort order", 0);

  if (!slug) return { error: "slug is required" };
  if (slug.length > 40) return { error: "slug must be 40 characters or fewer" };
  if (!name) return { error: "name is required" };
  if (name.length > 40) return { error: "name must be 40 characters or fewer" };
  if (!icon) return { error: "icon is required" };
  if (icon.length > 16) return { error: "icon must be 16 characters or fewer" };
  if (sortOrderCheck.error) return { error: sortOrderCheck.error };

  return {
    value: {
      slug,
      name,
      icon,
      sortOrder: sortOrderCheck.value as number,
      isActive: raw.isActive === undefined ? true : Boolean(raw.isActive),
    },
  };
}

export function validateImageAlt(
  raw: unknown
): { value?: string | null; error?: string } {
  if (raw === undefined || raw === null) return { value: null };
  if (typeof raw !== "string") return { error: "image alt must be text" };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { value: null };
  if (trimmed.length > 200) {
    return { error: "image alt must be 200 characters or fewer" };
  }
  return { value: trimmed };
}

export function validateImageFit(raw: unknown): { value?: ImageFit; error?: string } {
  const normalized =
    raw == null || raw === "" ? "COVER" : String(raw).trim().toUpperCase();
  if (normalized === "COVER" || normalized === "CONTAIN") {
    return { value: normalized };
  }
  return { error: "image fit is invalid" };
}

export function validateImageUrl(
  raw: unknown,
  allowedHosts: string[]
): { value?: string | null; error?: string } {
  if (raw === undefined || raw === null) return { value: null };
  if (typeof raw !== "string") return { error: "image URL must be text" };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { value: null };
  if (trimmed.length > 2048) {
    return { error: "image URL is too long" };
  }

  // Local-served hero. Only /800.webp is DB-valid; the kiosk derives
  // /400.webp on demand via buildThumbUrl().
  if (LOCAL_IMAGE_URL_HERO_RE.test(trimmed)) {
    return { value: trimmed };
  }

  // Remote paste-URL branch: https + host allowlist.
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { error: "image URL is not a valid URL" };
  }

  if (parsed.protocol !== "https:") {
    return { error: "image URL must use https" };
  }

  const host = parsed.host.toLowerCase();
  if (!allowedHosts.includes(host)) {
    return { error: "image URL host is not on the allowlist" };
  }

  return { value: trimmed };
}

export function validateItemInput(
  raw: unknown,
  options: { allowedImageHosts: string[] }
): { value?: AdminItemInput; error?: string } {
  if (!isRecord(raw)) return { error: "Invalid item payload" };

  const categoryId = toTrimmedString(raw.categoryId);
  const dealBaseMenuItemId =
    raw.dealBaseMenuItemId == null || raw.dealBaseMenuItemId === ""
      ? null
      : toTrimmedString(raw.dealBaseMenuItemId);
  const dealBaseSizeId =
    raw.dealBaseSizeId == null || raw.dealBaseSizeId === ""
      ? null
      : toTrimmedString(raw.dealBaseSizeId);
  const dealBaseSizeNameSnapshot =
    raw.dealBaseSizeNameSnapshot == null ||
    raw.dealBaseSizeNameSnapshot === ""
      ? null
      : toTrimmedString(raw.dealBaseSizeNameSnapshot);
  const comboNumCheck = parsePositiveIntegerOrNull(raw.comboNum, "combo number");
  const name = toTrimmedString(raw.name);
  const description = toTrimmedString(raw.description);
  const priceCheck = parseMoney(raw.price, "price");
  const emoji = toTrimmedString(raw.emoji) || "🍔";
  const bgColor = toTrimmedString(raw.bgColor) || "#ffe3b3";
  const bundleSavingsCheck = parseMoney(raw.bundleSavings, "bundle savings", {
    allowNull: true,
  });
  const dealExpiresAtCheck = parseOptionalDateTime(
    raw.dealExpiresAt,
    "deal expiration"
  );
  const dealStartsAtCheck = parseOptionalDateTime(
    raw.dealStartsAt,
    "deal start"
  );
  const dealLimitModeCheck = parseDealLimitMode(raw.dealLimitMode);
  const dealLimitQtyCheck = parseNonNegativeIntegerOrNull(
    raw.dealLimitQty,
    "deal limit quantity"
  );
  const dealLimitLowThresholdCheck = parseNonNegativeIntegerOrNull(
    raw.dealLimitLowThreshold,
    "deal limit low alert"
  );
  const imageUrlCheck = validateImageUrl(raw.imageUrl, options.allowedImageHosts);
  const imageAltCheck = validateImageAlt(raw.imageAlt);
  const imageFitCheck = validateImageFit(raw.imageFit);
  const cardImageUrlCheck = validateImageUrl(raw.cardImageUrl, options.allowedImageHosts);
  const cardImageAltCheck = validateImageAlt(raw.cardImageAlt);
  const sortOrderCheck = parseNonNegativeInteger(raw.sortOrder, "sort order", 0);
  const stockModeCheck = parseStockMode(raw.stockMode);
  const stockQtyCheck: { value?: number | null; error?: string } =
    stockModeCheck.value === "QUANTITY"
      ? parseNonNegativeInteger(raw.stockQty, "stock quantity", 0)
      : { value: null as number | null };
  const lowStockThresholdCheck: { value?: number | null; error?: string } =
    stockModeCheck.value === "QUANTITY"
      ? parseNonNegativeIntegerOrNull(raw.lowStockThreshold, "low stock threshold")
      : { value: null as number | null };
  const sizesCheck = validateModifiers(raw.sizes, "sizes");
  const addonsCheck = validateModifiers(raw.addons, "add-ons");
  const upgradeOptionsCheck = validateUpgradeOptions(raw.upgradeOptions, "upgrade options");

  if (!categoryId) return { error: "category is required" };
  if (
    raw.dealBaseMenuItemId != null &&
    raw.dealBaseMenuItemId !== "" &&
    typeof raw.dealBaseMenuItemId !== "string"
  ) {
    return { error: "deal base item is invalid" };
  }
  if (
    raw.dealBaseSizeId != null &&
    raw.dealBaseSizeId !== "" &&
    typeof raw.dealBaseSizeId !== "string"
  ) {
    return { error: "deal base size is invalid" };
  }
  if (
    raw.dealBaseSizeNameSnapshot != null &&
    raw.dealBaseSizeNameSnapshot !== "" &&
    typeof raw.dealBaseSizeNameSnapshot !== "string"
  ) {
    return { error: "deal base size is invalid" };
  }
  if (comboNumCheck.error) return { error: comboNumCheck.error };
  if (!name) return { error: "name is required" };
  if (name.length > 80) return { error: "name must be 80 characters or fewer" };
  if (!description) return { error: "description is required" };
  if (description.length > 240) {
    return { error: "description must be 240 characters or fewer" };
  }
  if (priceCheck.error) return { error: priceCheck.error };
  if (emoji.length > 16) return { error: "emoji must be 16 characters or fewer" };
  if (!/^#[0-9a-fA-F]{6}$/.test(bgColor)) {
    return { error: "background color must be a valid 6-digit hex color" };
  }

  const badgeCheck = parseBadge(raw.badge);
  if (badgeCheck.error) return { error: badgeCheck.error };

  if (bundleSavingsCheck.error) return { error: bundleSavingsCheck.error };
  if (dealStartsAtCheck.error) return { error: dealStartsAtCheck.error };
  if (dealExpiresAtCheck.error) return { error: dealExpiresAtCheck.error };
  if (dealLimitModeCheck.error) return { error: dealLimitModeCheck.error };
  if (dealLimitQtyCheck.error) return { error: dealLimitQtyCheck.error };
  if (dealLimitLowThresholdCheck.error) {
    return { error: dealLimitLowThresholdCheck.error };
  }
  if (
    dealLimitModeCheck.value === "LIMITED" &&
    dealLimitQtyCheck.value == null
  ) {
    return { error: "deal limit quantity is required" };
  }
  const dealLimitQtyMaxCheck = validateDealLimitNumber(
    dealLimitQtyCheck.value,
    "deal limit quantity"
  );
  if (dealLimitQtyMaxCheck.error) return { error: dealLimitQtyMaxCheck.error };
  const dealLimitLowThresholdMaxCheck = validateDealLimitNumber(
    dealLimitLowThresholdCheck.value,
    "deal limit low alert"
  );
  if (dealLimitLowThresholdMaxCheck.error) {
    return { error: dealLimitLowThresholdMaxCheck.error };
  }
  if (imageUrlCheck.error) return { error: imageUrlCheck.error };
  if (imageAltCheck.error) return { error: imageAltCheck.error };
  if (imageFitCheck.error) return { error: imageFitCheck.error };
  if (cardImageUrlCheck.error) return { error: cardImageUrlCheck.error };
  if (cardImageAltCheck.error) return { error: cardImageAltCheck.error };
  if (sortOrderCheck.error) return { error: sortOrderCheck.error };
  if (stockModeCheck.error) return { error: stockModeCheck.error };
  if (stockQtyCheck.error) return { error: stockQtyCheck.error };
  if (lowStockThresholdCheck.error) {
    return { error: lowStockThresholdCheck.error };
  }
  if (sizesCheck.error) return { error: sizesCheck.error };
  if (addonsCheck.error) return { error: addonsCheck.error };
  if (upgradeOptionsCheck.error) return { error: upgradeOptionsCheck.error };

  const stockMode = stockModeCheck.value as MenuStockMode;
  const stockQty =
    stockMode === "QUANTITY" ? (stockQtyCheck.value as number) : null;
  const lowStockThreshold =
    stockMode === "QUANTITY"
      ? (lowStockThresholdCheck.value as number | null)
      : null;

  return {
    value: {
      categoryId,
      comboNum: comboNumCheck.value as number | null,
      name,
      description,
      price: priceCheck.value as number,
      emoji,
      bgColor: bgColor.toLowerCase(),
      badge: badgeCheck.value as Exclude<Badge, null> | null,
      bundleSavings: bundleSavingsCheck.value as number | null,
      dealBaseMenuItemId,
      dealBaseSizeId: dealBaseMenuItemId ? dealBaseSizeId : null,
      dealBaseSizeNameSnapshot:
        dealBaseMenuItemId && dealBaseSizeId ? dealBaseSizeNameSnapshot : null,
      dealStartsAt: dealStartsAtCheck.value ?? null,
      dealExpiresAt: dealExpiresAtCheck.value ?? null,
      dealLimitMode: dealLimitModeCheck.value as DealLimitMode,
      dealLimitQty: dealLimitQtyCheck.value ?? null,
      dealLimitLowThreshold: dealLimitLowThresholdCheck.value ?? null,
      imageUrl: imageUrlCheck.value ?? null,
      imageAlt: imageAltCheck.value ?? null,
      imageFit: imageFitCheck.value as ImageFit,
      cardImageUrl: cardImageUrlCheck.value ?? null,
      cardImageAlt: cardImageAltCheck.value ?? null,
      isActive: raw.isActive === undefined ? true : Boolean(raw.isActive),
      isOutOfStock:
        raw.isOutOfStock === undefined ? false : Boolean(raw.isOutOfStock),
      stockMode,
      stockQty,
      lowStockThreshold,
      sortOrder: sortOrderCheck.value as number,
      sizes: sizesCheck.value as AdminModifierInput[],
      addons: addonsCheck.value as AdminModifierInput[],
      upgradeOptions: upgradeOptionsCheck.value as AdminUpgradeOptionInput[],
    },
  };
}
