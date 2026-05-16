import type { Prisma } from "@prisma/client";
import { bumpOutletMenuVersion } from "@/lib/outlet-menu-sync";
import type { CheckoutSnapshot, StockUnavailableResponseItem } from "@/lib/types";

type DealLimitTx = Pick<
  Prisma.TransactionClient,
  "menuItem" | "stockMovement" | "outletMenuVersion"
>;

type SnapshotInput = CheckoutSnapshot | Prisma.JsonValue | null | undefined;

export const DEAL_LIMIT_MAX_QTY = 99999;
export const DEAL_LIMIT_TARGET_TYPE = "DEAL_LIMIT" as const;

export type DealLimitMode = "UNLIMITED" | "LIMITED";

export type DealLimitState = {
  dealLimitMode?: DealLimitMode | string | null;
  dealLimitQty?: number | null;
  dealLimitLowThreshold?: number | null;
};

export function isDealLimitSoldOut(item: DealLimitState): boolean {
  return item.dealLimitMode === "LIMITED" && (item.dealLimitQty ?? 0) <= 0;
}

export function isDealLimitLow(item: DealLimitState): boolean {
  return (
    item.dealLimitMode === "LIMITED" &&
    item.dealLimitQty != null &&
    item.dealLimitQty > 0 &&
    item.dealLimitLowThreshold != null &&
    item.dealLimitQty <= item.dealLimitLowThreshold
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function checkoutItems(snapshot: SnapshotInput): unknown[] {
  if (!isRecord(snapshot)) return [];
  return Array.isArray(snapshot.items) ? snapshot.items : [];
}

export function checkoutSnapshotHasDealLines(snapshot: SnapshotInput): boolean {
  return checkoutItems(snapshot).some(
    (item) =>
      isRecord(item) &&
      (item.lineKind === "DEAL" ||
        (item.lineKind == null && typeof item.selectedUpgradeOptionId === "string")),
  );
}

type DealLimitLine = {
  menuItemId: string;
  qty: number;
};

export function dealLimitLinesFromCheckoutSnapshot(
  snapshot: SnapshotInput,
): DealLimitLine[] {
  const totals = new Map<string, number>();
  for (const line of checkoutItems(snapshot)) {
    if (!isRecord(line)) continue;
    if (line.lineKind == null) continue;
    if (line.lineKind !== "DEAL" && line.lineKind !== "ITEM") {
      throw new DealLimitUnavailableError([malformedDealLineItem()]);
    }
    if (line.lineKind !== "DEAL") continue;
    const menuItemId = typeof line.menuItemId === "string" ? line.menuItemId : "";
    const qty = typeof line.qty === "number" ? Math.trunc(line.qty) : 0;
    if (!menuItemId || qty <= 0 || qty !== line.qty) {
      throw new DealLimitUnavailableError([malformedDealLineItem()]);
    }
    totals.set(menuItemId, (totals.get(menuItemId) ?? 0) + qty);
  }
  return [...totals.entries()].map(([menuItemId, qty]) => ({ menuItemId, qty }));
}

export class DealLimitUnavailableError extends Error {
  readonly code = "MENU_STOCK_UNAVAILABLE" as const;

  constructor(readonly items: StockUnavailableResponseItem[]) {
    super("Some deals are no longer available. Review your order before paying.");
    this.name = "DealLimitUnavailableError";
  }
}

function malformedDealLineItem(): StockUnavailableResponseItem {
  return {
    targetType: DEAL_LIMIT_TARGET_TYPE,
    targetId: "unknown",
    targetNameSnapshot: "Deal",
    requestedQty: 0,
    availableQty: 0,
    menuItemId: null,
    nameSnapshot: "Deal",
  };
}

function unavailableItem(input: {
  dealId: string;
  dealName: string;
  requestedQty: number;
  availableQty: number;
}): StockUnavailableResponseItem {
  return {
    targetType: DEAL_LIMIT_TARGET_TYPE,
    targetId: input.dealId,
    targetNameSnapshot: input.dealName,
    requestedQty: input.requestedQty,
    availableQty: input.availableQty,
    menuItemId: input.dealId,
    nameSnapshot: input.dealName,
  };
}

export async function decrementOrderDealLimits(
  tx: DealLimitTx,
  input: {
    outletId: string;
    orderId: string;
    snapshot: SnapshotInput;
    now?: Date;
  },
): Promise<void> {
  const lines = dealLimitLinesFromCheckoutSnapshot(input.snapshot);
  if (lines.length === 0) return;

  const dealIds = lines.map((line) => line.menuItemId);
  const deals = await tx.menuItem.findMany({
    where: { outletId: input.outletId, id: { in: dealIds } },
    select: {
      id: true,
      name: true,
      dealLimitMode: true,
      dealLimitQty: true,
      category: { select: { slug: true } },
    },
  });
  const dealById = new Map(deals.map((deal) => [deal.id, deal]));
  const unavailable: StockUnavailableResponseItem[] = [];
  const now = input.now ?? new Date();

  for (const line of lines) {
    const deal = dealById.get(line.menuItemId);
    if (!deal || deal.category.slug !== "deals") {
      unavailable.push(
        unavailableItem({
          dealId: line.menuItemId,
          dealName: "Deal",
          requestedQty: line.qty,
          availableQty: 0,
        }),
      );
      continue;
    }
    if (deal.dealLimitMode !== "LIMITED") continue;
    const availableQty = deal.dealLimitQty ?? 0;
    if (availableQty < line.qty) {
      unavailable.push(
        unavailableItem({
          dealId: deal.id,
          dealName: deal.name,
          requestedQty: line.qty,
          availableQty,
        }),
      );
    }
  }
  if (unavailable.length > 0) throw new DealLimitUnavailableError(unavailable);

  let changed = false;
  for (const line of lines) {
    const deal = dealById.get(line.menuItemId);
    if (!deal || deal.category.slug !== "deals" || deal.dealLimitMode !== "LIMITED") {
      continue;
    }
    const beforeQty = deal.dealLimitQty ?? 0;
    const afterQty = beforeQty - line.qty;
    const updated = await tx.menuItem.updateMany({
      where: {
        id: deal.id,
        outletId: input.outletId,
        dealLimitMode: "LIMITED",
        dealLimitQty: { gte: line.qty },
      },
      data: {
        dealLimitQty: { decrement: line.qty },
        dealLimitUpdatedAt: now,
        dealLimitUpdatedById: null,
        lockVersion: { increment: 1 },
        updatedAt: now,
      },
    });
    if (updated.count !== 1) {
      throw new DealLimitUnavailableError([
        unavailableItem({
          dealId: deal.id,
          dealName: deal.name,
          requestedQty: line.qty,
          availableQty: 0,
        }),
      ]);
    }
    await tx.stockMovement.create({
      data: {
        outletId: input.outletId,
        targetType: DEAL_LIMIT_TARGET_TYPE,
        targetIdSnapshot: deal.id,
        targetNameSnapshot: deal.name,
        menuItemId: deal.id,
        itemNameSnapshot: deal.name,
        orderId: input.orderId,
        delta: -line.qty,
        reason: "ORDER_PLACED",
        idempotencyKey: `order:${input.orderId}:placed:${DEAL_LIMIT_TARGET_TYPE}:${deal.id}`,
        beforeQty,
        afterQty,
        actorType: "ORDER",
        actorId: input.orderId,
      },
    });
    changed = true;
  }
  if (changed) {
    await bumpOutletMenuVersion(tx, input.outletId);
  }
}

type DealLimitReturnResult = {
  changed: boolean;
  returnedItems: Array<{
    targetType: typeof DEAL_LIMIT_TARGET_TYPE;
    targetId: string;
    targetNameSnapshot: string;
    qty: number;
    beforeQty: number;
    afterQty: number;
    menuItemId: string;
    nameSnapshot: string;
  }>;
  skippedItems: Array<{
    targetType: typeof DEAL_LIMIT_TARGET_TYPE;
    targetId: string;
    targetNameSnapshot: string;
    qty: number;
    reason: string;
    menuItemId: string | null;
    nameSnapshot: string;
  }>;
};

async function returnPlacedDealLimitMovements(
  tx: DealLimitTx,
  input: {
    outletId: string;
    orderId: string;
    reason: string;
    idempotencyPrefix: string;
    actor: { actorType: string; actorId: string | null };
    now?: Date;
  },
): Promise<DealLimitReturnResult> {
  const placedMovements = await tx.stockMovement.findMany({
    where: {
      outletId: input.outletId,
      orderId: input.orderId,
      targetType: DEAL_LIMIT_TARGET_TYPE,
      reason: "ORDER_PLACED",
      delta: { lt: 0 },
    },
    orderBy: { createdAt: "asc" },
  });
  const result: DealLimitReturnResult = {
    changed: false,
    returnedItems: [],
    skippedItems: [],
  };
  if (placedMovements.length === 0) return result;

  const dealIds = [
    ...new Set(
      placedMovements
        .map((movement) => movement.targetIdSnapshot)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const deals = await tx.menuItem.findMany({
    where: { outletId: input.outletId, id: { in: dealIds } },
    select: { id: true, name: true, dealLimitQty: true },
  });
  const dealById = new Map(deals.map((deal) => [deal.id, deal]));
  const now = input.now ?? new Date();

  for (const movement of placedMovements) {
    const dealId = movement.targetIdSnapshot ?? "";
    const dealName = movement.targetNameSnapshot ?? movement.itemNameSnapshot;
    const qty = Math.abs(movement.delta);
    const markerKey = `${input.idempotencyPrefix}:${input.orderId}:${movement.id}`;
    const deal = dealId ? dealById.get(dealId) : null;
    const marker = await tx.stockMovement.createMany({
      data: [
        {
          outletId: input.outletId,
          targetType: DEAL_LIMIT_TARGET_TYPE,
          targetIdSnapshot: dealId || null,
          targetNameSnapshot: dealName,
          menuItemId: deal?.id ?? null,
          itemNameSnapshot: dealName,
          orderId: input.orderId,
          delta: 0,
          reason: input.reason,
          idempotencyKey: markerKey,
          beforeQty: null,
          afterQty: null,
          actorType: input.actor.actorType,
          actorId: input.actor.actorId,
          note: "Deal limit return idempotency marker.",
        },
      ],
      skipDuplicates: true,
    });
    if (marker.count === 0) continue;

    if (!deal) {
      result.skippedItems.push({
        targetType: DEAL_LIMIT_TARGET_TYPE,
        targetId: dealId,
        targetNameSnapshot: dealName,
        qty,
        reason: "Deal was deleted; movement history remains readable.",
        menuItemId: dealId || null,
        nameSnapshot: dealName,
      });
      continue;
    }

    const beforeQty = deal.dealLimitQty ?? 0;
    const afterQty = beforeQty + qty;
    await tx.menuItem.update({
      where: { id: deal.id },
      data: {
        dealLimitQty: afterQty,
        dealLimitUpdatedAt: now,
        dealLimitUpdatedById: null,
        lockVersion: { increment: 1 },
        updatedAt: now,
      },
    });
    deal.dealLimitQty = afterQty;
    await tx.stockMovement.updateMany({
      where: { idempotencyKey: markerKey },
      data: {
        delta: qty,
        beforeQty,
        afterQty,
        note: "Returned deal selling-limit quantity.",
      },
    });
    result.changed = true;
    result.returnedItems.push({
      targetType: DEAL_LIMIT_TARGET_TYPE,
      targetId: deal.id,
      targetNameSnapshot: deal.name,
      qty,
      beforeQty,
      afterQty,
      menuItemId: deal.id,
      nameSnapshot: deal.name,
    });
  }
  if (result.changed) {
    await bumpOutletMenuVersion(tx, input.outletId);
  }
  return result;
}

export async function restockCancelledOrderDealLimits(
  tx: DealLimitTx,
  input: {
    outletId: string;
    orderId: string;
    previousStatus: string;
    nextStatus: string;
    productionStartedAt: Date | null;
    now?: Date;
  },
): Promise<DealLimitReturnResult> {
  if (input.nextStatus !== "CANCELLED") {
    return { changed: false, returnedItems: [], skippedItems: [] };
  }
  if (input.previousStatus === "CANCELLED" || input.productionStartedAt) {
    return { changed: false, returnedItems: [], skippedItems: [] };
  }
  if (
    input.previousStatus !== "AWAITING_COUNTER_PAYMENT" &&
    input.previousStatus !== "PAID"
  ) {
    return { changed: false, returnedItems: [], skippedItems: [] };
  }
  const reason =
    input.previousStatus === "AWAITING_COUNTER_PAYMENT"
      ? "CASH_ORDER_CANCELLED_RESTOCK"
      : "ORDER_CANCELLED_RESTOCK";
  return returnPlacedDealLimitMovements(tx, {
    outletId: input.outletId,
    orderId: input.orderId,
    reason,
    idempotencyPrefix: `order:${input.orderId}:deal-limit:${reason}`,
    actor: { actorType: "SYSTEM", actorId: null },
    now: input.now,
  });
}

export async function returnOrderDealLimits(
  tx: DealLimitTx,
  input: {
    outletId: string;
    orderId: string;
    actor: { actorType: string; actorId: string | null };
    now?: Date;
  },
): Promise<DealLimitReturnResult> {
  return returnPlacedDealLimitMovements(tx, {
    outletId: input.outletId,
    orderId: input.orderId,
    reason: "ORDER_RETURNED_STOCK",
    idempotencyPrefix: `order:${input.orderId}:deal-limit:manual-return`,
    actor: input.actor,
    now: input.now,
  });
}

export async function orderHasDealLimitMovements(
  tx: Pick<Prisma.TransactionClient, "stockMovement">,
  input: { outletId: string; orderId: string },
): Promise<boolean> {
  const count = await tx.stockMovement.count({
    where: {
      outletId: input.outletId,
      orderId: input.orderId,
      targetType: DEAL_LIMIT_TARGET_TYPE,
      reason: "ORDER_PLACED",
      delta: { lt: 0 },
    },
  });
  return count > 0;
}
