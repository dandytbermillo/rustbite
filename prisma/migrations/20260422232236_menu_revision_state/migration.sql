-- AlterTable
ALTER TABLE "MenuRevision" ADD COLUMN     "targetId" TEXT,
ADD COLUMN     "targetLabel" TEXT,
ADD COLUMN     "targetType" TEXT;

-- CreateTable
CREATE TABLE "MenuHistoryState" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "currentRevisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuHistoryState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MenuHistoryState_currentRevisionId_idx" ON "MenuHistoryState"("currentRevisionId");

-- CreateIndex
CREATE INDEX "MenuRevision_targetType_targetId_idx" ON "MenuRevision"("targetType", "targetId");

-- AddForeignKey
ALTER TABLE "MenuHistoryState" ADD CONSTRAINT "MenuHistoryState_currentRevisionId_fkey" FOREIGN KEY ("currentRevisionId") REFERENCES "MenuRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill legacy revision metadata from the audit log created in the same transaction.
UPDATE "MenuRevision" AS revision
SET
  "targetType" = audit."targetType",
  "targetId" = audit."targetId",
  "targetLabel" = audit."targetLabel"
FROM "MenuAuditLog" AS audit
WHERE audit."actionType" = revision."reason"
  AND audit."createdAt" = revision."createdAt"
  AND (
    revision."targetType" IS NULL
    OR revision."targetId" IS NULL
    OR revision."targetLabel" IS NULL
  );

-- Seed the singleton state row to the menu currently live after legacy restores.
INSERT INTO "MenuHistoryState" ("id", "currentRevisionId", "createdAt", "updatedAt")
VALUES (
  'main',
  COALESCE(
    (
      SELECT "sourceRevisionId"
      FROM "MenuRevision"
      WHERE "reason" = 'MENU_RESTORED' AND "sourceRevisionId" IS NOT NULL
      ORDER BY "createdAt" DESC
      LIMIT 1
    ),
    (
      SELECT "id"
      FROM "MenuRevision"
      WHERE "reason" <> 'MENU_RESTORED'
      ORDER BY "createdAt" DESC
      LIMIT 1
    ),
    (
      SELECT "id"
      FROM "MenuRevision"
      ORDER BY "createdAt" DESC
      LIMIT 1
    )
  ),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO UPDATE
SET
  "currentRevisionId" = EXCLUDED."currentRevisionId",
  "updatedAt" = CURRENT_TIMESTAMP;
