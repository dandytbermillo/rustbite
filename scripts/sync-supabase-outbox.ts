/* eslint-disable no-console */
import "dotenv/config";
import { prisma } from "@/lib/db";

function batchSize(): number {
  const raw = Number(process.env.SUPABASE_SYNC_BATCH_SIZE ?? "25");
  if (!Number.isFinite(raw)) return 25;
  return Math.max(1, Math.min(Math.trunc(raw), 100));
}

async function main() {
  const now = new Date();
  const rows = await prisma.syncOutbox.findMany({
    where: {
      status: "PENDING",
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: batchSize(),
    select: {
      id: true,
      eventType: true,
      entityType: true,
      entityId: true,
      outletId: true,
      idempotencyKey: true,
      attempts: true,
      createdAt: true,
    },
  });

  console.log(`Sync outbox pending due rows: ${rows.length}`);
  for (const row of rows) {
    console.log(
      [
        row.id,
        row.eventType,
        `${row.entityType}:${row.entityId}`,
        `outlet=${row.outletId ?? "-"}`,
        `attempts=${row.attempts}`,
        `key=${row.idempotencyKey}`,
        `created=${row.createdAt.toISOString()}`,
      ].join(" ")
    );
  }
}

main()
  .catch((error) => {
    console.error("Sync outbox inspection failed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
