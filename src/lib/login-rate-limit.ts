import "server-only";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

export const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_RATE_LIMIT_MAX_FAILURES = 5;

type LoginSubjectType =
  | "ADMIN"
  | "ADMIN_MFA"
  | "ADMIN_STEP_UP"
  | "ADMIN_PASSWORD_RESET"
  | "DEVICE"
  | "DEVICE_STAFF_SWITCH_OPERATOR_SESSION"
  | "DEVICE_STAFF_SWITCH_OPERATOR_STABLE_DEVICE"
  | "DEVICE_STAFF_SWITCH_DEVICE"
  | "DEVICE_STAFF_SWITCH_IP";

type LoginRateLimitInput = {
  subjectType: LoginSubjectType;
  subjectKey: string;
  req: NextRequest;
};

type LoginRateLimitPolicy = {
  accountWindowMs: number;
  accountMaxFailures: number;
  ipWindowMs: number;
  ipMaxFailures: number;
  progressiveMinFailures: number;
  progressiveDelayMs: number[];
};

export type LoginRateLimitStatus = {
  blocked: boolean;
  retryAfterSeconds: number;
  reason?: "account_threshold" | "ip_threshold" | "progressive_backoff";
  policy: {
    accountWindowMs: number;
    accountMaxFailures: number;
    ipWindowMs: number;
    ipMaxFailures: number;
  };
};

const DEFAULT_PROGRESSIVE_BACKOFF_MS = [1_000, 5_000, 60_000, 5 * 60_000, 30 * 60_000];

function envInt(name: string, fallback: number, input?: { min?: number; max?: number }): number {
  const raw = process.env[name];
  if (!raw?.trim()) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const min = input?.min ?? 1;
  const max = input?.max ?? Number.MAX_SAFE_INTEGER;
  return Math.max(min, Math.min(Math.trunc(parsed), max));
}

function secondsEnv(name: string, fallbackSeconds: number): number {
  return envInt(name, fallbackSeconds, { min: 1, max: 24 * 60 * 60 }) * 1000;
}

function progressiveBackoffMs(): number[] {
  const raw = process.env.LOGIN_PROGRESSIVE_BACKOFF_SECONDS?.trim();
  if (!raw) return DEFAULT_PROGRESSIVE_BACKOFF_MS;
  const values = raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isFinite(part) && part > 0)
    .slice(0, 10)
    .map((part) => Math.min(Math.trunc(part), 60 * 60) * 1000);
  return values.length > 0 ? values : DEFAULT_PROGRESSIVE_BACKOFF_MS;
}

function progressiveMinFailures(): number {
  return envInt("LOGIN_PROGRESSIVE_BACKOFF_MIN_FAILURES", 3, { min: 1, max: 20 });
}

