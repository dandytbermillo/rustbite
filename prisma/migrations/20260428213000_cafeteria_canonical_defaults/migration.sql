ALTER TABLE "Category" ALTER COLUMN "outletId" SET DEFAULT 'cafeteria';
ALTER TABLE "MenuItem" ALTER COLUMN "outletId" SET DEFAULT 'cafeteria';
ALTER TABLE "Order" ALTER COLUMN "outletId" SET DEFAULT 'cafeteria';
ALTER TABLE "PaymentTransaction" ALTER COLUMN "outletId" SET DEFAULT 'cafeteria';
ALTER TABLE "MenuAuditLog" ALTER COLUMN "outletId" SET DEFAULT 'cafeteria';
ALTER TABLE "MenuRevision" ALTER COLUMN "outletId" SET DEFAULT 'cafeteria';
ALTER TABLE "MenuHistoryState" ALTER COLUMN "outletId" SET DEFAULT 'cafeteria';
