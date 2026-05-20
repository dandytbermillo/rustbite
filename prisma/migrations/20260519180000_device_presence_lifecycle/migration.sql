-- Device presence lifecycle state for registered kiosk/counter/kitchen/board browsers.
-- Additive, forward-only migration: old code can ignore these nullable fields.

ALTER TABLE "DeviceSession"
  ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3),
  ADD COLUMN "lastLifecycleAt" TIMESTAMP(3),
  ADD COLUMN "lastLifecycleEvent" TEXT,
  ADD COLUMN "lastVisibilityState" TEXT,
  ADD COLUMN "lastClosedAt" TIMESTAMP(3),
  ADD COLUMN "lastCloseReason" TEXT,
  ADD COLUMN "clientSessionHash" TEXT,
  ADD COLUMN "clientSequence" INTEGER,
  ADD COLUMN "lastClientErrorAt" TIMESTAMP(3),
  ADD COLUMN "uncleanRecoveryCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "DeviceSession_lastHeartbeatAt_idx" ON "DeviceSession"("lastHeartbeatAt");
CREATE INDEX "DeviceSession_lastLifecycleEvent_idx" ON "DeviceSession"("lastLifecycleEvent");
