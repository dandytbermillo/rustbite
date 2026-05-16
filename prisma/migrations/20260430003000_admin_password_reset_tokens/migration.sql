CREATE TABLE "AdminPasswordResetToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "requestedIpHash" TEXT,
  "userAgent" TEXT,
  CONSTRAINT "AdminPasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminPasswordResetToken_tokenHash_key"
  ON "AdminPasswordResetToken"("tokenHash");

CREATE INDEX "AdminPasswordResetToken_userId_idx"
  ON "AdminPasswordResetToken"("userId");

CREATE INDEX "AdminPasswordResetToken_expiresAt_idx"
  ON "AdminPasswordResetToken"("expiresAt");

CREATE INDEX "AdminPasswordResetToken_usedAt_idx"
  ON "AdminPasswordResetToken"("usedAt");

ALTER TABLE "AdminPasswordResetToken"
  ADD CONSTRAINT "AdminPasswordResetToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "AdminUser"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
