import "server-only";
import { Prisma } from "@prisma/client";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
import { prisma } from "@/lib/db";
import {
  accountTypeToSiteRole,
  effectiveAdminAccountType,
  type AdminAccountTypeValue,
  type AdminOutletRoleValue,
  type AuthAuditActor,
  writeAuthAudit,
} from "@/lib/admin-user-management";
import { resetAdminUserMfa } from "@/lib/admin-mfa-reset";

export const OWNER_CHANGE_COOLING_OFF_MS = 24 * 60 * 60 * 1000;
const OWNER_CHANGE_CANCEL_TOKEN_ENV = "OWNER_CHANGE_CANCEL_TOKEN_SECRET";

export type PendingOwnerChangeAction =
  | "DELETE"
  | "DEMOTE"
  | "DEACTIVATE"
  | "MFA_RESET"
  | "PASSWORD_RESET";

export type PendingOwnerChangePayload =
  | {
      kind: "USER_UPDATE";
      displayName: string;
      accountType: AdminAccountTypeValue;
      siteRole: "OWNER" | "ADMIN" | null;
      isActive: boolean;
      outletRoles: Array<{ outletId: string; role: AdminOutletRoleValue }>;
    }
  | {
      kind: "PASSWORD_RESET";
      passwordHash: string;
    }
  | {
      kind: "MFA_RESET";
    };

export type PendingOwnerChangeSummary = {
  id: string;
  action: string;
  status: string;
  requestedAt: string;
  executesAt: string;
  actorId: string;
  targetId: string;
  reason: string | null;
};

function isPayload(value: Prisma.JsonValue): value is PendingOwnerChangePayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  return (
    raw.kind === "USER_UPDATE" ||
    raw.kind === "PASSWORD_RESET" ||
    raw.kind === "MFA_RESET"
  );
}

function base64Url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function fromBase64Url(value: string): Buffer {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  return Buffer.from(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="), "base64");
}

function ownerChangeTokenKey(): Buffer {
  const configured =
    process.env[OWNER_CHANGE_CANCEL_TOKEN_ENV]?.trim() ||
    process.env.LOGIN_RATE_LIMIT_SECRET?.trim() ||
    process.env.ADMIN_MFA_SECRET_ENCRYPTION_KEY?.trim() ||
    "";
  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(`${OWNER_CHANGE_CANCEL_TOKEN_ENV} is required in production.`);
    }
    return createHash("sha256")
      .update("rushbite-dev-owner-change-cancel-token-secret", "utf8")
      .digest();
  }
  if (/^[a-f0-9]{64}$/i.test(configured)) return Buffer.from(configured, "hex");
  const decoded = Buffer.from(configured, "base64");
  if (decoded.length === 32) return decoded;
  return createHash("sha256").update(configured, "utf8").digest();
}

export function createOwnerChangeCancelToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashOwnerChangeCancelToken(token: string): string {
  return createHmac("sha256", ownerChangeTokenKey())
    .update("rushbite-owner-change-cancel-token:v1:", "utf8")
    .update(token.trim(), "utf8")
    .digest("hex");
}

function encryptOwnerChangeSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", ownerChangeTokenKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${base64Url(iv)}:${base64Url(tag)}:${base64Url(ciphertext)}`;
}

