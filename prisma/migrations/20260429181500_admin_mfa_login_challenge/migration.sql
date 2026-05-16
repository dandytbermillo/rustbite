CREATE TABLE "AdminMfaLoginChallenge" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "userAgent" TEXT,
  "ipHash" TEXT,

  CONSTRAINT "AdminMfaLoginChallenge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminMfaLoginChallenge_tokenHash_key"
  ON "AdminMfaLoginChallenge"("tokenHash");

CREATE INDEX "AdminMfaLoginChallenge_userId_idx"
  ON "AdminMfaLoginChallenge"("userId");

CREATE INDEX "AdminMfaLoginChallenge_expiresAt_idx"
  ON "AdminMfaLoginChallenge"("expiresAt");

CREATE INDEX "AdminMfaLoginChallenge_consumedAt_idx"
  ON "AdminMfaLoginChallenge"("consumedAt");

ALTER TABLE "AdminMfaLoginChallenge"
  ADD CONSTRAINT "AdminMfaLoginChallenge_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "AdminUser"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
