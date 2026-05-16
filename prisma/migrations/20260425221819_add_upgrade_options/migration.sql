-- AlterTable
ALTER TABLE "MenuItem" ADD COLUMN     "bundleSavings" DECIMAL(8,2);

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "upgradeSnapshotJson" JSONB;

-- CreateTable
CREATE TABLE "UpgradeOption" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "customTitle" TEXT,
    "extraCharge" DECIMAL(8,2) NOT NULL,
    "savingsLabel" DECIMAL(8,2),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UpgradeOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpgradeItemLink" (
    "id" TEXT NOT NULL,
    "upgradeOptionId" TEXT NOT NULL,
    "linkedMenuItemId" TEXT,
    "linkedSizeId" TEXT,
    "sizeNameSnapshot" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UpgradeItemLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UpgradeOption_itemId_idx" ON "UpgradeOption"("itemId");

-- CreateIndex
CREATE INDEX "UpgradeItemLink_upgradeOptionId_idx" ON "UpgradeItemLink"("upgradeOptionId");

-- CreateIndex
CREATE INDEX "UpgradeItemLink_linkedMenuItemId_idx" ON "UpgradeItemLink"("linkedMenuItemId");

-- CreateIndex
CREATE INDEX "UpgradeItemLink_linkedSizeId_idx" ON "UpgradeItemLink"("linkedSizeId");

-- AddForeignKey
ALTER TABLE "UpgradeOption" ADD CONSTRAINT "UpgradeOption_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpgradeItemLink" ADD CONSTRAINT "UpgradeItemLink_upgradeOptionId_fkey" FOREIGN KEY ("upgradeOptionId") REFERENCES "UpgradeOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpgradeItemLink" ADD CONSTRAINT "UpgradeItemLink_linkedMenuItemId_fkey" FOREIGN KEY ("linkedMenuItemId") REFERENCES "MenuItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpgradeItemLink" ADD CONSTRAINT "UpgradeItemLink_linkedSizeId_fkey" FOREIGN KEY ("linkedSizeId") REFERENCES "SizeOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;
