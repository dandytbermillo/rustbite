import type { Prisma } from "@prisma/client";
import type { MenuStockMode } from "@/lib/menu-availability";
import { bumpOutletMenuVersion } from "@/lib/outlet-menu-sync";
import type {
  StockRequirementSnapshot,
  StockRequirementSource,
  StockRequirementTargetType,
} from "@/lib/types";

type StockMovementTx = Pick<Prisma.TransactionClient, "stockMovement">;
type OrderStockTx = Pick<
  Prisma.TransactionClient,
  | "menuItem"
  | "addonOption"
  | "sharedModifierOption"
  | "sharedModifierGroup"
  | "stockMovement"
  | "outletMenuVersion"
>;

export type StockActor = {
  actorType: string;
  actorId: string | null;
};

export type StockItemState = {
  stockMode: MenuStockMode;
  stockQty: number | null;
};

type AggregatedStockRequirement = {
  targetType: StockRequirementTargetType;
  targetId: string;
  targetNameSnapshot: string;
  qty: number;
  sources: Set<StockRequirementSource>;
  orderLineMenuItemId: string;
  menuItemId: string | null;
  addonOptionId: string | null;
  sharedModifierOptionId: string | null;
};

type StockTargetRow = {
  targetType: StockRequirementTargetType;
  targetId: string;
  targetNameSnapshot: string;
  stockMode: MenuStockMode;
  isOutOfStock: boolean;
  stockQty: number | null;
  menuItemId: string | null;
  addonOptionId: string | null;
  sharedModifierOptionId: string | null;
  parentMenuItemId: string | null;
  parentSharedModifierGroupId: string | null;
};

export type MenuStockUnavailableItem = {
  targetType: StockRequirementTargetType;
  targetId: string;
  targetNameSnapshot: string;
  requestedQty: number;
  availableQty: number;
  menuItemId?: string | null;
  nameSnapshot?: string;
};

export type OrderStockReturnResult = {
  changed: boolean;
  returnedItems: Array<{
    targetType: StockRequirementTargetType;
    targetId: string;
    targetNameSnapshot: string;
    qty: number;
    beforeQty: number;
    afterQty: number;
    menuItemId?: string | null;
    nameSnapshot?: string;
  }>;
  skippedItems: Array<{
    targetType: StockRequirementTargetType;
    targetId: string;
    targetNameSnapshot: string;
    qty: number;
    reason: string;
    menuItemId?: string | null;
    nameSnapshot?: string;
  }>;
};

export class MenuStockUnavailableError extends Error {
  readonly code = "MENU_STOCK_UNAVAILABLE" as const;

  constructor(readonly items: MenuStockUnavailableItem[]) {
    super("Some items are no longer available. Review your order before paying.");
    this.name = "MenuStockUnavailableError";
  }
}

function trackedQty(state: StockItemState | null): number | null {
  if (!state || state.stockMode !== "QUANTITY") return null;
  return state.stockQty ?? 0;
}

export function stockTrackingChanged(
  before: StockItemState | null,
  after: StockItemState
): boolean {
  return (
    before == null ||
    before.stockMode !== after.stockMode ||
    trackedQty(before) !== trackedQty(after)
  );
}

