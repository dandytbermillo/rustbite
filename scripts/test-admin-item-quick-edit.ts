/* eslint-disable no-console */
import "dotenv/config";

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DEFAULT_SITE_ID } from "@/lib/outlets";

process.env.ADMIN_PASSWORD = "test-admin-password";
const LEGACY_AUTH = `Basic ${Buffer.from(
  `:${process.env.ADMIN_PASSWORD}`
).toString("base64")}`;

const require = createRequire(import.meta.url);
const shortRunId = Date.now().toString(36);
const runId = `quick-edit-${shortRunId}`;
const outletAId = `${runId}-a`;
const outletBId = `${runId}-b`;
const managerEmail = `${runId}-manager@example.test`;
const viewerEmail = `${runId}-viewer@example.test`;

type QuickEditRoute =
  typeof import("@/app/api/admin/items/[id]/quick-edit/route");
type FullItemRoute = typeof import("@/app/api/admin/items/[id]/route");
type ProductionAuth = typeof import("@/lib/production-auth");

type JsonObject = Record<string, unknown>;

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

async function loadModules(): Promise<{
  quickEditRoute: QuickEditRoute;
  fullItemRoute: FullItemRoute;
  productionAuth: ProductionAuth;
}> {
  stubServerOnly();
  const [quickEditRoute, fullItemRoute, productionAuth] = await Promise.all([
    import("@/app/api/admin/items/[id]/quick-edit/route"),
    import("@/app/api/admin/items/[id]/route"),
    import("@/lib/production-auth"),
  ]);
  return { quickEditRoute, fullItemRoute, productionAuth };
}

function cookieHeader(cookies: Record<string, string | null | undefined>) {
  return Object.entries(cookies)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join("; ");
}

