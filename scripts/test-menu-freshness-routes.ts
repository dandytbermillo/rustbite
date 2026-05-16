/* eslint-disable no-console */
import "dotenv/config";

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { NextRequest } from "next/server";
import {
  buildDatabaseDeviceSessionValue,
  DEVICE_SESSION_COOKIE,
  type DeviceRole,
} from "@/lib/device-auth";
import { prisma } from "@/lib/db";
import { DEFAULT_SITE_ID } from "@/lib/outlets";

const require = createRequire(import.meta.url);
const runId = `menu-fresh-routes-${Date.now()}`;
const outletId = `outlet-${runId}`;
const kioskDeviceId = `device-kiosk-${runId}`;
const counterDeviceId = `device-counter-${runId}`;
const ownerUserId = `owner-${runId}`;
const ADMIN_SESSION_COOKIE = "rb_admin_session";

type ProductionAuthModule = typeof import("@/lib/production-auth");

function stubServerOnly() {
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

function request(path: string, cookie?: string) {
  return new NextRequest(`http://localhost${path}`, {
    headers: {
      ...(cookie ? { cookie } : {}),
      origin: "http://localhost",
      referer: "http://localhost/",
    },
  });
}

function deviceCookie(role: DeviceRole, token: string) {
  return `${DEVICE_SESSION_COOKIE}=${buildDatabaseDeviceSessionValue(role, token)}`;
}

function cookieHeader(...cookies: string[]) {
  return cookies.join("; ");
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function readFirstSseEvent(response: Response) {
  assert.equal(response.status, 200, "SSE route should accept a valid session.");
  assert.equal(
    response.headers.get("Content-Type"),
    "text/event-stream",
    "SSE response should use event-stream content type."
  );
  assert.equal(
    response.headers.get("Cache-Control"),
    "no-cache, no-transform",
    "SSE response should disable proxy/browser buffering caches."
  );
  assert.equal(
    response.headers.get("X-Accel-Buffering"),
    "no",
    "SSE response should disable nginx buffering."
  );

  const reader = response.body?.getReader();
  assert(reader, "SSE response should include a readable body.");
  const decoder = new TextDecoder();
  let raw = "";

  try {
    while (!raw.includes("\n\n")) {
      const result = await Promise.race([
        reader.read(),
        new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
          setTimeout(() => reject(new Error("Timed out waiting for SSE event.")), 2_000);
        }),
      ]);
      if (result.done) break;
      raw += decoder.decode(result.value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  const [eventBlock] = raw.split("\n\n");
  const eventLine = eventBlock.split("\n").find((line) => line.startsWith("event: "));
  const dataLine = eventBlock.split("\n").find((line) => line.startsWith("data: "));
  assert.equal(eventLine, "event: menu_revision", "First SSE event should be menu_revision.");
  assert(dataLine, "First SSE event should include JSON data.");
  return JSON.parse(dataLine.slice("data: ".length)) as {
    outletId: string;
    revision: number;
    updatedAt: string;
  };
}

async function seedDeviceSession(
  productionAuth: ProductionAuthModule,
  deviceId: string,
  role: DeviceRole
) {
  const token = productionAuth.createSessionToken();
  await prisma.deviceSession.create({
    data: {
      deviceId,
      tokenHash: productionAuth.hashSessionToken(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return deviceCookie(role, token);
}

async function seedAdminSession(productionAuth: ProductionAuthModule) {
  const token = productionAuth.createSessionToken();
  await prisma.adminUser.create({
    data: {
      id: ownerUserId,
      email: `${runId}@example.com`,
      displayName: "Menu Freshness Owner",
      passwordHash: "unused",
      accountType: "OWNER",
      siteRole: "OWNER",
      mfaEnabledAt: new Date(),
      isActive: true,
      sessions: {
        create: {
          tokenHash: productionAuth.hashSessionToken(token),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      },
    },
  });
  return `${ADMIN_SESSION_COOKIE}=${token}`;
}

async function seed() {
  const productionAuth = await import("@/lib/production-auth");

  await prisma.site.upsert({
    where: { id: DEFAULT_SITE_ID },
    update: {},
    create: {
      id: DEFAULT_SITE_ID,
      name: "Rushbite",
      timezone: "America/Edmonton",
    },
  });
  await prisma.outlet.create({
    data: {
      id: outletId,
      siteId: DEFAULT_SITE_ID,
      name: `Menu freshness route test ${runId}`,
      slug: outletId,
      orderPrefix: `F${String(Date.now()).slice(-6)}`,
      isActive: true,
    },
  });
  await prisma.device.createMany({
    data: [
      {
        id: kioskDeviceId,
        siteId: DEFAULT_SITE_ID,
        outletId,
        name: `Kiosk ${runId}`,
        role: "kiosk",
        secretHash: "unused",
        isActive: true,
      },
      {
        id: counterDeviceId,
        siteId: DEFAULT_SITE_ID,
        outletId,
        name: `Counter ${runId}`,
        role: "counter",
        secretHash: "unused",
        isActive: true,
      },
    ],
  });

  return {
    kioskCookie: await seedDeviceSession(productionAuth, kioskDeviceId, "kiosk"),
    counterCookie: await seedDeviceSession(productionAuth, counterDeviceId, "counter"),
    adminCookie: await seedAdminSession(productionAuth),
  };
}

async function cleanup() {
  await prisma.deviceSession.deleteMany({
    where: { deviceId: { in: [kioskDeviceId, counterDeviceId] } },
  });
  await prisma.deviceOutletAccess.deleteMany({
    where: { deviceId: { in: [kioskDeviceId, counterDeviceId] } },
  });
  await prisma.device.deleteMany({
    where: { id: { in: [kioskDeviceId, counterDeviceId] } },
  });
  await prisma.menuHistoryState.deleteMany({ where: { outletId } });
  await prisma.menuRevision.deleteMany({ where: { outletId } });
  await prisma.menuAuditLog.deleteMany({ where: { outletId } });
  await prisma.outletMenuVersion.deleteMany({ where: { outletId } });
  await prisma.adminSession.deleteMany({ where: { userId: ownerUserId } });
  await prisma.adminUserOutletRole.deleteMany({ where: { userId: ownerUserId } });
  await prisma.adminUser.deleteMany({ where: { id: ownerUserId } });
  await prisma.outlet.deleteMany({ where: { id: outletId } });
}

async function main() {
  stubServerOnly();
  const [menuRoute, versionRoute, eventsRoute, sync] = await Promise.all([
    import("@/app/api/menu/route"),
    import("@/app/api/menu/version/route"),
    import("@/app/api/menu/events/route"),
    import("@/lib/outlet-menu-sync"),
  ]);

  await cleanup();
  const { kioskCookie, counterCookie, adminCookie } = await seed();
  const bumped = await prisma.$transaction((tx) =>
    sync.bumpOutletMenuVersion(tx, outletId)
  );

  const unauthenticatedMenu = await menuRoute.GET(request("/api/menu"));
  assert.equal(unauthenticatedMenu.status, 401, "/api/menu should reject anonymous requests.");

  const unauthorizedMenu = await menuRoute.GET(request("/api/menu", counterCookie));
  assert.equal(
    unauthorizedMenu.status,
    401,
    "/api/menu should reject non-kiosk device sessions."
  );

  const kioskMenu = await menuRoute.GET(request("/api/menu", kioskCookie));
  assert.equal(kioskMenu.status, 200, "/api/menu should accept kiosk device sessions.");
  assert.equal(
    kioskMenu.headers.get("Cache-Control"),
    "no-store",
    "/api/menu should never be HTTP cached."
  );
  const menuBody = await json<{
    outletId: string;
    revision: number;
    updatedAt: string;
    categories: unknown[];
    items: unknown[];
  }>(kioskMenu);
  assert.equal(menuBody.outletId, outletId, "/api/menu should use the kiosk outlet.");
  assert.equal(menuBody.revision, bumped.revision, "/api/menu should include current revision.");
  assert.ok(Array.isArray(menuBody.categories), "/api/menu should return categories array.");
  assert.ok(Array.isArray(menuBody.items), "/api/menu should return items array.");

  const anonymousVersion = await versionRoute.GET(request("/api/menu/version"));
  assert.equal(
    anonymousVersion.status,
    401,
    "/api/menu/version should reject anonymous requests."
  );

  const counterVersion = await versionRoute.GET(
    request("/api/menu/version", counterCookie)
  );
  assert.equal(
    counterVersion.status,
    401,
    "/api/menu/version should reject non-kiosk device sessions."
  );

  const kioskVersion = await versionRoute.GET(
    request("/api/menu/version", kioskCookie)
  );
  assert.equal(
    kioskVersion.status,
    200,
    "/api/menu/version should accept kiosk device sessions."
  );
  assert.equal(
    kioskVersion.headers.get("Cache-Control"),
    "no-store",
    "/api/menu/version should never be HTTP cached."
  );
  const versionBody = await json<{
    outletId: string;
    revision: number;
    updatedAt: string;
  }>(kioskVersion);
  assert.deepEqual(
    { outletId: versionBody.outletId, revision: versionBody.revision },
    { outletId, revision: bumped.revision },
    "/api/menu/version should return current kiosk outlet version."
  );

  const adminVersion = await versionRoute.GET(
    request(`/api/menu/version?outletId=${outletId}`, adminCookie)
  );
  assert.equal(
    adminVersion.status,
    200,
    "/api/menu/version should accept admin sessions with menu read access."
  );
  const adminVersionBody = await json<{
    outletId: string;
    revision: number;
    updatedAt: string;
  }>(adminVersion);
  assert.deepEqual(
    { outletId: adminVersionBody.outletId, revision: adminVersionBody.revision },
    { outletId, revision: bumped.revision },
    "/api/menu/version should return the admin requested outlet revision."
  );

  const mixedAdminCounterCookie = cookieHeader(adminCookie, counterCookie);
  const mixedAdminCounterVersion = await versionRoute.GET(
    request(`/api/menu/version?outletId=${outletId}`, mixedAdminCounterCookie)
  );
  assert.equal(
    mixedAdminCounterVersion.status,
    200,
    "/api/menu/version should prefer admin auth when admin and non-kiosk device cookies are both present."
  );
  const mixedAdminCounterVersionBody = await json<{
    outletId: string;
    revision: number;
    updatedAt: string;
  }>(mixedAdminCounterVersion);
  assert.deepEqual(
    {
      outletId: mixedAdminCounterVersionBody.outletId,
      revision: mixedAdminCounterVersionBody.revision,
    },
    { outletId, revision: bumped.revision },
    "/api/menu/version should return the admin outlet when mixed cookies are present."
  );

  const anonymousEvents = await eventsRoute.GET(request("/api/menu/events"));
  assert.equal(
    anonymousEvents.status,
    401,
    "/api/menu/events should reject anonymous requests."
  );

  const counterEvents = await eventsRoute.GET(
    request("/api/menu/events", counterCookie)
  );
  assert.equal(
    counterEvents.status,
    401,
    "/api/menu/events should reject non-kiosk device sessions."
  );

  const firstEvent = await readFirstSseEvent(
    await eventsRoute.GET(request("/api/menu/events", kioskCookie))
  );
  assert.deepEqual(
    { outletId: firstEvent.outletId, revision: firstEvent.revision },
    { outletId, revision: bumped.revision },
    "First SSE menu_revision event should identify the kiosk outlet revision."
  );

  const firstAdminEvent = await readFirstSseEvent(
    await eventsRoute.GET(request(`/api/menu/events?outletId=${outletId}`, adminCookie))
  );
  assert.deepEqual(
    { outletId: firstAdminEvent.outletId, revision: firstAdminEvent.revision },
    { outletId, revision: bumped.revision },
    "First admin SSE menu_revision event should identify the admin outlet revision."
  );

  const firstMixedAdminCounterEvent = await readFirstSseEvent(
    await eventsRoute.GET(
      request(`/api/menu/events?outletId=${outletId}`, mixedAdminCounterCookie)
    )
  );
  assert.deepEqual(
    {
      outletId: firstMixedAdminCounterEvent.outletId,
      revision: firstMixedAdminCounterEvent.revision,
    },
    { outletId, revision: bumped.revision },
    "Admin SSE should still work when a non-kiosk device cookie is also present."
  );
}

main()
  .then(async () => {
    await cleanup();
    console.log("Menu freshness route tests passed.");
  })
  .catch(async (err) => {
    await cleanup().catch(() => {});
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
