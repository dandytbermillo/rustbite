-- Persist whether kitchen production has ever started for an order.
-- This protects cancellation restock rules from later admin/status rewrites.

ALTER TABLE "Order"
ADD COLUMN "productionStartedAt" TIMESTAMP(3);

UPDATE "Order"
SET "productionStartedAt" = COALESCE("updatedAt", "createdAt")
WHERE "productionStartedAt" IS NULL
  AND "status" IN ('IN_KITCHEN', 'READY', 'COMPLETED');

CREATE INDEX "Order_productionStartedAt_idx" ON "Order"("productionStartedAt");
