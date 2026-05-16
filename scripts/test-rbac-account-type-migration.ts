/* eslint-disable no-console */
import { createRequire } from "module";
import { readFileSync } from "fs";
import { join } from "path";
import { NextRequest } from "next/server";
import "dotenv/config";
import { hashAdminPassword } from "@/lib/admin-passwords";
import { prisma } from "@/lib/db";

const require = createRequire(import.meta.url);
const runId = `rbac-migration-${Date.now()}`;
const outletId = `${runId}-outlet`;
const emails = {
  owner: `${runId}-owner@example.test`,
  staff: `${runId}-staff@example.test`,
  legacyAdmin: `${runId}-legacy-admin@example.test`,
};

type ColumnInfo = {
  column_name: string;
  is_nullable: "YES" | "NO";
};

type IndexInfo = {
  indexname: string;
  indexdef: string;
};

type CountRow = {
  count: number;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${String(expected)}, got ${String(actual)}.`);
  }
}

function assertIncludes(haystack: string, needle: string, message: string) {
  assert(haystack.includes(needle), message);
}

function stubServerOnly() {
  const serverOnlyPath = require.resolve("server-only");
  require.cache[serverOnlyPath] = {
    id: serverOnlyPath,
    filename: serverOnlyPath,
    loaded: true,
    exports: {},
    children: [],
    paths: [],
  } as unknown as NodeJS.Module;
}

function adminRequest(
  token: string,
  method: string,
  url: string,
  body?: Record<string, unknown>
) {
  return new NextRequest(url, {
    method,
    headers: {
      cookie: `rb_admin_session=${token}`,
      origin: "http://localhost",
      referer: "http://localhost/admin/users",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function cleanup() {
  const userRows = await prisma.adminUser.findMany({
    where: { email: { in: Object.values(emails) } },
    select: { id: true },
  });
  const userIds = userRows.map((row) => row.id);

  if (userIds.length > 0) {
    await prisma.pendingOwnerChangeCancelToken.deleteMany({
      where: { ownerUserId: { in: userIds } },
    });
    await prisma.pendingOwnerChange.deleteMany({
      where: {
        OR: [{ actorId: { in: userIds } }, { targetId: { in: userIds } }],
      },
    });
    await prisma.authEmailOutbox.deleteMany({
      where: { recipientEmail: { in: Object.values(emails) } },
    });
    await prisma.authAuditLog.deleteMany({
      where: {
        OR: [
          { actorId: { in: userIds } },
          { targetId: { in: userIds } },
          { actorLabel: { in: Object.values(emails) } },
          { targetLabel: { in: Object.values(emails) } },
        ],
      },
    });
    await prisma.adminUser.deleteMany({ where: { id: { in: userIds } } });
  }
  await prisma.outlet.deleteMany({ where: { id: outletId } });
}

async function ensureOutlet() {
  await prisma.site.upsert({
    where: { id: "site" },
    update: {},
    create: { id: "site", name: "Rushbite", timezone: "America/Edmonton" },
  });
  await prisma.outlet.upsert({
    where: { id: outletId },
    update: { isActive: true },
    create: {
      id: outletId,
      siteId: "site",
      name: `RBAC migration outlet ${runId}`,
      slug: outletId,
      orderPrefix: "M",
      isActive: true,
    },
  });
}

function assertMigrationSqlShape() {
  const migrationPath = join(
    process.cwd(),
    "prisma/migrations/20260429143000_rbac_account_type_transition/migration.sql"
  );
  const sql = readFileSync(migrationPath, "utf8");

  assertIncludes(
    sql,
    `Unknown AdminUser.siteRole value`,
    "Migration should fail closed on unknown legacy siteRole values."
  );
  assertIncludes(
    sql,
    `"siteRole" NOT IN ('OWNER', 'ADMIN')`,
    "Migration should allow only known legacy siteRole values."
  );
  assertIncludes(
    sql,
    `Unknown AdminUserOutletRole.role value`,
    "Migration should fail closed on unknown outlet role values."
  );
  assertIncludes(
    sql,
    `"role" NOT IN ('MANAGER', 'STAFF', 'OPERATOR', 'VIEWER')`,
    "Migration should explicitly account for legacy STAFF outlet roles."
  );
  assertIncludes(
    sql,
    `ALTER TABLE "AdminUser" ADD COLUMN "accountType" TEXT`,
    "Migration should add accountType before backfill."
  );
  assertIncludes(
    sql,
    `WHEN "siteRole" = 'OWNER' THEN 'OWNER'`,
    "Migration should backfill OWNER accountType from siteRole."
  );
  assertIncludes(
    sql,
    `WHEN "siteRole" = 'ADMIN' THEN 'ADMIN'`,
    "Migration should backfill ADMIN accountType from siteRole."
  );
  assertIncludes(
    sql,
    `ELSE 'STAFF'`,
    "Migration should backfill non-site users to STAFF."
  );
  assertIncludes(
    sql,
    `ALTER TABLE "AdminUser" ALTER COLUMN "accountType" SET NOT NULL`,
    "Migration should tighten accountType to NOT NULL only after backfill."
  );
  assertIncludes(
    sql,
    `SET "role" = 'OPERATOR'`,
    "Migration should rewrite legacy outlet STAFF role to OPERATOR."
  );
  assertIncludes(
    sql,
    `CREATE INDEX "AdminUser_accountType_idx"`,
    "Migration should index accountType."
  );
}

async function assertLiveSchemaAndDataInvariants() {
  const columns = await prisma.$queryRaw<ColumnInfo[]>`
    SELECT column_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'AdminUser'
      AND column_name IN ('accountType', 'siteRole')
  `;
  const byName = new Map(columns.map((column) => [column.column_name, column]));
  assertEqual(
    byName.get("accountType")?.is_nullable,
    "NO",
    "AdminUser.accountType should be NOT NULL after backfill."
  );
  assertEqual(
    byName.get("siteRole")?.is_nullable,
    "YES",
    "AdminUser.siteRole should remain nullable during rollback window."
  );

  const indexes = await prisma.$queryRaw<IndexInfo[]>`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename IN ('AdminUser', 'AdminUserOutletRole')
  `;
  const indexNames = new Set(indexes.map((index) => index.indexname));
  assert(indexNames.has("AdminUser_accountType_idx"), "accountType index should exist.");
  assert(indexNames.has("AdminUser_siteRole_idx"), "siteRole rollback index should still exist.");
  assert(
    indexNames.has("AdminUserOutletRole_userId_outletId_key"),
    "One-role-per-user-per-outlet unique index should exist."
  );

  const invalidAccountTypes = await prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(*)::int AS count
    FROM "AdminUser"
    WHERE "accountType" NOT IN ('OWNER', 'ADMIN', 'STAFF')
  `;
  assertEqual(invalidAccountTypes[0]?.count ?? 0, 0, "Unknown accountType rows should not exist.");

  const invalidSiteRoles = await prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(*)::int AS count
    FROM "AdminUser"
    WHERE "siteRole" IS NOT NULL
      AND "siteRole" NOT IN ('OWNER', 'ADMIN')
  `;
  assertEqual(invalidSiteRoles[0]?.count ?? 0, 0, "Unknown legacy siteRole rows should not exist.");

  const staleRollbackSiteRoles = await prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(*)::int AS count
    FROM "AdminUser"
    WHERE ("accountType" = 'OWNER' AND "siteRole" IS DISTINCT FROM 'OWNER')
       OR ("accountType" = 'ADMIN' AND "siteRole" IS DISTINCT FROM 'ADMIN')
       OR ("accountType" = 'STAFF' AND "siteRole" IS NOT NULL)
  `;
  assertEqual(
    staleRollbackSiteRoles[0]?.count ?? 0,
    0,
    "siteRole should remain dual-written for rollback compatibility."
  );

  const invalidOutletRoles = await prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(*)::int AS count
    FROM "AdminUserOutletRole"
    WHERE "role" NOT IN ('MANAGER', 'OPERATOR', 'VIEWER')
  `;
  assertEqual(invalidOutletRoles[0]?.count ?? 0, 0, "Unknown outlet roles should not exist.");

  const legacyOutletStaffRoles = await prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(*)::int AS count
    FROM "AdminUserOutletRole"
    WHERE "role" = 'STAFF'
  `;
  assertEqual(
    legacyOutletStaffRoles[0]?.count ?? 0,
    0,
    "Legacy AdminUserOutletRole.role=STAFF rows should be migrated to OPERATOR."
  );
}

