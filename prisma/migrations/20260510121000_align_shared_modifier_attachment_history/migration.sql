ALTER TABLE "MenuItemModifierGroupAttachmentHistory"
  ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER INDEX IF EXISTS "MenuItemModifierGroupAttachmentHistory_menuItemIdSnapshot_modif"
  RENAME TO "MenuItemModifierGroupAttachmentHistory_menuItem_group_key";
