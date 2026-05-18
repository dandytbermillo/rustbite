/* eslint-disable no-console */
// Synthetic fixtures + exclusion tests.
//
// Scope (deterministic + structural-guarantee strategy):
// Asserts: predicate helpers; seed idempotency / genuine rotation / policy
// (by spawning the real seed script — no seam, no fake); lib display +
// validation exclusion. The by-id ROUTE guard (the shared
// `syntheticByIdNotFound()` from synthetic-route-guard.ts, called by all 3
// audited routes: devices/[id], .../active, .../rotate) is structurally
// verified, NOT exercised here — doing so would need an admin-auth test
// seam (barred). Outlet by-id mutation routes: audited, NONE exist.
//
// Server-only shim: device/admin libs `import "server-only"`. Same
// require.cache shim as the other observability tests.
//
// REQUIRES the isSynthetic migration applied. Run:
//   npm run test:observability-synthetic-fixtures
import "dotenv/config";
import { createRequire } from "module";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);

function stubServerOnly(): void {
  const p = require.resolve("server-only");
  require.cache[p] = {
    id: p,
    filename: p,
    loaded: true,
    exports: {},
    children: [],
    paths: [],
  } as unknown as NodeJS.Module;
}

const CODE_A = "synthetic-monitor-code-AAAA-0123456789"; // >= 14
const CODE_B = "synthetic-monitor-code-BBBB-9876543210";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function runSeed(code: string) {
  execFileSync("npx", ["tsx", "scripts/seed-synthetic-fixtures.ts"], {
    env: { ...process.env, SYNTHETIC_DEVICE_ACCESS_CODE: code },
    stdio: "pipe",
  });
}

