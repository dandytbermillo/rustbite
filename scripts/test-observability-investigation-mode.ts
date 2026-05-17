/* eslint-disable no-console */
//
// Scope (per chosen "deterministic + structural guarantee" strategy):
// Covers the deterministic surface. Failure paths are guaranteed by structure,
// not faked here, and intentionally NOT asserted (would need a prod test-seam,
// barred, or a contrived mechanism that could pass for the wrong reason):
//   - gate read error/timeout -> fail closed: try/catch + withReadTimeout in
//     investigation-mode.ts readInvestigationModeGate.
//   - enable audit failure -> rollback: single prisma.$transaction wrapping
//     upsert + writeAuthAudit in enableInvestigationMode.
//   - disable audit failure -> fail safe: clear committed first, audit in a
//     separate try/catch in disableInvestigationMode.
//
// Server-only shim: investigation-mode.ts / production-auth.ts do
// `import "server-only"`, which throws when loaded outside an RSC. Same
// require.cache shim as test-observability-route-activation.ts (prior art).
//
// Run: npm run test:observability-investigation-mode

import "dotenv/config";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

function stubServerOnly(): void {
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

const PERMISSION = "admin.observability.investigationMode.manage" as const;
const SINGLETON_ID = "singleton";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function main() {
  stubServerOnly();
  const [{ prisma }, invMode, auth] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/observability/investigation-mode"),
    import("@/lib/production-auth"),
  ]);
  const {
    INVESTIGATION_MODE_GATE_READ_TIMEOUT_MS,
    clampInvestigationDurationMs,
    disableInvestigationMode,
    enableInvestigationMode,
    getInvestigationModeStatus,
    readInvestigationModeGate,
  } = invMode;
  const { adminHasPermission, ownerHasPermission, roleHasPermission } = auth;

  // ---- RBAC permission map (deterministic, real resolvers) ----
  assert(ownerHasPermission(PERMISSION), "OWNER must have investigation-mode permission");
  assert(adminHasPermission(PERMISSION), "ADMIN must have investigation-mode permission");
  assert(!roleHasPermission("MANAGER", PERMISSION), "MANAGER must NOT have it");
  assert(!roleHasPermission("OPERATOR", PERMISSION), "OPERATOR must NOT have it");
  assert(!roleHasPermission("VIEWER", PERMISSION), "VIEWER must NOT have it");

  // ---- duration clamp (incl. the 0.5 -> 1min regression) ----
  assert(clampInvestigationDurationMs(0.5) === 60_000, "0.5min must floor to 1min (no immediate expiry)");
  assert(clampInvestigationDurationMs(undefined) === 60 * 60_000, "undefined -> 1h default");
  assert(clampInvestigationDurationMs(0) === 60 * 60_000, "0 -> default");
  assert(clampInvestigationDurationMs(-5) === 60 * 60_000, "negative -> default");
  assert(clampInvestigationDurationMs(30) === 30 * 60_000, "30 -> 30min");
  assert(clampInvestigationDurationMs(9999) === 4 * 60 * 60_000, ">240 -> 4h hard max");
  assert(INVESTIGATION_MODE_GATE_READ_TIMEOUT_MS === 500, "gate read timeout is 500ms");

  // Isolation: snapshot the shared singleton; restore exactly in finally.
  const beforeRow = await prisma.appSettings.findUnique({ where: { id: SINGLETON_ID } });
  const existedBefore = beforeRow !== null;
  const beforeUntil = beforeRow?.investigationModeUntil ?? null;
  const auditStart = new Date();

  try {
    // gate: past -> inactive
    await prisma.appSettings.upsert({
      where: { id: SINGLETON_ID },
      update: { investigationModeUntil: new Date(Date.now() - 60_000) },
      create: { id: SINGLETON_ID, investigationModeUntil: new Date(Date.now() - 60_000) },
    });
    assert(!(await readInvestigationModeGate()).active, "past until -> inactive");

    // gate: future -> active
    await prisma.appSettings.update({
      where: { id: SINGLETON_ID },
      data: { investigationModeUntil: new Date(Date.now() + 5 * 60_000) },
    });
    assert((await readInvestigationModeGate()).active, "future until -> active");

    // gate: null -> inactive (normal disabled)
    await prisma.appSettings.update({
      where: { id: SINGLETON_ID },
      data: { investigationModeUntil: null },
    });
    assert(!(await readInvestigationModeGate()).active, "null until -> inactive");

    // enable: persists setting + writes audit atomically
    const { until } = await enableInvestigationMode(null, 30);
    const afterEnable = await prisma.appSettings.findUniqueOrThrow({
      where: { id: SINGLETON_ID },
      select: { investigationModeUntil: true },
    });
    assert(
      afterEnable.investigationModeUntil?.getTime() === until.getTime(),
      "enable persists investigationModeUntil"
    );
    const status = await getInvestigationModeStatus();
    assert(status.active && status.until === until.toISOString(), "status active after enable");
    assert(
      (await prisma.authAuditLog.count({
        where: { eventType: "observability.investigation_mode.enabled", createdAt: { gte: auditStart } },
      })) >= 1,
      "enable writes an audit-log entry in the same transaction"
    );

    // disable: clears + audits; idempotent
    await disableInvestigationMode(null);
    const afterDisable = await prisma.appSettings.findUniqueOrThrow({
      where: { id: SINGLETON_ID },
      select: { investigationModeUntil: true },
    });
    assert(afterDisable.investigationModeUntil === null, "disable clears investigationModeUntil");
    assert(!(await getInvestigationModeStatus()).active, "status inactive after disable");
    assert(
      (await prisma.authAuditLog.count({
        where: { eventType: "observability.investigation_mode.disabled", createdAt: { gte: auditStart } },
      })) >= 1,
      "disable writes an audit-log entry"
    );
    await disableInvestigationMode(null); // idempotent: must not throw
  } finally {
    if (existedBefore) {
      await prisma.appSettings.updateMany({
        where: { id: SINGLETON_ID },
        data: { investigationModeUntil: beforeUntil },
      });
    } else {
      await prisma.appSettings.deleteMany({ where: { id: SINGLETON_ID } });
    }
    await prisma.authAuditLog.deleteMany({
      where: {
        eventType: {
          in: [
            "observability.investigation_mode.enabled",
            "observability.investigation_mode.disabled",
          ],
        },
        createdAt: { gte: auditStart },
      },
    });
    await prisma.$disconnect().catch(() => {});
  }

  console.log("Investigation-mode tests passed.");
}

main().catch((err) => {
  console.error("Investigation-mode tests failed.");
  console.error(err);
  process.exitCode = 1;
});