export async function recordAdminStockMovement(
  tx: StockMovementTx,
  input: {
    outletId: string;
    menuItemId?: string | null;
    addonOptionId?: string | null;
    sharedModifierOptionId?: string | null;
    targetType?: StockRequirementTargetType;
    targetId?: string;
    targetNameSnapshot?: string;
    itemNameSnapshot: string;
    before: StockItemState | null;
    after: StockItemState;
    actor: StockActor;
    note?: string | null;
  }
) {
  if (!stockTrackingChanged(input.before, input.after)) return;

  const beforeQty = trackedQty(input.before);
  const afterQty = trackedQty(input.after);
  const delta =
    input.after.stockMode === "QUANTITY" && input.before?.stockMode === "QUANTITY"
      ? (afterQty ?? 0) - (beforeQty ?? 0)
      : input.after.stockMode === "QUANTITY"
        ? afterQty ?? 0
        : 0;
  const targetType = input.targetType ?? "MENU_ITEM";
  const targetId = input.targetId ?? input.menuItemId;
  if (!targetId) {
    throw new Error("Stock movement target id is required.");
  }
  const targetNameSnapshot = input.targetNameSnapshot ?? input.itemNameSnapshot;

  await tx.stockMovement.create({
    data: {
      outletId: input.outletId,
      targetType,
      targetIdSnapshot: targetId,
      targetNameSnapshot,
      menuItemId: targetType === "MENU_ITEM" ? input.menuItemId ?? null : null,
      addonOptionId:
        targetType === "ITEM_LOCAL_ADDON" ? input.addonOptionId ?? null : null,
      sharedModifierOptionId:
        targetType === "SHARED_MODIFIER_OPTION"
          ? input.sharedModifierOptionId ?? null
          : null,
      itemNameSnapshot: input.itemNameSnapshot,
      delta,
      beforeQty,
      afterQty,
      reason: "ADMIN_SET",
      idempotencyKey: null,
      actorType: input.actor.actorType,
      actorId: input.actor.actorId,
      note: input.note ?? null,
    },
  });
}

const STOCK_REQUIREMENT_SOURCES = new Set<StockRequirementSource>([
  "NORMAL_ITEM",
  "DEAL_BASE_ITEM",
  "DEAL_INCLUDED_ITEM",
  "ITEM_LOCAL_ADDON",
  "SHARED_MODIFIER_OPTION",
]);

const STOCK_REQUIREMENT_TARGET_TYPES = new Set<StockRequirementTargetType>([
  "MENU_ITEM",
  "ITEM_LOCAL_ADDON",
  "SHARED_MODIFIER_OPTION",
]);

function optionalString(value: unknown): string | null | undefined {
  if (value == null) return null;
  return typeof value === "string" ? value : undefined;
}

function normalizeStockRequirementSnapshot(
  value: unknown
): StockRequirementSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const qty = v.qty;
  const source = v.source;
  const orderLineMenuItemId = v.orderLineMenuItemId;

  if (
    !Number.isInteger(qty) ||
    Number(qty) <= 0 ||
    typeof source !== "string" ||
    !STOCK_REQUIREMENT_SOURCES.has(source as StockRequirementSource) ||
    typeof orderLineMenuItemId !== "string" ||
    orderLineMenuItemId.length === 0
  ) {
    return null;
  }

  const upgradeOptionId = optionalString(v.upgradeOptionId);
  const upgradeItemLinkId = optionalString(v.upgradeItemLinkId);
  const menuItemId = optionalString(v.menuItemId);
  const addonOptionId = optionalString(v.addonOptionId);
  const sharedModifierOptionId = optionalString(v.sharedModifierOptionId);
  if (
    upgradeOptionId === undefined ||
    upgradeItemLinkId === undefined ||
    menuItemId === undefined ||
    addonOptionId === undefined ||
    sharedModifierOptionId === undefined
  ) {
    return null;
  }

  if (typeof v.targetType === "string") {
    if (
      !STOCK_REQUIREMENT_TARGET_TYPES.has(
        v.targetType as StockRequirementTargetType
      ) ||
      typeof v.targetId !== "string" ||
      v.targetId.length === 0 ||
      typeof v.targetNameSnapshot !== "string" ||
      v.targetNameSnapshot.length === 0
    ) {
      return null;
    }

    return {
      targetType: v.targetType as StockRequirementTargetType,
      targetId: v.targetId,
      targetNameSnapshot: v.targetNameSnapshot,
      qty: Number(qty),
      source: source as StockRequirementSource,
      orderLineMenuItemId,
      menuItemId,
      addonOptionId,
      sharedModifierOptionId,
      upgradeOptionId,
      upgradeItemLinkId,
    };
  }

  if (
    typeof v.menuItemId !== "string" ||
    v.menuItemId.length === 0 ||
    typeof v.nameSnapshot !== "string" ||
    v.nameSnapshot.length === 0
  ) {
    return null;
  }

  return {
    targetType: "MENU_ITEM",
    targetId: v.menuItemId,
    targetNameSnapshot: v.nameSnapshot,
    qty: Number(qty),
    source: source as StockRequirementSource,
    orderLineMenuItemId,
    menuItemId: v.menuItemId,
    addonOptionId: null,
    sharedModifierOptionId: null,
    upgradeOptionId,
    upgradeItemLinkId,
  };
}

