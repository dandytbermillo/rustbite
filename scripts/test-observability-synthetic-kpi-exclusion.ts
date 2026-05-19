/* eslint-disable no-console */
// #3 — synthetic auth/KPI exclusion. All assertions are GENUINE (exported
// APIs, no seam, non-vacuous sanity checks):
//
//  1. Login root cause — `authenticateDatabaseDevice("kiosk", <code>)`
//     returns null; synthetic absent from the kiosk auth candidate query
//     (sanity: a non-synthetic filter WOULD include it).
//  2. Existing-session kill — create a real synthetic DeviceSession via the
//     exported `createDeviceSession`, build the cookie via exported
//     `buildDatabaseDeviceSessionValue`, resolve via the exported
//     `getDeviceSessionFromCookieReader` (the SINGLE boundary used by both
//     order-api-auth and /api/menu) ⇒ null, even though the session is
//     unexpired/unrevoked. Sanity: a real kiosk device's session DOES
//     resolve (proves the synthetic null is the guard, not a broken path).
//
// Phase-B KPI relation-spread was verified-trimmed (all KPI queries are
// active-outlet-scoped; synthetic outlet unselectable + Phase A bars
// synthetic orders) — see the plan; only buildDeviceFleet got the Device
// `isSynthetic:false` hedge.
//
// Server-only shim: device libs import server-only. Requires the #2
// migration applied. Run: npm run test:observability-synthetic-kpi-exclusion
import "dotenv/config";
import { createRequire } from "module";
import { execFileSync } from "node:child_process";
import { NextRequest } from "next/server";

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

const CODE = "synthetic-kpi-test-code-0123456789"; // >= 14 chars

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function main() {
  stubServerOnly();
  const [{ prisma }, deviceSessions, deviceAuth, fixtures] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/device-sessions"),
    import("@/lib/device-auth"),
    import("@/lib/observability/synthetic-fixtures"),
  ]);
  const { SYNTHETIC_DEVICE_ID, syntheticExcludeWhere } = fixtures;

  execFileSync("npx", ["tsx", "scripts/seed-synthetic-fixtures.ts"], {
    env: { ...process.env, SYNTHETIC_DEVICE_ACCESS_CODE: CODE },
    stdio: "pipe",
  });

  const req = new NextRequest("http://localhost/");
  const cookieReader = (value: string) => ({
    get: (name: string) =>
      name === deviceAuth.DEVICE_SESSION_COOKIE ? { value } : undefined,
  });
  let tempDeviceId: string | null = null;

  try {
    // --- 1. login root cause ---
    assert(
      (await deviceSessions.authenticateDatabaseDevice("kiosk", CODE)) === null,
      "synthetic device must NOT authenticate via authenticateDatabaseDevice"
    );
    const candidates = await prisma.device.findMany({
      where: { role: "kiosk", isActive: true, ...syntheticExcludeWhere() },
      select: { id: true },
    });
    assert(
      !candidates.some((d) => d.id === SYNTHETIC_DEVICE_ID),
      "synthetic device must be excluded from kiosk auth candidates"
    );
    const all = await prisma.device.findMany({
      where: { role: "kiosk", isActive: true },
      select: { id: true },
    });
    assert(
      all.some((d) => d.id === SYNTHETIC_DEVICE_ID),
      "synthetic device exists as an active kiosk (exclusion is non-vacuous)"
    );

    // --- 2. existing-session kill (genuine, no seam) ---
    const { token } = await deviceSessions.createDeviceSession(
      SYNTHETIC_DEVICE_ID,
      req
    );
    const synthActor = await deviceSessions.getDeviceSessionFromCookieReader(
      cookieReader(deviceAuth.buildDatabaseDeviceSessionValue("kiosk", token))
    );
    assert(
      synthActor === null,
      "existing synthetic DeviceSession must NOT authorize (kills order/menu/payment via the shared boundary)"
    );

    // sanity: a real kiosk device session DOES resolve — proves the null
    // above is the synthetic guard, not a broken resolution path.
    const realOutlet = await prisma.outlet.findFirst({
      where: { isActive: true, isSynthetic: false },
      select: { id: true },
    });
    assert(realOutlet, "expected a real active outlet for the sanity check");
    tempDeviceId = `synthetic-kpi-test-real-${Date.now()}`;
    await prisma.device.create({
      data: {
        id: tempDeviceId,
        siteId: "site",
        outletId: realOutlet.id,
        name: "kpi-test-real",
        role: "kiosk",
        isActive: true,
        isSharedAcrossOutlets: false,
        isSynthetic: false,
        secretHash: "x".repeat(40),
      },
    });
    const { token: realToken } = await deviceSessions.createDeviceSession(
      tempDeviceId,
      req
    );
    const realActor = await deviceSessions.getDeviceSessionFromCookieReader(
      cookieReader(deviceAuth.buildDatabaseDeviceSessionValue("kiosk", realToken))
    );
    assert(
      realActor !== null,
      "a real kiosk DeviceSession DOES resolve (synthetic null is the guard, not a broken path)"
    );
  } finally {
    const ids = [SYNTHETIC_DEVICE_ID, ...(tempDeviceId ? [tempDeviceId] : [])];
    await prisma.deviceSession
      .deleteMany({ where: { deviceId: { in: ids } } })
      .catch(() => {});
    if (tempDeviceId) {
      await prisma.device
        .delete({ where: { id: tempDeviceId } })
        .catch(() => {});
    }
    await prisma.$disconnect().catch(() => {});
  }

  console.log("Synthetic KPI/auth exclusion tests passed.");
}

main().catch((error) => {
  console.error("Synthetic KPI/auth exclusion tests failed.");
  console.error(error);
  process.exitCode = 1;
});
