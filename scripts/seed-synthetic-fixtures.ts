/* eslint-disable no-console */
// Idempotent synthetic-monitor fixtures (outlet + device). SEPARATE from
// prisma/seed.ts (which early-returns on populated DBs). Safe to run in any
// env. The ONLY path allowed to maintain the synthetic device/outlet —
// admin APIs reject them by-id (404).
//
// Credential idempotency: Argon2 uses a fresh salt per hash, so naive
// re-hash = forced rotation every run. We verify the existing hash against
// the configured code first and only rotate (rehash + revoke sessions) on
// a real mismatch.
//
// Run: npm run db:seed:synthetic   (requires SYNTHETIC_DEVICE_ACCESS_CODE)
import "dotenv/config";
import { prisma } from "@/lib/db";
import {
  hashAdminPassword,
  validateAdminPasswordPolicy,
  verifyAdminPassword,
} from "@/lib/admin-passwords";
import {
  SYNTHETIC_DEVICE_ACCESS_CODE_ENV,
  SYNTHETIC_DEVICE_ID,
  SYNTHETIC_OUTLET_ID,
} from "@/lib/observability/synthetic-fixtures";

async function main() {
  const code = process.env[SYNTHETIC_DEVICE_ACCESS_CODE_ENV];
  if (!code) {
    throw new Error(
      `${SYNTHETIC_DEVICE_ACCESS_CODE_ENV} must be set to seed the synthetic device.`
    );
  }
  const policy = validateAdminPasswordPolicy(code);
  if (!policy.ok) {
    throw new Error(
      `${SYNTHETIC_DEVICE_ACCESS_CODE_ENV} invalid: ${policy.error}`
    );
  }

  await prisma.site.upsert({
    where: { id: "site" },
    update: {},
    create: { id: "site", name: "Rushbite", timezone: "America/Edmonton" },
  });

  // Deterministic ⇒ naturally idempotent.
  await prisma.outlet.upsert({
    where: { id: SYNTHETIC_OUTLET_ID },
    update: { isSynthetic: true, isActive: true },
    create: {
      id: SYNTHETIC_OUTLET_ID,
      siteId: "site",
      name: "Synthetic Monitor",
      slug: "synthetic-monitor",
      orderPrefix: "SYN",
      isActive: true,
      isSynthetic: true,
    },
  });

  const existing = await prisma.device.findUnique({
    where: { id: SYNTHETIC_DEVICE_ID },
    select: { id: true, secretHash: true },
  });

  const deviceShape = {
    isSynthetic: true,
    isActive: true,
    role: "kiosk",
    isSharedAcrossOutlets: false,
    outletId: SYNTHETIC_OUTLET_ID,
  } as const;

  if (!existing) {
    await prisma.device.create({
      data: {
        id: SYNTHETIC_DEVICE_ID,
        siteId: "site",
        name: "Synthetic Monitor Device",
        secretHash: await hashAdminPassword(code),
        ...deviceShape,
      },
    });
    console.log("Synthetic device created.");
  } else if (await verifyAdminPassword(existing.secretHash, code)) {
    // Code unchanged ⇒ DO NOT re-hash / revoke. Only reassert flags
    // (deterministic, no churn).
    await prisma.device.update({
      where: { id: SYNTHETIC_DEVICE_ID },
      data: deviceShape,
    });
    console.log("Synthetic device unchanged (code matches; no rotation).");
  } else {
    // Mirror the device rotate route: hash outside the tx (Argon2 is heavy),
    // then atomically soft-revoke active sessions (revokedAt) + rotate the
    // secret. No audit entry — this is a maintenance script, not an
    // admin-initiated action (no actor).
    const newHash = await hashAdminPassword(code);
    const now = new Date();
    const revokedCount = await prisma.$transaction(async (tx) => {
      const revoked = await tx.deviceSession.updateMany({
        where: { deviceId: SYNTHETIC_DEVICE_ID, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.device.update({
        where: { id: SYNTHETIC_DEVICE_ID },
        data: { secretHash: newHash, rotatedAt: now, ...deviceShape },
      });
      return revoked.count;
    });
    console.log(
      `Synthetic device credential rotated; revoked ${revokedCount} session(s).`
    );
  }

  console.log("Synthetic fixtures seeded.");
}

main()
  .catch((error) => {
    console.error("Synthetic fixture seed failed.");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