export function parseStockRequirementsJson(
  value: unknown
): StockRequirementSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const normalized = normalizeStockRequirementSnapshot(entry);
    return normalized ? [normalized] : [];
  });
}

export function hasQuantityStockRequirements(
  requirements: readonly StockRequirementSnapshot[]
): boolean {
  return requirements.length > 0;
}

function requirementKey(requirement: Pick<StockRequirementSnapshot, "targetType" | "targetId">) {
  return `${requirement.targetType}:${requirement.targetId}`;
}

function aggregateRequirements(requirements: readonly StockRequirementSnapshot[]) {
  const byTarget = new Map<string, AggregatedStockRequirement>();

  for (const requirement of requirements) {
    const key = requirementKey(requirement);
    const existing = byTarget.get(key);
    if (existing) {
      existing.qty += requirement.qty;
      existing.sources.add(requirement.source);
      continue;
    }
    byTarget.set(key, {
      targetType: requirement.targetType,
      targetId: requirement.targetId,
      targetNameSnapshot: requirement.targetNameSnapshot,
      qty: requirement.qty,
      sources: new Set([requirement.source]),
      orderLineMenuItemId: requirement.orderLineMenuItemId,
      menuItemId:
        requirement.targetType === "MENU_ITEM"
          ? requirement.menuItemId ?? requirement.targetId
          : requirement.menuItemId ?? null,
      addonOptionId:
        requirement.targetType === "ITEM_LOCAL_ADDON"
          ? requirement.addonOptionId ?? requirement.targetId
          : requirement.addonOptionId ?? null,
      sharedModifierOptionId:
        requirement.targetType === "SHARED_MODIFIER_OPTION"
          ? requirement.sharedModifierOptionId ?? requirement.targetId
          : requirement.sharedModifierOptionId ?? null,
    });
  }

  return [...byTarget.values()];
}