function routeRequest({
  path,
  body,
  sessionToken,
  activeOutletId,
  legacyAuth = false,
}: {
  path: string;
  body: JsonObject;
  sessionToken?: string;
  activeOutletId?: string | null;
  legacyAuth?: boolean;
}) {
  const cookie = cookieHeader({
    rb_admin_session: sessionToken,
    rb_admin_active_outlet: activeOutletId,
  });
  return new NextRequest(`http://localhost${path}`, {
    method: "PATCH",
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(legacyAuth ? { authorization: LEGACY_AUTH } : {}),
      origin: "http://localhost",
      referer: "http://localhost/admin/menu",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function paramsOf(itemId: string) {
  return { params: Promise.resolve({ id: itemId }) };
}

async function readJson(response: Response): Promise<JsonObject> {
  const text = await response.text();
  try {
    return JSON.parse(text) as JsonObject;
  } catch {
    return { raw: text };
  }
}

async function callQuickEdit(
  route: QuickEditRoute,
  itemId: string,
  body: JsonObject,
  options: { sessionToken?: string; activeOutletId?: string | null; legacyAuth?: boolean } = {
    legacyAuth: true,
  }
) {
  return route.PATCH(
    routeRequest({
      path: `/api/admin/items/${itemId}/quick-edit`,
      body,
      ...options,
    }),
    paramsOf(itemId)
  );
}

async function createSession(productionAuth: ProductionAuth, userId: string) {
  const token = productionAuth.createSessionToken();
  await prisma.adminSession.create({
    data: {
      userId,
      tokenHash: productionAuth.hashSessionToken(token),
      expiresAt: productionAuth.computeAdminSessionExpiry(),
      userAgent: "quick-edit-test",
      ipHash: `${runId}-ip`,
    },
  });
  return token;
}

async function ensureSiteAndOutlets() {
  await prisma.site.upsert({
    where: { id: DEFAULT_SITE_ID },
    update: {},
    create: {
      id: DEFAULT_SITE_ID,
      name: "Rushbite",
      timezone: "America/Edmonton",
    },
  });

  await prisma.outlet.createMany({
    data: [
      {
        id: outletAId,
        siteId: DEFAULT_SITE_ID,
        name: `Quick Edit A ${shortRunId}`,
        slug: outletAId,
        orderPrefix: `QA${shortRunId.slice(-4).toUpperCase()}`,
        isActive: true,
      },
      {
        id: outletBId,
        siteId: DEFAULT_SITE_ID,
        name: `Quick Edit B ${shortRunId}`,
        slug: outletBId,
        orderPrefix: `QB${shortRunId.slice(-4).toUpperCase()}`,
        isActive: true,
      },
    ],
  });
}

async function seedUsers() {
  const [manager, viewer] = await Promise.all([
    prisma.adminUser.create({
      data: {
        email: managerEmail,
        displayName: "Quick Edit Manager",
        passwordHash: "test-password-hash",
        accountType: "STAFF",
        siteRole: null,
        isActive: true,
      },
    }),
    prisma.adminUser.create({
      data: {
        email: viewerEmail,
        displayName: "Quick Edit Viewer",
        passwordHash: "test-password-hash",
        accountType: "STAFF",
        siteRole: null,
        isActive: true,
      },
    }),
  ]);

  await prisma.adminUserOutletRole.createMany({
    data: [
      { userId: manager.id, outletId: outletAId, role: "MANAGER" },
      { userId: viewer.id, outletId: outletAId, role: "VIEWER" },
    ],
  });

  return { manager, viewer };
}

async function createCategory(outletId: string, slug: string, name: string) {
  return prisma.category.create({
    data: {
      outletId,
      slug,
      name,
      icon: slug.includes("deals") ? "🔥" : "🍔",
      sortOrder: 0,
      isActive: true,
    },
  });
}

async function createItem({
  categoryId,
  outletId,
  name,
  price = "5.00",
  badge = null,
  isActive = true,
  isOutOfStock = false,
  stockMode = "MANUAL",
  stockQty = null,
  lowStockThreshold = null,
  withModifiers = false,
}: {
  categoryId: string;
  outletId: string;
  name: string;
  price?: string;
  badge?: string | null;
  isActive?: boolean;
  isOutOfStock?: boolean;
  stockMode?: "MANUAL" | "QUANTITY";
  stockQty?: number | null;
  lowStockThreshold?: number | null;
  withModifiers?: boolean;
}) {
  return prisma.menuItem.create({
    data: {
      categoryId,
      outletId,
      name,
      description: `${name} description`,
      price: new Prisma.Decimal(price),
      emoji: "🍔",
      bgColor: "#FFE3B3",
      badge,
      isActive,
      isOutOfStock,
      stockMode,
      stockQty,
      lowStockThreshold,
      sortOrder: 0,
      sizes: withModifiers
        ? {
            create: [
              { name: "Small", priceDelta: new Prisma.Decimal("0.00"), sortOrder: 0 },
              { name: "Large", priceDelta: new Prisma.Decimal("2.00"), sortOrder: 1 },
            ],
          }
        : undefined,
      addons: withModifiers
        ? {
            create: [
              { name: "Cheese", priceDelta: new Prisma.Decimal("1.00"), sortOrder: 0 },
            ],
          }
        : undefined,
    },
  });
}

async function createDeal({
  categoryId,
  outletId,
  baseItemId,
  linkedItemId,
}: {
  categoryId: string;
  outletId: string;
  baseItemId: string;
  linkedItemId: string;
}) {
  return prisma.menuItem.create({
    data: {
      categoryId,
      outletId,
      name: `Deal ${shortRunId}`,
      description: "Deal description",
      price: new Prisma.Decimal("9.00"),
      emoji: "🔥",
      bgColor: "#FFE3B3",
      badge: "DEAL",
      isActive: true,
      dealBaseMenuItemId: baseItemId,
      dealExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      sortOrder: 0,
      upgradeOptions: {
        create: {
          customTitle: "Add side",
          extraCharge: new Prisma.Decimal("2.00"),
          savingsLabel: null,
          discountPct: null,
          sortOrder: 0,
          linkedItems: {
            create: {
              linkedMenuItemId: linkedItemId,
              linkedSizeId: null,
              itemNameSnapshot: "Side",
              sizeNameSnapshot: null,
              sortOrder: 0,
            },
          },
        },
      },
    },
  });
}

async function getItem(itemId: string) {
  return prisma.menuItem.findUniqueOrThrow({
    where: { id: itemId },
    include: {
      sizes: { orderBy: { sortOrder: "asc" } },
      addons: { orderBy: { sortOrder: "asc" } },
      upgradeOptions: true,
    },
  });
}

async function getAuditCount(itemId: string) {
  return prisma.menuAuditLog.count({
    where: { targetId: itemId, actionType: "ITEM_UPDATED" },
  });
}

async function getRevisionCount(itemId: string) {
  return prisma.menuRevision.count({
    where: { targetId: itemId, reason: "ITEM_UPDATED" },
  });
}

async function getOutletRevision(outletId: string) {
  const row = await prisma.outletMenuVersion.findUnique({
    where: { outletId },
    select: { revision: true },
  });
  return row?.revision ?? 1;
}

async function fullItemPayload(itemId: string, lockVersion: number) {
  const item = await prisma.menuItem.findUniqueOrThrow({
    where: { id: itemId },
    include: {
      sizes: { orderBy: { sortOrder: "asc" } },
      addons: { orderBy: { sortOrder: "asc" } },
    },
  });
  return {
    lockVersion,
    categoryId: item.categoryId,
    comboNum: item.comboNum,
    name: item.name,
    description: item.description,
    price: Number(item.price),
    emoji: item.emoji,
    bgColor: item.bgColor,
    badge: item.badge,
    bundleSavings: item.bundleSavings != null ? Number(item.bundleSavings) : null,
    dealBaseMenuItemId: null,
    dealExpiresAt: null,
    imageUrl: item.imageUrl,
    imageAlt: item.imageAlt,
    imageFit: item.imageFit,
    cardImageUrl: item.cardImageUrl,
    cardImageAlt: item.cardImageAlt,
    isActive: item.isActive,
    isOutOfStock: item.isOutOfStock,
    stockMode: item.stockMode,
    stockQty: item.stockQty,
    lowStockThreshold: item.lowStockThreshold,
    sortOrder: item.sortOrder,
    sizes: item.sizes.map((size) => ({
      id: size.id,
      name: size.name,
      priceDelta: Number(size.priceDelta),
    })),
    addons: item.addons.map((addon) => ({
      id: addon.id,
      name: addon.name,
      priceDelta: Number(addon.priceDelta),
    })),
    upgradeOptions: [],
  };
}

async function cleanup() {
  await prisma.adminSession.deleteMany({
    where: { user: { email: { in: [managerEmail, viewerEmail] } } },
  });
  await prisma.adminUser.deleteMany({
    where: { email: { in: [managerEmail, viewerEmail] } },
  });
  await prisma.stockMovement.deleteMany({
    where: { outletId: { in: [outletAId, outletBId] } },
  });
  await prisma.menuHistoryState.deleteMany({
    where: { outletId: { in: [outletAId, outletBId] } },
  });
  await prisma.menuRevision.deleteMany({
    where: { outletId: { in: [outletAId, outletBId] } },
  });
  await prisma.menuAuditLog.deleteMany({
    where: { outletId: { in: [outletAId, outletBId] } },
  });
  await prisma.upgradeItemLink.deleteMany({
    where: { upgradeOption: { item: { outletId: { in: [outletAId, outletBId] } } } },
  });
  await prisma.upgradeOption.deleteMany({
    where: { item: { outletId: { in: [outletAId, outletBId] } } },
  });
  await prisma.addonOption.deleteMany({
    where: { item: { outletId: { in: [outletAId, outletBId] } } },
  });
  await prisma.sizeOption.deleteMany({
    where: { item: { outletId: { in: [outletAId, outletBId] } } },
  });
  await prisma.menuItem.deleteMany({
    where: { outletId: { in: [outletAId, outletBId] } },
  });
  await prisma.category.deleteMany({
    where: { outletId: { in: [outletAId, outletBId] } },
  });
  await prisma.outletMenuVersion.deleteMany({
    where: { outletId: { in: [outletAId, outletBId] } },
  });
  await prisma.outlet.deleteMany({
    where: { id: { in: [outletAId, outletBId] } },
  });
}

async function main() {
  const modules = await loadModules();
  await cleanup();
  await ensureSiteAndOutlets();
  const { manager, viewer } = await seedUsers();
  const managerToken = await createSession(modules.productionAuth, manager.id);
  const viewerToken = await createSession(modules.productionAuth, viewer.id);

  const normalA = await createCategory(outletAId, `${runId}-normal-a`, "Normal A");
  const normalB = await createCategory(outletBId, `${runId}-normal-b`, "Normal B");
  const dealsA = await createCategory(outletAId, "deals", "Deals");

  try {
    const base = await createItem({
      categoryId: normalA.id,
      outletId: outletAId,
      name: `${runId} Base`,
      price: "5.00",
      badge: "HOT",
      stockMode: "QUANTITY",
      stockQty: 8,
      lowStockThreshold: 2,
      withModifiers: true,
    });
    const side = await createItem({
      categoryId: normalA.id,
      outletId: outletAId,
      name: `${runId} Side`,
      price: "2.00",
    });
    const deal = await createDeal({
      categoryId: dealsA.id,
      outletId: outletAId,
      baseItemId: base.id,
      linkedItemId: side.id,
    });
    const outletBItem = await createItem({
      categoryId: normalB.id,
      outletId: outletBId,
      name: `${runId} Outlet B`,
      price: "7.00",
    });

    console.log("- case 1: anonymous request is rejected");
    const anonymous = await callQuickEdit(
      modules.quickEditRoute,
      base.id,
      { lockVersion: base.lockVersion, price: 5.25 },
      {}
    );
    assert.equal(anonymous.status, 401);

    console.log("- case 2: user without admin.menu.write is rejected");
    const viewerResponse = await callQuickEdit(
      modules.quickEditRoute,
      base.id,
      { lockVersion: base.lockVersion, price: 5.25 },
      { sessionToken: viewerToken, activeOutletId: outletAId }
    );
    assert.equal(viewerResponse.status, 403);

    console.log("- case 3: cross-outlet direct item id is rejected");
    const crossOutlet = await callQuickEdit(
      modules.quickEditRoute,
      outletBItem.id,
      { lockVersion: outletBItem.lockVersion, price: 7.25 },
      { sessionToken: managerToken, activeOutletId: outletAId }
    );
    assert.equal(crossOutlet.status, 403);
    assert.equal(Number((await getItem(outletBItem.id)).price), 7);

    console.log("- case 4: stale lockVersion returns 409 and does not mutate");
    const staleItem = await createItem({
      categoryId: normalA.id,
      outletId: outletAId,
      name: `${runId} Stale`,
      price: "3.00",
    });
    const staleLockVersion = staleItem.lockVersion;
    await prisma.menuItem.update({
      where: { id: staleItem.id },
      data: { description: "Changed elsewhere", lockVersion: { increment: 1 } },
    });
    const stale = await callQuickEdit(
      modules.quickEditRoute,
      staleItem.id,
      { lockVersion: staleLockVersion, price: 3.5 }
    );
    assert.equal(stale.status, 409);
    assert.equal(Number((await getItem(staleItem.id)).price), 3);

    console.log("- case 5: deal badge quick edit works, deal price quick edit is rejected");
    const dealPriceResponse = await callQuickEdit(
      modules.quickEditRoute,
      deal.id,
      { lockVersion: deal.lockVersion, price: 10 }
    );
    assert.equal(dealPriceResponse.status, 400);
    assert.equal(Number((await getItem(deal.id)).price), 9);
    const dealBadgeBefore = await getItem(deal.id);
    const dealBadgeResponse = await callQuickEdit(
      modules.quickEditRoute,
      deal.id,
      { lockVersion: dealBadgeBefore.lockVersion, badge: "HOT" }
    );
    assert.equal(dealBadgeResponse.status, 200);
    const dealAfterBadge = await getItem(deal.id);
    assert.equal(dealAfterBadge.badge, "HOT");
    assert.equal(Number(dealAfterBadge.price), 9);

    console.log("- case 6: invalid price payloads are rejected");
    for (const price of ["", "   ", -1, "not-a-number", true]) {
      const response = await callQuickEdit(
        modules.quickEditRoute,
        base.id,
        { lockVersion: base.lockVersion, price }
      );
      assert.equal(response.status, 400, `invalid price ${String(price)} -> 400`);
    }

    console.log("- case 7: price is rounded to two decimals");
    const roundItem = await createItem({
      categoryId: normalA.id,
      outletId: outletAId,
      name: `${runId} Rounding`,
      price: "4.00",
    });
    const roundResponse = await callQuickEdit(
      modules.quickEditRoute,
      roundItem.id,
      { lockVersion: roundItem.lockVersion, price: 4.126 }
    );
    assert.equal(roundResponse.status, 200);
    assert.equal(Number((await getItem(roundItem.id)).price), 4.13);

    console.log("- case 8: invalid badge is rejected");
    const invalidBadge = await callQuickEdit(
      modules.quickEditRoute,
      roundItem.id,
      {
        lockVersion: (await getItem(roundItem.id)).lockVersion,
        badge: "BOGO",
      }
    );
    assert.equal(invalidBadge.status, 400);

    console.log("- case 9: empty badge clears to null");
    const badgeItem = await createItem({
      categoryId: normalA.id,
      outletId: outletAId,
      name: `${runId} Badge`,
      price: "4.00",
      badge: "POPULAR",
    });
    const clearBadge = await callQuickEdit(
      modules.quickEditRoute,
      badgeItem.id,
      { lockVersion: badgeItem.lockVersion, badge: "" }
    );
    assert.equal(clearBadge.status, 200);
    assert.equal((await getItem(badgeItem.id)).badge, null);

    const whitespaceBadgeItem = await createItem({
      categoryId: normalA.id,
      outletId: outletAId,
      name: `${runId} Whitespace Badge`,
      price: "4.00",
      badge: "HOT",
    });
    const clearWhitespaceBadge = await callQuickEdit(
      modules.quickEditRoute,
      whitespaceBadgeItem.id,
      { lockVersion: whitespaceBadgeItem.lockVersion, badge: "   " }
    );
    assert.equal(clearWhitespaceBadge.status, 200);
    assert.equal((await getItem(whitespaceBadgeItem.id)).badge, null);

    console.log("- case 10: price-only edit writes one audit/revision/version");
    const auditBefore = await getAuditCount(base.id);
    const revisionBefore = await getRevisionCount(base.id);
    const versionBefore = await getOutletRevision(outletAId);
    const stockMovementBefore = await prisma.stockMovement.count({
      where: { outletId: outletAId },
    });
    const baseBefore = await getItem(base.id);
    const priceOnly = await callQuickEdit(
      modules.quickEditRoute,
      base.id,
      { lockVersion: baseBefore.lockVersion, price: 5.5 }
    );
    assert.equal(priceOnly.status, 200);
    const priceOnlyJson = await readJson(priceOnly);
    assert.equal(priceOnlyJson.price, 5.5);
    assert.equal(priceOnlyJson.lockVersion, baseBefore.lockVersion + 1);
    const baseAfterPrice = await getItem(base.id);
    assert.equal(Number(baseAfterPrice.price), 5.5);
    assert.equal(baseAfterPrice.lockVersion, baseBefore.lockVersion + 1);
    assert.equal(baseAfterPrice.badge, "HOT");
    assert.equal(await getAuditCount(base.id), auditBefore + 1);
    assert.equal(await getRevisionCount(base.id), revisionBefore + 1);
    assert.equal(await getOutletRevision(outletAId), versionBefore + 1);
    assert.equal(
      await prisma.stockMovement.count({ where: { outletId: outletAId } }),
      stockMovementBefore
    );

    console.log("- case 11: badge-only edit updates only badge content fields");
    const badgeOnlyBefore = await getItem(base.id);
    const badgeOnly = await callQuickEdit(
      modules.quickEditRoute,
      base.id,
      { lockVersion: badgeOnlyBefore.lockVersion, badge: "NEW" }
    );
    assert.equal(badgeOnly.status, 200);
    const badgeOnlyAfter = await getItem(base.id);
    assert.equal(Number(badgeOnlyAfter.price), 5.5);
    assert.equal(badgeOnlyAfter.badge, "NEW");

    console.log("- case 12: combined price+badge edit works");
    const combinedBefore = await getItem(base.id);
    const combined = await callQuickEdit(
      modules.quickEditRoute,
      base.id,
      {
        lockVersion: combinedBefore.lockVersion,
        price: 6.25,
        badge: null,
      }
    );
    assert.equal(combined.status, 200);
    const combinedAfter = await getItem(base.id);
    assert.equal(Number(combinedAfter.price), 6.25);
    assert.equal(combinedAfter.badge, null);

    console.log("- case 13: no-op normalized values create no audit/revision/version");
    const noOpBefore = await getItem(base.id);
    const noOpAuditBefore = await getAuditCount(base.id);
    const noOpRevisionBefore = await getRevisionCount(base.id);
    const noOpVersionBefore = await getOutletRevision(outletAId);
    const noOp = await callQuickEdit(
      modules.quickEditRoute,
      base.id,
      {
        lockVersion: noOpBefore.lockVersion,
        price: "6.250",
        badge: "",
      }
    );
    assert.equal(noOp.status, 200);
    assert.equal((await getItem(base.id)).lockVersion, noOpBefore.lockVersion);
    assert.equal(await getAuditCount(base.id), noOpAuditBefore);
    assert.equal(await getRevisionCount(base.id), noOpRevisionBefore);
    assert.equal(await getOutletRevision(outletAId), noOpVersionBefore);

    console.log("- case 14: modifiers, stock, image, category, sort, active state untouched");
    const integrityBefore = await getItem(base.id);
    const integrityResponse = await callQuickEdit(
      modules.quickEditRoute,
      base.id,
      { lockVersion: integrityBefore.lockVersion, price: 6.75 }
    );
    assert.equal(integrityResponse.status, 200);
    const integrityAfter = await getItem(base.id);
    assert.deepEqual(
      integrityAfter.sizes.map((size) => ({
        id: size.id,
        name: size.name,
        priceDelta: Number(size.priceDelta),
        sortOrder: size.sortOrder,
      })),
      integrityBefore.sizes.map((size) => ({
        id: size.id,
        name: size.name,
        priceDelta: Number(size.priceDelta),
        sortOrder: size.sortOrder,
      }))
    );
    assert.deepEqual(
      integrityAfter.addons.map((addon) => ({
        id: addon.id,
        name: addon.name,
        priceDelta: Number(addon.priceDelta),
        sortOrder: addon.sortOrder,
      })),
      integrityBefore.addons.map((addon) => ({
        id: addon.id,
        name: addon.name,
        priceDelta: Number(addon.priceDelta),
        sortOrder: addon.sortOrder,
      }))
    );
    assert.equal(integrityAfter.stockMode, integrityBefore.stockMode);
    assert.equal(integrityAfter.stockQty, integrityBefore.stockQty);
    assert.equal(integrityAfter.lowStockThreshold, integrityBefore.lowStockThreshold);
    assert.equal(
      integrityAfter.stockUpdatedAt?.toISOString() ?? null,
      integrityBefore.stockUpdatedAt?.toISOString() ?? null
    );
    assert.equal(integrityAfter.stockUpdatedById, integrityBefore.stockUpdatedById);
    assert.equal(integrityAfter.categoryId, integrityBefore.categoryId);
    assert.equal(integrityAfter.sortOrder, integrityBefore.sortOrder);
    assert.equal(integrityAfter.isActive, integrityBefore.isActive);
    assert.equal(integrityAfter.isOutOfStock, integrityBefore.isOutOfStock);

    console.log("- case 15: strict unknown-field payload rejection");
    const strictBefore = await getItem(base.id);
    const strict = await callQuickEdit(
      modules.quickEditRoute,
      base.id,
      {
        lockVersion: strictBefore.lockVersion,
        price: 7.25,
        categoryId: normalB.id,
      }
    );
    assert.equal(strict.status, 400);
    assert.equal((await getItem(base.id)).categoryId, strictBefore.categoryId);

    console.log("- case 16: concurrent same-lockVersion requests produce one winner");
    const concurrentItem = await createItem({
      categoryId: normalA.id,
      outletId: outletAId,
      name: `${runId} Concurrent`,
      price: "8.00",
    });
    const concurrentLockVersion = concurrentItem.lockVersion;
    const [first, second] = await Promise.all([
      callQuickEdit(modules.quickEditRoute, concurrentItem.id, {
        lockVersion: concurrentLockVersion,
        price: 8.5,
      }),
      callQuickEdit(modules.quickEditRoute, concurrentItem.id, {
        lockVersion: concurrentLockVersion,
        badge: "HOT",
      }),
    ]);
    assert.deepEqual(
      [first.status, second.status].sort(),
      [200, 409],
      "one concurrent request should win and one should conflict"
    );
    assert.equal(await getAuditCount(concurrentItem.id), 1);
    assert.equal(await getRevisionCount(concurrentItem.id), 1);

    console.log("- case 17: stale full modal save conflicts after quick edit");
    const modalItem = await createItem({
      categoryId: normalA.id,
      outletId: outletAId,
      name: `${runId} Modal Conflict`,
      price: "9.00",
      withModifiers: true,
    });
    const modalStaleLockVersion = modalItem.lockVersion;
    const quickBeforeModal = await callQuickEdit(
      modules.quickEditRoute,
      modalItem.id,
      { lockVersion: modalStaleLockVersion, price: 9.5 }
    );
    assert.equal(quickBeforeModal.status, 200);
    const fullPayload = await fullItemPayload(modalItem.id, modalStaleLockVersion);
    const staleModal = await modules.fullItemRoute.PATCH(
      routeRequest({
        path: `/api/admin/items/${modalItem.id}`,
        body: fullPayload,
        legacyAuth: true,
      }),
      paramsOf(modalItem.id)
    );
    assert.equal(staleModal.status, 409);

    console.log(
      "- case 17b: full modal manual stock preserves dormant quantity values"
    );
    const manualStockItem = await createItem({
      categoryId: normalA.id,
      outletId: outletAId,
      name: `${runId} Manual Preserve`,
      price: "9.00",
      stockMode: "QUANTITY",
      stockQty: 9,
      lowStockThreshold: 3,
      withModifiers: true,
    });
    const manualStockPayload = await fullItemPayload(
      manualStockItem.id,
      manualStockItem.lockVersion
    );
    const manualStockResponse = await modules.fullItemRoute.PATCH(
      routeRequest({
        path: `/api/admin/items/${manualStockItem.id}`,
        body: {
          ...manualStockPayload,
          stockMode: "MANUAL",
          isOutOfStock: true,
          stockQty: null,
          lowStockThreshold: null,
        },
        legacyAuth: true,
      }),
      paramsOf(manualStockItem.id)
    );
    assert.equal(manualStockResponse.status, 200);
    const manualStockAfter = await getItem(manualStockItem.id);
    assert.equal(manualStockAfter.stockMode, "MANUAL");
    assert.equal(manualStockAfter.isOutOfStock, true);
    assert.equal(manualStockAfter.stockQty, 9);
    assert.equal(manualStockAfter.lowStockThreshold, 3);

    console.log(
      "- case 17c: full modal quantity edit preserves paused selling state"
    );
    const pausedQuantityItem = await createItem({
      categoryId: normalA.id,
      outletId: outletAId,
      name: `${runId} Paused Quantity Preserve`,
      price: "9.00",
      isOutOfStock: true,
      stockMode: "QUANTITY",
      stockQty: 10,
      lowStockThreshold: 3,
      withModifiers: true,
    });
    const pausedQuantityPayload = await fullItemPayload(
      pausedQuantityItem.id,
      pausedQuantityItem.lockVersion
    );
    const pausedQuantityResponse = await modules.fullItemRoute.PATCH(
      routeRequest({
        path: `/api/admin/items/${pausedQuantityItem.id}`,
        body: {
          ...pausedQuantityPayload,
          stockQty: 12,
        },
        legacyAuth: true,
      }),
      paramsOf(pausedQuantityItem.id)
    );
    assert.equal(pausedQuantityResponse.status, 200);
    const pausedQuantityAfter = await getItem(pausedQuantityItem.id);
    assert.equal(pausedQuantityAfter.stockMode, "QUANTITY");
    assert.equal(pausedQuantityAfter.isOutOfStock, true);
    assert.equal(pausedQuantityAfter.stockQty, 12);
    assert.equal(pausedQuantityAfter.lowStockThreshold, 3);

    console.log("- case 18: hidden and sized non-deal rows can be quick-edited");
    const hidden = await createItem({
      categoryId: normalA.id,
      outletId: outletAId,
      name: `${runId} Hidden`,
      price: "4.00",
      isActive: false,
      withModifiers: true,
    });
    const hiddenResponse = await callQuickEdit(
      modules.quickEditRoute,
      hidden.id,
      { lockVersion: hidden.lockVersion, price: 4.5 }
    );
    assert.equal(hiddenResponse.status, 200);
    assert.equal(Number((await getItem(hidden.id)).price), 4.5);

    console.log("- case 19: legacy Basic Auth is accepted during migration window");
    const legacyItem = await createItem({
      categoryId: normalA.id,
      outletId: outletAId,
      name: `${runId} Legacy`,
      price: "4.00",
    });
    const legacy = await callQuickEdit(
      modules.quickEditRoute,
      legacyItem.id,
      { lockVersion: legacyItem.lockVersion, badge: "POPULAR" },
      { legacyAuth: true }
    );
    assert.equal(legacy.status, 200);
    assert.equal((await getItem(legacyItem.id)).badge, "POPULAR");

    console.log("- case 20: quick edit bumps menu version for deal-dependent base item");
    const versionBaseBefore = await getOutletRevision(outletAId);
    const latestBase = await getItem(base.id);
    const dependentBaseEdit = await callQuickEdit(
      modules.quickEditRoute,
      base.id,
      { lockVersion: latestBase.lockVersion, price: 7.25 }
    );
    assert.equal(dependentBaseEdit.status, 200);
    assert.equal(await getOutletRevision(outletAId), versionBaseBefore + 1);

    console.log("✓ admin item quick-edit route tests passed");
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

main().catch(async (err) => {
  console.error(err);
  await cleanup().catch(() => undefined);
  await prisma.$disconnect();
  process.exit(1);
});
