-- Lightweight live-order revision used by the admin dashboard freshness loop.
-- This is separate from Order.updatedAt because the dashboard needs one cheap
-- outlet-scoped freshness signal for order creation, status changes, and refunds.
CREATE TABLE "OutletOrderVersion" (
  "outletId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OutletOrderVersion_pkey" PRIMARY KEY ("outletId")
);

INSERT INTO "OutletOrderVersion" ("outletId", "revision", "createdAt", "updatedAt")
SELECT "id", 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Outlet"
ON CONFLICT ("outletId") DO NOTHING;

ALTER TABLE "OutletOrderVersion"
  ADD CONSTRAINT "OutletOrderVersion_outletId_fkey"
  FOREIGN KEY ("outletId") REFERENCES "Outlet"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