async function assertRouteDualWriteCompatibility() {
  stubServerOnly();
  const [productionAuth, adminMfa, usersRoute, userRoute] = await Promise.all([
    import("@/lib/production-auth"),
    import("@/lib/admin-mfa"),
    import("@/app/api/admin/users/route"),
    import("@/app/api/admin/users/[id]/route"),
  ]);

  await ensureOutlet();
  const owner = await prisma.adminUser.create({
    data: {
      email: emails.owner,
      displayName: "RBAC Migration Owner",
      passwordHash: await hashAdminPassword("migration-owner-password-14chars"),
      accountType: "OWNER",
      siteRole: "OWNER",
      mfaSecretCiphertext: adminMfa.encryptMfaSecret(adminMfa.generateTotpSecret()),
      mfaEnabledAt: new Date(),
      isActive: true,
    },
  });
  const ownerToken = productionAuth.createSessionToken();
  await prisma.adminSession.create({
    data: {
      userId: owner.id,
      tokenHash: productionAuth.hashSessionToken(ownerToken),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      stepUpVerifiedAt: new Date(),
      stepUpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  const createStaff = await usersRoute.POST(
    adminRequest(ownerToken, "POST", "http://localhost/api/admin/users", {
      email: emails.staff,
      displayName: "RBAC Migration Staff",
      password: "migration-staff-password-14chars",
      accountType: "STAFF",
      outletRoles: [{ outletId, role: "STAFF" }],
    })
  );
  assertEqual(createStaff.status, 201, "Owner should create Staff user with legacy outlet role.");
  const staff = await prisma.adminUser.findUniqueOrThrow({
    where: { email: emails.staff },
    include: { outletRoles: true },
  });
  assertEqual(staff.accountType, "STAFF", "Created Staff accountType should persist.");
  assertEqual(staff.siteRole, null, "Created Staff siteRole should be null for rollback.");
  assertEqual(
    staff.outletRoles[0]?.role,
    "OPERATOR",
    "Legacy outlet role STAFF should normalize to OPERATOR at write time."
  );

  const createLegacyAdmin = await usersRoute.POST(
    adminRequest(ownerToken, "POST", "http://localhost/api/admin/users", {
      email: emails.legacyAdmin,
      displayName: "RBAC Legacy Admin",
      password: "migration-admin-password-14chars",
      siteRole: "ADMIN",
      outletRoles: [],
    })
  );
  assertEqual(createLegacyAdmin.status, 201, "Legacy siteRole payload should create Admin user.");
  const legacyAdmin = await prisma.adminUser.findUniqueOrThrow({
    where: { email: emails.legacyAdmin },
  });
  assertEqual(legacyAdmin.accountType, "ADMIN", "Legacy Admin payload should write accountType.");
  assertEqual(legacyAdmin.siteRole, "ADMIN", "Legacy Admin payload should dual-write siteRole.");

  const promoteStaff = await userRoute.PATCH(
    adminRequest(ownerToken, "PATCH", `http://localhost/api/admin/users/${staff.id}`, {
      displayName: "RBAC Migration Staff Promoted",
      accountType: "ADMIN",
      isActive: true,
      outletRoles: [],
    }),
    { params: Promise.resolve({ id: staff.id }) }
  );
  assertEqual(promoteStaff.status, 200, "Owner should promote Staff to Admin.");
  const promotedStaff = await prisma.adminUser.findUniqueOrThrow({
    where: { id: staff.id },
    include: { outletRoles: true },
  });
  assertEqual(promotedStaff.accountType, "ADMIN", "Promotion should write accountType=ADMIN.");
  assertEqual(promotedStaff.siteRole, "ADMIN", "Promotion should dual-write siteRole=ADMIN.");
  assertEqual(promotedStaff.outletRoles.length, 0, "Site Admin should not need outlet roles.");

  const demoteStaff = await userRoute.PATCH(
    adminRequest(ownerToken, "PATCH", `http://localhost/api/admin/users/${staff.id}`, {
      displayName: "RBAC Migration Staff Demoted",
      siteRole: null,
      isActive: true,
      outletRoles: [{ outletId, role: "MANAGER" }],
    }),
    { params: Promise.resolve({ id: staff.id }) }
  );
  assertEqual(demoteStaff.status, 200, "Owner should demote Admin back to Staff.");
  const demotedStaff = await prisma.adminUser.findUniqueOrThrow({
    where: { id: staff.id },
    include: { outletRoles: true },
  });
  assertEqual(demotedStaff.accountType, "STAFF", "Null siteRole payload should write Staff.");
  assertEqual(demotedStaff.siteRole, null, "Staff demotion should dual-write null siteRole.");
  assertEqual(demotedStaff.outletRoles[0]?.role, "MANAGER", "Staff outlet role should persist.");
}

async function main() {
  await cleanup();
  assertMigrationSqlShape();
  await assertLiveSchemaAndDataInvariants();
  await assertRouteDualWriteCompatibility();
  await assertLiveSchemaAndDataInvariants();
  console.log("RBAC account-type migration safety tests passed.");
}

main()
  .catch((error) => {
    console.error("RBAC account-type migration safety tests failed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((error) => {
      console.error("Cleanup failed.");
      console.error(error);
      process.exitCode = 1;
    });
    await prisma.$disconnect();
  });
