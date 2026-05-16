ALTER TABLE "SharedModifierGroup"
  DROP CONSTRAINT IF EXISTS "SharedModifierGroup_maxSelect_check";

ALTER TABLE "SharedModifierGroup"
  ADD CONSTRAINT "SharedModifierGroup_maxSelect_check"
  CHECK (
    "maxSelect" IS NULL OR
    (
      "maxSelect" >= "minSelect" AND
      (
        "selectionMode" NOT IN ('OPTIONAL_MULTI', 'REQUIRED_MULTI') OR
        "maxSelect" >= 1
      )
    )
  );

ALTER TABLE "MenuItemModifierGroup"
  DROP CONSTRAINT IF EXISTS "MenuItemModifierGroup_maxSelectOverride_check";

ALTER TABLE "MenuItemModifierGroup"
  ADD CONSTRAINT "MenuItemModifierGroup_maxSelectOverride_check"
  CHECK (
    "maxSelectOverride" IS NULL OR
    (
      "maxSelectOverride" >= 1 AND
      (
        "minSelectOverride" IS NULL OR
        "maxSelectOverride" >= "minSelectOverride"
      )
    )
  );
