-- Add frozen checkout stock requirements and idempotent order stock movements.

ALTER TABLE "PaymentTransaction"
ADD COLUMN "stockRequirementsJson" JSONB;

ALTER TABLE "StockMovement"
ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "StockMovement_idempotencyKey_key"
ON "StockMovement"("idempotencyKey");
