/* eslint-disable no-console */
import "dotenv/config";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  resetStaleSyncOutboxRows,
  sendPendingSyncOutbox,
} from "@/lib/supabase-sync/dispatcher";
import type {
  SyncOutboxSendResult,
  SyncOutboxTransport,
} from "@/lib/supabase-sync/transport";

const runId = `sync-outbox-dispatcher-${Date.now()}`;
const rowIds = new Set<string>();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cleanup() {
  await prisma.syncOutbox.deleteMany({
    where: {
      OR: [
        { id: { in: [...rowIds] } },
        { idempotencyKey: { startsWith: `test:${runId}:` } },
      ],
    },
  });
}

async function createOutboxRow(
  label: string,
  overrides: Partial<Prisma.SyncOutboxUncheckedCreateInput> = {}
) {
  const data: Prisma.SyncOutboxUncheckedCreateInput = {
    eventType: "test.event",
    entityType: "test",
    entityId: `${runId}:${label}`,
    outletId: "cafeteria",
    idempotencyKey: `test:${runId}:${label}`,
    payload: { runId, label },
    ...overrides,
  };
  const row = await prisma.syncOutbox.create({
    data,
  });
  rowIds.add(row.id);
  return row;
}

function staticTransport(result: SyncOutboxSendResult): SyncOutboxTransport {
  return {
    async send() {
      return result;
    },
  };
}

async function assertSuccessMarksSent() {
  const now = new Date("2026-05-16T12:00:00.000Z");
  const row = await createOutboxRow("success");

  const result = await sendPendingSyncOutbox({
    transport: staticTransport({ status: "sent" }),
    batchSize: 1,
    now,
    workerId: "test-success",
  });

  const updated = await prisma.syncOutbox.findUniqueOrThrow({
    where: { id: row.id },
  });
  assert(result.sent === 1, "Successful delivery should count as sent.");
  assert(updated.status === "SENT", "Successful delivery should mark row SENT.");
  assert(updated.attempts === 1, "Successful delivery should increment attempts once.");
  assert(updated.sentAt?.getTime() === now.getTime(), "Successful delivery should set sentAt.");
  assert(updated.lastError === null, "Successful delivery should clear lastError.");
  assert(updated.claimedAt === null, "Successful delivery should clear claimedAt.");
  assert(updated.leaseExpiresAt === null, "Successful delivery should clear leaseExpiresAt.");
  assert(updated.claimedBy === null, "Successful delivery should clear claimedBy.");
}

async function assertDuplicateMarksSent() {
  const row = await createOutboxRow("duplicate");
  const result = await sendPendingSyncOutbox({
    transport: staticTransport({ status: "duplicate" }),
    batchSize: 1,
    now: new Date("2026-05-16T12:01:00.000Z"),
    workerId: "test-duplicate",
  });
  const updated = await prisma.syncOutbox.findUniqueOrThrow({
    where: { id: row.id },
  });

  assert(result.sent === 1, "Duplicate delivery should count as sent.");
  assert(result.duplicates === 1, "Duplicate delivery should increment duplicate count.");
  assert(updated.status === "SENT", "Duplicate delivery should mark row SENT.");
}

async function assertFailureRetries() {
  const now = new Date("2026-05-16T12:02:00.000Z");
  const row = await createOutboxRow("failure-retry");

  const result = await sendPendingSyncOutbox({
    transport: staticTransport({ status: "failed", error: "network down" }),
    batchSize: 1,
    maxAttempts: 10,
    now,
    workerId: "test-retry",
  });
  const updated = await prisma.syncOutbox.findUniqueOrThrow({
    where: { id: row.id },
  });

  assert(result.retried === 1, "Failed delivery before max attempts should retry.");
  assert(updated.status === "PENDING", "Retryable failure should return row to PENDING.");
  assert(updated.attempts === 1, "Retryable failure should increment attempts once.");
  assert(updated.lastError === "network down", "Retryable failure should write lastError.");
  assert(updated.nextAttemptAt && updated.nextAttemptAt > now, "Retryable failure should set nextAttemptAt.");
  assert(updated.failedAt === null, "Retryable failure should not set failedAt.");
  assert(updated.claimedAt === null, "Retryable failure should clear claimedAt.");
  assert(updated.leaseExpiresAt === null, "Retryable failure should clear leaseExpiresAt.");
  assert(updated.claimedBy === null, "Retryable failure should clear claimedBy.");
}

