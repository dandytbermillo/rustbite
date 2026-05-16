ALTER TABLE "AdminUser"
  ADD COLUMN "mfaSecretCiphertext" TEXT,
  ADD COLUMN "mfaEnabledAt" TIMESTAMP(3);