async function main() {
  stubServerOnly();
  const [
    { prisma },
    fixtures,
    adminUsers,
    deviceMgmt,
    adminActiveOutlet,
  ] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/observability/synthetic-fixtures"),
    import("@/lib/admin-user-management"),
    import("@/lib/device-management"),
    import("@/lib/admin-active-outlet"),
  ]);
  const {
    SYNTHETIC_OUTLET_ID,
    SYNTHETIC_DEVICE_ID,
    syntheticExcludeWhere,
    syntheticOnlyWhere,
    isSyntheticRow,
  } = fixtures;

  // ---- pure predicate ----
  assert(syntheticExcludeWhere().isSynthetic === false, "exclude => isSynthetic:false");
  assert(syntheticOnlyWhere().isSynthetic === true, "only => isSynthetic:true");
  assert(isSyntheticRow({ isSynthetic: true }), "flag true => synthetic");
  assert(isSyntheticRow({ id: SYNTHETIC_DEVICE_ID }), "synthetic id => synthetic");
  assert(!isSyntheticRow({ id: "real", isSynthetic: false }), "real row => not synthetic");
  assert(!isSyntheticRow(null), "null => not synthetic");

  // ---- policy: short code fails fast (seed exits non-zero) ----
  let policyFailed = false;
  try {
    runSeed("short");
  } catch {
    policyFailed = true;
  }
  assert(policyFailed, "sub-14-char access code must fail fast");

  // snapshot synthetic rows for restore
  const beforeDevice = await prisma.device.findUnique({
    where: { id: SYNTHETIC_DEVICE_ID },
    select: { secretHash: true },
  });

  try {
    // ---- seed + flags ----
    runSeed(CODE_A);
    const o = await prisma.outlet.findUniqueOrThrow({
      where: { id: SYNTHETIC_OUTLET_ID },
      select: { isSynthetic: true, isActive: true },
    });
    const d = await prisma.device.findUniqueOrThrow({
      where: { id: SYNTHETIC_DEVICE_ID },
      select: { isSynthetic: true, role: true, isSharedAcrossOutlets: true, secretHash: true },
    });
    assert(o.isSynthetic && d.isSynthetic, "seed sets isSynthetic on outlet+device");
    assert(d.role === "kiosk" && !d.isSharedAcrossOutlets, "device is kiosk, non-shared");

    // ---- credential idempotency: re-seed same code => secretHash UNCHANGED ----
    const hash1 = d.secretHash;
    await prisma.deviceSession.create({
      data: {
        deviceId: SYNTHETIC_DEVICE_ID,
        tokenHash: `synthetic-test-token-${Date.now()}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    runSeed(CODE_A);
    const d2 = await prisma.device.findUniqueOrThrow({
      where: { id: SYNTHETIC_DEVICE_ID },
      select: { secretHash: true },
    });
    assert(d2.secretHash === hash1, "same code => secretHash unchanged (no forced rotation)");
    assert(
      (await prisma.deviceSession.count({
        where: { deviceId: SYNTHETIC_DEVICE_ID, revokedAt: null },
      })) === 1,
      "same code => active session NOT revoked"
    );

    // ---- genuine rotation: changed code => hash changes + sessions revoked ----
    runSeed(CODE_B);
    const d3 = await prisma.device.findUniqueOrThrow({
      where: { id: SYNTHETIC_DEVICE_ID },
      select: { secretHash: true },
    });
    assert(d3.secretHash !== hash1, "changed code => secretHash rotated");
    assert(
      (await prisma.deviceSession.count({
        where: { deviceId: SYNTHETIC_DEVICE_ID, revokedAt: null },
      })) === 0,
      "changed code => prior sessions soft-revoked (revokedAt set, not deleted)"
    );

    // ---- display exclusion ----
    const outlets = await adminUsers.listAdminOutlets();
    assert(
      !outlets.some((r) => r.id === SYNTHETIC_OUTLET_ID),
      "listAdminOutlets hides synthetic outlet"
    );
    const devices = await deviceMgmt.listDevices();
    assert(
      !devices.some((r) => r.id === SYNTHETIC_DEVICE_ID),
      "listDevices hides synthetic device"
    );

    // Active-outlet resolution must reject the synthetic id (the internal
    // findActiveOutlet filter) and fall back. "All outlets" is the distinct
    // marker of the "preferred outlet not found ⇒ fell back" branch; if the
    // synthetic outlet leaked through it would resolve to its own id/name.
    const resolved = await adminActiveOutlet.resolveAdminActiveOutlet(
      { siteRole: "OWNER" } as never,
      undefined,
      SYNTHETIC_OUTLET_ID
    );
    assert(
      resolved.status === "active" &&
        resolved.outletId !== SYNTHETIC_OUTLET_ID &&
        resolved.outletName === "All outlets",
      "resolveAdminActiveOutlet rejects synthetic outlet id and falls back"
    );

    // ---- validation exclusion ----
    const roleCheck = await adminUsers.assertKnownOutletRoles([
      { outletId: SYNTHETIC_OUTLET_ID, role: "MANAGER" },
    ]);
    assert(!roleCheck.ok, "assertKnownOutletRoles rejects synthetic outlet");
    const direct = await deviceMgmt.validateDeviceAssignment({
      role: "kiosk",
      isSharedAcrossOutlets: false,
      outletId: SYNTHETIC_OUTLET_ID,
      sharedOutletIds: [],
    });
    assert(!direct.ok, "validateDeviceAssignment rejects synthetic as direct outlet");
    // role "counter" (NOT kiosk): kiosk+shared short-circuits on
    // "Kiosk devices must belong to one outlet" before the synthetic check,
    // which would make this pass for the wrong reason.
    const shared = await deviceMgmt.validateDeviceAssignment({
      role: "counter",
      isSharedAcrossOutlets: true,
      outletId: null,
      sharedOutletIds: [SYNTHETIC_OUTLET_ID],
    });
    assert(
      !shared.ok && /shared outlets are invalid/i.test(shared.error),
      "validateDeviceAssignment rejects synthetic as shared outlet (for the right reason)"
    );
  } finally {
    await prisma.deviceSession.deleteMany({ where: { deviceId: SYNTHETIC_DEVICE_ID } });
    if (beforeDevice) {
      await prisma.device.update({
        where: { id: SYNTHETIC_DEVICE_ID },
        data: { secretHash: beforeDevice.secretHash },
      });
    }
    await prisma.$disconnect().catch(() => {});
  }

  console.log("Synthetic fixtures tests passed.");
}

main().catch((error) => {
  console.error("Synthetic fixtures tests failed.");
  console.error(error);
  process.exitCode = 1;
});
