import {
  isMenuItemAvailable,
  type MenuStockMode,
} from "@/lib/menu-availability";
import { validateDealSchedule } from "@/lib/deal-schedule";

export const DEAL_BASE_ISSUE_CODES = {
  MISSING_BASE: "deal_base_missing",
  BASE_NOT_FOUND: "deal_base_not_found",
  BASE_POINTS_TO_DEAL: "deal_base_points_to_deal",
  BASE_CROSS_OUTLET: "deal_base_cross_outlet",
  BASE_SELF_REFERENCE: "deal_base_self_reference",
  BASE_SIZE_INVALID: "deal_base_size_invalid",
  NESTED_DEAL_LINK: "deal_nested_deal_link",
  CROSS_OUTLET_LINK: "deal_cross_outlet_link",
  MISSING_LINKED_ITEM: "deal_missing_linked_item",
  INVALID_LINKED_SIZE: "deal_invalid_linked_size",
  LINKED_ITEM_UNAVAILABLE: "deal_linked_item_unavailable",
} as const;

export type DealBaseIssueCode =
  (typeof DEAL_BASE_ISSUE_CODES)[keyof typeof DEAL_BASE_ISSUE_CODES];

export type DealBaseIssueSeverity = "repair" | "warning" | "blocking";

export type DealBaseValidationIssue = {
  code: DealBaseIssueCode;
  severity: DealBaseIssueSeverity;
  message: string;
  dealId: string;
  dealName?: string;
  menuItemId?: string | null;
  menuItemName?: string | null;
  upgradeOptionId?: string;
  linkId?: string;
};

export const DEAL_VISIBILITY_REASONS = {
  LIVE: "live",
  MANUALLY_HIDDEN: "manually_hidden",
  NO_EXPIRATION: "no_expiration",
  INVALID_SCHEDULE: "invalid_schedule",
  NOT_STARTED: "not_started",
  EXPIRED: "expired",
  BASE_MISSING: "base_missing",
  BASE_UNAVAILABLE: "base_unavailable",
  INCLUDED_ITEMS_UNAVAILABLE: "included_items_unavailable",
  NEEDS_REPAIR: "needs_repair",
} as const;

export type DealVisibilityReason =
  (typeof DEAL_VISIBILITY_REASONS)[keyof typeof DEAL_VISIBILITY_REASONS];

export type DealVisibilityResult = {
  visible: boolean;
  reason: DealVisibilityReason;
  repairNeeded: boolean;
  customerMessage?: string;
  issues: DealBaseValidationIssue[];
};

export function makeDealVisibilityResult(
  visible: boolean,
  reason: DealVisibilityReason,
  issues: DealBaseValidationIssue[] = [],
  customerMessage?: string
): DealVisibilityResult {
  return {
    visible,
    reason,
    repairNeeded:
      reason === DEAL_VISIBILITY_REASONS.NEEDS_REPAIR ||
      issues.some((issue) => issue.severity === "repair"),
    customerMessage,
    issues,
  };
}

export type DealBaseCategoryLike = {
  id?: string;
  slug: string;
};

export type DealBaseMenuItemLike = {
  id: string;
  outletId: string;
  name: string;
  isActive?: boolean;
  isOutOfStock?: boolean;
  stockMode?: MenuStockMode | null;
  stockQty?: number | null;
  category: DealBaseCategoryLike;
};

export type DealBaseSizeLike = {
  id: string;
  itemId: string;
};

export type DealBaseUpgradeItemLinkLike = {
  id: string;
  linkedMenuItemId: string | null;
  linkedSizeId: string | null;
  linkedMenuItem: DealBaseMenuItemLike | null;
  linkedSize?: DealBaseSizeLike | null;
};

export type DealBaseUpgradeOptionLike = {
  id: string;
  linkedItems: ReadonlyArray<DealBaseUpgradeItemLinkLike>;
};

