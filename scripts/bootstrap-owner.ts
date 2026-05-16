import { PrismaClient } from "@prisma/client";
import {
  hashAdminPassword,
  validateAdminPasswordPolicy,
} from "../src/lib/admin-passwords";

const prisma = new PrismaClient();

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function normalizeAdminEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function main() {
  const email = normalizeAdminEmail(requiredEnv("ADMIN_BOOTSTRAP_EMAIL"));
  const displayName =
    process.env.ADMIN_BOOTSTRAP_NAME?.trim() || email.split("@")[0] || "Owner";
  const password = requiredEnv("ADMIN_BOOTSTRAP_PASSWORD");
  const policy = validateAdminPasswordPolicy(password);
  if (!policy.ok) throw new Error(policy.error);

  const passwordHash = await hashAdminPassword(password);

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('rushbite-owner-bootstrap'))`;

    const existingOwnerCount = await tx.adminUser.count({
      where: {
        isActive: true,
        accountType: "OWNER",
      },
    });
    if (existingOwnerCount > 0) {
      return { created: false as const, reason: "active_owner_exists" };
    }

    const user = await tx.adminUser.upsert({
      where: { email },
      update: {
        displayName,
        passwordHash,
        accountType: "OWNER",
        siteRole: "OWNER",
        isActive: true,
        passwordChangedAt: new Date(),
      },
      create: {
        email,
        displayName,
        passwordHash,
        accountType: "OWNER",
        siteRole: "OWNER",
        isActive: true,
        passwordChangedAt: new Date(),
      },
      select: { id: true, email: true },
    });

    await tx.authAuditLog.create({
      data: {
        eventType: "OWNER_BOOTSTRAPPED",
        actorType: "SYSTEM",
        targetType: "ADMIN_USER",
        targetId: user.id,
        targetLabel: user.email,
      },
    });

    return { created: true as const, email: user.email };
  });

  if (result.created) {
    console.log(`Created owner admin: ${result.email}`);
  } else {
    console.log("Owner bootstrap skipped: an active owner already exists.");
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