async function loadStockTargetRows(
  tx: OrderStockTx,
  outletId: string,
  requirements: readonly AggregatedStockRequirement[]
) {
  const rowByKey = new Map<string, StockTargetRow>();
  const menuItemIds = requirements
    .filter((requirement) => requirement.targetType === "MENU_ITEM")
    .map((requirement) => requirement.targetId);
  const addonOptionIds = requirements
    .filter((requirement) => requirement.targetType === "ITEM_LOCAL_ADDON")
    .map((requirement) => requirement.targetId);
  const sharedModifierOptionIds = requirements
    .filter((requirement) => requirement.targetType === "SHARED_MODIFIER_OPTION")
    .map((requirement) => requirement.targetId);

  if (menuItemIds.length > 0) {
    const rows = await tx.menuItem.findMany({
      where: { outletId, id: { in: menuItemIds } },
      select: {
        id: true,
        name: true,
        stockMode: true,
        isOutOfStock: true,
        stockQty: true,
      },
    });
    for (const row of rows) {
      rowByKey.set(requirementKey({ targetType: "MENU_ITEM", targetId: row.id }), {
        targetType: "MENU_ITEM",
        targetId: row.id,
        targetNameSnapshot: row.name,
        stockMode: row.stockMode,
        isOutOfStock: row.isOutOfStock,
        stockQty: row.stockQty,
        menuItemId: row.id,
        addonOptionId: null,
        sharedModifierOptionId: null,
        parentMenuItemId: row.id,
        parentSharedModifierGroupId: null,
      });
    }
  }

  if (addonOptionIds.length > 0) {
    const rows = await tx.addonOption.findMany({
      where: { id: { in: addonOptionIds }, item: { outletId } },
      select: {
        id: true,
        itemId: true,
        name: true,
        stockMode: true,
        isOutOfStock: true,
        stockQty: true,
      },
    });
    for (const row of rows) {
      rowByKey.set(
        requirementKey({ targetType: "ITEM_LOCAL_ADDON", targetId: row.id }),
        {
          targetType: "ITEM_LOCAL_ADDON",
          targetId: row.id,
          targetNameSnapshot: row.name,
          stockMode: row.stockMode,
          isOutOfStock: row.isOutOfStock,
          stockQty: row.stockQty,
          menuItemId: null,
          addonOptionId: row.id,
          sharedModifierOptionId: null,
          parentMenuItemId: row.itemId,
          parentSharedModifierGroupId: null,
        }
      );
    }
  }

  if (sharedModifierOptionIds.length > 0) {
    const rows = await tx.sharedModifierOption.findMany({
      where: { id: { in: sharedModifierOptionIds }, group: { outletId } },
      select: {
        id: true,
        groupId: true,
        name: true,
        stockMode: true,
        isOutOfStock: true,
        stockQty: true,
      },
    });
    for (const row of rows) {
      rowByKey.set(
        requirementKey({
          targetType: "SHARED_MODIFIER_OPTION",
          targetId: row.id,
        }),
        {
          targetType: "SHARED_MODIFIER_OPTION",
          targetId: row.id,
          targetNameSnapshot: row.name,
          stockMode: row.stockMode,
          isOutOfStock: row.isOutOfStock,
          stockQty: row.stockQty,
          menuItemId: null,
          addonOptionId: null,
          sharedModifierOptionId: row.id,
          parentMenuItemId: null,
          parentSharedModifierGroupId: row.groupId,
        }
      );
    }
  }

  return rowByKey;
}

function unavailableItem(
  requirement: AggregatedStockRequirement,
  row: StockTargetRow | undefined
): MenuStockUnavailableItem {
  const targetNameSnapshot = row?.targetNameSnapshot ?? requirement.targetNameSnapshot;
  return {
    targetType: requirement.targetType,
    targetId: requirement.targetId,
    targetNameSnapshot,
    requestedQty: requirement.qty,
    availableQty:
      row &&
      row.stockMode === "QUANTITY" &&
      !(row.targetType === "MENU_ITEM" && row.isOutOfStock)
        ? row.stockQty ?? 0
        : 0,
    ...(requirement.targetType === "MENU_ITEM"
      ? { menuItemId: requirement.targetId, nameSnapshot: targetNameSnapshot }
      : {}),
  };
}

async function decrementTargetQuantity(
  tx: OrderStockTx,
  outletId: string,
  requirement: AggregatedStockRequirement,
  now: Date
) {
  if (requirement.targetType === "MENU_ITEM") {
    const update = await tx.menuItem.updateMany({
      where: {
        id: requirement.targetId,
        outletId,
        stockMode: "QUANTITY",
        isOutOfStock: false,
        stockQty: { gte: requirement.qty },
      },
      data: {
        stockQty: { decrement: requirement.qty },
        stockUpdatedAt: now,
        stockUpdatedById: null,
        lockVersion: { increment: 1 },
      },
    });
    return update.count === 1;
  }

  if (requirement.targetType === "ITEM_LOCAL_ADDON") {
    const update = await tx.addonOption.updateMany({
      where: {
        id: requirement.targetId,
        item: { outletId },
        stockMode: "QUANTITY",
        stockQty: { gte: requirement.qty },
      },
      data: {
        stockQty: { decrement: requirement.qty },
        stockUpdatedAt: now,
        stockUpdatedById: null,
      },
    });
    if (update.count !== 1) return false;
    const parentItemId = requirement.menuItemId;
    if (parentItemId) {
      await tx.menuItem.updateMany({
        where: { id: parentItemId, outletId },
        data: { lockVersion: { increment: 1 } },
      });
    }
    return true;
  }

  const update = await tx.sharedModifierOption.updateMany({
    where: {
      id: requirement.targetId,
      group: { outletId },
      stockMode: "QUANTITY",
      stockQty: { gte: requirement.qty },
    },
    data: {
      stockQty: { decrement: requirement.qty },
      stockUpdatedAt: now,
      stockUpdatedById: null,
    },
  });
  if (update.count !== 1) return false;
  const row = await tx.sharedModifierOption.findFirst({
    where: { id: requirement.targetId, group: { outletId } },
    select: { groupId: true },
  });
  if (row) {
    await tx.sharedModifierGroup.updateMany({
      where: { id: row.groupId, outletId },
      data: { lockVersion: { increment: 1 } },
    });
  }
  return true;
}