export function getLoginRateLimitPolicy(
  subjectType: LoginSubjectType
): LoginRateLimitPolicy {
  const progressiveDelayMs = progressiveBackoffMs();
  const progressiveMinFailuresValue = progressiveMinFailures();
  switch (subjectType) {
    case "ADMIN_PASSWORD_RESET":
      return {
        accountWindowMs: secondsEnv("ADMIN_PASSWORD_RESET_RATE_LIMIT_ACCOUNT_WINDOW_SECONDS", 15 * 60),
        accountMaxFailures: envInt("ADMIN_PASSWORD_RESET_RATE_LIMIT_ACCOUNT_MAX", 5, {
          min: 1,
          max: 1000,
        }),
        ipWindowMs: secondsEnv("ADMIN_PASSWORD_RESET_RATE_LIMIT_IP_WINDOW_SECONDS", 60),
        ipMaxFailures: envInt("ADMIN_PASSWORD_RESET_RATE_LIMIT_IP_MAX", 20, {
          min: 1,
          max: 5000,
        }),
        progressiveMinFailures: progressiveMinFailuresValue,
        progressiveDelayMs,
      };
    case "ADMIN_MFA":
      return {
        accountWindowMs: secondsEnv("ADMIN_MFA_RATE_LIMIT_ACCOUNT_WINDOW_SECONDS", 15 * 60),
        accountMaxFailures: envInt("ADMIN_MFA_RATE_LIMIT_ACCOUNT_MAX", 10, {
          min: 1,
          max: 1000,
        }),
        ipWindowMs: secondsEnv("ADMIN_MFA_RATE_LIMIT_IP_WINDOW_SECONDS", 5 * 60),
        ipMaxFailures: envInt("ADMIN_MFA_RATE_LIMIT_IP_MAX", 30, {
          min: 1,
          max: 5000,
        }),
        progressiveMinFailures: progressiveMinFailuresValue,
        progressiveDelayMs,
      };
    case "ADMIN_STEP_UP":
      return {
        accountWindowMs: secondsEnv("ADMIN_STEP_UP_RATE_LIMIT_ACCOUNT_WINDOW_SECONDS", 15 * 60),
        accountMaxFailures: envInt("ADMIN_STEP_UP_RATE_LIMIT_ACCOUNT_MAX", 10, {
          min: 1,
          max: 1000,
        }),
        ipWindowMs: secondsEnv("ADMIN_STEP_UP_RATE_LIMIT_IP_WINDOW_SECONDS", 5 * 60),
        ipMaxFailures: envInt("ADMIN_STEP_UP_RATE_LIMIT_IP_MAX", 30, {
          min: 1,
          max: 5000,
        }),
        progressiveMinFailures: progressiveMinFailuresValue,
        progressiveDelayMs,
      };
    case "DEVICE":
      return {
        accountWindowMs: secondsEnv("DEVICE_LOGIN_RATE_LIMIT_ACCOUNT_WINDOW_SECONDS", 15 * 60),
        accountMaxFailures: envInt("DEVICE_LOGIN_RATE_LIMIT_ACCOUNT_MAX", 10, {
          min: 1,
          max: 1000,
        }),
        ipWindowMs: secondsEnv("DEVICE_LOGIN_RATE_LIMIT_IP_WINDOW_SECONDS", 60),
        ipMaxFailures: envInt("DEVICE_LOGIN_RATE_LIMIT_IP_MAX", 20, {
          min: 1,
          max: 5000,
        }),
        progressiveMinFailures: progressiveMinFailuresValue,
        progressiveDelayMs,
      };
    case "DEVICE_STAFF_SWITCH_OPERATOR_SESSION":
      // operator-switch subjects: callers must pass skipIpCheck/skipIpRecord
      // so the global ipHash query/index is never touched. The "ip" fields
      // here are kept for shape compatibility but never read in practice.
      return {
        accountWindowMs: secondsEnv(
          "DEVICE_STAFF_SWITCH_RATE_LIMIT_OPERATOR_WINDOW_SECONDS",
          15 * 60
        ),
        accountMaxFailures: envInt("DEVICE_STAFF_SWITCH_RATE_LIMIT_OPERATOR_MAX", 5, {
          min: 1,
          max: 1000,
        }),
        ipWindowMs: 60_000,
        ipMaxFailures: Number.MAX_SAFE_INTEGER,
        progressiveMinFailures: progressiveMinFailuresValue,
        progressiveDelayMs,
      };
    case "DEVICE_STAFF_SWITCH_OPERATOR_STABLE_DEVICE":
      return {
        accountWindowMs: secondsEnv(
          "DEVICE_STAFF_SWITCH_RATE_LIMIT_OPERATOR_DEVICE_WINDOW_SECONDS",
          60 * 60
        ),
        accountMaxFailures: envInt(
          "DEVICE_STAFF_SWITCH_RATE_LIMIT_OPERATOR_DEVICE_MAX",
          15,
          { min: 1, max: 1000 }
        ),
        ipWindowMs: 60_000,
        ipMaxFailures: Number.MAX_SAFE_INTEGER,
        progressiveMinFailures: progressiveMinFailuresValue,
        progressiveDelayMs,
      };
    case "DEVICE_STAFF_SWITCH_DEVICE":
      return {
        accountWindowMs: secondsEnv(
          "DEVICE_STAFF_SWITCH_RATE_LIMIT_DEVICE_WINDOW_SECONDS",
          60 * 60
        ),
        accountMaxFailures: envInt("DEVICE_STAFF_SWITCH_RATE_LIMIT_DEVICE_MAX", 20, {
          min: 1,
          max: 1000,
        }),
        ipWindowMs: 60_000,
        ipMaxFailures: Number.MAX_SAFE_INTEGER,
        progressiveMinFailures: progressiveMinFailuresValue,
        progressiveDelayMs,
      };
    case "DEVICE_STAFF_SWITCH_IP":
      // The IP rate-limit for operator-switch lives ENTIRELY under this
      // subject type with subjectKey = ipHash. The "account" thresholds
      // here are the operator-switch IP thresholds.
      return {
        accountWindowMs: secondsEnv(
          "DEVICE_STAFF_SWITCH_RATE_LIMIT_IP_WINDOW_SECONDS",
          60
        ),
        accountMaxFailures: envInt("DEVICE_STAFF_SWITCH_RATE_LIMIT_IP_MAX", 20, {
          min: 1,
          max: 5000,
        }),
        ipWindowMs: 60_000,
        ipMaxFailures: Number.MAX_SAFE_INTEGER,
        progressiveMinFailures: progressiveMinFailuresValue,
        progressiveDelayMs,
      };
    case "ADMIN":
    default:
      return {
        accountWindowMs: secondsEnv("ADMIN_LOGIN_RATE_LIMIT_ACCOUNT_WINDOW_SECONDS", 15 * 60),
        accountMaxFailures: envInt("ADMIN_LOGIN_RATE_LIMIT_ACCOUNT_MAX", 10, {
          min: 1,
          max: 1000,
        }),
        ipWindowMs: secondsEnv("ADMIN_LOGIN_RATE_LIMIT_IP_WINDOW_SECONDS", 60),
        ipMaxFailures: envInt("ADMIN_LOGIN_RATE_LIMIT_IP_MAX", 20, {
          min: 1,
          max: 5000,
        }),
        progressiveMinFailures: progressiveMinFailuresValue,
        progressiveDelayMs,
      };
  }
}

