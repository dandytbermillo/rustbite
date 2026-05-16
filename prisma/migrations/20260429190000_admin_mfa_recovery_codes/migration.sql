CREATE TABLE "AdminMfaRecoveryCode" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "usedAt" TIMESTAMP(3),

  CONSTRAINT "AdminMfaRecoveryCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminMfaRecoveryCode_codeHash_key"
  ON "AdminMfaRecoveryCode"("codeHash");

CREATE INDEX "AdminMfaRecoveryCode_userId_idx"
  ON "AdminMfaRecoveryCode"("userId");

CREATE INDEX "AdminMfaRecoveryCode_usedAt_idx"
  ON "AdminMfaRecoveryCode"("usedAt");

ALTER TABLE "AdminMfaRecoveryCode"
  ADD CONSTRAINT "AdminMfaRecoveryCode_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "AdminUser"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