async function incrementTargetQuantity(
  tx: OrderStockTx,
  outletId: string,
  row: StockTargetRow,
  qty: number,
  now: Date,
  actor: StockActor | null
) {
  if (row.targetType === "MENU_ITEM") {
    const update = await tx.menuItem.updateMany({
      where: { id: row.targetId, outletId, stockMode: "QUANTITY" },
      data: {
        stockQty: { increment: qty },
        stockUpdatedAt: now,
        stockUpdatedById:
          actor?.actorType === "ADMIN_USER" ? actor.actorId : null,
        lockVersion: { increment: 1 },
      },
    });
    return update.count === 1;
  }

  if (row.targetType === "ITEM_LOCAL_ADDON") {
    const update = await tx.addonOption.updateMany({
      where: { id: row.targetId, item: { outletId }, stockMode: "QUANTITY" },
      data: {
        stockQty: { increment: qty },
        stockUpdatedAt: now,
        stockUpdatedById:
          actor?.actorType === "ADMIN_USER" ? actor.actorId : null,
      },
    });
    if (update.count !== 1) return false;
    if (row.parentMenuItemId) {
      await tx.menuItem.updateMany({
        where: { id: row.parentMenuItemId, outletId },
        data: { lockVersion: { increment: 1 } },
      });
    }
    return true;
  }

  const update = await tx.sharedModifierOption.updateMany({
    where: { id: row.targetId, group: { outletId }, stockMode: "QUANTITY" },
    data: {
      stockQty: { increment: qty },
      stockUpdatedAt: now,
      stockUpdatedById:
        actor?.actorType === "ADMIN_USER" ? actor.actorId : null,
    },
  });
  if (update.count !== 1) return false;
  if (row.parentSharedModifierGroupId) {
    await tx.sharedModifierGroup.updateMany({
      where: { id: row.parentSharedModifierGroupId, outletId },
      data: { lockVersion: { increment: 1 } },
    });
  }
  return true;
}

function stockMovementTargetFields(
  requirement: AggregatedStockRequirement,
  row: StockTargetRow | undefined
) {
  const targetNameSnapshot = row?.targetNameSnapshot ?? requirement.targetNameSnapshot;
  return {
    targetType: requirement.targetType,
    targetIdSnapshot: requirement.targetId,
    targetNameSnapshot,
    menuItemId: row?.menuItemId ?? null,
    addonOptionId: row?.addonOptionId ?? null,
    sharedModifierOptionId: row?.sharedModifierOptionId ?? null,
    itemNameSnapshot: targetNameSnapshot,
  };
}

function idempotencyKey(
  orderId: string,
  reason: string,
  requirement: Pick<AggregatedStockRequirement, "targetType" | "targetId">
) {
  return `order:${orderId}:${reason}:${requirement.targetType}:${requirement.targetId}`;
}

