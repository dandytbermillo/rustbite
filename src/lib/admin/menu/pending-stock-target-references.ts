import type { Prisma } from "@prisma/client";
import { parseStockRequirementsJson } from "@/lib/menu-stock-movements";
import type { StockRequirementTargetType } from "@/lib/types";

export type StockTargetReference = {
  targetType: StockRequirementTargetType;
  targetId: string;
};

export type PendingPaymentStockTargetReference = {
  id: string;
  status: string;
  provider: string;
  paymentMethod: string;
};

type PendingPaymentReferenceTx = Pick<
  Prisma.TransactionClient,
  "paymentTransaction"
>;

export const FINALIZABLE_PAYMENT_REFERENCE_STATUSES = [
  "CREATED",
  "PROCESSING",
  "PENDING_COUNTER_PAYMENT",
  "AUTHORIZED",
  "CAPTURED",
] as const;

export const FINALIZABLE_PAYMENT_REFERENCE_PROVIDERS = [
  "COUNTER",
  "MOCK",
  "STRIPE_TERMINAL",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function arrayIncludesId(value: unknown, targetId: string): boolean {
  return Array.isArray(value) && value.some((entry) => entry === targetId);
}

function valueReferencesKeys(
  value: unknown,
  keys: readonly string[],
  targetId: string
): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => valueReferencesKeys(entry, keys, targetId));
  }
  if (!isRecord(value)) return false;

  for (const key of keys) {
    const current = value[key];
    if (current === targetId || arrayIncludesId(current, targetId)) return true;
  }

  return Object.values(value).some((entry) =>
    valueReferencesKeys(entry, keys, targetId)
  );
}

export function stockRequirementsReferenceTarget(
  value: unknown,
  target: StockTargetReference
): boolean {
  return parseStockRequirementsJson(value).some(
    (requirement) =>
      requirement.targetType === target.targetType &&
      requirement.targetId === target.targetId
  );
}

export function cartSnapshotReferencesStockTarget(
  value: unknown,
  target: StockTargetReference
): boolean {
  if (!isRecord(value)) return false;

  if (target.targetType === "MENU_ITEM") {
    return valueReferencesKeys(
      value,
      ["menuItemId", "menuItemIds", "linkedMenuItemId", "linkedMenuItemIds"],
      target.targetId
    );
  }

  if (target.targetType === "ITEM_LOCAL_ADDON") {
    return valueReferencesKeys(
      value,
      ["addonId", "addonIds", "addonOptionId", "addonOptionIds"],
      target.targetId
    );
  }

  return valueReferencesKeys(
    value,
    [
      "sharedModifierOptionId",
      "sharedModifierOptionIds",
      "modifierOptionId",
      "modifierOptionIds",
    ],
    target.targetId
  );
}

export async function findFinalizablePaymentTransactionsReferencingStockTarget(
  tx: PendingPaymentReferenceTx,
  input: {
    outletId: string;
    target: StockTargetReference;
  }
): Promise<PendingPaymentStockTargetReference[]> {
  const rows = await tx.paymentTransaction.findMany({
    where: {
      outletId: input.outletId,
      status: { in: [...FINALIZABLE_PAYMENT_REFERENCE_STATUSES] },
      provider: { in: [...FINALIZABLE_PAYMENT_REFERENCE_PROVIDERS] },
      orderId: null,
      finalizedOrderId: null,
    },
    select: {
      id: true,
      status: true,
      provider: true,
      paymentMethod: true,
      cartSnapshot: true,
      stockRequirementsJson: true,
    },
  });

  return rows
    .filter(
      (row) =>
        stockRequirementsReferenceTarget(row.stockRequirementsJson, input.target) ||
        cartSnapshotReferencesStockTarget(row.cartSnapshot, input.target)
    )
    .map((row) => ({
      id: row.id,
      status: row.status,
      provider: row.provider,
      paymentMethod: row.paymentMethod,
    }));
}
