import { createHash } from "crypto";
import { Prisma } from "@prisma/client";

const PAYLOAD_SCHEMA_VERSION = 1;
const SUPABASE_EVENT_TABLE = "kiosk_sync_events";

// These helpers must receive the `tx` client from `prisma.$transaction(...)`.
// The `never` fields make the root Prisma client fail normal TypeScript
// assignment, and the runtime guard below catches casts or `any`.
type TransactionOnlyClientGuard = {
  $transaction?: never;
  $connect?: never;
  $disconnect?: never;
};

type SyncOutboxClient = Pick<Prisma.TransactionClient, "syncOutbox"> &
  TransactionOnlyClientGuard;
type PaymentSyncClient = Pick<
  Prisma.TransactionClient,
  "paymentTransaction" | "syncOutbox"
> &
  TransactionOnlyClientGuard;

export type SyncEventContext = {
  clientType?: string;
  deviceId?: string | null;
  requestId?: string;
};

type PaymentSyncUpdateData = {
  status?: string;
  provider?: string;
  paymentMethod?: string;
  currency?: string;
  subtotal?: Prisma.Decimal | number | string;
  gst?: Prisma.Decimal | number | string;
  total?: Prisma.Decimal | number | string;
  providerPaymentIntentId?: string | null;
  providerReaderId?: string | null;
  providerReference?: string | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  orderId?: string | null;
  finalizedOrderId?: string | null;
  finalizedAt?: Date | null;
  completedAt?: Date | null;
  lastSyncedAt?: Date | null;
  refundState?: string;
  refundIdempotencyKey?: string | null;
};

type PaymentForSync = {
  id: string;
  outletId: string;
  kioskId: string;
  orderType: string;
  paymentMethod: string;
  provider: string;
  status: string;
  currency: string;
  subtotal: Prisma.Decimal;
  gst: Prisma.Decimal;
  total: Prisma.Decimal;
  cartSnapshot: Prisma.JsonValue;
  stockRequirementsJson: Prisma.JsonValue | null;
  providerPaymentIntentId: string | null;
  providerReaderId: string | null;
  providerReference: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  orderId: string | null;
  finalizedOrderId: string | null;
  finalizedAt: Date | null;
  refundState: string;
  refundIdempotencyKey: string | null;
  syncRevision: number;
  completedAt: Date | null;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type OrderItemForSync = {
  id: string;
  menuItemId: string;
  nameSnapshot: string;
  qty: number;
  sizeName: string | null;
  sizePriceDelta: Prisma.Decimal | null;
  addonsJson: unknown;
  addOnSetSelectionsJson: unknown;
  isMeal: boolean;
  mealUpgrade: Prisma.Decimal | null;
  upgradeSnapshotJson: unknown;
  lineTotal: Prisma.Decimal;
};

type OrderForSync = {
  id: string;
  orderNumber: string;
  outletId: string;
  businessDate: Date | null;
  sequenceNumber: number | null;
  displayOrderNumber: string | null;
  kioskId: string;
  orderType: string;
  status: string;
  subtotal: Prisma.Decimal;
  gst: Prisma.Decimal;
  total: Prisma.Decimal;
  paymentMethod: string | null;
  paymentProvider: string | null;
  paymentStatus: string | null;
  productionStartedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  items: OrderItemForSync[];
  paymentTransaction?: PaymentForSync | null;
};

function assertTransactionClient(client: TransactionOnlyClientGuard): void {
  const maybeRootClient = client as {
    $transaction?: unknown;
    $connect?: unknown;
    $disconnect?: unknown;
  };

  if (
    typeof maybeRootClient.$transaction === "function" ||
    typeof maybeRootClient.$connect === "function" ||
    typeof maybeRootClient.$disconnect === "function"
  ) {
    throw new Error(
      "Supabase sync outbox helpers must be called with the transaction client from prisma.$transaction(...)."
    );
  }
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function decimalString(
  value: Prisma.Decimal | number | string | null | undefined
): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Prisma.Decimal ? value.toFixed(2) : String(value);
}

function payloadHash(payload: Prisma.InputJsonValue): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function normalizeComparable(value: unknown): string | number | null {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Prisma.Decimal) return value.toFixed(2);
  return value as string | number;
}

