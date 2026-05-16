ALTER TABLE "MenuItem" ADD COLUMN "dealBaseSizeId" TEXT;
ALTER TABLE "MenuItem" ADD COLUMN "dealBaseSizeNameSnapshot" TEXT;

CREATE INDEX "MenuItem_dealBaseSizeId_idx" ON "MenuItem"("dealBaseSizeId");

ALTER TABLE "MenuItem"
  ADD CONSTRAINT "MenuItem_dealBaseSizeId_fkey"
  FOREIGN KEY ("dealBaseSizeId") REFERENCES "SizeOption"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
