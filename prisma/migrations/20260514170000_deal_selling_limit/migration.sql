CREATE TYPE "DealLimitMode" AS ENUM ('UNLIMITED', 'LIMITED');

ALTER TYPE "StockMovementTargetType" ADD VALUE 'DEAL_LIMIT';

ALTER TABLE "MenuItem"
  ADD COLUMN "dealLimitMode" "DealLimitMode" NOT NULL DEFAULT 'UNLIMITED',
  ADD COLUMN "dealLimitQty" INTEGER,
  ADD COLUMN "dealLimitLowThreshold" INTEGER,
  ADD COLUMN "dealLimitUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "dealLimitUpdatedById" TEXT;

ALTER TABLE "MenuItem"
  ADD CONSTRAINT "MenuItem_dealLimitUpdatedById_fkey"
  FOREIGN KEY ("dealLimitUpdatedById") REFERENCES "AdminUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MenuItem"
  ADD CONSTRAINT "MenuItem_dealLimitQty_range_check"
  CHECK ("dealLimitQty" IS NULL OR ("dealLimitQty" >= 0 AND "dealLimitQty" <= 99999));

ALTER TABLE "MenuItem"
  ADD CONSTRAINT "MenuItem_dealLimitLowThreshold_range_check"
  CHECK ("dealLimitLowThreshold" IS NULL OR ("dealLimitLowThreshold" >= 0 AND "dealLimitLowThreshold" <= 99999));

ALTER TABLE "MenuItem"
  ADD CONSTRAINT "MenuItem_limitedDealRequiresQty_check"
  CHECK ("dealLimitMode" <> 'LIMITED' OR "dealLimitQty" IS NOT NULL);

CREATE INDEX "MenuItem_dealLimitMode_idx" ON "MenuItem"("dealLimitMode");
CREATE INDEX "MenuItem_dealLimitUpdatedById_idx" ON "MenuItem"("dealLimitUpdatedById");