function paymentUpdateHasSyncChange(
  current: PaymentForSync,
  data: PaymentSyncUpdateData
): boolean {
  const fields: Array<keyof PaymentSyncUpdateData> = [
    "status",
    "provider",
    "paymentMethod",
    "currency",
    "subtotal",
    "gst",
    "total",
    "providerPaymentIntentId",
    "providerReaderId",
    "providerReference",
    "failureCode",
    "failureMessage",
    "orderId",
    "finalizedOrderId",
    "finalizedAt",
    "completedAt",
    "refundState",
    "refundIdempotencyKey",
  ];

  return fields.some((field) => {
    if (!(field in data)) return false;
    return (
      normalizeComparable(current[field as keyof PaymentForSync]) !==
      normalizeComparable(data[field])
    );
  });
}

async function createSyncOutboxEvent(
  client: SyncOutboxClient,
  input: {
    eventType: string;
    entityType: string;
    entityId: string;
    outletId?: string | null;
    idempotencyKey: string;
    payload: Prisma.InputJsonValue;
    sourceRevision?: number | null;
    sourceUpdatedAt?: Date | null;
    context?: SyncEventContext;
  }
) {
  assertTransactionClient(client);
  await client.syncOutbox.create({
    data: {
      eventType: input.eventType,
      entityType: input.entityType,
      entityId: input.entityId,
      outletId: input.outletId ?? null,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload,
      payloadSchemaVersion: PAYLOAD_SCHEMA_VERSION,
      supabaseTargetTable: SUPABASE_EVENT_TABLE,
      sourceRevision: input.sourceRevision ?? null,
      sourceUpdatedAt: input.sourceUpdatedAt ?? null,
      payloadHash: payloadHash(input.payload),
      clientType: input.context?.clientType ?? null,
      deviceId: input.context?.deviceId ?? null,
      requestId: input.context?.requestId ?? null,
    },
  });
}

function buildPaymentPayload(eventType: string, payment: PaymentForSync) {
  return {
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    eventType,
    entityType: "payment",
    payment: {
      id: payment.id,
      outletId: payment.outletId,
      kioskId: payment.kioskId,
      orderType: payment.orderType,
      paymentMethod: payment.paymentMethod,
      provider: payment.provider,
      status: payment.status,
      currency: payment.currency,
      subtotal: decimalString(payment.subtotal),
      gst: decimalString(payment.gst),
      total: decimalString(payment.total),
      providerPaymentIntentId: payment.providerPaymentIntentId,
      providerReaderId: payment.providerReaderId,
      providerReference: payment.providerReference,
      failureCode: payment.failureCode,
      failureMessage: payment.failureMessage,
      orderId: payment.orderId,
      finalizedOrderId: payment.finalizedOrderId,
      finalizedAt: iso(payment.finalizedAt),
      refundState: payment.refundState,
      refundIdempotencyKey: payment.refundIdempotencyKey,
      syncRevision: payment.syncRevision,
      completedAt: iso(payment.completedAt),
      lastSyncedAt: iso(payment.lastSyncedAt),
      createdAt: iso(payment.createdAt),
      updatedAt: iso(payment.updatedAt),
    },
  } satisfies Prisma.InputJsonObject;
}

