-- Daily display order numbers intentionally repeat across business dates.
-- Uniqueness is enforced by outletId + businessDate + sequenceNumber.
DROP INDEX IF EXISTS "Order_orderNumber_key";