export function decryptOwnerChangeSecret(value: string): string {
  const [version, ivRaw, tagRaw, ciphertextRaw] = value.split(":");
  if (version !== "v1" || !ivRaw || !tagRaw || !ciphertextRaw) {
    throw new Error("Owner-change secret is invalid.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    ownerChangeTokenKey(),
    fromBase64Url(ivRaw)
  );
  decipher.setAuthTag(fromBase64Url(tagRaw));
  return Buffer.concat([
    decipher.update(fromBase64Url(ciphertextRaw)),
    decipher.final(),
  ]).toString("utf8");
}

function adminBaseUrl() {
  return (
    process.env.ADMIN_PUBLIC_BASE_URL?.trim().replace(/\/+$/, "") ||
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") ||
    "http://localhost:3000"
  );
}

function actionLabel(action: PendingOwnerChangeAction | string): string {
  if (action === "DEACTIVATE") return "Deactivate Owner";
  if (action === "DEMOTE") return "Demote Owner";
  if (action === "PASSWORD_RESET") return "Reset Owner password";
  if (action === "MFA_RESET") return "Reset Owner MFA";
  if (action === "DELETE") return "Delete Owner";
  return action;
}

async function enqueueOwnerChangeNotifications(
  tx: Prisma.TransactionClient,
  input: {
    pendingId: string;
    action: PendingOwnerChangeAction;
    actorId: string;
    actorLabel?: string | null;
    targetLabel: string;
    executesAt: Date;
  }
) {
  const recipients = await tx.adminUser.findMany({
    where: { accountType: "OWNER", isActive: true },
    select: { id: true, email: true, displayName: true },
  });
  if (recipients.length === 0) return;

  await Promise.all(
    recipients.map(async (recipient) => {
      const token = createOwnerChangeCancelToken();
      const cancelUrl = `${adminBaseUrl()}/admin/users?ownerChangeCancelToken=${encodeURIComponent(token)}`;
      await tx.pendingOwnerChangeCancelToken.create({
        data: {
          pendingOwnerChangeId: input.pendingId,
          ownerUserId: recipient.id,
          tokenHash: hashOwnerChangeCancelToken(token),
          expiresAt: input.executesAt,
        },
      });
      await tx.authEmailOutbox.create({
        data: {
          eventType: "OWNER_CHANGE_REQUESTED",
          recipientUserId: recipient.id,
          recipientEmail: recipient.email,
          subject: `Rushbite security: ${actionLabel(input.action)} scheduled`,
          textBody: [
            `A pending Owner security change was requested in Rushbite.`,
            ``,
            `Action: ${actionLabel(input.action)}`,
            `Target Owner: ${input.targetLabel}`,
            `Requested by: ${input.actorLabel || input.actorId}`,
            `Eligible after: ${input.executesAt.toISOString()}`,
            ``,
            `Sign in to Rushbite Admin > Users to review or cancel this change.`,
          ].join("\n"),
          metadata: {
            pendingOwnerChangeId: input.pendingId,
            action: input.action,
            encryptedCancelUrl: encryptOwnerChangeSecret(cancelUrl),
          },
        },
      });
    })
  );
}

export function pendingOwnerChangeSummary(row: {
  id: string;
  action: string;
  status: string;
  requestedAt: Date;
  executesAt: Date;
  actorId: string;
  targetId: string;
  reason: string | null;
}): PendingOwnerChangeSummary {
  return {
    id: row.id,
    action: row.action,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    executesAt: row.executesAt.toISOString(),
    actorId: row.actorId,
    targetId: row.targetId,
    reason: row.reason,
  };
}

export async function listPendingOwnerChangesByTarget(
  targetIds: string[]
): Promise<Record<string, PendingOwnerChangeSummary[]>> {
  if (targetIds.length === 0) return {};
  const rows = await prisma.pendingOwnerChange.findMany({
    where: { targetId: { in: targetIds }, status: "PENDING" },
    orderBy: { requestedAt: "desc" },
  });
  const grouped: Record<string, PendingOwnerChangeSummary[]> = {};
  for (const row of rows) {
    grouped[row.targetId] ??= [];
    grouped[row.targetId]!.push(pendingOwnerChangeSummary(row));
  }
  return grouped;
}

export async function requestPendingOwnerChange(
  tx: Prisma.TransactionClient,
  input: {
    actor: AuthAuditActor;
    actorId: string;
    targetId: string;
    targetLabel: string;
    action: PendingOwnerChangeAction;
    reason?: string | null;
    metadata: PendingOwnerChangePayload;
  }
): Promise<
  | { ok: true; pending: PendingOwnerChangeSummary; existing?: boolean }
  | { ok: false; status: number; error: string }
> {
  if (input.actorId === input.targetId) {
    return {
      ok: false,
      status: 400,
      error: "Owner cooling-off is for actions against another owner.",
    };
  }

  const [actor, target, existingForTarget, mutualPending] = await Promise.all([
    tx.adminUser.findUnique({
      where: { id: input.actorId },
      select: { id: true, accountType: true, siteRole: true, isActive: true },
    }),
    tx.adminUser.findUnique({
      where: { id: input.targetId },
      select: { id: true, accountType: true, siteRole: true, isActive: true },
    }),
    tx.pendingOwnerChange.findFirst({
      where: { targetId: input.targetId, status: "PENDING" },
      orderBy: { requestedAt: "desc" },
    }),
    tx.pendingOwnerChange.findFirst({
      where: {
        actorId: input.targetId,
        targetId: input.actorId,
        status: "PENDING",
      },
      orderBy: { requestedAt: "desc" },
    }),
  ]);

  if (
    !actor ||
    !actor.isActive ||
    effectiveAdminAccountType(actor.accountType, actor.siteRole) !== "OWNER"
  ) {
    return {
      ok: false,
      status: 403,
      error: "Only active owners can request owner cooling-off changes.",
    };
  }

  if (
    !target ||
    effectiveAdminAccountType(target.accountType, target.siteRole) !== "OWNER" ||
    !target.isActive
  ) {
    return {
      ok: false,
      status: 400,
      error: "Target must be an active owner.",
    };
  }

  const activeOwnerCount = await tx.adminUser.count({
    where: { isActive: true, accountType: "OWNER" },
  });
  if (activeOwnerCount <= 1) {
    return {
      ok: false,
      status: 400,
      error: "Cannot queue a destructive change against the last active owner.",
    };
  }

  if (existingForTarget) {
    return {
      ok: true,
      existing: true,
      pending: pendingOwnerChangeSummary(existingForTarget),
    };
  }

  if (mutualPending) {
    return {
      ok: false,
      status: 409,
      error:
        "A mutual destructive owner change is already pending. Cancel or execute it first.",
    };
  }

  const now = new Date();
  const pending = await tx.pendingOwnerChange.create({
    data: {
      actorId: input.actorId,
      targetId: input.targetId,
      action: input.action,
      reason: input.reason ?? null,
      metadata: input.metadata as unknown as Prisma.InputJsonValue,
      requestedAt: now,
      executesAt: new Date(now.getTime() + OWNER_CHANGE_COOLING_OFF_MS),
    },
  });

  await writeAuthAudit(tx, {
    eventType: "OWNER_CHANGE_REQUESTED",
    actor: input.actor,
    targetType: "ADMIN_USER",
    targetId: input.targetId,
    targetLabel: input.targetLabel,
    metadata: {
      pendingOwnerChangeId: pending.id,
      action: input.action,
      executesAt: pending.executesAt.toISOString(),
    },
  });

  await enqueueOwnerChangeNotifications(tx, {
    pendingId: pending.id,
    action: input.action,
    actorId: input.actorId,
    actorLabel: input.actor.label,
    targetLabel: input.targetLabel,
    executesAt: pending.executesAt,
  });

  return { ok: true, pending: pendingOwnerChangeSummary(pending) };
}

export async function cancelPendingOwnerChangeWithToken(input: {
  token: string;
  actor: AuthAuditActor;
  actorId: string;
}): Promise<
  | { ok: true; pending: PendingOwnerChangeSummary }
  | { ok: false; status: number; error: string }
> {
  const tokenHash = hashOwnerChangeCancelToken(input.token);
  return prisma.$transaction(async (tx) => {
    const row = await tx.pendingOwnerChangeCancelToken.findUnique({
      where: { tokenHash },
      include: { pendingOwnerChange: true },
    });
    if (
      !row ||
      row.usedAt ||
      row.expiresAt <= new Date() ||
      row.ownerUserId !== input.actorId ||
      row.pendingOwnerChange.status !== "PENDING"
    ) {
      return {
        ok: false as const,
        status: 404,
        error: "Cancel token is invalid or expired.",
      };
    }

    const consumed = await tx.pendingOwnerChangeCancelToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (consumed.count !== 1) {
      return {
        ok: false as const,
        status: 409,
        error: "Cancel token was already used.",
      };
    }

    return cancelPendingOwnerChange(
      {
        id: row.pendingOwnerChangeId,
        actor: input.actor,
        actorId: input.actorId,
      },
      tx
    );
  });
}

export async function cancelPendingOwnerChange(
  input: {
    id: string;
    actor: AuthAuditActor;
    actorId: string;
  },
  tx: Prisma.TransactionClient = prisma
): Promise<
  | { ok: true; pending: PendingOwnerChangeSummary }
  | { ok: false; status: number; error: string }
> {
  const pending = await tx.pendingOwnerChange.findUnique({ where: { id: input.id } });
  if (!pending || pending.status !== "PENDING") {
    return { ok: false, status: 404, error: "Pending owner change not found." };
  }

  const actor = await tx.adminUser.findUnique({
    where: { id: input.actorId },
    select: { id: true, accountType: true, siteRole: true, isActive: true },
  });
  const isOwner =
    actor &&
    actor.isActive &&
    effectiveAdminAccountType(actor.accountType, actor.siteRole) === "OWNER";
  const canCancel =
    input.actorId === pending.actorId || input.actorId === pending.targetId || isOwner;
  if (!canCancel) {
    return {
      ok: false,
      status: 403,
      error: "Only an active owner, the requester, or the target owner can cancel this change.",
    };
  }

  const updated = await tx.pendingOwnerChange.update({
    where: { id: input.id },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancelledBy: input.actorId,
    },
  });

  await writeAuthAudit(tx, {
    eventType: "OWNER_CHANGE_CANCELLED",
    actor: input.actor,
    targetType: "PENDING_OWNER_CHANGE",
    targetId: updated.id,
    targetLabel: updated.action,
    metadata: { action: updated.action, targetOwnerId: updated.targetId },
  });

  return { ok: true, pending: pendingOwnerChangeSummary(updated) };
}