function buildOrderPayload(input: {
  eventType: string;
  order: OrderForSync;
  previousStatus?: string | null;
  nextStatus?: string | null;
}) {
  const order = input.order;
  return {
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    eventType: input.eventType,
    entityType: "order",
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      outletId: order.outletId,
      businessDate: iso(order.businessDate),
      sequenceNumber: order.sequenceNumber,
      displayOrderNumber: order.displayOrderNumber,
      kioskId: order.kioskId,
      orderType: order.orderType,
      status: order.status,
      previousStatus: input.previousStatus ?? null,
      nextStatus: input.nextStatus ?? null,
      subtotal: decimalString(order.subtotal),
      gst: decimalString(order.gst),
      total: decimalString(order.total),
      paymentMethod: order.paymentMethod,
      paymentProvider: order.paymentProvider,
      paymentStatus: order.paymentStatus,
      productionStartedAt: iso(order.productionStartedAt),
      createdAt: iso(order.createdAt),
      updatedAt: iso(order.updatedAt),
      items: order.items.map((item) => ({
        id: item.id,
        menuItemId: item.menuItemId,
        nameSnapshot: item.nameSnapshot,
        qty: item.qty,
        sizeName: item.sizeName,
        sizePriceDelta: decimalString(item.sizePriceDelta),
        addonsJson: item.addonsJson as Prisma.InputJsonValue,
        addOnSetSelectionsJson:
          (item.addOnSetSelectionsJson as Prisma.InputJsonValue | null) ?? null,
        isMeal: item.isMeal,
        mealUpgrade: decimalString(item.mealUpgrade),
        upgradeSnapshotJson:
          (item.upgradeSnapshotJson as Prisma.InputJsonValue | null) ?? null,
        lineTotal: decimalString(item.lineTotal),
      })),
      paymentTransaction: order.paymentTransaction
        ? buildPaymentPayload("payment.snapshot", order.paymentTransaction).payment
        : null,
    },
  } satisfies Prisma.InputJsonObject;
}

export async function createPaymentTransactionWithSyncEvent(
  client: PaymentSyncClient,
  input: {
    data: Prisma.PaymentTransactionUncheckedCreateInput;
    context?: SyncEventContext;
  }
): Promise<PaymentForSync> {
  assertTransactionClient(client);
  const payment = await client.paymentTransaction.create({ data: input.data });
  await createSyncOutboxEvent(client, {
    eventType: "payment.created",
    entityType: "payment",
    entityId: payment.id,
    outletId: payment.outletId,
    idempotencyKey: `payment:${payment.id}:created`,
    payload: buildPaymentPayload("payment.created", payment),
    sourceRevision: payment.syncRevision,
    sourceUpdatedAt: payment.updatedAt,
    context: input.context,
  });
  return payment;
}

export async function updatePaymentTransactionWithSyncEvent(
  client: PaymentSyncClient,
  input: {
    id: string;
    data: PaymentSyncUpdateData;
    context?: SyncEventContext;
  }
): Promise<PaymentForSync> {
  assertTransactionClient(client);
  const current = await client.paymentTransaction.findUniqueOrThrow({
    where: { id: input.id },
  });

  if (!paymentUpdateHasSyncChange(current, input.data)) return current;

  const updated = await client.paymentTransaction.update({
    where: { id: input.id },
    data: {
      ...(input.data as Prisma.PaymentTransactionUncheckedUpdateInput),
      syncRevision: { increment: 1 },
    },
  });

  await createSyncOutboxEvent(client, {
    eventType: "payment.updated",
    entityType: "payment",
    entityId: updated.id,
    outletId: updated.outletId,
    idempotencyKey: `payment:${updated.id}:updated:rev:${updated.syncRevision}`,
    payload: buildPaymentPayload("payment.updated", updated),
    sourceRevision: updated.syncRevision,
    sourceUpdatedAt: updated.updatedAt,
    context: input.context,
  });

  return updated;
}

export async function createOrderSyncEvent(
  client: SyncOutboxClient,
  input: {
    eventType: "order.created" | "order.status_updated";
    order: OrderForSync;
    idempotencyKey: string;
    sourceRevision: number;
    previousStatus?: string | null;
    nextStatus?: string | null;
    context?: SyncEventContext;
  }
) {
  assertTransactionClient(client);
  await createSyncOutboxEvent(client, {
    eventType: input.eventType,
    entityType: "order",
    entityId: input.order.id,
    outletId: input.order.outletId,
    idempotencyKey: input.idempotencyKey,
    payload: buildOrderPayload({
      eventType: input.eventType,
      order: input.order,
      previousStatus: input.previousStatus,
      nextStatus: input.nextStatus,
    }),
    sourceRevision: input.sourceRevision,
    sourceUpdatedAt: input.order.updatedAt,
    context: input.context,
  });
}
