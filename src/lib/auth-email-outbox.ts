import "server-only";
import type { AuthEmailOutbox, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptOwnerChangeSecret } from "@/lib/admin-owner-changes";
import { decryptAdminPasswordResetSecret } from "@/lib/admin-password-reset";

const DEFAULT_BATCH_SIZE = 25;
const MAX_ATTEMPTS = 5;
const STUCK_SENDING_MS = 15 * 60 * 1000;
const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type AuthEmailOutboxResult = {
  sent: number;
  retried: number;
  failed: number;
  skipped: number;
};

type DeliveryResult = {
  provider: "dry-run" | "resend";
  providerMessageId?: string;
};

function isPlainObject(value: Prisma.JsonValue | null): value is Prisma.JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function metadataObject(value: Prisma.JsonValue | null): Prisma.InputJsonObject {
  if (!isPlainObject(value)) return {};
  return { ...value };
}

function metadataString(value: Prisma.JsonValue | null, key: string): string | null {
  if (!isPlainObject(value)) return null;
  const raw = value[key];
  return typeof raw === "string" ? raw : null;
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}

function retryDelayMs(attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(60 * 60 * 1000, 60 * 1000 * 2 ** exponent);
}

function emailDryRunEnabled(): boolean {
  const configured = process.env.AUTH_EMAIL_DRY_RUN?.trim().toLowerCase();
  if (configured === "true") return true;
  if (configured === "false") return false;
  return process.env.NODE_ENV !== "production" && !process.env.RESEND_API_KEY;
}

export function authEmailImmediateDeliveryReady(): boolean {
  return (
    !emailDryRunEnabled() &&
    Boolean(process.env.RESEND_API_KEY?.trim()) &&
    Boolean(process.env.EMAIL_FROM?.trim())
  );
}

function assertProviderConfigured() {
  if (emailDryRunEnabled()) return;
  if (!process.env.RESEND_API_KEY?.trim()) {
    throw new Error("RESEND_API_KEY is required to send auth email outbox rows.");
  }
  if (!process.env.EMAIL_FROM?.trim()) {
    throw new Error("EMAIL_FROM is required to send auth email outbox rows.");
  }
}

export function buildAuthEmailText(row: AuthEmailOutbox): string {
  const encryptedCancelUrl = metadataString(row.metadata, "encryptedCancelUrl");
  const encryptedActionUrl = metadataString(row.metadata, "encryptedActionUrl");
  if (!encryptedCancelUrl && !encryptedActionUrl) return row.textBody;

  const actionUrl = encryptedCancelUrl
    ? decryptOwnerChangeSecret(encryptedCancelUrl)
    : decryptAdminPasswordResetSecret(encryptedActionUrl!);
  const actionLabel = encryptedCancelUrl ? "Cancel link:" : "Secure link:";
  return [
    row.textBody,
    "",
    actionLabel,
    actionUrl,
    "",
    encryptedCancelUrl
      ? "If you did not expect this change, sign in and review Admin > Users."
      : "If you did not request this, ignore this email and contact an Owner.",
  ].join("\n");
}

async function sendViaResend(input: {
  to: string;
  subject: string;
  text: string;
}): Promise<DeliveryResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!apiKey || !from) {
    throw new Error("Resend email provider is not configured.");
  }

  const replyTo = process.env.EMAIL_REPLY_TO?.trim();
  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(
      `Resend rejected auth email (${response.status}): ${responseText.slice(0, 300)}`
    );
  }

  let providerMessageId: string | undefined;
  try {
    const json = JSON.parse(responseText) as { id?: unknown };
    providerMessageId = typeof json.id === "string" ? json.id : undefined;
  } catch {
    providerMessageId = undefined;
  }

  return { provider: "resend", providerMessageId };
}

async function deliverAuthEmail(row: AuthEmailOutbox): Promise<DeliveryResult> {
  const text = buildAuthEmailText(row);
  if (emailDryRunEnabled()) {
    return { provider: "dry-run", providerMessageId: `dry-run:${row.id}` };
  }
  return sendViaResend({
    to: row.recipientEmail,
    subject: row.subject,
    text,
  });
}

async function resetStuckSendingRows(now: Date) {
  const stuckBefore = new Date(now.getTime() - STUCK_SENDING_MS);
  await prisma.authEmailOutbox.updateMany({
    where: {
      status: "SENDING",
      updatedAt: { lt: stuckBefore },
    },
    data: {
      status: "PENDING",
      nextAttemptAt: now,
    },
  });
}

export async function sendPendingAuthEmails(input?: {
  batchSize?: number;
  ids?: string[];
  now?: Date;
}): Promise<AuthEmailOutboxResult> {
  const now = input?.now ?? new Date();
  const ids = input?.ids;
  if (ids && ids.length === 0) {
    return { sent: 0, retried: 0, failed: 0, skipped: 0 };
  }
  const batchSize = Math.max(1, Math.min(input?.batchSize ?? DEFAULT_BATCH_SIZE, 100));
  const result: AuthEmailOutboxResult = { sent: 0, retried: 0, failed: 0, skipped: 0 };

  await resetStuckSendingRows(now);

  const rows = await prisma.authEmailOutbox.findMany({
    where: {
      status: "PENDING",
      ...(ids ? { id: { in: ids } } : {}),
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: batchSize,
  });

  if (rows.length === 0) return result;
  assertProviderConfigured();

  for (const row of rows) {
    const claim = await prisma.authEmailOutbox.updateMany({
      where: { id: row.id, status: "PENDING" },
      data: {
        status: "SENDING",
        attempts: { increment: 1 },
        failedAt: null,
      },
    });
    if (claim.count !== 1) {
      result.skipped += 1;
      continue;
    }

    const claimedRow = await prisma.authEmailOutbox.findUniqueOrThrow({
      where: { id: row.id },
    });

    try {
      const delivery = await deliverAuthEmail(claimedRow);
      await prisma.authEmailOutbox.update({
        where: { id: claimedRow.id },
        data: {
          status: "SENT",
          sentAt: now,
          failedAt: null,
          nextAttemptAt: null,
          metadata: {
            ...metadataObject(claimedRow.metadata),
            provider: delivery.provider,
            providerMessageId: delivery.providerMessageId ?? null,
          },
        },
      });
      result.sent += 1;
    } catch (error) {
      const lastError = safeErrorMessage(error);
      const shouldFail = claimedRow.attempts >= MAX_ATTEMPTS;
      await prisma.authEmailOutbox.update({
        where: { id: claimedRow.id },
        data: {
          status: shouldFail ? "FAILED" : "PENDING",
          failedAt: shouldFail ? now : null,
          nextAttemptAt: shouldFail
            ? null
            : new Date(now.getTime() + retryDelayMs(claimedRow.attempts)),
          metadata: {
            ...metadataObject(claimedRow.metadata),
            lastError,
          },
        },
      });
      if (shouldFail) {
        result.failed += 1;
      } else {
        result.retried += 1;
      }
    }
  }

  return result;
}
