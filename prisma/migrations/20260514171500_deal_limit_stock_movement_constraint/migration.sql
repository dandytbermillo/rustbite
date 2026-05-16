ALTER TABLE "StockMovement"
DROP CONSTRAINT IF EXISTS "StockMovement_target_consistency_check";

ALTER TABLE "StockMovement"
ADD CONSTRAINT "StockMovement_target_consistency_check"
CHECK (
  (
    "targetType" = 'MENU_ITEM'
    AND "addonOptionId" IS NULL
    AND "sharedModifierOptionId" IS NULL
  )
  OR (
    "targetType" = 'ITEM_LOCAL_ADDON'
    AND "menuItemId" IS NULL
    AND "sharedModifierOptionId" IS NULL
    AND ("addonOptionId" IS NOT NULL OR "targetIdSnapshot" IS NOT NULL)
  )
  OR (
    "targetType" = 'SHARED_MODIFIER_OPTION'
    AND "menuItemId" IS NULL
    AND "addonOptionId" IS NULL
    AND ("sharedModifierOptionId" IS NOT NULL OR "targetIdSnapshot" IS NOT NULL)
  )
  OR (
    "targetType" = 'DEAL_LIMIT'
    AND "addonOptionId" IS NULL
    AND "sharedModifierOptionId" IS NULL
    AND ("menuItemId" IS NOT NULL OR "targetIdSnapshot" IS NOT NULL)
  )
);
