DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Outlet" WHERE id = 'restaurant') THEN
    UPDATE "Category"
    SET "outletId" = 'cafeteria',
        "updatedAt" = NOW()
    WHERE "outletId" = 'restaurant'
      AND NOT EXISTS (
        SELECT 1 FROM "Category" WHERE "outletId" = 'cafeteria'
      );

    UPDATE "MenuItem"
    SET "outletId" = 'cafeteria',
        "updatedAt" = NOW()
    WHERE "outletId" = 'restaurant'
      AND NOT EXISTS (
        SELECT 1 FROM "MenuItem" WHERE "outletId" = 'cafeteria'
      );

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

    IF EXISTS (SELECT 1 FROM "Category" WHERE "outletId" = 'restaurant')
       OR EXISTS (SELECT 1 FROM "MenuItem" WHERE "outletId" = 'restaurant')
       OR EXISTS (SELECT 1 FROM "Order" WHERE "outletId" = 'restaurant')
       OR EXISTS (SELECT 1 FROM "PaymentTransaction" WHERE "outletId" = 'restaurant')
       OR EXISTS (SELECT 1 FROM "MenuRevision" WHERE "outletId" = 'restaurant')
       OR EXISTS (SELECT 1 FROM "MenuAuditLog" WHERE "outletId" = 'restaurant')
       OR EXISTS (SELECT 1 FROM "MenuHistoryState" WHERE "outletId" = 'restaurant')
       OR EXISTS (SELECT 1 FROM "Device" WHERE "outletId" = 'restaurant')
       OR EXISTS (SELECT 1 FROM "DeviceOutletAccess" WHERE "outletId" = 'restaurant')
       OR EXISTS (SELECT 1 FROM "AuthAuditLog" WHERE "outletId" = 'restaurant')
       OR EXISTS (SELECT 1 FROM "OutletDailyOrderSequence" WHERE "outletId" = 'restaurant') THEN
      RAISE EXCEPTION 'Cannot remove restaurant outlet because operational records still reference it';
    END IF;

    UPDATE "AdminUserOutletRole" cafeteria
    SET role = CASE
          WHEN cafeteria.role = 'MANAGER' OR restaurant.role = 'MANAGER' THEN 'MANAGER'
          WHEN cafeteria.role = 'STAFF' OR restaurant.role = 'STAFF' THEN 'STAFF'
          ELSE 'VIEWER'
        END,
        "updatedAt" = NOW()
    FROM "AdminUserOutletRole" restaurant
    WHERE cafeteria."userId" = restaurant."userId"
      AND cafeteria."outletId" = 'cafeteria'
      AND restaurant."outletId" = 'restaurant';

    DELETE FROM "AdminUserOutletRole" restaurant
    WHERE restaurant."outletId" = 'restaurant'
      AND EXISTS (
        SELECT 1
        FROM "AdminUserOutletRole" cafeteria
        WHERE cafeteria."userId" = restaurant."userId"
          AND cafeteria."outletId" = 'cafeteria'
      );

    UPDATE "AdminUserOutletRole"
    SET "outletId" = 'cafeteria',
        "updatedAt" = NOW()
    WHERE "outletId" = 'restaurant';

    DELETE FROM "OutletSettings"
    WHERE "outletId" = 'restaurant';

    DELETE FROM "Outlet"
    WHERE id = 'restaurant';
  END IF;
END $$;
