import "server-only";
import { prisma } from "@/lib/db";
import {
  authAuditActorFromSession,
  writeAuthAudit,
} from "@/lib/admin-user-management";

// AppSettings is a singleton row keyed by this id (schema: @id @default("singleton")).
const APP_SETTINGS_SINGLETON_ID = "singleton";

// Diagnostic gate must fail closed fast; well under health readiness' 1500ms.
export const INVESTIGATION_MODE_GATE_READ_TIMEOUT_MS = 500;

const DEFAULT_DURATION_MS = 60 * 60 * 1000; // 1h (plan default cap)
const MAX_DURATION_MS = 4 * 60 * 60 * 1000; // 4h (plan hard max)

// Same shape `authAuditActorFromSession` accepts, without importing a possibly
// non-exported type.
type AuditableSession = Parameters<typeof authAuditActorFromSession>[0];

export type InvestigationModeStatus = {
  active: boolean;
  until: string | null;
};

export function clampInvestigationDurationMs(minutes: number | undefined): number {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) {
    return DEFAULT_DURATION_MS;
  }
  // Floor at 1 minute: a positive sub-minute request (e.g. 0.5) must not
  // truncate to 0 and produce an immediately-expired window. Erring shorter is
  // the safe direction for a privacy gate (never extend exposure).
  const requestedMinutes = Math.max(1, Math.trunc(minutes));
  return Math.min(requestedMinutes * 60 * 1000, MAX_DURATION_MS);
}

// Bounds the caller's wait and fails closed. NOTE: this does NOT cancel the
// in-flight Prisma query — it may still complete in the background.
function withReadTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`investigation-mode gate read exceeded ${ms}ms`)),
      ms
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/**
 * Fail-closed gate read. Missing row / null = normal disabled (no log).
 * Real read error or timeout = disabled + one best-effort diagnostic.
 * Never returns env defaults, never leaks raw IP/UA.
 */
export async function readInvestigationModeGate(
  now: Date = new Date()
): Promise<{ active: boolean }> {
  try {
    const row = await withReadTimeout(
      prisma.appSettings.findUnique({
        where: { id: APP_SETTINGS_SINGLETON_ID },
        select: { investigationModeUntil: true },
      }),
      INVESTIGATION_MODE_GATE_READ_TIMEOUT_MS
    );
    if (!row || row.investigationModeUntil == null) {
      return { active: false }; // normal disabled state — no diagnostic spam
    }
    return { active: now < row.investigationModeUntil };
  } catch (error) {
    // Storage-read failure/timeout: fail closed + best-effort local diagnostic.
    console.error(
      "[observability] investigation-mode gate read failed; failing closed",
      { error: error instanceof Error ? error.message : String(error) }
    );
    return { active: false };
  }
}

export async function getInvestigationModeStatus(
  now: Date = new Date()
): Promise<InvestigationModeStatus> {
  const row = await prisma.appSettings.findUnique({
    where: { id: APP_SETTINGS_SINGLETON_ID },
    select: { investigationModeUntil: true },
  });
  const until = row?.investigationModeUntil ?? null;
  return {
    active: until != null && now < until,
    until: until ? until.toISOString() : null,
  };
}

/**
 * Enable: settings upsert + audit in ONE transaction. Audit failure rolls the
 * whole thing back, so "enabled without an audit entry" is impossible.
 */
export async function enableInvestigationMode(
  session: AuditableSession,
  durationMinutes: number | undefined,
  now: Date = new Date()
): Promise<{ until: Date }> {
  const durationMs = clampInvestigationDurationMs(durationMinutes);
  const until = new Date(now.getTime() + durationMs);

  await prisma.$transaction(async (tx) => {
    await tx.appSettings.upsert({
      where: { id: APP_SETTINGS_SINGLETON_ID },
      update: { investigationModeUntil: until },
      create: {
        id: APP_SETTINGS_SINGLETON_ID,
        investigationModeUntil: until,
      },
    });
    await writeAuthAudit(tx, {
      eventType: "observability.investigation_mode.enabled",
      actor: authAuditActorFromSession(session),
      targetType: "OBSERVABILITY_SETTING",
      targetId: "investigation_mode",
      metadata: {
        until: until.toISOString(),
        durationMinutes: Math.round(durationMs / 60000),
      },
    });
  });

  return { until };
}

/**
 * Disable: clear first and commit, THEN audit separately. If the audit write
 * fails the mode is already disabled (fail safe) — caller still returns
 * success; we only emit a best-effort local diagnostic.
 */
export async function disableInvestigationMode(
  session: AuditableSession
): Promise<{ ok: true }> {
  // updateMany so an absent singleton row is a no-op (already disabled), not a throw.
  await prisma.appSettings.updateMany({
    where: { id: APP_SETTINGS_SINGLETON_ID },
    data: { investigationModeUntil: null },
  });

  try {
    await prisma.$transaction((tx) =>
      writeAuthAudit(tx, {
        eventType: "observability.investigation_mode.disabled",
        actor: authAuditActorFromSession(session),
        targetType: "OBSERVABILITY_SETTING",
        targetId: "investigation_mode",
      })
    );
  } catch (error) {
    // Fail safe: mode is already cleared. Do not surface as an API failure.
    console.error(
      "[observability] investigation-mode disable audit write failed; mode already disabled",
      { error: error instanceof Error ? error.message : String(error) }
    );
  }

  return { ok: true };
}