export async function executeDuePendingOwnerChanges(
  now = new Date()
): Promise<{ executed: number; failed: number }> {
  const due = await prisma.pendingOwnerChange.findMany({
    where: { status: "PENDING", executesAt: { lte: now } },
    orderBy: { executesAt: "asc" },
  });
  let executed = 0;
  let failed = 0;

  for (const pending of due) {
    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.pendingOwnerChange.findUnique({
        where: { id: pending.id },
      });
      if (!locked || locked.status !== "PENDING" || locked.executesAt > now) {
        return "skipped" as const;
      }

      const [actor, target] = await Promise.all([
        tx.adminUser.findUnique({
          where: { id: locked.actorId },
          select: { id: true, accountType: true, siteRole: true, isActive: true, email: true },
        }),
        tx.adminUser.findUnique({
          where: { id: locked.targetId },
          select: { id: true, accountType: true, siteRole: true, isActive: true, email: true },
        }),
      ]);
      const payload = locked.metadata && isPayload(locked.metadata) ? locked.metadata : null;
      const actorStillOwner =
        actor?.isActive &&
        effectiveAdminAccountType(actor.accountType, actor.siteRole) === "OWNER";
      const targetStillOwner =
        target?.isActive &&
        effectiveAdminAccountType(target.accountType, target.siteRole) === "OWNER";
      const activeOwnerCount = await tx.adminUser.count({
        where: { isActive: true, accountType: "OWNER" },
      });

      if (!actorStillOwner || !targetStillOwner || activeOwnerCount <= 1 || !payload) {
        await tx.pendingOwnerChange.update({
          where: { id: locked.id },
          data: { status: "FAILED", reason: "execution_recheck_failed" },
        });
        return "failed" as const;
      }

      if (payload.kind === "USER_UPDATE") {
        await tx.adminUser.update({
          where: { id: locked.targetId },
          data: {
            displayName: payload.displayName,
            accountType: payload.accountType,
            siteRole: accountTypeToSiteRole(payload.accountType),
            isActive: payload.isActive,
          },
        });
        await tx.adminUserOutletRole.deleteMany({ where: { userId: locked.targetId } });
        if (payload.outletRoles.length > 0) {
          await tx.adminUserOutletRole.createMany({
            data: payload.outletRoles.map((role) => ({
              userId: locked.targetId,
              outletId: role.outletId,
              role: role.role,
            })),
          });
        }
      } else if (payload.kind === "PASSWORD_RESET") {
        await tx.adminUser.update({
          where: { id: locked.targetId },
          data: { passwordHash: payload.passwordHash, passwordChangedAt: now },
        });
      } else {
        await resetAdminUserMfa(tx, locked.targetId);
      }

      await tx.adminSession.updateMany({
        where: { userId: locked.targetId, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.pendingOwnerChange.update({
        where: { id: locked.id },
        data: { status: "EXECUTED", executedAt: now },
      });
      await writeAuthAudit(tx, {
        eventType: "OWNER_CHANGE_EXECUTED",
        actor: {
          type: "SYSTEM",
          label: "Pending owner change executor",
        },
        targetType: "ADMIN_USER",
        targetId: locked.targetId,
        targetLabel: target.email,
        metadata: { pendingOwnerChangeId: locked.id, action: locked.action },
      });
      return "executed" as const;
    });

    if (result === "executed") executed += 1;
    if (result === "failed") failed += 1;
  }

  return { executed, failed };
}
