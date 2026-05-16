-- Add target-safe stock infrastructure for item-local add-ons and shared modifier options.

CREATE TYPE "StockMovementTargetType" AS ENUM (
  'MENU_ITEM',
  'ITEM_LOCAL_ADDON',
  'SHARED_MODIFIER_OPTION'
);

ALTER TABLE "AddonOption"
ADD COLUMN "stockMode" "StockMode" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN "isOutOfStock" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "stockQty" INTEGER,
ADD COLUMN "lowStockThreshold" INTEGER,
ADD COLUMN "stockUpdatedAt" TIMESTAMP(3),
ADD COLUMN "stockUpdatedById" TEXT;

ALTER TABLE "SharedModifierOption"
ADD COLUMN "stockMode" "StockMode" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN "isOutOfStock" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "stockQty" INTEGER,
ADD COLUMN "lowStockThreshold" INTEGER,
ADD COLUMN "stockUpdatedAt" TIMESTAMP(3),
ADD COLUMN "stockUpdatedById" TEXT;

ALTER TABLE "StockMovement"
ADD COLUMN "targetType" "StockMovementTargetType" NOT NULL DEFAULT 'MENU_ITEM',
ADD COLUMN "targetIdSnapshot" TEXT,
ADD COLUMN "targetNameSnapshot" TEXT,
ADD COLUMN "addonOptionId" TEXT,
ADD COLUMN "sharedModifierOptionId" TEXT;

UPDATE "StockMovement"
SET
  "targetType" = 'MENU_ITEM',
  "targetIdSnapshot" = "menuItemId",
  "targetNameSnapshot" = "itemNameSnapshot";

ALTER TABLE "AddonOption"
ADD CONSTRAINT "AddonOption_stockQty_nonnegative_check"
CHECK ("stockQty" IS NULL OR "stockQty" >= 0);

ALTER TABLE "AddonOption"
ADD CONSTRAINT "AddonOption_lowStockThreshold_nonnegative_check"
CHECK ("lowStockThreshold" IS NULL OR "lowStockThreshold" >= 0);

ALTER TABLE "SharedModifierOption"
ADD CONSTRAINT "SharedModifierOption_stockQty_nonnegative_check"
CHECK ("stockQty" IS NULL OR "stockQty" >= 0);

ALTER TABLE "SharedModifierOption"
ADD CONSTRAINT "SharedModifierOption_lowStockThreshold_nonnegative_check"
CHECK ("lowStockThreshold" IS NULL OR "lowStockThreshold" >= 0);

ALTER TABLE "StockMovement"
ADD CONSTRAINT "StockMovement_target_consistency_check"
CHECK (
  (
    "targetType" = 'MENU_ITEM'
    AND "addonOptionId" IS NULL
    AND "sharedModifierOptionId" IS NULL
  )
  OR (
    "targetType" = 'ITEM_LOCAL_ADDON'
    AND "menuItemId" IS NULL
    AND "sharedModifierOptionId" IS NULL
    AND ("addonOptionId" IS NOT NULL OR "targetIdSnapshot" IS NOT NULL)
  )
  OR (
    "targetType" = 'SHARED_MODIFIER_OPTION'
    AND "menuItemId" IS NULL
    AND "addonOptionId" IS NULL
    AND ("sharedModifierOptionId" IS NOT NULL OR "targetIdSnapshot" IS NOT NULL)
  )
);

CREATE INDEX "AddonOption_stockMode_idx" ON "AddonOption"("stockMode");
CREATE INDEX "AddonOption_stockUpdatedById_idx" ON "AddonOption"("stockUpdatedById");

CREATE INDEX "SharedModifierOption_stockMode_idx" ON "SharedModifierOption"("stockMode");
CREATE INDEX "SharedModifierOption_stockUpdatedById_idx" ON "SharedModifierOption"("stockUpdatedById");

CREATE INDEX "StockMovement_targetType_targetIdSnapshot_createdAt_idx"
ON "StockMovement"("targetType", "targetIdSnapshot", "createdAt");

CREATE INDEX "StockMovement_targetType_createdAt_idx"
ON "StockMovement"("targetType", "createdAt");

CREATE INDEX "StockMovement_addonOptionId_createdAt_idx"
ON "StockMovement"("addonOptionId", "createdAt");

CREATE INDEX "StockMovement_sharedModifierOptionId_createdAt_idx"
ON "StockMovement"("sharedModifierOptionId", "createdAt");

ALTER TABLE "AddonOption"
ADD CONSTRAINT "AddonOption_stockUpdatedById_fkey"
FOREIGN KEY ("stockUpdatedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SharedModifierOption"
ADD CONSTRAINT "SharedModifierOption_stockUpdatedById_fkey"
FOREIGN KEY ("stockUpdatedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StockMovement"
ADD CONSTRAINT "StockMovement_addonOptionId_fkey"
FOREIGN KEY ("addonOptionId") REFERENCES "AddonOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StockMovement"
ADD CONSTRAINT "StockMovement_sharedModifierOptionId_fkey"
FOREIGN KEY ("sharedModifierOptionId") REFERENCES "SharedModifierOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;
