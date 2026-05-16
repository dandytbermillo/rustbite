import type { SyncOutbox } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { SyncOutboxSendResult, SyncOutboxTransport } from "./transport";

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_LEASE_MS = 2 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 10;
const MAX_BATCH_SIZE = 100;
const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;

type SyncOutboxStore = Pick<typeof prisma, "syncOutbox">;

export type SyncOutboxDispatchResult = {
  sent: number;
  duplicates: number;
  retried: number;
  failed: number;
  skipped: number;
  resetStale: number;
};

export type SendPendingSyncOutboxInput = {
  transport: SyncOutboxTransport;
  batchSize?: number;
  maxAttempts?: number;
  now?: Date;
  workerId?: string;
  leaseMs?: number;
  store?: SyncOutboxStore;
};

function numberFromEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) ? raw : fallback;
}

export function syncOutboxBatchSize(value?: number): number {
  const raw = value ?? numberFromEnv("SUPABASE_SYNC_BATCH_SIZE", DEFAULT_BATCH_SIZE);
  return Math.max(1, Math.min(Math.trunc(raw), MAX_BATCH_SIZE));
}

export function syncOutboxMaxAttempts(value?: number): number {
  const raw =
    value ?? numberFromEnv("SUPABASE_SYNC_MAX_ATTEMPTS", DEFAULT_MAX_ATTEMPTS);
  return Math.max(1, Math.trunc(raw));
}

export function syncOutboxRetryDelayMs(attempt: number): number {
  const delays = [
    60 * 1000,
    2 * 60 * 1000,
    4 * 60 * 1000,
    8 * 60 * 1000,
    15 * 60 * 1000,
    30 * 60 * 1000,
    MAX_RETRY_DELAY_MS,
  ];
  return delays[Math.min(Math.max(0, attempt - 1), delays.length - 1)]!;
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}

function deliveryErrorMessage(result: SyncOutboxSendResult): string {
  if (result.status === "failed") return result.error;
  if (result.status === "timeout") {
    return result.error ?? "Supabase sync delivery timed out.";
  }
  return "Unknown Supabase sync delivery failure.";
}

export async function resetStaleSyncOutboxRows(input?: {
  now?: Date;
  store?: SyncOutboxStore;
}): Promise<number> {
  const now = input?.now ?? new Date();
  const store = input?.store ?? prisma;
  const result = await store.syncOutbox.updateMany({
    where: {
      status: "SENDING",
      leaseExpiresAt: { lt: now },
    },
    data: {
      status: "PENDING",
      claimedAt: null,
      leaseExpiresAt: null,
      claimedBy: null,
      nextAttemptAt: now,
    },
  });
  return result.count;
}

async function claimSyncOutboxRow(input: {
  rowId: string;
  now: Date;
  workerId: string;
  leaseMs: number;
  store: SyncOutboxStore;
}): Promise<SyncOutbox | null> {
  const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs);
  const claim = await input.store.syncOutbox.updateMany({
    where: {
      id: input.rowId,
      status: "PENDING",
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: input.now } }],
    },
    data: {
      status: "SENDING",
      attempts: { increment: 1 },
      claimedAt: input.now,
      leaseExpiresAt,
      claimedBy: input.workerId,
      failedAt: null,
    },
  });

  if (claim.count !== 1) return null;
  return input.store.syncOutbox.findUniqueOrThrow({
    where: { id: input.rowId },
  });
}

async function markSyncOutboxSent(input: {
  rowId: string;
  now: Date;
  store: SyncOutboxStore;
}) {
  await input.store.syncOutbox.update({
    where: { id: input.rowId },
    data: {
      status: "SENT",
      sentAt: input.now,
      failedAt: null,
      nextAttemptAt: null,
      lastError: null,
      claimedAt: null,
      leaseExpiresAt: null,
      claimedBy: null,
    },
  });
}

async function markSyncOutboxRetryOrFailed(input: {
  row: SyncOutbox;
  now: Date;
  maxAttempts: number;
  error: string;
  store: SyncOutboxStore;
}): Promise<"retried" | "failed"> {
  const exhausted = input.row.attempts >= input.maxAttempts;
  await input.store.syncOutbox.update({
    where: { id: input.row.id },
    data: {
      status: exhausted ? "FAILED" : "PENDING",
      failedAt: exhausted ? input.now : null,
      nextAttemptAt: exhausted
        ? null
        : new Date(
            input.now.getTime() + syncOutboxRetryDelayMs(input.row.attempts)
          ),
      lastError: input.error,
      claimedAt: null,
      leaseExpiresAt: null,
      claimedBy: null,
    },
  });
  return exhausted ? "failed" : "retried";
}

export async function sendPendingSyncOutbox(
  input: SendPendingSyncOutboxInput
): Promise<SyncOutboxDispatchResult> {
  const now = input.now ?? new Date();
  const store = input.store ?? prisma;
  const workerId =
    input.workerId ??
    `sync-worker:${process.pid}:${Math.random().toString(36).slice(2)}`;
  const leaseMs = Math.max(1, input.leaseMs ?? DEFAULT_LEASE_MS);
  const maxAttempts = syncOutboxMaxAttempts(input.maxAttempts);
  const result: SyncOutboxDispatchResult = {
    sent: 0,
    duplicates: 0,
    retried: 0,
    failed: 0,
    skipped: 0,
    resetStale: 0,
  };

  result.resetStale = await resetStaleSyncOutboxRows({ now, store });

  const rows = await store.syncOutbox.findMany({
    where: {
      status: "PENDING",
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: syncOutboxBatchSize(input.batchSize),
  });

  for (const row of rows) {
    const claimed = await claimSyncOutboxRow({
      rowId: row.id,
      now,
      workerId,
      leaseMs,
      store,
    });
    if (!claimed) {
      result.skipped += 1;
      continue;
    }

    let delivery: SyncOutboxSendResult;
    try {
      delivery = await input.transport.send(claimed);
    } catch (error) {
      delivery = { status: "failed", error: safeErrorMessage(error) };
    }

    if (delivery.status === "sent" || delivery.status === "duplicate") {
      await markSyncOutboxSent({ rowId: claimed.id, now, store });
      result.sent += 1;
      if (delivery.status === "duplicate") result.duplicates += 1;
      continue;
    }

    const outcome = await markSyncOutboxRetryOrFailed({
      row: claimed,
      now,
      maxAttempts,
      error: deliveryErrorMessage(delivery),
      store,
    });
    result[outcome] += 1;
  }

  return result;
}
