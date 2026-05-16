-- Slice 1: nullable deal base identity for future repair/enforcement.
-- Existing rows stay readable; stricter rules are gated in later slices.
ALTER TABLE "MenuItem" ADD COLUMN "dealBaseMenuItemId" TEXT;

CREATE INDEX "MenuItem_dealBaseMenuItemId_idx" ON "MenuItem"("dealBaseMenuItemId");

ALTER TABLE "MenuItem"
  ADD CONSTRAINT "MenuItem_dealBaseMenuItemId_fkey"
  FOREIGN KEY ("dealBaseMenuItemId") REFERENCES "MenuItem"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
