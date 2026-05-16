-- Phase 1: Counter/Kitchen Active Operator Foundation
-- See docs/counter-kitchen-active-staff-plan-2026-04-30.md
-- See plan: ~/.claude/plans/ancient-enchanting-whale.md

-- DeviceSession: active operator + active outlet selection state.
-- All columns nullable so existing rows are valid without backfill.
ALTER TABLE "DeviceSession"
  ADD COLUMN "activeOutletId" TEXT,
  ADD COLUMN "activeStaffUserId" TEXT,
  ADD COLUMN "activeStaffOutletId" TEXT,
  ADD COLUMN "activeStaffRole" TEXT,
  ADD COLUMN "activeStaffVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "activeStaffLastActionAt" TIMESTAMP(3);

ALTER TABLE "DeviceSession"
  ADD CONSTRAINT "DeviceSession_activeStaffUserId_fkey"
  FOREIGN KEY ("activeStaffUserId")
  REFERENCES "AdminUser"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE INDEX "DeviceSession_activeOutletId_idx"
  ON "DeviceSession"("activeOutletId");

CREATE INDEX "DeviceSession_activeStaffUserId_idx"
  ON "DeviceSession"("activeStaffUserId");

CREATE INDEX "DeviceSession_activeStaffOutletId_idx"
  ON "DeviceSession"("activeStaffOutletId");

-- AdminUser: peppered Argon2id operational PIN for counter/kitchen sign-in.
ALTER TABLE "AdminUser"
  ADD COLUMN "operationalPinHash" TEXT,
  ADD COLUMN "operationalPinChangedAt" TIMESTAMP(3);

-- AdminUserSurfaceAccess: Owner-controlled grant of which surfaces a user
-- may operate. v1 only persists "COUNTER" and "KITCHEN" (validated at the
-- API boundary); see src/lib/admin-user-surface-access.ts.
CREATE TABLE "AdminUserSurfaceAccess" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "surface"   TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AdminUserSurfaceAccess_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AdminUserSurfaceAccess"
  ADD CONSTRAINT "AdminUserSurfaceAccess_userId_fkey"
  FOREIGN KEY ("userId")
  REFERENCES "AdminUser"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

CREATE UNIQUE INDEX "AdminUserSurfaceAccess_userId_surface_key"
  ON "AdminUserSurfaceAccess"("userId", "surface");

CREATE INDEX "AdminUserSurfaceAccess_surface_idx"
  ON "AdminUserSurfaceAccess"("surface");
