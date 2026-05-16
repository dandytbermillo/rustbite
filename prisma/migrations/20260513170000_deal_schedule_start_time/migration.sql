ALTER TABLE "MenuItem" ADD COLUMN "dealStartsAt" TIMESTAMP(3);

CREATE INDEX "MenuItem_outletId_dealStartsAt_dealExpiresAt_idx" ON "MenuItem"("outletId", "dealStartsAt", "dealExpiresAt");
