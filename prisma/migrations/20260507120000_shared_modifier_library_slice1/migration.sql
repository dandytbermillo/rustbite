CREATE TYPE "ModifierSelectionMode" AS ENUM (
  'OPTIONAL_MULTI',
  'REQUIRED_SINGLE',
  'OPTIONAL_SINGLE',
  'REQUIRED_MULTI'
);

CREATE TYPE "ModifierContractMode" AS ENUM (
  'LEGACY',
  'SHARED',
  'MIXED_COMPAT'
);

ALTER TABLE "MenuItem"
  ADD COLUMN "modifierContractMode" "ModifierContractMode" NOT NULL DEFAULT 'LEGACY';

CREATE TABLE "SharedModifierGroup" (
  "id" TEXT NOT NULL,
  "outletId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "selectionMode" "ModifierSelectionMode" NOT NULL DEFAULT 'OPTIONAL_MULTI',
  "minSelect" INTEGER NOT NULL DEFAULT 0,
  "maxSelect" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "lockVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SharedModifierGroup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SharedModifierGroup_minSelect_check" CHECK ("minSelect" >= 0),
  CONSTRAINT "SharedModifierGroup_maxSelect_check" CHECK ("maxSelect" IS NULL OR "maxSelect" >= "minSelect"),
  CONSTRAINT "SharedModifierGroup_required_multi_check" CHECK ("selectionMode" <> 'REQUIRED_MULTI' OR "minSelect" >= 1),
  CONSTRAINT "SharedModifierGroup_optional_single_check" CHECK ("selectionMode" <> 'OPTIONAL_SINGLE' OR ("minSelect" = 0 AND "maxSelect" = 1)),
  CONSTRAINT "SharedModifierGroup_required_single_check" CHECK ("selectionMode" <> 'REQUIRED_SINGLE' OR ("minSelect" = 1 AND "maxSelect" = 1))
);

CREATE TABLE "SharedModifierOption" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "priceDelta" DECIMAL(8, 2) NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SharedModifierOption_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SharedModifierOption_priceDelta_check" CHECK ("priceDelta" >= 0)
);

CREATE TABLE "MenuItemModifierGroup" (
  "id" TEXT NOT NULL,
  "outletId" TEXT NOT NULL,
  "menuItemId" TEXT NOT NULL,
  "modifierGroupId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "minSelectOverride" INTEGER,
  "maxSelectOverride" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MenuItemModifierGroup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MenuItemModifierGroup_minSelectOverride_check" CHECK ("minSelectOverride" IS NULL OR "minSelectOverride" >= 0),
  CONSTRAINT "MenuItemModifierGroup_maxSelectOverride_check" CHECK (
    "maxSelectOverride" IS NULL OR
    "minSelectOverride" IS NULL OR
    "maxSelectOverride" >= "minSelectOverride"
  )
);

CREATE TABLE "MenuItemModifierOptionOverride" (
  "id" TEXT NOT NULL,
  "menuItemModifierGroupId" TEXT NOT NULL,
  "modifierOptionId" TEXT NOT NULL,
  "isHidden" BOOLEAN NOT NULL DEFAULT false,
  "priceDeltaOverride" DECIMAL(8, 2),
  "sortOrderOverride" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MenuItemModifierOptionOverride_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MenuItemModifierOptionOverride_priceDeltaOverride_check" CHECK (
    "priceDeltaOverride" IS NULL OR "priceDeltaOverride" >= 0
  )
);

CREATE INDEX "SharedModifierGroup_outletId_idx" ON "SharedModifierGroup"("outletId");
CREATE INDEX "SharedModifierGroup_isActive_idx" ON "SharedModifierGroup"("isActive");
CREATE UNIQUE INDEX "SharedModifierGroup_active_outlet_name_key"
  ON "SharedModifierGroup"("outletId", lower(btrim("name")))
  WHERE "isActive" = true;

CREATE INDEX "SharedModifierOption_groupId_idx" ON "SharedModifierOption"("groupId");
CREATE INDEX "SharedModifierOption_isActive_idx" ON "SharedModifierOption"("isActive");
CREATE UNIQUE INDEX "SharedModifierOption_active_group_name_key"
  ON "SharedModifierOption"("groupId", lower(btrim("name")))
  WHERE "isActive" = true;

CREATE UNIQUE INDEX "MenuItemModifierGroup_menuItemId_modifierGroupId_key"
  ON "MenuItemModifierGroup"("menuItemId", "modifierGroupId");
CREATE INDEX "MenuItemModifierGroup_outletId_idx" ON "MenuItemModifierGroup"("outletId");
CREATE INDEX "MenuItemModifierGroup_menuItemId_idx" ON "MenuItemModifierGroup"("menuItemId");
CREATE INDEX "MenuItemModifierGroup_modifierGroupId_idx" ON "MenuItemModifierGroup"("modifierGroupId");
CREATE INDEX "MenuItemModifierGroup_isActive_idx" ON "MenuItemModifierGroup"("isActive");

CREATE UNIQUE INDEX "MenuItemModifierOptionOverride_menuItemModifierGroupId_modifierOptionId_key"
  ON "MenuItemModifierOptionOverride"("menuItemModifierGroupId", "modifierOptionId");
CREATE INDEX "MenuItemModifierOptionOverride_modifierOptionId_idx"
  ON "MenuItemModifierOptionOverride"("modifierOptionId");

ALTER TABLE "SharedModifierGroup"
  ADD CONSTRAINT "SharedModifierGroup_outletId_fkey"
  FOREIGN KEY ("outletId") REFERENCES "Outlet"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SharedModifierOption"
  ADD CONSTRAINT "SharedModifierOption_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "SharedModifierGroup"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MenuItemModifierGroup"
  ADD CONSTRAINT "MenuItemModifierGroup_outletId_fkey"
  FOREIGN KEY ("outletId") REFERENCES "Outlet"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MenuItemModifierGroup"
  ADD CONSTRAINT "MenuItemModifierGroup_menuItemId_fkey"
  FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MenuItemModifierGroup"
  ADD CONSTRAINT "MenuItemModifierGroup_modifierGroupId_fkey"
  FOREIGN KEY ("modifierGroupId") REFERENCES "SharedModifierGroup"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MenuItemModifierOptionOverride"
  ADD CONSTRAINT "MenuItemModifierOptionOverride_menuItemModifierGroupId_fkey"
  FOREIGN KEY ("menuItemModifierGroupId") REFERENCES "MenuItemModifierGroup"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MenuItemModifierOptionOverride"
  ADD CONSTRAINT "MenuItemModifierOptionOverride_modifierOptionId_fkey"
  FOREIGN KEY ("modifierOptionId") REFERENCES "SharedModifierOption"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