export type DealDefinitionLike = {
  id: string;
  name: string;
  outletId: string;
  dealBaseMenuItemId: string | null;
  dealBaseMenuItem: DealBaseMenuItemLike | null;
  upgradeOptions: ReadonlyArray<DealBaseUpgradeOptionLike>;
};

export function validateDealBaseReference(
  deal: Pick<
    DealDefinitionLike,
    "id" | "name" | "outletId" | "dealBaseMenuItemId" | "dealBaseMenuItem"
  >
): DealBaseValidationIssue[] {
  const baseId = deal.dealBaseMenuItemId;
  if (!baseId) {
    return [
      {
        code: DEAL_BASE_ISSUE_CODES.MISSING_BASE,
        severity: "repair",
        message: "Deal is missing a base item reference.",
        dealId: deal.id,
        dealName: deal.name,
        menuItemId: null,
      },
    ];
  }

  if (baseId === deal.id) {
    return [
      {
        code: DEAL_BASE_ISSUE_CODES.BASE_SELF_REFERENCE,
        severity: "repair",
        message: "Deal base item points to the deal itself.",
        dealId: deal.id,
        dealName: deal.name,
        menuItemId: baseId,
      },
    ];
  }

  if (!deal.dealBaseMenuItem) {
    return [
      {
        code: DEAL_BASE_ISSUE_CODES.BASE_NOT_FOUND,
        severity: "repair",
        message: "Deal base item no longer exists.",
        dealId: deal.id,
        dealName: deal.name,
        menuItemId: baseId,
      },
    ];
  }

  if (deal.dealBaseMenuItem.outletId !== deal.outletId) {
    return [
      {
        code: DEAL_BASE_ISSUE_CODES.BASE_CROSS_OUTLET,
        severity: "repair",
        message: "Deal base item belongs to a different outlet.",
        dealId: deal.id,
        dealName: deal.name,
        menuItemId: baseId,
        menuItemName: deal.dealBaseMenuItem.name,
      },
    ];
  }

  if (deal.dealBaseMenuItem.category.slug === "deals") {
    return [
      {
        code: DEAL_BASE_ISSUE_CODES.BASE_POINTS_TO_DEAL,
        severity: "repair",
        message: "Deal base item points to another deal shell.",
        dealId: deal.id,
        dealName: deal.name,
        menuItemId: baseId,
        menuItemName: deal.dealBaseMenuItem.name,
      },
    ];
  }

  return [];
}

export function validateOptionalDealBaseReference(
  deal: Pick<
    DealDefinitionLike,
    "id" | "name" | "outletId" | "dealBaseMenuItemId" | "dealBaseMenuItem"
  >
): DealBaseValidationIssue[] {
  return deal.dealBaseMenuItemId ? validateDealBaseReference(deal) : [];
}

