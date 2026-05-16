-- CreateEnum
CREATE TYPE "StockMode" AS ENUM ('MANUAL', 'QUANTITY');

-- AlterTable
ALTER TABLE "MenuItem"
ADD COLUMN "stockMode" "StockMode" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN "stockQty" INTEGER,
ADD COLUMN "lowStockThreshold" INTEGER,
ADD COLUMN "stockUpdatedAt" TIMESTAMP(3),
ADD COLUMN "stockUpdatedById" TEXT;

-- Safety constraints
ALTER TABLE "MenuItem"
ADD CONSTRAINT "MenuItem_stockQty_nonnegative_check"
CHECK ("stockQty" IS NULL OR "stockQty" >= 0);

ALTER TABLE "MenuItem"
ADD CONSTRAINT "MenuItem_lowStockThreshold_nonnegative_check"
CHECK ("lowStockThreshold" IS NULL OR "lowStockThreshold" >= 0);

-- CreateTable
CREATE TABLE "StockMovement" (
  "id" TEXT NOT NULL,
  "outletId" TEXT NOT NULL,
  "menuItemId" TEXT,
  "itemNameSnapshot" TEXT NOT NULL,
  "orderId" TEXT,
  "delta" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "beforeQty" INTEGER,
  "afterQty" INTEGER,
  "actorType" TEXT NOT NULL,
  "actorId" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MenuItem_stockMode_idx" ON "MenuItem"("stockMode");

-- CreateIndex
CREATE INDEX "MenuItem_stockUpdatedById_idx" ON "MenuItem"("stockUpdatedById");

-- CreateIndex
CREATE INDEX "StockMovement_outletId_createdAt_idx" ON "StockMovement"("outletId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_menuItemId_createdAt_idx" ON "StockMovement"("menuItemId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_orderId_idx" ON "StockMovement"("orderId");

-- AddForeignKey
ALTER TABLE "MenuItem"
ADD CONSTRAINT "MenuItem_stockUpdatedById_fkey"
FOREIGN KEY ("stockUpdatedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement"
ADD CONSTRAINT "StockMovement_outletId_fkey"
FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement"
ADD CONSTRAINT "StockMovement_menuItemId_fkey"
FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement"
ADD CONSTRAINT "StockMovement_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