function hashLoginValue(kind: string, value: string): string {
  const secret =
    process.env.LOGIN_RATE_LIMIT_SECRET ??
    process.env.ADMIN_PASSWORD ??
    "rushbite-local-rate-limit-secret";
  return createHash("sha256")
    .update(`${secret}:${kind}:${value}`, "utf8")
    .digest("hex");
}

function firstForwardedIp(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim();
  return first || null;
}

export function getLoginIpHash(req: NextRequest): string | null {
  const rawIp =
    firstForwardedIp(req.headers.get("x-forwarded-for")) ??
    req.headers.get("x-real-ip")?.trim() ??
    req.headers.get("cf-connecting-ip")?.trim() ??
    null;
  return rawIp ? hashLoginValue("ip", rawIp) : null;
}

export function getLoginSubjectHash(
  subjectType: LoginSubjectType,
  subjectKey: string
): string {
  return hashLoginValue(`subject:${subjectType}`, subjectKey.trim().toLowerCase());
}

export async function getLoginRateLimitStatus({
  subjectType,
  subjectKey,
  req,
  skipIpCheck = false,
}: LoginRateLimitInput & { skipIpCheck?: boolean }): Promise<LoginRateLimitStatus> {
  const policy = getLoginRateLimitPolicy(subjectType);
  const subjectKeyHash = getLoginSubjectHash(subjectType, subjectKey || "(blank)");
  const ipHash = getLoginIpHash(req);
  const accountSince = new Date(Date.now() - policy.accountWindowMs);
  const ipSince = new Date(Date.now() - policy.ipWindowMs);

  const [subjectFailures, ipFailures] = await Promise.all([
    prisma.loginAttempt.findMany({
      where: {
        subjectType,
        subjectKeyHash,
        succeeded: false,
        attemptedAt: { gte: accountSince },
      },
      orderBy: { attemptedAt: "desc" },
      take: Math.max(
        policy.accountMaxFailures,
        policy.progressiveMinFailures + policy.progressiveDelayMs.length
      ),
      select: { attemptedAt: true },
    }),
    !skipIpCheck && ipHash
      ? prisma.loginAttempt.findMany({
          where: {
            ipHash,
            succeeded: false,
            attemptedAt: { gte: ipSince },
          },
          orderBy: { attemptedAt: "desc" },
          take: policy.ipMaxFailures,
          select: { attemptedAt: true },
        })
      : Promise.resolve([]),
  ]);

  const policySummary = {
    accountWindowMs: policy.accountWindowMs,
    accountMaxFailures: policy.accountMaxFailures,
    ipWindowMs: policy.ipWindowMs,
    ipMaxFailures: policy.ipMaxFailures,
  };

  const sortedSubjectFailures = [...subjectFailures].sort(
    (a, b) => a.attemptedAt.getTime() - b.attemptedAt.getTime()
  );
  const sortedIpFailures = [...ipFailures].sort(
    (a, b) => a.attemptedAt.getTime() - b.attemptedAt.getTime()
  );

  if (sortedSubjectFailures.length >= policy.accountMaxFailures) {
    const oldest = sortedSubjectFailures[0]!.attemptedAt;
    const retryAfterMs = oldest.getTime() + policy.accountWindowMs - Date.now();
    return {
      blocked: true,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      reason: "account_threshold",
      policy: policySummary,
    };
  }

  if (sortedIpFailures.length >= policy.ipMaxFailures) {
    const oldest = sortedIpFailures[0]!.attemptedAt;
    const retryAfterMs = oldest.getTime() + policy.ipWindowMs - Date.now();
    return {
      blocked: true,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      reason: "ip_threshold",
      policy: policySummary,
    };
  }

  if (
    subjectFailures.length >= policy.progressiveMinFailures &&
    policy.progressiveDelayMs.length > 0
  ) {
    const latest = subjectFailures[0]!.attemptedAt;
    const delay =
      policy.progressiveDelayMs[
        Math.min(
          subjectFailures.length - policy.progressiveMinFailures,
          policy.progressiveDelayMs.length - 1
        )
      ]!;
    const retryAfterMs = latest.getTime() + delay - Date.now();
    if (retryAfterMs > 0) {
      return {
        blocked: true,
        retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
        reason: "progressive_backoff",
        policy: policySummary,
      };
    }
  }

  return {
    blocked: false,
    retryAfterSeconds: 0,
    policy: policySummary,
  };
}

export async function recordLoginAttempt({
  subjectType,
  subjectKey,
  req,
  succeeded,
  metadata,
  skipIpRecord = false,
}: LoginRateLimitInput & {
  succeeded: boolean;
  metadata?: Prisma.InputJsonObject;
  skipIpRecord?: boolean;
}) {
  await prisma.loginAttempt.create({
    data: {
      subjectType,
      subjectKeyHash: getLoginSubjectHash(subjectType, subjectKey || "(blank)"),
      // When skipIpRecord is true the row is excluded from the global
      // [ipHash, attemptedAt] index so it cannot inflate cross-subject
      // IP thresholds. Used by operator-switch which represents its IP
      // rate-limit via a dedicated DEVICE_STAFF_SWITCH_IP subject row.
      ipHash: skipIpRecord ? null : getLoginIpHash(req),
      succeeded,
      metadata: metadata ?? undefined,
    },
  });
}
