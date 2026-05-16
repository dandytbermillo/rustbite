-- Production auth/outlet foundations.
-- This migration keeps the current single-outlet runtime compatible by
-- backfilling all existing data into a default restaurant outlet.

CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Edmonton',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Outlet" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "orderPrefix" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Outlet_pkey" PRIMARY KEY ("id")
);

INSERT INTO "Site" ("id", "name", "timezone", "updatedAt")
VALUES ('site', 'Rushbite', 'America/Edmonton', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Outlet" ("id", "siteId", "name", "slug", "orderPrefix", "updatedAt")
VALUES
  ('restaurant', 'site', 'Restaurant', 'restaurant', 'R', CURRENT_TIMESTAMP),
  ('cafeteria', 'site', 'Cafeteria', 'cafeteria', 'C', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

CREATE UNIQUE INDEX "Outlet_siteId_slug_key" ON "Outlet"("siteId", "slug");
CREATE UNIQUE INDEX "Outlet_siteId_orderPrefix_key" ON "Outlet"("siteId", "orderPrefix");
CREATE INDEX "Outlet_siteId_idx" ON "Outlet"("siteId");
CREATE INDEX "Outlet_isActive_idx" ON "Outlet"("isActive");

ALTER TABLE "Outlet"
ADD CONSTRAINT "Outlet_siteId_fkey"
FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "OutletSettings" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "dealDefaultDiscountPct" DECIMAL(5,2),
    "menuDisplayName" TEXT,
    "paymentConfigJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutletSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OutletSettings_outletId_key" ON "OutletSettings"("outletId");

ALTER TABLE "OutletSettings"
ADD CONSTRAINT "OutletSettings_outletId_fkey"
FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "OutletSettings" ("id", "outletId", "createdAt", "updatedAt")
VALUES
  ('restaurant-settings', 'restaurant', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cafeteria-settings', 'cafeteria', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("outletId") DO NOTHING;

ALTER TABLE "Category" ADD COLUMN "outletId" TEXT NOT NULL DEFAULT 'restaurant';
DROP INDEX IF EXISTS "Category_slug_key";
CREATE UNIQUE INDEX "Category_outletId_slug_key" ON "Category"("outletId", "slug");
CREATE INDEX "Category_outletId_idx" ON "Category"("outletId");
ALTER TABLE "Category"
ADD CONSTRAINT "Category_outletId_fkey"
FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MenuItem" ADD COLUMN "outletId" TEXT NOT NULL DEFAULT 'restaurant';
CREATE INDEX "MenuItem_outletId_idx" ON "MenuItem"("outletId");
ALTER TABLE "MenuItem"
ADD CONSTRAINT "MenuItem_outletId_fkey"
FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Order"
ADD COLUMN "outletId" TEXT NOT NULL DEFAULT 'restaurant',
ADD COLUMN "businessDate" TIMESTAMP(3),
ADD COLUMN "sequenceNumber" INTEGER,
ADD COLUMN "displayOrderNumber" TEXT;
CREATE INDEX "Order_outletId_idx" ON "Order"("outletId");
CREATE UNIQUE INDEX "Order_outletId_businessDate_sequenceNumber_key"
ON "Order"("outletId", "businessDate", "sequenceNumber");
ALTER TABLE "Order"
ADD CONSTRAINT "Order_outletId_fkey"
FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentTransaction"
ADD COLUMN "outletId" TEXT NOT NULL DEFAULT 'restaurant',
ADD COLUMN "finalizedAt" TIMESTAMP(3),
ADD COLUMN "finalizedOrderId" TEXT,
ADD COLUMN "refundState" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN "refundIdempotencyKey" TEXT;
CREATE UNIQUE INDEX "PaymentTransaction_finalizedOrderId_key" ON "PaymentTransaction"("finalizedOrderId");
CREATE UNIQUE INDEX "PaymentTransaction_refundIdempotencyKey_key" ON "PaymentTransaction"("refundIdempotencyKey");
CREATE INDEX "PaymentTransaction_outletId_idx" ON "PaymentTransaction"("outletId");
ALTER TABLE "PaymentTransaction"
ADD CONSTRAINT "PaymentTransaction_outletId_fkey"
FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MenuAuditLog" ADD COLUMN "outletId" TEXT NOT NULL DEFAULT 'restaurant';
CREATE INDEX "MenuAuditLog_outletId_idx" ON "MenuAuditLog"("outletId");
ALTER TABLE "MenuAuditLog"
ADD CONSTRAINT "MenuAuditLog_outletId_fkey"
FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MenuRevision"
ADD COLUMN "siteId" TEXT NOT NULL DEFAULT 'site',
ADD COLUMN "outletId" TEXT NOT NULL DEFAULT 'restaurant';
CREATE INDEX "MenuRevision_siteId_idx" ON "MenuRevision"("siteId");
CREATE INDEX "MenuRevision_outletId_idx" ON "MenuRevision"("outletId");
ALTER TABLE "MenuRevision"
ADD CONSTRAINT "MenuRevision_siteId_fkey"
FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MenuRevision"
ADD CONSTRAINT "MenuRevision_outletId_fkey"
FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MenuHistoryState" ADD COLUMN "outletId" TEXT NOT NULL DEFAULT 'restaurant';
CREATE UNIQUE INDEX "MenuHistoryState_outletId_key" ON "MenuHistoryState"("outletId");
ALTER TABLE "MenuHistoryState"
ADD CONSTRAINT "MenuHistoryState_outletId_fkey"
FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AppSettings" ADD COLUMN "siteId" TEXT NOT NULL DEFAULT 'site';
CREATE INDEX "AppSettings_siteId_idx" ON "AppSettings"("siteId");
ALTER TABLE "AppSettings"
ADD CONSTRAINT "AppSettings_siteId_fkey"
FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "OutletDailyOrderSequence" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "businessDate" TIMESTAMP(3) NOT NULL,
    "nextSequence" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutletDailyOrderSequence_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OutletDailyOrderSequence_outletId_businessDate_key"
ON "OutletDailyOrderSequence"("outletId", "businessDate");
ALTER TABLE "OutletDailyOrderSequence"
ADD CONSTRAINT "OutletDailyOrderSequence_outletId_fkey"
FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "siteRole" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");
CREATE INDEX "AdminUser_siteRole_idx" ON "AdminUser"("siteRole");
CREATE INDEX "AdminUser_isActive_idx" ON "AdminUser"("isActive");

CREATE TABLE "AdminUserOutletRole" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminUserOutletRole_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdminUserOutletRole_userId_outletId_key" ON "AdminUserOutletRole"("userId", "outletId");
CREATE INDEX "AdminUserOutletRole_outletId_role_idx" ON "AdminUserOutletRole"("outletId", "role");
ALTER TABLE "AdminUserOutletRole"
ADD CONSTRAINT "AdminUserOutletRole_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdminUserOutletRole"
ADD CONSTRAINT "AdminUserOutletRole_outletId_fkey"
FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AdminSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ipHash" TEXT,

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdminSession_tokenHash_key" ON "AdminSession"("tokenHash");
CREATE INDEX "AdminSession_userId_idx" ON "AdminSession"("userId");
CREATE INDEX "AdminSession_expiresAt_idx" ON "AdminSession"("expiresAt");
CREATE INDEX "AdminSession_revokedAt_idx" ON "AdminSession"("revokedAt");
ALTER TABLE "AdminSession"
ADD CONSTRAINT "AdminSession_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL DEFAULT 'site',
    "outletId" TEXT,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "isSharedAcrossOutlets" BOOLEAN NOT NULL DEFAULT false,
    "secretHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "lastIpHash" TEXT,
    "lastUserAgent" TEXT,
    "rotatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Device_siteId_idx" ON "Device"("siteId");
CREATE INDEX "Device_outletId_idx" ON "Device"("outletId");
CREATE INDEX "Device_role_idx" ON "Device"("role");
CREATE INDEX "Device_isActive_idx" ON "Device"("isActive");
ALTER TABLE "Device"
ADD CONSTRAINT "Device_siteId_fkey"
FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Device"
ADD CONSTRAINT "Device_outletId_fkey"
FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "DeviceOutletAccess" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceOutletAccess_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeviceOutletAccess_deviceId_outletId_key" ON "DeviceOutletAccess"("deviceId", "outletId");
CREATE INDEX "DeviceOutletAccess_outletId_idx" ON "DeviceOutletAccess"("outletId");
ALTER TABLE "DeviceOutletAccess"
ADD CONSTRAINT "DeviceOutletAccess_deviceId_fkey"
FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeviceOutletAccess"
ADD CONSTRAINT "DeviceOutletAccess_outletId_fkey"
FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DeviceSession" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ipHash" TEXT,

    CONSTRAINT "DeviceSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeviceSession_tokenHash_key" ON "DeviceSession"("tokenHash");
CREATE INDEX "DeviceSession_deviceId_idx" ON "DeviceSession"("deviceId");
CREATE INDEX "DeviceSession_expiresAt_idx" ON "DeviceSession"("expiresAt");
CREATE INDEX "DeviceSession_revokedAt_idx" ON "DeviceSession"("revokedAt");
ALTER TABLE "DeviceSession"
ADD CONSTRAINT "DeviceSession_deviceId_fkey"
FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AuthAuditLog" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "actorLabel" TEXT,
    "targetType" TEXT,
    "targetId" TEXT,
    "targetLabel" TEXT,
    "siteId" TEXT NOT NULL DEFAULT 'site',
    "outletId" TEXT,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthAuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuthAuditLog_createdAt_idx" ON "AuthAuditLog"("createdAt");
CREATE INDEX "AuthAuditLog_eventType_idx" ON "AuthAuditLog"("eventType");
CREATE INDEX "AuthAuditLog_actorType_actorId_idx" ON "AuthAuditLog"("actorType", "actorId");
CREATE INDEX "AuthAuditLog_targetType_targetId_idx" ON "AuthAuditLog"("targetType", "targetId");
ALTER TABLE "AuthAuditLog"
ADD CONSTRAINT "AuthAuditLog_siteId_fkey"
FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuthAuditLog"
ADD CONSTRAINT "AuthAuditLog_outletId_fkey"
FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectKeyHash" TEXT NOT NULL,
    "ipHash" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "succeeded" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LoginAttempt_subjectType_subjectKeyHash_attemptedAt_idx"
ON "LoginAttempt"("subjectType", "subjectKeyHash", "attemptedAt");
CREATE INDEX "LoginAttempt_ipHash_attemptedAt_idx"
ON "LoginAttempt"("ipHash", "attemptedAt");
