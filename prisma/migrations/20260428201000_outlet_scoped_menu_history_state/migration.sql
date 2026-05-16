-- Menu history state is now explicitly outlet-scoped.
-- The original singleton row used id='main'; keep its revision pointer but move
-- it to the deterministic restaurant state id so cafeteria can have its own row.

UPDATE "MenuHistoryState" AS target
SET
  "currentRevisionId" = COALESCE(source."currentRevisionId", target."currentRevisionId"),
  "outletId" = 'restaurant',
  "updatedAt" = CURRENT_TIMESTAMP
FROM "MenuHistoryState" AS source
WHERE target.id = 'outlet:restaurant'
  AND source.id = 'main';

DELETE FROM "MenuHistoryState"
WHERE id = 'main'
  AND EXISTS (
    SELECT 1
    FROM "MenuHistoryState"
    WHERE id = 'outlet:restaurant'
  );

UPDATE "MenuHistoryState"
SET
  id = 'outlet:restaurant',
  "outletId" = 'restaurant',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE id = 'main';

ALTER TABLE "MenuHistoryState" ALTER COLUMN id DROP DEFAULT;
