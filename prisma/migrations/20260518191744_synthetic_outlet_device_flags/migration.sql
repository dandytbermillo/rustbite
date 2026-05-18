-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "isSynthetic" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Outlet" ADD COLUMN     "isSynthetic" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Device_isSynthetic_idx" ON "Device"("isSynthetic");

-- CreateIndex
CREATE INDEX "Outlet_isSynthetic_idx" ON "Outlet"("isSynthetic");