export async function decrementOrderStockRequirements(
  tx: OrderStockTx,
  input: {
    outletId: string;
    orderId: string;
    requirements: readonly StockRequirementSnapshot[];
    now?: Date;
  }
) {
  const requirements = aggregateRequirements(input.requirements);
  if (requirements.length === 0) return false;

  const now = input.now ?? new Date();
  const rowByKey = await loadStockTargetRows(tx, input.outletId, requirements);
  const unavailable: MenuStockUnavailableItem[] = [];

  for (const requirement of requirements) {
    const row = rowByKey.get(requirementKey(requirement));
    if (
      !row ||
      row.stockMode !== "QUANTITY" ||
      (row.targetType === "MENU_ITEM" && row.isOutOfStock) ||
      (row.stockQty ?? 0) < requirement.qty
    ) {
      unavailable.push(unavailableItem(requirement, row));
    }
  }

  if (unavailable.length > 0) {
    throw new MenuStockUnavailableError(unavailable);
  }

  for (const requirement of requirements) {
    const row = rowByKey.get(requirementKey(requirement))!;
    const beforeQty = row.stockQty ?? 0;
    const afterQty = beforeQty - requirement.qty;
    const updated = await decrementTargetQuantity(
      tx,
      input.outletId,
      { ...requirement, menuItemId: row.parentMenuItemId ?? requirement.menuItemId },
      now
    );

    if (!updated) {
      const liveRows = await loadStockTargetRows(tx, input.outletId, [requirement]);
      throw new MenuStockUnavailableError([
        unavailableItem(requirement, liveRows.get(requirementKey(requirement))),
      ]);
    }

    await tx.stockMovement.create({
      data: {
        outletId: input.outletId,
        ...stockMovementTargetFields(requirement, row),
        orderId: input.orderId,
        delta: -requirement.qty,
        reason: "ORDER_PLACED",
        idempotencyKey: idempotencyKey(input.orderId, "placed", requirement),
        beforeQty,
        afterQty,
        actorType: "ORDER",
        actorId: input.orderId,
        note: `Checkout stock decrement (${[...requirement.sources].join(", ")}).`,
      },
    });
  }

  await bumpOutletMenuVersion(tx, input.outletId);
  return true;
}

function cancellationRestockReason(
  previousStatus: string,
  nextStatus: string
): "CASH_ORDER_CANCELLED_RESTOCK" | "ORDER_CANCELLED_RESTOCK" | null {
  if (nextStatus !== "CANCELLED") return null;
  if (previousStatus === "AWAITING_COUNTER_PAYMENT") {
    return "CASH_ORDER_CANCELLED_RESTOCK";
  }
  if (previousStatus === "PAID") return "ORDER_CANCELLED_RESTOCK";
  return null;
}

export async function restockCancelledOrderStockRequirements(
  tx: OrderStockTx,
  input: {
    outletId: string;
    orderId: string;
    previousStatus: string;
    nextStatus: string;
    productionStartedAt?: Date | string | null;
    requirements: readonly StockRequirementSnapshot[];
    now?: Date;
  }
) {
  if (input.productionStartedAt) return false;

  const reason = cancellationRestockReason(
    input.previousStatus,
    input.nextStatus
  );
  if (!reason) return false;

  const requirements = aggregateRequirements(input.requirements);
  if (requirements.length === 0) return false;

  const now = input.now ?? new Date();
  const rowByKey = await loadStockTargetRows(tx, input.outletId, requirements);
  let changed = false;

  for (const requirement of requirements) {
    const row = rowByKey.get(requirementKey(requirement));
    const isQuantityTracked = row?.stockMode === "QUANTITY";
    const beforeQty = isQuantityTracked ? row.stockQty ?? 0 : null;
    const afterQty = isQuantityTracked
      ? (beforeQty ?? 0) + requirement.qty
      : beforeQty;
    const skippedReason = !row
      ? "target no longer exists"
      : row.stockMode !== "QUANTITY"
        ? "target is no longer quantity-tracked"
        : null;

    const marker = await tx.stockMovement.createMany({
      data: {
        outletId: input.outletId,
        ...stockMovementTargetFields(requirement, row),
        orderId: input.orderId,
        delta: isQuantityTracked ? requirement.qty : 0,
        reason,
        idempotencyKey: idempotencyKey(input.orderId, "cancel-restock", requirement),
        beforeQty,
        afterQty,
        actorType: "ORDER",
        actorId: input.orderId,
        note: skippedReason
          ? `Cancellation restock skipped because ${skippedReason}.`
          : `Cancellation restock from ${input.previousStatus}.`,
      },
      skipDuplicates: true,
    });

    if (marker.count !== 1 || !row || !isQuantityTracked) continue;

    const updated = await incrementTargetQuantity(
      tx,
      input.outletId,
      row,
      requirement.qty,
      now,
      null
    );

    if (!updated) {
      throw new Error(
        `Unable to restock quantity target ${requirement.targetType}:${requirement.targetId} for cancelled order ${input.orderId}.`
      );
    }

    changed = true;
  }

  if (changed) await bumpOutletMenuVersion(tx, input.outletId);
  return changed;
}

