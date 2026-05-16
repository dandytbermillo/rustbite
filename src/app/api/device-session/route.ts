import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { DEVICE_SESSION_COOKIE } from "@/lib/device-auth";
import {
  clearDeviceSessionCookie,
  createDeviceSession,
  getDeviceSessionFromRequest,
  isLegacyDeviceAuthEnabled,
  isValidLegacyDevicePassword,
  revokeDeviceSessionToken,
  setDeviceSessionCookie,
  setLegacyDeviceSessionCookie,
  authenticateDatabaseDevice,
} from "@/lib/device-sessions";
import {
  inferDeviceRoleFromPath,
  isDeviceRole,
  normalizeNextPath,
  type DeviceRole,
} from "@/lib/device-auth";
import {
  getLoginIpHash,
  getLoginRateLimitStatus,
  recordLoginAttempt,
} from "@/lib/login-rate-limit";
import { requireSameOriginMutation } from "@/lib/production-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function buildLoginRedirect(
  req: NextRequest,
  nextPath: string,
  role: DeviceRole,
  error?: string
) {
  const loginUrl = new URL("/device-login", req.url);
  loginUrl.searchParams.set("next", nextPath);
  loginUrl.searchParams.set("role", role);
  if (error) loginUrl.searchParams.set("error", error);
  return NextResponse.redirect(loginUrl);
}

export async function POST(req: NextRequest) {
  const originError = requireSameOriginMutation(req);
  if (originError) return originError;

  const formData = await req.formData();
  const nextPath = normalizeNextPath(formData.get("next")?.toString(), "/");
  const requestedRole = formData.get("role")?.toString();
  const inferredRole = inferDeviceRoleFromPath(nextPath);
  const role =
    (isDeviceRole(requestedRole) ? requestedRole : inferredRole) ?? "kiosk";
  const password = formData.get("password")?.toString();
  const subjectKey = role;

  const rateLimit = await getLoginRateLimitStatus({
    subjectType: "DEVICE",
    subjectKey,
    req,
  });
  if (rateLimit.blocked) {
    await prisma.authAuditLog.create({
      data: {
        eventType: "DEVICE_LOGIN_RATE_LIMITED",
        actorType: "SYSTEM",
        targetType: "DEVICE_LOGIN",
        targetLabel: role,
        ipHash: getLoginIpHash(req),
        metadata: {
          retryAfterSeconds: rateLimit.retryAfterSeconds,
          reason: rateLimit.reason ?? "unknown",
          policy: rateLimit.policy,
          role,
        },
      },
    });
    return buildLoginRedirect(req, nextPath, role, "locked");
  }

  const device = await authenticateDatabaseDevice(role, password);
  if (device) {
    const { token, expiresAt } = await createDeviceSession(device.id, req);
    await prisma.authAuditLog.create({
      data: {
        eventType: "DEVICE_LOGIN_SUCCEEDED",
        actorType: "DEVICE",
        actorId: device.id,
        actorLabel: device.name,
        targetType: "DEVICE",
        targetId: device.id,
        targetLabel: device.name,
        ipHash: getLoginIpHash(req),
        userAgent: req.headers.get("user-agent") ?? null,
        metadata: { role },
      },
    });
    await recordLoginAttempt({
      subjectType: "DEVICE",
      subjectKey,
      req,
      succeeded: true,
      metadata: { role, deviceId: device.id },
    });

    const response = NextResponse.redirect(new URL(nextPath, req.url));
    setDeviceSessionCookie(response, role, token, expiresAt);
    return response;
  }

  if (await isValidLegacyDevicePassword(role, password)) {
    await recordLoginAttempt({
      subjectType: "DEVICE",
      subjectKey,
      req,
      succeeded: true,
      metadata: { role, legacy: true },
    });

    const response = NextResponse.redirect(new URL(nextPath, req.url));
    setLegacyDeviceSessionCookie(response, role);
    return response;
  }

  await recordLoginAttempt({
    subjectType: "DEVICE",
    subjectKey,
    req,
    succeeded: false,
    metadata: {
      role,
      reason: "invalid_credentials",
      legacyEnabled: isLegacyDeviceAuthEnabled(),
    },
  });
  return buildLoginRedirect(req, nextPath, role, "invalid");
}

export async function DELETE(req: NextRequest) {
  const originError = requireSameOriginMutation(req);
  if (originError) return originError;

  const actor = await getDeviceSessionFromRequest(req);
  const nextPath = normalizeNextPath(
    new URL(req.url).searchParams.get("next"),
    "/device-login"
  );

  await revokeDeviceSessionToken(req.cookies.get(DEVICE_SESSION_COOKIE)?.value);

  if (actor?.deviceId) {
    await prisma.authAuditLog.create({
      data: {
        eventType: "DEVICE_LOGOUT",
        actorType: "DEVICE",
        actorId: actor.deviceId,
        actorLabel: actor.name,
        targetType: "DEVICE",
        targetId: actor.deviceId,
        targetLabel: actor.name,
        ipHash: getLoginIpHash(req),
        userAgent: req.headers.get("user-agent") ?? null,
        metadata: { role: actor.role },
      },
    });
  }

  const response = NextResponse.redirect(new URL(nextPath, req.url));
  clearDeviceSessionCookie(response);
  return response;
}
