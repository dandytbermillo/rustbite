DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "AdminUser"
    WHERE "siteRole" IS NOT NULL
      AND "siteRole" NOT IN ('OWNER', 'ADMIN')
  ) THEN
    RAISE EXCEPTION 'Unknown AdminUser.siteRole value. Document and map unknown values before running this migration.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "AdminUserOutletRole"
    WHERE "role" NOT IN ('MANAGER', 'STAFF', 'OPERATOR', 'VIEWER')
  ) THEN
    RAISE EXCEPTION 'Unknown AdminUserOutletRole.role value. Document and map unknown values before running this migration.';
  END IF;
END $$;

ALTER TABLE "AdminUser" ADD COLUMN "accountType" TEXT;

UPDATE "AdminUser"
SET "accountType" = CASE
  WHEN "siteRole" = 'OWNER' THEN 'OWNER'
  WHEN "siteRole" = 'ADMIN' THEN 'ADMIN'
  ELSE 'STAFF'
END;

ALTER TABLE "AdminUser" ALTER COLUMN "accountType" SET NOT NULL;

UPDATE "AdminUserOutletRole"
SET "role" = 'OPERATOR'
WHERE "role" = 'STAFF';

ALTER TABLE "AdminSession"
  ADD COLUMN "stepUpVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "stepUpExpiresAt" TIMESTAMP(3);

CREATE TABLE "PendingOwnerChange" (
  "id" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "reason" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "executesAt" TIMESTAMP(3) NOT NULL,
  "cancelledAt" TIMESTAMP(3),
  "cancelledBy" TEXT,
  "executedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PendingOwnerChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminUser_accountType_idx" ON "AdminUser"("accountType");
CREATE INDEX "PendingOwnerChange_actorId_idx" ON "PendingOwnerChange"("actorId");
CREATE INDEX "PendingOwnerChange_targetId_idx" ON "PendingOwnerChange"("targetId");
CREATE INDEX "PendingOwnerChange_status_executesAt_idx" ON "PendingOwnerChange"("status", "executesAt");