export async function returnOrderStockRequirements(
  tx: OrderStockTx,
  input: {
    outletId: string;
    orderId: string;
    requirements: readonly StockRequirementSnapshot[];
    actor: StockActor;
    note?: string | null;
    now?: Date;
  }
): Promise<OrderStockReturnResult> {
  const requirements = aggregateRequirements(input.requirements);
  const result: OrderStockReturnResult = {
    changed: false,
    returnedItems: [],
    skippedItems: [],
  };
  if (requirements.length === 0) return result;

  const now = input.now ?? new Date();
  const rowByKey = await loadStockTargetRows(tx, input.outletId, requirements);

  for (const requirement of requirements) {
    const row = rowByKey.get(requirementKey(requirement));
    const isQuantityTracked = row?.stockMode === "QUANTITY";
    const beforeQty = isQuantityTracked ? row.stockQty ?? 0 : null;
    const afterQty = isQuantityTracked
      ? (beforeQty ?? 0) + requirement.qty
      : beforeQty;
    const skippedReason = !row
      ? "target no longer exists"
      : row.stockMode !== "QUANTITY"
        ? "target is no longer quantity-tracked"
        : null;

    const marker = await tx.stockMovement.createMany({
      data: {
        outletId: input.outletId,
        ...stockMovementTargetFields(requirement, row),
        orderId: input.orderId,
        delta: isQuantityTracked ? requirement.qty : 0,
        reason: "ADMIN_RETURN_STOCK",
        idempotencyKey: idempotencyKey(
          input.orderId,
          "admin-return-stock",
          requirement
        ),
        beforeQty,
        afterQty,
        actorType: input.actor.actorType,
        actorId: input.actor.actorId,
        note:
          input.note ??
          (skippedReason
            ? `Manual return skipped because ${skippedReason}.`
            : "Manual stock return for refunded or post-production cancelled order."),
      },
      skipDuplicates: true,
    });

    if (marker.count !== 1) {
      continue;
    }

    if (!row || !isQuantityTracked) {
      const targetNameSnapshot = row?.targetNameSnapshot ?? requirement.targetNameSnapshot;
      result.skippedItems.push({
        targetType: requirement.targetType,
        targetId: requirement.targetId,
        targetNameSnapshot,
        qty: requirement.qty,
        reason: skippedReason ?? "target was not returned",
        ...(requirement.targetType === "MENU_ITEM"
          ? {
              menuItemId: requirement.targetId,
              nameSnapshot: targetNameSnapshot,
            }
          : {}),
      });
      continue;
    }

    const updated = await incrementTargetQuantity(
      tx,
      input.outletId,
      row,
      requirement.qty,
      now,
      input.actor
    );

    if (!updated) {
      throw new Error(
        `Unable to return quantity target ${requirement.targetType}:${requirement.targetId} for order ${input.orderId}.`
      );
    }

    result.changed = true;
    result.returnedItems.push({
      targetType: row.targetType,
      targetId: row.targetId,
      targetNameSnapshot: row.targetNameSnapshot,
      qty: requirement.qty,
      beforeQty: beforeQty ?? 0,
      afterQty: afterQty ?? 0,
      ...(row.targetType === "MENU_ITEM"
        ? { menuItemId: row.targetId, nameSnapshot: row.targetNameSnapshot }
        : {}),
    });
  }

  if (result.changed) await bumpOutletMenuVersion(tx, input.outletId);
  return result;
}
