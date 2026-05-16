CREATE TABLE "MenuItemModifierGroupAttachmentHistory" (
  "id" TEXT NOT NULL,
  "outletId" TEXT NOT NULL,
  "menuItemId" TEXT,
  "menuItemIdSnapshot" TEXT NOT NULL,
  "menuItemNameSnapshot" TEXT NOT NULL,
  "modifierGroupId" TEXT NOT NULL,
  "modifierGroupNameSnapshot" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MenuItemModifierGroupAttachmentHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MenuItemModifierGroupAttachmentHistory_menuItemIdSnapshot_modifierGroupId_key"
  ON "MenuItemModifierGroupAttachmentHistory"("menuItemIdSnapshot", "modifierGroupId");
CREATE INDEX "MenuItemModifierGroupAttachmentHistory_outletId_idx"
  ON "MenuItemModifierGroupAttachmentHistory"("outletId");
CREATE INDEX "MenuItemModifierGroupAttachmentHistory_menuItemId_idx"
  ON "MenuItemModifierGroupAttachmentHistory"("menuItemId");
CREATE INDEX "MenuItemModifierGroupAttachmentHistory_modifierGroupId_idx"
  ON "MenuItemModifierGroupAttachmentHistory"("modifierGroupId");

ALTER TABLE "MenuItemModifierGroupAttachmentHistory"
  ADD CONSTRAINT "MenuItemModifierGroupAttachmentHistory_outletId_fkey"
  FOREIGN KEY ("outletId") REFERENCES "Outlet"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MenuItemModifierGroupAttachmentHistory"
  ADD CONSTRAINT "MenuItemModifierGroupAttachmentHistory_menuItemId_fkey"
  FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MenuItemModifierGroupAttachmentHistory"
  ADD CONSTRAINT "MenuItemModifierGroupAttachmentHistory_modifierGroupId_fkey"
  FOREIGN KEY ("modifierGroupId") REFERENCES "SharedModifierGroup"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "MenuItemModifierGroupAttachmentHistory" (
  "id",
  "outletId",
  "menuItemId",
  "menuItemIdSnapshot",
  "menuItemNameSnapshot",
  "modifierGroupId",
  "modifierGroupNameSnapshot",
  "createdAt",
  "updatedAt"
)
SELECT
  mig."id",
  mig."outletId",
  mig."menuItemId",
  mig."menuItemId",
  mi."name",
  mig."modifierGroupId",
  smg."name",
  mig."createdAt",
  mig."updatedAt"
FROM "MenuItemModifierGroup" mig
INNER JOIN "MenuItem" mi ON mi."id" = mig."menuItemId"
INNER JOIN "SharedModifierGroup" smg ON smg."id" = mig."modifierGroupId"
ON CONFLICT ("menuItemIdSnapshot", "modifierGroupId") DO NOTHING;
