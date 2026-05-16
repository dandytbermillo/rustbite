import "server-only";
import type { Prisma } from "@prisma/client";

export async function resetAdminUserMfa(
  tx: Prisma.TransactionClient,
  userId: string
) {
  await tx.adminUser.update({
    where: { id: userId },
    data: {
      mfaSecretCiphertext: null,
      mfaEnabledAt: null,
    },
  });
  await Promise.all([
    tx.adminMfaRecoveryCode.deleteMany({ where: { userId } }),
    tx.adminMfaLoginChallenge.deleteMany({ where: { userId } }),
  ]);
}