async function assertTimeoutRetries() {
  const row = await createOutboxRow("timeout");
  const result = await sendPendingSyncOutbox({
    transport: staticTransport({ status: "timeout" }),
    batchSize: 1,
    maxAttempts: 10,
    now: new Date("2026-05-16T12:03:00.000Z"),
    workerId: "test-timeout",
  });
  const updated = await prisma.syncOutbox.findUniqueOrThrow({
    where: { id: row.id },
  });

  assert(result.retried === 1, "Timeout should leave row retryable.");
  assert(updated.status === "PENDING", "Timeout should return row to PENDING.");
  assert(
    updated.lastError?.includes("timed out"),
    "Timeout should write a timeout lastError."
  );
}

async function assertMaxAttemptsFails() {
  const now = new Date("2026-05-16T12:04:00.000Z");
  const row = await createOutboxRow("max-attempts", { attempts: 9 });

  const result = await sendPendingSyncOutbox({
    transport: staticTransport({ status: "failed", error: "still down" }),
    batchSize: 1,
    maxAttempts: 10,
    now,
    workerId: "test-max",
  });
  const updated = await prisma.syncOutbox.findUniqueOrThrow({
    where: { id: row.id },
  });

  assert(result.failed === 1, "Failure at max attempts should count as failed.");
  assert(updated.status === "FAILED", "Failure at max attempts should mark row FAILED.");
  assert(updated.attempts === 10, "Failure at max attempts should include the final attempt.");
  assert(updated.failedAt?.getTime() === now.getTime(), "FAILED row should set failedAt.");
  assert(updated.nextAttemptAt === null, "FAILED row should clear nextAttemptAt.");
  assert(updated.lastError === "still down", "FAILED row should preserve lastError.");
}

async function assertStaleLeaseReset() {
  const now = new Date("2026-05-16T12:05:00.000Z");
  const row = await createOutboxRow("stale-lease", {
    status: "SENDING",
    claimedAt: new Date("2026-05-16T12:00:00.000Z"),
    leaseExpiresAt: new Date("2026-05-16T12:04:00.000Z"),
    claimedBy: "dead-worker",
  });

  const resetCount = await resetStaleSyncOutboxRows({ now });
  const updated = await prisma.syncOutbox.findUniqueOrThrow({
    where: { id: row.id },
  });

  assert(resetCount >= 1, "Stale lease reset should update at least the stale test row.");
  assert(updated.status === "PENDING", "Stale lease reset should return row to PENDING.");
  assert(updated.nextAttemptAt?.getTime() === now.getTime(), "Stale lease reset should make row due now.");
  assert(updated.claimedAt === null, "Stale lease reset should clear claimedAt.");
  assert(updated.leaseExpiresAt === null, "Stale lease reset should clear leaseExpiresAt.");
  assert(updated.claimedBy === null, "Stale lease reset should clear claimedBy.");
}

async function assertConcurrentDispatchDoesNotDoubleSend() {
  const row = await createOutboxRow("concurrent");
  let sendCount = 0;
  const transport: SyncOutboxTransport = {
    async send(sentRow) {
      assert(sentRow.id === row.id, "Concurrent test should send the intended row.");
      sendCount += 1;
      await delay(100);
      return { status: "sent" };
    },
  };

  const now = new Date("2026-05-16T12:06:00.000Z");
  await Promise.all([
    sendPendingSyncOutbox({
      transport,
      batchSize: 1,
      now,
      workerId: "test-concurrent-a",
    }),
    sendPendingSyncOutbox({
      transport,
      batchSize: 1,
      now,
      workerId: "test-concurrent-b",
    }),
  ]);

  const updated = await prisma.syncOutbox.findUniqueOrThrow({
    where: { id: row.id },
  });
  assert(sendCount === 1, "Concurrent dispatchers should send the row only once.");
  assert(updated.status === "SENT", "Concurrent dispatch should finish with SENT row.");
  assert(updated.attempts === 1, "Concurrent dispatch should claim exactly once.");
}

async function main() {
  await cleanup();
  await assertSuccessMarksSent();
  await assertDuplicateMarksSent();
  await assertFailureRetries();
  await assertTimeoutRetries();
  await assertMaxAttemptsFails();
  await assertStaleLeaseReset();
  await assertConcurrentDispatchDoesNotDoubleSend();
  console.log(`Sync outbox dispatcher tests passed: ${runId}`);
}

main()
  .catch((error) => {
    console.error("Sync outbox dispatcher tests failed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((error) => {
      console.error("Sync outbox dispatcher cleanup failed.");
      console.error(error);
      process.exitCode = 1;
    });
    await prisma.$disconnect();
  });
