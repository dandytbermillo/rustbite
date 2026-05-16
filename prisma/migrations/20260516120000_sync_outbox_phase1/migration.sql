ALTER TABLE "PaymentTransaction"
  ADD COLUMN "syncRevision" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "SyncOutbox" (
  "id" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "outletId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "payloadSchemaVersion" INTEGER NOT NULL DEFAULT 1,
  "supabaseTargetTable" TEXT,
  "sourceRevision" INTEGER,
  "sourceUpdatedAt" TIMESTAMP(3),
  "payloadHash" TEXT,
  "clientType" TEXT,
  "deviceId" TEXT,
  "requestId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "claimedAt" TIMESTAMP(3),
  "leaseExpiresAt" TIMESTAMP(3),
  "claimedBy" TEXT,
  "nextAttemptAt" TIMESTAMP(3),
  "lastError" TEXT,
  "sentAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SyncOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SyncOutbox_idempotencyKey_key"
  ON "SyncOutbox"("idempotencyKey");

CREATE INDEX "SyncOutbox_status_nextAttemptAt_idx"
  ON "SyncOutbox"("status", "nextAttemptAt");

CREATE INDEX "SyncOutbox_status_leaseExpiresAt_idx"
  ON "SyncOutbox"("status", "leaseExpiresAt");

CREATE INDEX "SyncOutbox_eventType_idx"
  ON "SyncOutbox"("eventType");

CREATE INDEX "SyncOutbox_entityType_entityId_idx"
  ON "SyncOutbox"("entityType", "entityId");

CREATE INDEX "SyncOutbox_outletId_idx"
  ON "SyncOutbox"("outletId");

CREATE INDEX "SyncOutbox_createdAt_idx"
  ON "SyncOutbox"("createdAt");
