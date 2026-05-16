/* eslint-disable no-console */
import "dotenv/config";

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DEFAULT_SITE_ID } from "@/lib/outlets";

// ── Setup ─────────────────────────────────────────────────────────────────────
// Use legacy basic-auth path. requireAdminApiPermission short-circuits when
// hasValidAdminAuth(req) returns true (admin-sessions.ts:261); that path
// bypasses outlet scoping (cross-outlet 403 is covered by the rbac test).
process.env.ADMIN_PASSWORD = "test-admin-password";
const ADMIN_AUTH = `Basic ${Buffer.from(`:${process.env.ADMIN_PASSWORD}`).toString("base64")}`;

const require = createRequire(import.meta.url);
const runId = `reorder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const outletId = `outlet-${runId}`;

type RouteModule = typeof import("@/app/api/admin/categories/[id]/reorder/route");

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

async function loadRoute(): Promise<RouteModule> {
  stubServerOnly();
  return import("@/app/api/admin/categories/[id]/reorder/route");
}

function makeRequest(categoryId: string, body: unknown) {
  return new NextRequest(
    `http://localhost/api/admin/categories/${categoryId}/reorder`,
    {
      method: "POST",
      headers: {
        authorization: ADMIN_AUTH,
        origin: "http://localhost",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
}

function paramsOf(categoryId: string) {
  // Route param is `id` (Next.js requires sibling slugs to match — see
  // categories/[id]/route.ts), but locally we keep the variable name
  // `categoryId` for clarity.
  return { params: Promise.resolve({ id: categoryId }) };
}

// ── Seed helpers ──────────────────────────────────────────────────────────────
async function ensureSiteAndOutlet() {
  await prisma.site.upsert({
    where: { id: DEFAULT_SITE_ID },
    update: {},
    create: {
      id: DEFAULT_SITE_ID,
      name: "Rushbite",
      timezone: "America/Edmonton",
    },
  });
  await prisma.outlet.upsert({
    where: { id: outletId },
    update: {},
    create: {
      id: outletId,
      siteId: DEFAULT_SITE_ID,
      name: `Reorder test ${runId}`,
      slug: outletId,
      orderPrefix: `R${String(Date.now()).slice(-6)}`,
      isActive: true,
    },
  });
}

type SeedItem = {
  id: string;
  name: string;
  sortOrder: number;
  badge?: string;
  withSizes?: boolean;
  withAddons?: boolean;
};

async function seedCategoryWithItems(
  categoryId: string,
  categoryName: string,
  items: SeedItem[]
) {
  // Seed category and items with timestamps in the past so updatedAt
  // comparisons in case 7 don't flake on same-millisecond writes.
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await prisma.category.create({
    data: {
      id: categoryId,
      outletId,
      name: categoryName,
      slug: categoryId,
      icon: "🍔",
      sortOrder: 0,
      isActive: true,
      createdAt: past,
      updatedAt: past,
    },
  });
  for (const item of items) {
    await prisma.menuItem.create({
      data: {
        id: item.id,
        categoryId,
        outletId,
        name: item.name,
        description: "Test item",
        price: new Prisma.Decimal("9.99"),
        emoji: "🍔",
        bgColor: "#FFE3B3",
        badge: item.badge ?? null,
        sortOrder: item.sortOrder,
        isActive: true,
        isOutOfStock: false,
        createdAt: past,
        updatedAt: past,
        sizes: item.withSizes
          ? {
              create: [
                { name: "Small", priceDelta: new Prisma.Decimal("0"), sortOrder: 0 },
                { name: "Large", priceDelta: new Prisma.Decimal("2"), sortOrder: 1 },
              ],
            }
          : undefined,
        addons: item.withAddons
          ? {
              create: [
                { name: "Cheese", priceDelta: new Prisma.Decimal("1"), sortOrder: 0 },
                { name: "Bacon", priceDelta: new Prisma.Decimal("2"), sortOrder: 1 },
              ],
            }
          : undefined,
      },
    });
  }
}

async function getCategoryUpdatedAt(categoryId: string): Promise<string> {
  const c = await prisma.category.findUniqueOrThrow({
    where: { id: categoryId },
    select: { updatedAt: true },
  });
  return c.updatedAt.toISOString();
}

async function getItemOrder(categoryId: string): Promise<string[]> {
  const rows = await prisma.menuItem.findMany({
    where: { categoryId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

async function getAuditCount(categoryId: string): Promise<number> {
  return prisma.menuAuditLog.count({
    where: { targetId: categoryId, actionType: "MENU_REORDERED" },
  });
}

async function getRevisionCount(categoryId: string): Promise<number> {
  return prisma.menuRevision.count({
    where: { targetId: categoryId, reason: "MENU_REORDERED" },
  });
}

async function clearOutlet() {
  // Delete ordered children before parents.
  await prisma.menuRevision.deleteMany({ where: { outletId } });
  await prisma.menuAuditLog.deleteMany({ where: { outletId } });
  await prisma.menuHistoryState.deleteMany({ where: { outletId } });
  await prisma.upgradeItemLink.deleteMany({
    where: { upgradeOption: { item: { outletId } } },
  });
  await prisma.upgradeOption.deleteMany({ where: { item: { outletId } } });
  await prisma.addonOption.deleteMany({ where: { item: { outletId } } });
  await prisma.sizeOption.deleteMany({ where: { item: { outletId } } });
  await prisma.menuItem.deleteMany({ where: { outletId } });
  await prisma.category.deleteMany({ where: { outletId } });
}

async function cleanup() {
  await clearOutlet();
  await prisma.outlet.deleteMany({ where: { id: outletId } });
}

// ── Cases ─────────────────────────────────────────────────────────────────────

async function caseHappyPath(route: RouteModule, ctx: { catId: string }) {
  await seedCategoryWithItems(ctx.catId, "Burgers", [
    { id: `${ctx.catId}-a`, name: "Alpha", sortOrder: 0 },
    { id: `${ctx.catId}-b`, name: "Beta", sortOrder: 1 },
    { id: `${ctx.catId}-c`, name: "Gamma", sortOrder: 2 },
  ]);
  const updatedAt = await getCategoryUpdatedAt(ctx.catId);
  const before = await getItemOrder(ctx.catId);
  const orderedItemIds = [before[2], before[0], before[1]];
  const res = await route.POST(
    makeRequest(ctx.catId, {
      updatedAt,
      expectedCurrentOrder: before,
      orderedItemIds,
    }),
    paramsOf(ctx.catId)
  );
  assert.equal(res.status, 200, "happy path → 200");
  const body = (await res.json()) as { changed: boolean; items: { id: string; sortOrder: number }[] };
  assert.equal(body.changed, true, "happy path → changed=true");
  assert.deepEqual(
    body.items.map((i) => i.id),
    orderedItemIds,
    "happy path → response items in new order"
  );
  const dbOrder = await getItemOrder(ctx.catId);
  assert.deepEqual(dbOrder, orderedItemIds, "happy path → DB order matches request");
  console.log("✓ case 1: happy path");
}

async function caseAuditAndRevision(ctx: { catId: string }) {
  const auditCount = await getAuditCount(ctx.catId);
  const revisionCount = await getRevisionCount(ctx.catId);
  assert.equal(auditCount, 1, "exactly one MENU_REORDERED audit row");
  assert.equal(revisionCount, 1, "exactly one MENU_REORDERED revision row");
  const audit = await prisma.menuAuditLog.findFirstOrThrow({
    where: { targetId: ctx.catId, actionType: "MENU_REORDERED" },
  });
  assert.equal(audit.targetType, "CATEGORY", "audit targetType=CATEGORY");
  const before = audit.beforePayload as { orderedItemIds: string[] };
  const after = audit.afterPayload as { orderedItemIds: string[] };
  assert.ok(Array.isArray(before.orderedItemIds), "audit beforePayload has orderedItemIds");
  assert.ok(Array.isArray(after.orderedItemIds), "audit afterPayload has orderedItemIds");
  const state = await prisma.menuHistoryState.findFirst({ where: { outletId } });
  assert.ok(state?.currentRevisionId, "menuHistoryState.currentRevisionId set");
  console.log("✓ case 2+3: single audit + revision rows written");
}

async function caseModifierIntegrity(route: RouteModule) {
  const catId = `${runId}-mods`;
  await seedCategoryWithItems(catId, "WithMods", [
    { id: `${catId}-i1`, name: "WithSizesAddons", sortOrder: 0, withSizes: true, withAddons: true },
    { id: `${catId}-i2`, name: "Plain", sortOrder: 1 },
  ]);
  const sizesBefore = await prisma.sizeOption.findMany({
    where: { item: { categoryId: catId } },
    orderBy: [{ itemId: "asc" }, { sortOrder: "asc" }],
  });
  const addonsBefore = await prisma.addonOption.findMany({
    where: { item: { categoryId: catId } },
    orderBy: [{ itemId: "asc" }, { sortOrder: "asc" }],
  });

  const updatedAt = await getCategoryUpdatedAt(catId);
  const before = await getItemOrder(catId);
  await route.POST(
    makeRequest(catId, {
      updatedAt,
      expectedCurrentOrder: before,
      orderedItemIds: [before[1], before[0]],
    }),
    paramsOf(catId)
  );

  const sizesAfter = await prisma.sizeOption.findMany({
    where: { item: { categoryId: catId } },
    orderBy: [{ itemId: "asc" }, { sortOrder: "asc" }],
  });
  const addonsAfter = await prisma.addonOption.findMany({
    where: { item: { categoryId: catId } },
    orderBy: [{ itemId: "asc" }, { sortOrder: "asc" }],
  });
  assert.equal(sizesAfter.length, sizesBefore.length, "size row count unchanged");
  assert.equal(addonsAfter.length, addonsBefore.length, "addon row count unchanged");
  for (let i = 0; i < sizesBefore.length; i++) {
    assert.equal(sizesAfter[i].id, sizesBefore[i].id, "size id unchanged");
    assert.equal(sizesAfter[i].name, sizesBefore[i].name, "size name unchanged");
    assert.equal(
      sizesAfter[i].priceDelta.toString(),
      sizesBefore[i].priceDelta.toString(),
      "size priceDelta unchanged"
    );
    assert.equal(sizesAfter[i].sortOrder, sizesBefore[i].sortOrder, "size sortOrder unchanged");
  }
  for (let i = 0; i < addonsBefore.length; i++) {
    assert.equal(addonsAfter[i].id, addonsBefore[i].id, "addon id unchanged");
    assert.equal(addonsAfter[i].name, addonsBefore[i].name, "addon name unchanged");
  }
  console.log("✓ case 4: SizeOption/AddonOption rows untouched by reorder");
}

async function caseItemFlagIntegrity(route: RouteModule) {
  const catId = `${runId}-flags`;
  await seedCategoryWithItems(catId, "Flags", [
    { id: `${catId}-x`, name: "X", sortOrder: 0 },
    { id: `${catId}-y`, name: "Y", sortOrder: 1 },
  ]);
  const before = await prisma.menuItem.findMany({
    where: { categoryId: catId },
    select: { id: true, isActive: true, isOutOfStock: true, stockMode: true, stockQty: true },
    orderBy: { id: "asc" },
  });
  const updatedAt = await getCategoryUpdatedAt(catId);
  const beforeOrder = await getItemOrder(catId);
  await route.POST(
    makeRequest(catId, {
      updatedAt,
      expectedCurrentOrder: beforeOrder,
      orderedItemIds: [beforeOrder[1], beforeOrder[0]],
    }),
    paramsOf(catId)
  );
  const after = await prisma.menuItem.findMany({
    where: { categoryId: catId },
    select: { id: true, isActive: true, isOutOfStock: true, stockMode: true, stockQty: true },
    orderBy: { id: "asc" },
  });
  for (let i = 0; i < before.length; i++) {
    assert.equal(after[i].isActive, before[i].isActive, "isActive unchanged");
    assert.equal(after[i].isOutOfStock, before[i].isOutOfStock, "isOutOfStock unchanged");
    assert.equal(after[i].stockMode, before[i].stockMode, "stockMode unchanged");
    assert.equal(after[i].stockQty, before[i].stockQty, "stockQty unchanged");
  }
  console.log("✓ case 6: item flags untouched");
}

async function caseUpdatedAtBumped(route: RouteModule) {
  const catId = `${runId}-bump`;
  await seedCategoryWithItems(catId, "Bump", [
    { id: `${catId}-1`, name: "One", sortOrder: 0 },
    { id: `${catId}-2`, name: "Two", sortOrder: 1 },
    { id: `${catId}-3`, name: "Three", sortOrder: 2 },
  ]);
  const before = await prisma.menuItem.findMany({
    where: { categoryId: catId },
    select: { id: true, sortOrder: true, updatedAt: true },
    orderBy: { sortOrder: "asc" },
  });
  const beforeMap = new Map(before.map((i) => [i.id, i]));
  const updatedAt = await getCategoryUpdatedAt(catId);
  const beforeOrder = before.map((i) => i.id);
  // Move only item 3 to position 0, 1 stays, 2 stays. Items 1+2 will shift
  // their sortOrder; item 3 also moves. None of the rows whose new index
  // matches their old sortOrder should be touched (= no rows match here,
  // all three sortOrders change).
  const newOrder = [beforeOrder[2], beforeOrder[0], beforeOrder[1]];
  await route.POST(
    makeRequest(catId, {
      updatedAt,
      expectedCurrentOrder: beforeOrder,
      orderedItemIds: newOrder,
    }),
    paramsOf(catId)
  );
  const after = await prisma.menuItem.findMany({
    where: { categoryId: catId },
    select: { id: true, sortOrder: true, updatedAt: true },
  });
  for (const row of after) {
    const beforeRow = beforeMap.get(row.id)!;
    if (beforeRow.sortOrder !== row.sortOrder) {
      assert.ok(
        row.updatedAt.getTime() > beforeRow.updatedAt.getTime(),
        `updatedAt bumped for moved item ${row.id}`
      );
    }
  }
  console.log("✓ case 7: updatedAt bumped on every reordered row");
}

async function caseNoOpShortCircuit(route: RouteModule) {
  const catId = `${runId}-noop`;
  await seedCategoryWithItems(catId, "Noop", [
    { id: `${catId}-1`, name: "First", sortOrder: 0 },
    { id: `${catId}-2`, name: "Second", sortOrder: 1 },
  ]);
  const updatedAt = await getCategoryUpdatedAt(catId);
  const before = await getItemOrder(catId);
  const beforeRows = await prisma.menuItem.findMany({
    where: { categoryId: catId },
    select: { id: true, updatedAt: true },
  });
  const auditBefore = await getAuditCount(catId);
  const revBefore = await getRevisionCount(catId);

  const res = await route.POST(
    makeRequest(catId, {
      updatedAt,
      expectedCurrentOrder: before,
      orderedItemIds: before, // identical → no-op
    }),
    paramsOf(catId)
  );
  assert.equal(res.status, 200, "no-op → 200");
  const body = (await res.json()) as { changed: boolean };
  assert.equal(body.changed, false, "no-op → changed=false");

  const afterRows = await prisma.menuItem.findMany({
    where: { categoryId: catId },
    select: { id: true, updatedAt: true },
  });
  for (const row of afterRows) {
    const beforeRow = beforeRows.find((b) => b.id === row.id)!;
    assert.equal(
      row.updatedAt.getTime(),
      beforeRow.updatedAt.getTime(),
      "no-op → no updatedAt bumps"
    );
  }
  assert.equal(await getAuditCount(catId), auditBefore, "no-op → no new audit row");
  assert.equal(await getRevisionCount(catId), revBefore, "no-op → no new revision row");
  console.log("✓ case 8: no-op short-circuits without writes");
}

async function caseStaleCategoryUpdatedAt(route: RouteModule) {
  const catId = `${runId}-stale`;
  await seedCategoryWithItems(catId, "Stale", [
    { id: `${catId}-1`, name: "A", sortOrder: 0 },
    { id: `${catId}-2`, name: "B", sortOrder: 1 },
  ]);
  const before = await getItemOrder(catId);
  const staleUpdatedAt = await getCategoryUpdatedAt(catId);
  // Bump category updatedAt out-of-band.
  await prisma.category.update({
    where: { id: catId },
    data: { name: "StaleRenamed" },
  });
  const res = await route.POST(
    makeRequest(catId, {
      updatedAt: staleUpdatedAt,
      expectedCurrentOrder: before,
      orderedItemIds: [before[1], before[0]],
    }),
    paramsOf(catId)
  );
  assert.equal(res.status, 409, "stale category updatedAt → 409");
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /Category changed/, "stale → category-changed message");
  console.log("✓ case 9: 409 on stale Category.updatedAt");
}

async function caseCompetingReorderGuard(route: RouteModule) {
  const catId = `${runId}-compete`;
  await seedCategoryWithItems(catId, "Compete", [
    { id: `${catId}-a`, name: "A", sortOrder: 0 },
    { id: `${catId}-b`, name: "B", sortOrder: 1 },
    { id: `${catId}-c`, name: "C", sortOrder: 2 },
  ]);
  const updatedAt = await getCategoryUpdatedAt(catId);
  const A_view = await getItemOrder(catId);
  // B reorders first.
  const resB = await route.POST(
    makeRequest(catId, {
      updatedAt,
      expectedCurrentOrder: A_view,
      orderedItemIds: [A_view[2], A_view[0], A_view[1]],
    }),
    paramsOf(catId)
  );
  assert.equal(resB.status, 200, "B succeeds");
  // A submits using its stale view → expectedCurrentOrder mismatch.
  const resA = await route.POST(
    makeRequest(catId, {
      updatedAt,
      expectedCurrentOrder: A_view, // stale
      orderedItemIds: [A_view[1], A_view[0], A_view[2]],
    }),
    paramsOf(catId)
  );
  assert.equal(resA.status, 409, "A → 409 (committed competing reorder)");
  const body = (await resA.json()) as { error: string };
  assert.match(body.error, /Menu order changed/, "A → order-changed message");
  console.log("✓ case 10: 409 on committed competing reorder");
}

async function caseMissingItemId(route: RouteModule) {
  const catId = `${runId}-missing`;
  await seedCategoryWithItems(catId, "Missing", [
    { id: `${catId}-a`, name: "A", sortOrder: 0 },
    { id: `${catId}-b`, name: "B", sortOrder: 1 },
    { id: `${catId}-c`, name: "C", sortOrder: 2 },
  ]);
  const updatedAt = await getCategoryUpdatedAt(catId);
  const before = await getItemOrder(catId);
  const res = await route.POST(
    makeRequest(catId, {
      updatedAt,
      expectedCurrentOrder: before.slice(0, 2), // length mismatch (3 vs 2)
      orderedItemIds: [before[0], before[1]],
    }),
    paramsOf(catId)
  );
  assert.equal(res.status, 409, "set mismatch (length) → 409");
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /Menu order changed/, "length-mismatch surfaces as order-changed");
  console.log("✓ case 11: 409 when orderedItemIds length doesn't match");
}

async function caseExtraForeignId(route: RouteModule) {
  const catId = `${runId}-extra`;
  const otherCatId = `${runId}-extra-other`;
  await seedCategoryWithItems(catId, "Extra", [
    { id: `${catId}-a`, name: "A", sortOrder: 0 },
    { id: `${catId}-b`, name: "B", sortOrder: 1 },
  ]);
  await seedCategoryWithItems(otherCatId, "Other", [
    { id: `${otherCatId}-x`, name: "X", sortOrder: 0 },
  ]);
  const updatedAt = await getCategoryUpdatedAt(catId);
  const before = await getItemOrder(catId);
  const res = await route.POST(
    makeRequest(catId, {
      updatedAt,
      expectedCurrentOrder: before,
      orderedItemIds: [before[0], `${otherCatId}-x`], // foreign id swapped in
    }),
    paramsOf(catId)
  );
  assert.equal(res.status, 409, "foreign id → 409");
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /Category items changed/, "foreign id → set-mismatch message");
  console.log("✓ case 12: 409 when orderedItemIds includes a foreign id");
}

async function caseDuplicateIds(route: RouteModule) {
  const catId = `${runId}-dups`;
  await seedCategoryWithItems(catId, "Dups", [
    { id: `${catId}-a`, name: "A", sortOrder: 0 },
    { id: `${catId}-b`, name: "B", sortOrder: 1 },
  ]);
  const updatedAt = await getCategoryUpdatedAt(catId);
  const before = await getItemOrder(catId);
  const res = await route.POST(
    makeRequest(catId, {
      updatedAt,
      expectedCurrentOrder: before,
      orderedItemIds: [before[0], before[0]], // duplicate
    }),
    paramsOf(catId)
  );
  assert.equal(res.status, 400, "duplicate ids → 400");
  console.log("✓ case 13: 400 on duplicate orderedItemIds");
}

async function caseEmptyArray(route: RouteModule) {
  const catId = `${runId}-empty`;
  await seedCategoryWithItems(catId, "Empty", [
    { id: `${catId}-a`, name: "A", sortOrder: 0 },
  ]);
  const updatedAt = await getCategoryUpdatedAt(catId);
  const res = await route.POST(
    makeRequest(catId, {
      updatedAt,
      expectedCurrentOrder: [],
      orderedItemIds: [],
    }),
    paramsOf(catId)
  );
  assert.equal(res.status, 400, "empty arrays → 400");
  console.log("✓ case 14: 400 on empty arrays");
}

async function caseLengthMismatch(route: RouteModule) {
  const catId = `${runId}-lenmiss`;
  await seedCategoryWithItems(catId, "LenMiss", [
    { id: `${catId}-a`, name: "A", sortOrder: 0 },
    { id: `${catId}-b`, name: "B", sortOrder: 1 },
  ]);
  const updatedAt = await getCategoryUpdatedAt(catId);
  const before = await getItemOrder(catId);
  const res = await route.POST(
    makeRequest(catId, {
      updatedAt,
      expectedCurrentOrder: before, // length 2
      orderedItemIds: [before[0]], // length 1 — body-validation level
    }),
    paramsOf(catId)
  );
  assert.equal(res.status, 400, "expectedCurrentOrder/orderedItemIds length mismatch → 400");
  console.log("✓ case 15: 400 on expectedCurrentOrder/orderedItemIds length mismatch");
}

async function caseTripleTieBreak(route: RouteModule) {
  // Three items with two-way collision: A is alone, B and C share sortOrder
  // AND name. Endpoint must order them by id (asc) as final tiebreaker.
  const catId = `${runId}-triple`;
  // Pick ids such that we know the alphabetical order: zZZ < zzz lexicographically? Use explicit ids.
  const idA = `${catId}-id-A`;
  const idB1 = `${catId}-id-B-aaa`;
  const idB2 = `${catId}-id-B-bbb`;
  await seedCategoryWithItems(catId, "Triple", [
    { id: idA, name: "Zoo", sortOrder: 0 },
    { id: idB1, name: "Apple", sortOrder: 1 },
    { id: idB2, name: "Apple", sortOrder: 1 }, // same sortOrder + same name as idB1
  ]);
  const before = await getItemOrder(catId);
  // Expected order: A first (sortOrder=0), then idB1 then idB2 (id-asc tiebreak).
  assert.deepEqual(before, [idA, idB1, idB2], "endpoint orders by [sortOrder, name, id]");

  // Submit a wrong order (B1 and B2 swapped) → must 409.
  const updatedAt = await getCategoryUpdatedAt(catId);
  const wrongRes = await route.POST(
    makeRequest(catId, {
      updatedAt,
      expectedCurrentOrder: [idA, idB2, idB1], // wrong tie-break
      orderedItemIds: [idB1, idA, idB2],
    }),
    paramsOf(catId)
  );
  assert.equal(wrongRes.status, 409, "wrong tie-break → 409");

  // Submit the correct order → succeeds.
  const okRes = await route.POST(
    makeRequest(catId, {
      updatedAt,
      expectedCurrentOrder: [idA, idB1, idB2],
      orderedItemIds: [idB2, idB1, idA],
    }),
    paramsOf(catId)
  );
  assert.equal(okRes.status, 200, "correct tie-break → 200");
  console.log("✓ case 17: triple tie-break by [sortOrder, name, id]");
}

async function caseConcurrentRace(route: RouteModule) {
  const catId = `${runId}-race`;
  await seedCategoryWithItems(catId, "Race", [
    { id: `${catId}-a`, name: "A", sortOrder: 0 },
    { id: `${catId}-b`, name: "B", sortOrder: 1 },
    { id: `${catId}-c`, name: "C", sortOrder: 2 },
  ]);
  const updatedAt = await getCategoryUpdatedAt(catId);
  const start = await getItemOrder(catId);
  const auditBefore = await getAuditCount(catId);

  const reqA = makeRequest(catId, {
    updatedAt,
    expectedCurrentOrder: start,
    orderedItemIds: [start[2], start[0], start[1]],
  });
  const reqB = makeRequest(catId, {
    updatedAt,
    expectedCurrentOrder: start,
    orderedItemIds: [start[1], start[2], start[0]],
  });
  const [resA, resB] = await Promise.all([
    route.POST(reqA, paramsOf(catId)),
    route.POST(reqB, paramsOf(catId)),
  ]);
  const statuses = [resA.status, resB.status].sort();
  assert.deepEqual(
    statuses,
    [200, 409],
    `concurrent reorders → exactly one 200 and one 409 (got [${statuses.join(", ")}])`
  );

  const winner = resA.status === 200 ? resA : resB;
  const winnerBody = (await winner.json()) as { items: { id: string }[] };
  const finalOrder = await getItemOrder(catId);
  assert.deepEqual(
    finalOrder,
    winnerBody.items.map((i) => i.id),
    "DB final order matches winner's response"
  );
  const auditAfter = await getAuditCount(catId);
  assert.equal(
    auditAfter - auditBefore,
    1,
    "exactly one MENU_REORDERED audit row from the racing pair"
  );
  console.log("✓ case 18: concurrent reorders — one winner, one 409, single audit row");
}

// ── Runner ────────────────────────────────────────────────────────────────────

async function main() {
  await ensureSiteAndOutlet();
  await clearOutlet();

  const route = await loadRoute();

  const sharedCatId = `${runId}-shared`;
  await caseHappyPath(route, { catId: sharedCatId });
  await caseAuditAndRevision({ catId: sharedCatId });
  await caseModifierIntegrity(route);
  // case 5 (UpgradeOption.updatedAt unchanged) is folded into case 4: the
  // seed in caseModifierIntegrity does not include upgrades — for non-deal
  // categories there are no UpgradeOption rows to touch. Verifying that no
  // UpgradeOption rows are written on a non-deal reorder is the same
  // assertion (count stays 0).
  const upgradeRowCount = await prisma.upgradeOption.count({ where: { item: { outletId } } });
  assert.equal(upgradeRowCount, 0, "no UpgradeOption rows touched on non-deal reorder");
  console.log("✓ case 5: no UpgradeOption rows written by reorder");
  await caseItemFlagIntegrity(route);
  await caseUpdatedAtBumped(route);
  await caseNoOpShortCircuit(route);
  await caseStaleCategoryUpdatedAt(route);
  await caseCompetingReorderGuard(route);
  await caseMissingItemId(route);
  await caseExtraForeignId(route);
  await caseDuplicateIds(route);
  await caseEmptyArray(route);
  await caseLengthMismatch(route);
  // case 16 (cross-outlet 403) is intentionally skipped here: the test uses
  // legacy basic-auth which bypasses outlet scoping (admin-sessions.ts:261).
  // Cross-outlet RBAC is covered by test-admin-rbac-active-outlet.ts.
  console.log("- case 16: cross-outlet 403 covered by test-admin-rbac-active-outlet.ts");
  await caseTripleTieBreak(route);
  await caseConcurrentRace(route);

  console.log("\nAll reorder route tests passed.");
}

main()
  .then(async () => {
    await cleanup();
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    try {
      await cleanup();
    } catch (cleanupErr) {
      console.error("cleanup failed:", cleanupErr);
    }
    await prisma.$disconnect();
    process.exit(1);
  });