export function validateDealUpgradeLinks(
  deal: Pick<DealDefinitionLike, "id" | "name" | "outletId" | "upgradeOptions">
): DealBaseValidationIssue[] {
  const issues: DealBaseValidationIssue[] = [];

  for (const upgrade of deal.upgradeOptions) {
    for (const link of upgrade.linkedItems) {
      if (!link.linkedMenuItemId || !link.linkedMenuItem) {
        issues.push({
          code: DEAL_BASE_ISSUE_CODES.MISSING_LINKED_ITEM,
          severity: "repair",
          message: "Deal upgrade link points to a missing menu item.",
          dealId: deal.id,
          dealName: deal.name,
          upgradeOptionId: upgrade.id,
          linkId: link.id,
          menuItemId: link.linkedMenuItemId,
        });
        continue;
      }

      if (link.linkedMenuItem.outletId !== deal.outletId) {
        issues.push({
          code: DEAL_BASE_ISSUE_CODES.CROSS_OUTLET_LINK,
          severity: "repair",
          message: "Deal upgrade link points to a different outlet.",
          dealId: deal.id,
          dealName: deal.name,
          upgradeOptionId: upgrade.id,
          linkId: link.id,
          menuItemId: link.linkedMenuItemId,
          menuItemName: link.linkedMenuItem.name,
        });
      }

      if (link.linkedMenuItem.category.slug === "deals") {
        issues.push({
          code: DEAL_BASE_ISSUE_CODES.NESTED_DEAL_LINK,
          severity: "repair",
          message: "Deal upgrade link points to another deal shell.",
          dealId: deal.id,
          dealName: deal.name,
          upgradeOptionId: upgrade.id,
          linkId: link.id,
          menuItemId: link.linkedMenuItemId,
          menuItemName: link.linkedMenuItem.name,
        });
      }

      if (
        link.linkedSizeId &&
        (!link.linkedSize || link.linkedSize.itemId !== link.linkedMenuItemId)
      ) {
        issues.push({
          code: DEAL_BASE_ISSUE_CODES.INVALID_LINKED_SIZE,
          severity: "repair",
          message:
            "Deal upgrade link points to a size that does not belong to the linked item.",
          dealId: deal.id,
          dealName: deal.name,
          upgradeOptionId: upgrade.id,
          linkId: link.id,
          menuItemId: link.linkedMenuItemId,
          menuItemName: link.linkedMenuItem.name,
        });
      }

      if (!isMenuItemAvailable({ isActive: true, ...link.linkedMenuItem })) {
        issues.push({
          code: DEAL_BASE_ISSUE_CODES.LINKED_ITEM_UNAVAILABLE,
          severity: "warning",
          message:
            "Deal upgrade link points to an item that is currently unavailable.",
          dealId: deal.id,
          dealName: deal.name,
          upgradeOptionId: upgrade.id,
          linkId: link.id,
          menuItemId: link.linkedMenuItemId,
          menuItemName: link.linkedMenuItem.name,
        });
      }
    }
  }

  return issues;
}

export function validateDealDefinition(
  deal: DealDefinitionLike
): DealBaseValidationIssue[] {
  return [
    ...validateDealBaseReference(deal),
    ...validateDealUpgradeLinks(deal),
  ];
}

export function firstRepairMessage(issues: DealBaseValidationIssue[]) {
  return issues.find((issue) => issue.severity === "repair") ?? null;
}

