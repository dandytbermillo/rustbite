DO $$
DECLARE
  cafeteria_category_count INTEGER;
  cafeteria_item_count INTEGER;
  restaurant_category_count INTEGER;
  restaurant_item_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO cafeteria_category_count
  FROM "Category"
  WHERE "outletId" = 'cafeteria';

  SELECT COUNT(*) INTO cafeteria_item_count
  FROM "MenuItem"
  WHERE "outletId" = 'cafeteria';

  SELECT COUNT(*) INTO restaurant_category_count
  FROM "Category"
  WHERE "outletId" = 'restaurant';

  SELECT COUNT(*) INTO restaurant_item_count
  FROM "MenuItem"
  WHERE "outletId" = 'restaurant';

  IF cafeteria_category_count = 0
     AND cafeteria_item_count = 0
     AND (restaurant_category_count > 0 OR restaurant_item_count > 0) THEN
    UPDATE "Category"
    SET "outletId" = 'cafeteria',
        "updatedAt" = NOW()
    WHERE "outletId" = 'restaurant';

    UPDATE "MenuItem"
    SET "outletId" = 'cafeteria',
        "updatedAt" = NOW()
    WHERE "outletId" = 'restaurant';

    UPDATE "MenuRevision"
    SET "outletId" = 'cafeteria'
    WHERE "outletId" = 'restaurant';

    UPDATE "MenuAuditLog"
    SET "outletId" = 'cafeteria'
    WHERE "outletId" = 'restaurant';

    IF EXISTS (
      SELECT 1
      FROM "MenuHistoryState"
      WHERE "outletId" = 'restaurant'
    ) THEN
      IF NOT EXISTS (
        SELECT 1
        FROM "MenuHistoryState"
        WHERE "outletId" = 'cafeteria'
      ) THEN
        UPDATE "MenuHistoryState"
        SET id = 'outlet:cafeteria',
            "outletId" = 'cafeteria',
            "updatedAt" = NOW()
        WHERE "outletId" = 'restaurant';
      ELSE
        UPDATE "MenuHistoryState" cafeteria
        SET "currentRevisionId" = COALESCE(
              cafeteria."currentRevisionId",
              restaurant."currentRevisionId"
            ),
            "updatedAt" = NOW()
        FROM "MenuHistoryState" restaurant
        WHERE cafeteria."outletId" = 'cafeteria'
          AND restaurant."outletId" = 'restaurant';

        DELETE FROM "MenuHistoryState"
        WHERE "outletId" = 'restaurant';
      END IF;
    END IF;
  END IF;
END $$;
