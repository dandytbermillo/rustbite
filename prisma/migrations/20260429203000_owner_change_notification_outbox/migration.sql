CREATE TABLE "PendingOwnerChangeCancelToken" (
  "id" TEXT NOT NULL,
  "pendingOwnerChangeId" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),

  CONSTRAINT "PendingOwnerChangeCancelToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PendingOwnerChangeCancelToken_tokenHash_key"
  ON "PendingOwnerChangeCancelToken"("tokenHash");

CREATE INDEX "PendingOwnerChangeCancelToken_pendingOwnerChangeId_idx"
  ON "PendingOwnerChangeCancelToken"("pendingOwnerChangeId");

CREATE INDEX "PendingOwnerChangeCancelToken_ownerUserId_idx"
  ON "PendingOwnerChangeCancelToken"("ownerUserId");

CREATE INDEX "PendingOwnerChangeCancelToken_expiresAt_idx"
  ON "PendingOwnerChangeCancelToken"("expiresAt");

CREATE INDEX "PendingOwnerChangeCancelToken_usedAt_idx"
  ON "PendingOwnerChangeCancelToken"("usedAt");

ALTER TABLE "PendingOwnerChangeCancelToken"
  ADD CONSTRAINT "PendingOwnerChangeCancelToken_pendingOwnerChangeId_fkey"
  FOREIGN KEY ("pendingOwnerChangeId") REFERENCES "PendingOwnerChange"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AuthEmailOutbox" (
  "id" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "recipientUserId" TEXT,
  "recipientEmail" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "textBody" TEXT NOT NULL,
  "metadata" JSONB,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AuthEmailOutbox_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuthEmailOutbox_status_nextAttemptAt_idx"
  ON "AuthEmailOutbox"("status", "nextAttemptAt");

CREATE INDEX "AuthEmailOutbox_recipientUserId_idx"
  ON "AuthEmailOutbox"("recipientUserId");

CREATE INDEX "AuthEmailOutbox_eventType_idx"
  ON "AuthEmailOutbox"("eventType");
