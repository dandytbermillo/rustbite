-- Lightweight live-menu revision used by kiosk/counter/kitchen freshness sync.
-- This is separate from MenuRevision, which stores full admin history snapshots.
CREATE TABLE "OutletMenuVersion" (
  "outletId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OutletMenuVersion_pkey" PRIMARY KEY ("outletId")
);

INSERT INTO "OutletMenuVersion" ("outletId", "revision", "createdAt", "updatedAt")
SELECT "id", 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Outlet"
ON CONFLICT ("outletId") DO NOTHING;

ALTER TABLE "OutletMenuVersion"
  ADD CONSTRAINT "OutletMenuVersion_outletId_fkey"
  FOREIGN KEY ("outletId") REFERENCES "Outlet"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
