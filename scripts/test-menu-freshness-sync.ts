import assert from "node:assert/strict";
import { prisma } from "../src/lib/db";
import { getDeviceMenuOutletId } from "../src/lib/device-menu-outlet";
import { DEFAULT_SITE_ID } from "../src/lib/outlets";
import { writeMenuAuditAndRevision } from "../src/lib/menu-history";
import {
  bumpOutletMenuVersion,
  getOutletMenuVersion,
} from "../src/lib/outlet-menu-sync";

const outletId = `test-menu-sync-${Date.now()}`;
const concurrentOutletId = `${outletId}-concurrent`;

function makeActor(overrides: Partial<Parameters<typeof getDeviceMenuOutletId>[0]>) {
  return {
    sessionId: "session",
    deviceId: "device",
    name: "Kiosk",
    role: "kiosk" as const,
    outletId: "primary",
    isSharedAcrossOutlets: false,
    allowedOutletIds: ["primary", "secondary"],
    isLegacy: false,
    activeOutletId: null,
    activeStaffUserId: null,
    activeStaffDisplayName: null,
    activeStaffAccountType: null,
    activeStaffOutletId: null,
    activeStaffRole: null,
    activeStaffVerifiedAt: null,
    activeStaffLastActionAt: null,
    ...overrides,
  };
}

async function main() {
  assert.equal(getDeviceMenuOutletId(makeActor({})), "primary");
  assert.equal(
    getDeviceMenuOutletId(makeActor({ activeOutletId: "secondary" })),
    "secondary"
  );
  assert.equal(
    getDeviceMenuOutletId(makeActor({ activeOutletId: "other" })),
    "primary"
  );
  assert.equal(
    getDeviceMenuOutletId(
      makeActor({ outletId: null, activeOutletId: null, allowedOutletIds: ["secondary"] })
    ),
    "secondary"
  );

  await prisma.site.upsert({
    where: { id: DEFAULT_SITE_ID },
    update: {},
    create: {
      id: DEFAULT_SITE_ID,
      name: "Rushbite",
    },
  });

  await prisma.outlet.create({
    data: {
      id: outletId,
      siteId: DEFAULT_SITE_ID,
      name: "Menu Sync Test",
      slug: outletId,
      orderPrefix: `T${String(Date.now()).slice(-5)}`,
    },
  });
  await prisma.outlet.create({
    data: {
      id: concurrentOutletId,
      siteId: DEFAULT_SITE_ID,
      name: "Menu Sync Concurrent Test",
      slug: concurrentOutletId,
      orderPrefix: `C${String(Date.now()).slice(-5)}`,
    },
  });

  const baseline = await getOutletMenuVersion(prisma, outletId);
  assert.equal(baseline.outletId, outletId);
  assert.equal(baseline.revision, 1);

  const firstBump = await prisma.$transaction((tx) =>
    bumpOutletMenuVersion(tx, outletId)
  );
  assert.equal(firstBump.revision, 2);

  await assert.rejects(
    prisma.$transaction(async (tx) => {
      await bumpOutletMenuVersion(tx, outletId);
      throw new Error("rollback");
    }),
    /rollback/
  );
  const afterRollback = await getOutletMenuVersion(prisma, outletId);
  assert.equal(afterRollback.revision, 2);

  await prisma.$transaction((tx) =>
    writeMenuAuditAndRevision(tx, {
      actionType: "CATEGORY_CREATED",
      targetType: "CATEGORY",
      outletId,
      targetId: "test-category",
      targetLabel: "Test Category",
      afterPayload: { ok: true },
    })
  );
  const afterAudit = await getOutletMenuVersion(prisma, outletId);
  assert.equal(afterAudit.revision, 3);
  assert.ok(Date.parse(afterAudit.updatedAt) > 0);

  const concurrentBaseline = await getOutletMenuVersion(prisma, concurrentOutletId);
  assert.equal(concurrentBaseline.revision, 1);

  const concurrentBumps = await Promise.all([
    prisma.$transaction((tx) => bumpOutletMenuVersion(tx, concurrentOutletId)),
    prisma.$transaction((tx) => bumpOutletMenuVersion(tx, concurrentOutletId)),
  ]);
  assert.deepEqual(
    concurrentBumps.map((version) => version.revision).sort((a, b) => a - b),
    [2, 3]
  );
  const afterConcurrentBumps = await getOutletMenuVersion(
    prisma,
    concurrentOutletId
  );
  assert.equal(afterConcurrentBumps.revision, 3);
}

async function cleanup() {
  const outletIds = [outletId, concurrentOutletId];
  await prisma.menuHistoryState.deleteMany({ where: { outletId: { in: outletIds } } });
  await prisma.menuRevision.deleteMany({ where: { outletId: { in: outletIds } } });
  await prisma.menuAuditLog.deleteMany({ where: { outletId: { in: outletIds } } });
  await prisma.outletMenuVersion.deleteMany({ where: { outletId: { in: outletIds } } });
  await prisma.outlet.deleteMany({ where: { id: { in: outletIds } } });
}

main()
  .then(async () => {
    await cleanup();
    console.log("Menu freshness sync tests passed.");
  })
  .catch(async (err) => {
    await cleanup().catch(() => {});
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