export function isStrictDealBaseEnforcementEnabled(
  env: Record<string, string | undefined> =
    typeof process === "undefined" ? {} : process.env
): boolean {
  const raw = env.STRICT_DEAL_BASE_ENFORCEMENT?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export type DealCustomerVisibilityMenuItemLike = DealBaseMenuItemLike & {
  sizes?: ReadonlyArray<{ id: string }>;
};

export type DealCustomerVisibilitySizeLike = {
  id: string;
  itemId: string;
};

export type DealCustomerVisibilityLinkLike = {
  id: string;
  linkedMenuItemId: string | null;
  linkedSizeId: string | null;
  sizeNameSnapshot: string | null;
  linkedMenuItem: DealCustomerVisibilityMenuItemLike | null;
  linkedSize?: DealCustomerVisibilitySizeLike | null;
};

export type DealCustomerVisibilityOptionLike<
  TLink extends DealCustomerVisibilityLinkLike = DealCustomerVisibilityLinkLike
> = {
  id: string;
  linkedItems: ReadonlyArray<TLink>;
};

export type DealCustomerVisibilityLike<
  TOption extends DealCustomerVisibilityOptionLike = DealCustomerVisibilityOptionLike
> = Omit<DealDefinitionLike, "dealBaseMenuItem" | "upgradeOptions"> & {
  isActive: boolean;
  dealStartsAt?: Date | string | null;
  dealExpiresAt?: Date | string | null;
  dealBaseMenuItem: DealCustomerVisibilityMenuItemLike | null;
  upgradeOptions: ReadonlyArray<TOption>;
};

function coerceDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isRequiredDealLinkCustomerRenderable<
  TLink extends DealCustomerVisibilityLinkLike
>(deal: Pick<DealDefinitionLike, "outletId">, link: TLink): boolean {
  if (!link.linkedMenuItemId || !link.linkedMenuItem) return false;
  if (link.linkedMenuItem.outletId !== deal.outletId) return false;
  if (link.linkedMenuItem.category.slug === "deals") return false;
  if (!isMenuItemAvailable({ isActive: true, ...link.linkedMenuItem })) {
    return false;
  }

  if (link.linkedSizeId) {
    if (!link.linkedSize || link.linkedSize.itemId !== link.linkedMenuItemId) {
      return false;
    }
  }

  // Sticky size lost: the link was originally size-specific, but the size row
  // was deleted via SetNull. Do not sell an ambiguous deal component.
  if (link.sizeNameSnapshot != null && link.linkedSizeId == null) return false;

  // A size-less link is only safe while the linked item has no customer-facing
  // sizes. If sizes were later added, the admin must choose one explicitly.
  if (
    link.sizeNameSnapshot == null &&
    link.linkedSizeId == null &&
    (link.linkedMenuItem.sizes?.length ?? 0) > 0
  ) {
    return false;
  }

  return true;
}

export function getCompleteDealUpgradeLinks<
  TLink extends DealCustomerVisibilityLinkLike
>(
  deal: Pick<DealDefinitionLike, "outletId">,
  option: DealCustomerVisibilityOptionLike<TLink>
): TLink[] {
  if (option.linkedItems.length === 0) return [];
  return option.linkedItems.every((link) =>
    isRequiredDealLinkCustomerRenderable(deal, link)
  )
    ? [...option.linkedItems]
    : [];
}

export function isDealCustomerVisible(
  deal: DealCustomerVisibilityLike,
  now: Date = new Date()
): DealVisibilityResult {
  if (!deal.isActive) {
    return makeDealVisibilityResult(false, DEAL_VISIBILITY_REASONS.MANUALLY_HIDDEN);
  }

  const schedule = validateDealSchedule(
    { startsAt: deal.dealStartsAt, expiresAt: deal.dealExpiresAt },
    now,
  );
  if (!schedule.ok) {
    return makeDealVisibilityResult(
      false,
      schedule.status === "missing"
        ? DEAL_VISIBILITY_REASONS.NO_EXPIRATION
        : DEAL_VISIBILITY_REASONS.INVALID_SCHEDULE,
    );
  }
  if (schedule.status === "scheduled") {
    return makeDealVisibilityResult(false, DEAL_VISIBILITY_REASONS.NOT_STARTED);
  }
  if (schedule.status === "expired") {
    return makeDealVisibilityResult(false, DEAL_VISIBILITY_REASONS.EXPIRED);
  }

  const issues = validateDealDefinition(deal);
  const repairIssues = issues.filter((issue) => issue.severity === "repair");
  if (repairIssues.length > 0) {
    return makeDealVisibilityResult(
      false,
      DEAL_VISIBILITY_REASONS.NEEDS_REPAIR,
      repairIssues
    );
  }

  if (!deal.dealBaseMenuItem) {
    return makeDealVisibilityResult(false, DEAL_VISIBILITY_REASONS.BASE_MISSING);
  }
  if (!isMenuItemAvailable({ isActive: true, ...deal.dealBaseMenuItem })) {
    return makeDealVisibilityResult(false, DEAL_VISIBILITY_REASONS.BASE_UNAVAILABLE);
  }

  const hasCompleteOption = deal.upgradeOptions.some(
    (option) => getCompleteDealUpgradeLinks(deal, option).length > 0
  );
  if (!hasCompleteOption) {
    return makeDealVisibilityResult(
      false,
      DEAL_VISIBILITY_REASONS.INCLUDED_ITEMS_UNAVAILABLE,
      issues
    );
  }

  return makeDealVisibilityResult(true, DEAL_VISIBILITY_REASONS.LIVE, issues);
}

type SnapshotCategoryLike = {
  id: string;
  slug: string;
};

type SnapshotItemLike = {
  id: string;
  categoryId: string;
  name: string;
  dealBaseMenuItemId: string | null;
  dealBaseSizeId?: string | null;
  dealBaseSizeNameSnapshot?: string | null;
  sizes?: Array<{ id: string; name?: string | null }>;
};

export function createSnapshotDealBaseResolver(snapshot: {
  categories: SnapshotCategoryLike[];
  items: SnapshotItemLike[];
}) {
  const categoryById = new Map(
    snapshot.categories.map((category) => [category.id, category])
  );
  const itemById = new Map(snapshot.items.map((item) => [item.id, item]));
  const safeBaseByDealId = new Map<string, string | null>();
  const safeBaseSizeByDealId = new Map<
    string,
    { id: string; name: string | null } | null
  >();
  const issues: DealBaseValidationIssue[] = [];

  for (const item of snapshot.items) {
    if (categoryById.get(item.categoryId)?.slug !== "deals") continue;

    const baseId = item.dealBaseMenuItemId;
    if (!baseId) {
      safeBaseByDealId.set(item.id, null);
      safeBaseSizeByDealId.set(item.id, null);
      issues.push({
        code: DEAL_BASE_ISSUE_CODES.MISSING_BASE,
        severity: "repair",
        message: "Deal is missing a base item reference.",
        dealId: item.id,
        dealName: item.name,
        menuItemId: null,
      });
      continue;
    }

    if (baseId === item.id) {
      safeBaseByDealId.set(item.id, null);
      safeBaseSizeByDealId.set(item.id, null);
      issues.push({
        code: DEAL_BASE_ISSUE_CODES.BASE_SELF_REFERENCE,
        severity: "repair",
        message: "Deal base item points to the deal itself.",
        dealId: item.id,
        dealName: item.name,
        menuItemId: baseId,
      });
      continue;
    }

    const baseItem = itemById.get(baseId);
    if (!baseItem) {
      safeBaseByDealId.set(item.id, null);
      safeBaseSizeByDealId.set(item.id, null);
      issues.push({
        code: DEAL_BASE_ISSUE_CODES.BASE_NOT_FOUND,
        severity: "repair",
        message: "Deal base item is missing from the snapshot.",
        dealId: item.id,
        dealName: item.name,
        menuItemId: baseId,
      });
      continue;
    }

    if (categoryById.get(baseItem.categoryId)?.slug === "deals") {
      safeBaseByDealId.set(item.id, null);
      safeBaseSizeByDealId.set(item.id, null);
      issues.push({
        code: DEAL_BASE_ISSUE_CODES.BASE_POINTS_TO_DEAL,
        severity: "repair",
        message: "Deal base item points to another deal.",
        dealId: item.id,
        dealName: item.name,
        menuItemId: baseId,
      });
      continue;
    }

    safeBaseByDealId.set(item.id, baseId);
    const safeSize =
      item.dealBaseSizeId && Array.isArray(baseItem.sizes)
        ? (baseItem.sizes.find((size) => size.id === item.dealBaseSizeId) ??
          null)
        : null;
    safeBaseSizeByDealId.set(
      item.id,
      safeSize
        ? {
            id: safeSize.id,
            name:
              safeSize.name ??
              item.dealBaseSizeNameSnapshot ??
              null,
          }
        : null,
    );
  }

  return {
    issues,
    getSafeBaseMenuItemId(item: SnapshotItemLike) {
      return safeBaseByDealId.get(item.id) ?? null;
    },
    getSafeBaseSizeId(item: SnapshotItemLike) {
      return safeBaseSizeByDealId.get(item.id)?.id ?? null;
    },
    getSafeBaseSizeName(item: SnapshotItemLike) {
      return safeBaseSizeByDealId.get(item.id)?.name ?? null;
    },
  };
}
