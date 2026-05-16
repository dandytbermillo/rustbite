import "server-only";
import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import {
  getLoginIpHash,
  getLoginRateLimitStatus,
  recordLoginAttempt,
  type LoginRateLimitStatus,
} from "@/lib/login-rate-limit";

// Operator switch rate-limit helper.
//
// Wraps login-rate-limit primitives across four DEDICATED subject types so
// operator-switch failures NEVER touch the global ipHash query path used
// by /admin/login. The IP rate-limit lives entirely as a per-subject row
// under DEVICE_STAFF_SWITCH_IP keyed by ipHash. All four subjects pass
// skipIpCheck/skipIpRecord so the global ipHash index is bypassed in
// both directions.

export type OperatorSwitchInput = {
  userId: string;
  deviceId: string;
  deviceSessionId: string;
  req: NextRequest;
};

export type OperatorSwitchAllowedResult =
  | { ok: true }
  | {
      ok: false;
      reason: "rate_limited";
      retryAfterSeconds: number;
      blockedSubject:
        | "DEVICE_STAFF_SWITCH_OPERATOR_SESSION"
        | "DEVICE_STAFF_SWITCH_OPERATOR_STABLE_DEVICE"
        | "DEVICE_STAFF_SWITCH_DEVICE"
        | "DEVICE_STAFF_SWITCH_IP";
    };

function operatorSessionKey(input: OperatorSwitchInput): string {
  return `${input.userId}:${input.deviceSessionId}`;
}

function operatorStableDeviceKey(input: OperatorSwitchInput): string {
  return `${input.userId}:${input.deviceId}`;
}

function ipSubjectKey(req: NextRequest): string {
  return getLoginIpHash(req) ?? "(no-ip)";
}

export async function checkOperatorSwitchAllowed(
  input: OperatorSwitchInput
): Promise<OperatorSwitchAllowedResult> {
  const checks: Array<{
    subjectType:
      | "DEVICE_STAFF_SWITCH_OPERATOR_SESSION"
      | "DEVICE_STAFF_SWITCH_OPERATOR_STABLE_DEVICE"
      | "DEVICE_STAFF_SWITCH_DEVICE"
      | "DEVICE_STAFF_SWITCH_IP";
    subjectKey: string;
  }> = [
    {
      subjectType: "DEVICE_STAFF_SWITCH_OPERATOR_SESSION",
      subjectKey: operatorSessionKey(input),
    },
    {
      subjectType: "DEVICE_STAFF_SWITCH_OPERATOR_STABLE_DEVICE",
      subjectKey: operatorStableDeviceKey(input),
    },
    {
      subjectType: "DEVICE_STAFF_SWITCH_DEVICE",
      subjectKey: input.deviceSessionId,
    },
    {
      subjectType: "DEVICE_STAFF_SWITCH_IP",
      subjectKey: ipSubjectKey(input.req),
    },
  ];

  const statuses = await Promise.all(
    checks.map(({ subjectType, subjectKey }) =>
      getLoginRateLimitStatus({
        subjectType,
        subjectKey,
        req: input.req,
        // None of the four operator-switch subjects participate in the
        // global ipHash query — that path is reserved for /admin/login.
        skipIpCheck: true,
      })
    )
  );

  let mostRestrictive:
    | { idx: number; status: LoginRateLimitStatus }
    | null = null;
  for (let idx = 0; idx < statuses.length; idx += 1) {
    const status = statuses[idx]!;
    if (!status.blocked) continue;
    if (
      mostRestrictive === null ||
      status.retryAfterSeconds > mostRestrictive.status.retryAfterSeconds
    ) {
      mostRestrictive = { idx, status };
    }
  }

  if (mostRestrictive) {
    return {
      ok: false,
      reason: "rate_limited",
      retryAfterSeconds: mostRestrictive.status.retryAfterSeconds,
      blockedSubject: checks[mostRestrictive.idx]!.subjectType,
    };
  }

  return { ok: true };
}

export async function recordOperatorSwitchFailure(
  input: OperatorSwitchInput,
  metadata?: Prisma.InputJsonObject
): Promise<void> {
  const baseMetadata = { ...(metadata ?? {}), kind: "operator_switch_failure" };
  await Promise.all([
    recordLoginAttempt({
      subjectType: "DEVICE_STAFF_SWITCH_OPERATOR_SESSION",
      subjectKey: operatorSessionKey(input),
      req: input.req,
      succeeded: false,
      metadata: baseMetadata,
      skipIpRecord: true,
    }),
    recordLoginAttempt({
      subjectType: "DEVICE_STAFF_SWITCH_OPERATOR_STABLE_DEVICE",
      subjectKey: operatorStableDeviceKey(input),
      req: input.req,
      succeeded: false,
      metadata: baseMetadata,
      skipIpRecord: true,
    }),
    recordLoginAttempt({
      subjectType: "DEVICE_STAFF_SWITCH_DEVICE",
      subjectKey: input.deviceSessionId,
      req: input.req,
      succeeded: false,
      metadata: baseMetadata,
      skipIpRecord: true,
    }),
    recordLoginAttempt({
      subjectType: "DEVICE_STAFF_SWITCH_IP",
      subjectKey: ipSubjectKey(input.req),
      req: input.req,
      succeeded: false,
      metadata: baseMetadata,
      skipIpRecord: true,
    }),
  ]);
}

export async function recordOperatorSwitchSuccess(
  input: OperatorSwitchInput,
  metadata?: Prisma.InputJsonObject
): Promise<void> {
  await recordLoginAttempt({
    subjectType: "DEVICE_STAFF_SWITCH_OPERATOR_SESSION",
    subjectKey: operatorSessionKey(input),
    req: input.req,
    succeeded: true,
    metadata: metadata ?? { kind: "operator_switch_success" },
    skipIpRecord: true,
  });
}
