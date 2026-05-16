/* eslint-disable no-console */
import "dotenv/config";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { updateOrderStatus } from "@/lib/order-updates";
import {
  createPaymentTransactionWithSyncEvent,
  updatePaymentTransactionWithSyncEvent,
} from "@/lib/supabase-sync/outbox";

const runId = `sync-outbox-phase1-${Date.now()}`;
const outletId = "cafeteria";
const paymentIds = new Set<string>();
const orderIds = new Set<string>();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function paymentData(
  id: string,
  overrides: Partial<Prisma.PaymentTransactionUncheckedCreateInput> = {}
): Prisma.PaymentTransactionUncheckedCreateInput {
  return {
    id,
    outletId,
    kioskId: `kiosk-${runId}`,
    orderType: "TAKEOUT",
    paymentMethod: "CARD",
    provider: "MOCK",
    status: "CREATED",
    currency: "CAD",
    subtotal: new Prisma.Decimal("10.00"),
    gst: new Prisma.Decimal("0.50"),
    total: new Prisma.Decimal("10.50"),
    cartSnapshot: {
      test: true,
      runId,
      paymentId: id,
    },
    ...overrides,
  };
}

async function ensureCafeteriaOutlet() {
  await prisma.site.upsert({
    where: { id: "site" },
    update: {},
    create: {
      id: "site",
      name: "Rushbite",
      timezone: "America/Edmonton",
    },
  });

  await prisma.outlet.upsert({
    where: { id: outletId },
    update: { isActive: true },
    create: {
      id: outletId,
      siteId: "site",
      name: "Cafeteria",
      slug: "cafeteria",
      orderPrefix: "C",
      isActive: true,
    },
  });
}

async function cleanup() {
  const entityIds = [...paymentIds, ...orderIds];
  const cleanupSyncOutbox = async () => {
    if (entityIds.length === 0) return;
    await prisma.syncOutbox.deleteMany({
      where: { entityId: { in: entityIds } },
    });
  };

  await cleanupSyncOutbox();
  if (paymentIds.size > 0) {
    await prisma.paymentTransaction.deleteMany({
      where: { id: { in: [...paymentIds] } },
    });
  }
  if (orderIds.size > 0) {
    await prisma.order.deleteMany({
      where: { id: { in: [...orderIds] } },
    });
  }
  await cleanupSyncOutbox();
}

async function assertRootClientRejected() {
  const paymentId = `${runId}-root-guard`;
  paymentIds.add(paymentId);
  let rejected = false;

  try {
    await createPaymentTransactionWithSyncEvent(
      prisma as unknown as Parameters<typeof createPaymentTransactionWithSyncEvent>[0],
      {
        data: paymentData(paymentId),
        context: { clientType: "test" },
      }
    );
  } catch (error) {
    rejected =
      error instanceof Error &&
      error.message.includes("transaction client from prisma.$transaction");
  }

  assert(rejected, "Root Prisma client should be rejected by the outbox helper guard.");
  assert(
    (await prisma.paymentTransaction.count({ where: { id: paymentId } })) === 0,
    "Root-client guard should fail before creating a payment row."
  );
  assert(
    (await prisma.syncOutbox.count({ where: { entityId: paymentId } })) === 0,
    "Root-client guard should fail before creating an outbox row."
  );
}

async function assertRollbackRemovesBusinessAndOutboxRows() {
  const paymentId = `${runId}-rollback`;
  paymentIds.add(paymentId);
  let rolledBack = false;

  try {
    await prisma.$transaction(async (tx) => {
      await createPaymentTransactionWithSyncEvent(tx, {
        data: paymentData(paymentId),
        context: { clientType: "test" },
      });
      throw new Error("force rollback after outbox insert");
    });
  } catch (error) {
    rolledBack =
      error instanceof Error &&
      error.message === "force rollback after outbox insert";
  }

  assert(rolledBack, "Rollback test transaction should throw the expected error.");
  assert(
    (await prisma.paymentTransaction.count({ where: { id: paymentId } })) === 0,
    "Rolled-back transaction should not leave a payment row."
  );
  assert(
    (await prisma.syncOutbox.count({ where: { entityId: paymentId } })) === 0,
    "Rolled-back transaction should not leave a sync outbox row."
  );
}

async function assertPaymentNoOpDoesNotEnqueueEvent() {
  const paymentId = `${runId}-payment-noop`;
  paymentIds.add(paymentId);

  await prisma.$transaction((tx) =>
    createPaymentTransactionWithSyncEvent(tx, {
      data: paymentData(paymentId),
      context: { clientType: "test" },
    })
  );

  await prisma.$transaction((tx) =>
    updatePaymentTransactionWithSyncEvent(tx, {
      id: paymentId,
      data: {
        status: "CREATED",
        lastSyncedAt: new Date(),
      },
      context: { clientType: "test" },
    })
  );

  const payment = await prisma.paymentTransaction.findUniqueOrThrow({
    where: { id: paymentId },
    select: { syncRevision: true, lastSyncedAt: true },
  });
  const events = await prisma.syncOutbox.findMany({
    where: { entityId: paymentId },
    orderBy: { createdAt: "asc" },
    select: { eventType: true },
  });

  assert(
    payment.syncRevision === 0,
    "No-op payment update should not increment syncRevision."
  );
  assert(
    payment.lastSyncedAt === null,
    "No-op payment update should not write ignored lastSyncedAt-only changes."
  );
  assert(
    events.length === 1 && events[0]?.eventType === "payment.created",
    "No-op payment update should not enqueue payment.updated."
  );
}

async function assertOrderNoOpDoesNotEnqueueEvent() {
  const order = await prisma.order.create({
    data: {
      orderNumber: `SYNC-NOOP-${runId}`,
      outletId,
      kioskId: `kiosk-${runId}`,
      orderType: "TAKEOUT",
      status: "PAID",
      paymentMethod: "CASH",
      paymentProvider: "COUNTER",
      paymentStatus: "CAPTURED",
      subtotal: new Prisma.Decimal("10.00"),
      gst: new Prisma.Decimal("0.50"),
      total: new Prisma.Decimal("10.50"),
    },
  });
  orderIds.add(order.id);

  const updated = await updateOrderStatus(order.id, "PAID", {
    outletIds: [outletId],
  });

  assert(updated?.id === order.id, "No-op order status update should return the existing order.");
  assert(
    (await prisma.syncOutbox.count({ where: { entityId: order.id } })) === 0,
    "No-op order status update should not enqueue order.status_updated."
  );
}

async function main() {
  await ensureCafeteriaOutlet();
  await assertRootClientRejected();
  await assertRollbackRemovesBusinessAndOutboxRows();
  await assertPaymentNoOpDoesNotEnqueueEvent();
  await assertOrderNoOpDoesNotEnqueueEvent();
  console.log(`Sync outbox Phase 1 regression tests passed: ${runId}`);
}

main()
  .catch((error) => {
    console.error("Sync outbox Phase 1 regression tests failed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((error) => {
      console.error("Sync outbox Phase 1 cleanup failed.");
      console.error(error);
      process.exitCode = 1;
    });
    await prisma.$disconnect();
  });
