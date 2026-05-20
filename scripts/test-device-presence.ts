/* eslint-disable no-console */
import "dotenv/config";
import { createRequire } from "node:module";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  DEVICE_SESSION_COOKIE,
  buildDatabaseDeviceSessionValue,
  buildLegacyDeviceSessionValue,
} from "@/lib/device-auth";

process.env.DEVICE_PRESENCE_RATE_LIMIT_SESSION_MAX = "2";
process.env.DEVICE_PRESENCE_RATE_LIMIT_IP_MAX = "100";

const require = createRequire(import.meta.url);
const serverOnlyPath = require.resolve("server-only");
require.cache[serverOnlyPath] = {
  id: serverOnlyPath,
  filename: serverOnlyPath,
  loaded: true,
  exports: {},
  children: [],
  paths: [],
} as unknown as NodeJS.Module;

type PresenceRoute = typeof import("@/app/api/device-session/presence/route");
type PresenceLib = typeof import("@/lib/device-presence");
type ProductionAuth = typeof import("@/lib/production-auth");
type AdminPasswords = typeof import("@/lib/admin-passwords");

const runId = `device-presence-${Date.now()}`;
const outletId = `${runId}-outlet`;
const deviceId = `${runId}-device`;
const deviceSessionId = `${runId}-session`;
const syntheticDeviceId = `${runId}-synthetic-device`;
const syntheticSessionId = `${runId}-synthetic-session`;
const sessionToken = `${runId}-token`;
const syntheticToken = `${runId}-synthetic-token`;
const now = new Date("2026-05-19T18:00:00.000Z");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(
      `${message}. Expected ${String(expected)}, got ${String(actual)}.`,
    );
  }
}

function request(
  body: Record<string, unknown>,
  token = sessionToken,
): NextRequest {
  return new NextRequest("http://localhost/api/device-session/presence", {
    method: "POST",
    headers: {
      cookie: `${DEVICE_SESSION_COOKIE}=${buildDatabaseDeviceSessionValue(
        "kiosk",
        token,
      )}`,
      origin: "http://localhost",
      referer: "http://localhost/kiosk",
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.10",
    },
    body: JSON.stringify(body),
  });
}

function legacyRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/device-session/presence", {
    method: "POST",
    headers: {
      cookie: `${DEVICE_SESSION_COOKIE}=${buildLegacyDeviceSessionValue(
        "kiosk",
        "local-kiosk-key",
      )}`,
      origin: "http://localhost",
      referer: "http://localhost/kiosk",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function loadModules(): Promise<{
  route: PresenceRoute;
  presence: PresenceLib;
  productionAuth: ProductionAuth;
  adminPasswords: AdminPasswords;
}> {
  const [route, presence, productionAuth, adminPasswords] = await Promise.all([
    import("@/app/api/device-session/presence/route"),
    import("@/lib/device-presence"),
    import("@/lib/production-auth"),
    import("@/lib/admin-passwords"),
  ]);
  return { route, presence, productionAuth, adminPasswords };
}

async function seed(input: {
  productionAuth: ProductionAuth;
  adminPasswords: AdminPasswords;
}) {
  const secretHash = await input.adminPasswords.hashAdminPassword(
    "device-presence-test-secret",
  );
  await prisma.site.upsert({
    where: { id: "site" },
    update: {},
    create: { id: "site", name: "Test Site" },
  });
  await prisma.outlet.create({
    data: {
      id: outletId,
      siteId: "site",
      name: "Presence Outlet",
      slug: `presence-${runId}`,
      orderPrefix: "DP",
      isActive: true,
    },
  });
  await prisma.device.createMany({
    data: [
      {
        id: deviceId,
        siteId: "site",
        outletId,
        name: "Presence Kiosk",
        role: "kiosk",
        secretHash,
        isActive: true,
      },
      {
        id: syntheticDeviceId,
        siteId: "site",
        outletId,
        name: "Synthetic Presence Kiosk",
        role: "kiosk",
        secretHash,
        isActive: true,
        isSynthetic: true,
      },
    ],
  });
  await prisma.deviceSession.createMany({
    data: [
      {
        id: deviceSessionId,
        deviceId,
        tokenHash: input.productionAuth.hashSessionToken(sessionToken),
        expiresAt: input.productionAuth.computeDeviceSessionExpiry(now),
        lastSeenAt: new Date(now.getTime() - 60_000),
      },
      {
        id: syntheticSessionId,
        deviceId: syntheticDeviceId,
        tokenHash: input.productionAuth.hashSessionToken(syntheticToken),
        expiresAt: input.productionAuth.computeDeviceSessionExpiry(now),
        lastSeenAt: now,
      },
    ],
  });
}

async function cleanup() {
  await prisma.deviceSession.deleteMany({
    where: { id: { in: [deviceSessionId, syntheticSessionId] } },
  });
  await prisma.device.deleteMany({
    where: { id: { in: [deviceId, syntheticDeviceId] } },
  });
  await prisma.outlet.deleteMany({ where: { id: outletId } });
}

async function post(
  route: PresenceRoute,
  body: Record<string, unknown>,
  token = sessionToken,
) {
  return route.POST(request(body, token));
}

function payload(
  event: string,
  sequence: number,
  clientSessionId = "presenceClientSession01",
): Record<string, unknown> {
  return {
    event,
    clientSessionId,
    sequence,
    visibilityState: "visible",
    uptimeMsBucket: "10-60s",
  };
}

async function sessionLifecycleEvent() {
  const session = await prisma.deviceSession.findUniqueOrThrow({
    where: { id: deviceSessionId },
    select: {
      lastLifecycleEvent: true,
      lastClosedAt: true,
      clientSequence: true,
      clientSessionHash: true,
      uncleanRecoveryCount: true,
    },
  });
  return session;
}

async function main() {
  const { route, presence, productionAuth, adminPasswords } =
    await loadModules();
  await cleanup().catch(() => undefined);
  await seed({ productionAuth, adminPasswords });
  presence.resetDevicePresenceRateLimitForTests();

  try {
    let res = await post(route, payload("opened", 1));
    assertEqual(res.status, 204, "opened should be accepted");
    let lifecycle = await sessionLifecycleEvent();
    assertEqual(lifecycle.lastLifecycleEvent, "opened", "opened is stored");

    res = await post(route, { ...payload("bad_event", 2) });
    assertEqual(res.status, 400, "invalid event should be rejected");
    lifecycle = await sessionLifecycleEvent();
    assertEqual(
      lifecycle.lastLifecycleEvent,
      "opened",
      "invalid enum must not partially persist",
    );

    presence.resetDevicePresenceRateLimitForTests();
    res = await post(route, {
      ...payload("clean_close", 3),
      closeReason: "pagehide",
    });
    assertEqual(res.status, 204, "clean close should be accepted");
    lifecycle = await sessionLifecycleEvent();
    assertEqual(lifecycle.lastLifecycleEvent, "clean_close", "closed stored");
    assert(lifecycle.lastClosedAt, "clean close should set lastClosedAt");

    res = await post(route, payload("heartbeat", 2));
    assertEqual(res.status, 204, "stale sequence should no-op as 204");
    lifecycle = await sessionLifecycleEvent();
    assertEqual(
      lifecycle.lastLifecycleEvent,
      "clean_close",
      "stale sequence must not overwrite clean close",
    );

    presence.resetDevicePresenceRateLimitForTests();
    res = await post(route, payload("opened", 1, "presenceClientSession02"));
    assertEqual(res.status, 204, "new client open should be accepted");
    res = await post(route, {
      ...payload("clean_close", 4, "presenceClientSession01"),
      closeReason: "pagehide",
    });
    assertEqual(res.status, 204, "old client close should no-op as 204");
    lifecycle = await sessionLifecycleEvent();
    assertEqual(
      lifecycle.lastLifecycleEvent,
      "opened",
      "old client hash must not overwrite newer open",
    );

    presence.resetDevicePresenceRateLimitForTests();
    res = await post(route, payload("bfcache_pagehide", 2, "presenceClientSession02"));
    assertEqual(res.status, 204, "bfcache pagehide should be accepted");
    lifecycle = await sessionLifecycleEvent();
    assertEqual(
      lifecycle.lastLifecycleEvent,
      "bfcache_pagehide",
      "bfcache pagehide should be stored",
    );
    assertEqual(
      Boolean(lifecycle.lastClosedAt),
      false,
      "bfcache pagehide must not set lastClosedAt",
    );

    presence.resetDevicePresenceRateLimitForTests();
    res = await post(route, payload("recovered_unclean_previous_session", 3, "presenceClientSession02"));
    assertEqual(res.status, 204, "recovery should be accepted");
    lifecycle = await sessionLifecycleEvent();
    assertEqual(
      lifecycle.uncleanRecoveryCount,
      1,
      "recovery increments count",
    );

    presence.resetDevicePresenceRateLimitForTests();
    res = await post(route, payload("visible", 4, "presenceClientSession02"));
    assertEqual(res.status, 204, "first rate-limited request accepted");
    res = await post(route, payload("heartbeat", 5, "presenceClientSession02"));
    assertEqual(res.status, 204, "second rate-limited request accepted");
    res = await post(route, payload("heartbeat", 6, "presenceClientSession02"));
    assertEqual(res.status, 429, "third request should hit test rate limit");
    assert(
      res.headers.get("Retry-After"),
      "rate limit response should include Retry-After",
    );

    presence.resetDevicePresenceRateLimitForTests();
    res = await route.POST(legacyRequest(payload("opened", 1)));
    assertEqual(res.status, 401, "legacy device session should be rejected");

    presence.resetDevicePresenceRateLimitForTests();
    res = await post(route, payload("opened", 1), syntheticToken);
    assertEqual(res.status, 401, "synthetic device session should be rejected");

    const derivedVisibleHidden = presence.deriveDevicePresence({
      now,
      isActive: true,
      lastSeenAt: null,
      sessions: [
        {
          lastSeenAt: new Date(now.getTime() - 30_000),
          lastHeartbeatAt: new Date(now.getTime() - 30_000),
          lastLifecycleAt: new Date(now.getTime() - 20_000),
          lastLifecycleEvent: "hidden",
          lastVisibilityState: "hidden",
          lastClosedAt: null,
        },
      ],
    });
    assertEqual(
      derivedVisibleHidden.presenceKind,
      "online",
      "visibility-hidden session with a fresh heartbeat should stay online",
    );

    const derivedHidden = presence.deriveDevicePresence({
      now,
      isActive: true,
      lastSeenAt: null,
      sessions: [
        {
          lastSeenAt: new Date(now.getTime() - 60_000),
          lastHeartbeatAt: new Date(now.getTime() - 2 * 60_000),
          lastLifecycleAt: new Date(now.getTime() - 60_000),
          lastLifecycleEvent: "freeze",
          lastVisibilityState: "hidden",
          lastClosedAt: null,
        },
      ],
    });
    assertEqual(derivedHidden.presenceKind, "hidden", "frozen session hidden");
    assertEqual(derivedHidden.state, "idle", "hidden counts as idle");

    const derivedUnexpected = presence.deriveDevicePresence({
      now,
      isActive: true,
      lastSeenAt: null,
      sessions: [
        {
          lastSeenAt: new Date(now.getTime() - 20 * 60_000),
          lastHeartbeatAt: new Date(now.getTime() - 20 * 60_000),
          lastLifecycleAt: new Date(now.getTime() - 19 * 60_000),
          lastLifecycleEvent: "freeze",
          lastVisibilityState: "hidden",
          lastClosedAt: null,
        },
      ],
    });
    assertEqual(
      derivedUnexpected.presenceKind,
      "unexpected_offline",
      "frozen session expires after extended hidden window",
    );

    console.log("Device presence tests passed.");
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await cleanup().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
