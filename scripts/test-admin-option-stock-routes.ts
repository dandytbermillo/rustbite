/* eslint-disable no-console */
import "dotenv/config";

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DEFAULT_SITE_ID } from "@/lib/outlets";

const require = createRequire(import.meta.url);
const shortRunId = Date.now().toString(36);
const runId = `option-stock-routes-${shortRunId}`;
const outletId = `${runId}-outlet`;
const otherOutletId = `${runId}-other`;
const managerEmail = `${runId}-manager@example.test`;
const viewerEmail = `${runId}-viewer@example.test`;

type AddonStockRoute =
  typeof import("@/app/api/admin/items/[id]/addons/[addonId]/stock/route");
type ModifierOptionStockRoute =
  typeof import("@/app/api/admin/modifier-groups/[id]/options/[optionId]/stock/route");
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
  addonStockRoute: AddonStockRoute;
  modifierOptionStockRoute: ModifierOptionStockRoute;
  productionAuth: ProductionAuth;
}> {
  stubServerOnly();
  const [addonStockRoute, modifierOptionStockRoute, productionAuth] =
    await Promise.all([
      import("@/app/api/admin/items/[id]/addons/[addonId]/stock/route"),
      import("@/app/api/admin/modifier-groups/[id]/options/[optionId]/stock/route"),
      import("@/lib/production-auth"),
    ]);
  return { addonStockRoute, modifierOptionStockRoute, productionAuth };
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
  activeOutletId = outletId,
}: {
  path: string;
  body: JsonObject;
  sessionToken?: string;
  activeOutletId?: string | null;
}) {
  const cookie = cookieHeader({
    rb_admin_session: sessionToken,
    rb_admin_active_outlet: activeOutletId,
  });
  return new NextRequest(`http://localhost${path}`, {
    method: "PATCH",
    headers: {
      ...(cookie ? { cookie } : {}),
      origin: "http://localhost",
      referer: "http://localhost/admin/workspace",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function addonParamsOf(id: string, addonId: string) {
  return { params: Promise.resolve({ id, addonId }) };
}

function modifierOptionParamsOf(id: string, optionId: string) {
  return { params: Promise.resolve({ id, optionId }) };
}

async function readJson(response: Response): Promise<JsonObject> {
  const text = await response.text();
  try {
    return JSON.parse(text) as JsonObject;
  } catch {
    return { raw: text };
  }
}

async function expectStatus(
  response: Response,
  status: number,
  message: string,
  errorCode?: string
) {
  const json = await readJson(response);
  assert.equal(response.status, status, message);
  if (errorCode) {
    assert.equal(json.errorCode, errorCode, `${message}: unexpected errorCode`);
  }
  return json;
}

async function createSession(productionAuth: ProductionAuth, userId: string) {
  const token = productionAuth.createSessionToken();
  await prisma.adminSession.create({
    data: {
      userId,
      tokenHash: productionAuth.hashSessionToken(token),
      expiresAt: productionAuth.computeAdminSessionExpiry(),
      userAgent: "option-stock-routes-test",
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
        id: outletId,
        siteId: DEFAULT_SITE_ID,
        name: `Option Stock Routes ${shortRunId}`,
        slug: outletId,
        orderPrefix: `OS${shortRunId.slice(-4).toUpperCase()}`,
        isActive: true,
      },
      {
        id: otherOutletId,
        siteId: DEFAULT_SITE_ID,
        name: `Option Stock Other ${shortRunId}`,
        slug: otherOutletId,
        orderPrefix: `OO${shortRunId.slice(-4).toUpperCase()}`,
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
        displayName: "Option Stock Manager",
        passwordHash: "test-password-hash",
        accountType: "STAFF",
        siteRole: null,
        isActive: true,
      },
    }),
    prisma.adminUser.create({
      data: {
        email: viewerEmail,
        displayName: "Option Stock Viewer",
        passwordHash: "test-password-hash",
        accountType: "STAFF",
        siteRole: null,
        isActive: true,
      },
    }),
  ]);

  await prisma.adminUserOutletRole.createMany({
    data: [
      { userId: manager.id, outletId, role: "MANAGER" },
      { userId: viewer.id, outletId, role: "VIEWER" },
    ],
  });

  return { manager, viewer };
}

async function seedFixture() {
  const category = await prisma.category.create({
    data: {
      outletId,
      slug: `${runId}-category`,
      name: `Option Stock Category ${shortRunId}`,
      icon: "🍔",
      sortOrder: 9900,
      isActive: true,
    },
  });

  const item = await prisma.menuItem.create({
    data: {
      outletId,
      categoryId: category.id,
      name: `Option Stock Burger ${shortRunId}`,
      description: "Option stock route fixture",
      price: new Prisma.Decimal("9.99"),
      emoji: "🍔",
      bgColor: "#FFE3B3",
      isActive: true,
      modifierContractMode: "SHARED",
      sortOrder: 9900,
      addons: {
        create: {
          name: `Avocado ${shortRunId}`,
          priceDelta: new Prisma.Decimal("1.50"),
          stockMode: "MANUAL",
          isOutOfStock: false,
          sortOrder: 1,
        },
      },
    },
    include: { addons: true },
  });

  const group = await prisma.sharedModifierGroup.create({
    data: {
      outletId,
      name: `Dressings ${shortRunId}`,
      description: "Reusable dressing set",
      selectionMode: "OPTIONAL_MULTI",
      minSelect: 0,
      maxSelect: 2,
      isActive: true,
      sortOrder: 9900,
      options: {
        create: {
          name: `Ranch ${shortRunId}`,
          priceDelta: new Prisma.Decimal("0.75"),
          stockMode: "MANUAL",
          isOutOfStock: false,
          isActive: true,
          sortOrder: 1,
        },
      },
    },
    include: { options: true },
  });

  await prisma.menuItemModifierGroup.create({
    data: {
      outletId,
      menuItemId: item.id,
      modifierGroupId: group.id,
      sortOrder: 1,
      isActive: true,
    },
  });

  const otherCategory = await prisma.category.create({
    data: {
      outletId: otherOutletId,
      slug: `${runId}-other-category`,
      name: `Option Stock Other Category ${shortRunId}`,
      icon: "🥗",
      sortOrder: 9900,
      isActive: true,
    },
  });
  const otherItem = await prisma.menuItem.create({
    data: {
      outletId: otherOutletId,
      categoryId: otherCategory.id,
      name: `Other Outlet Salad ${shortRunId}`,
      description: "Cross-outlet fixture",
      price: new Prisma.Decimal("7.50"),
      emoji: "🥗",
      bgColor: "#E8FFF2",
      isActive: true,
      addons: {
        create: {
          name: `Other Outlet Addon ${shortRunId}`,
          priceDelta: new Prisma.Decimal("0.50"),
          stockMode: "MANUAL",
          isOutOfStock: false,
        },
      },
    },
    include: { addons: true },
  });

  return {
    item,
    addon: item.addons[0],
    group,
    option: group.options[0],
    otherItem,
    otherAddon: otherItem.addons[0],
  };
}

async function cleanup() {
  await prisma.stockMovement.deleteMany({
    where: {
      OR: [
        { outletId: { in: [outletId, otherOutletId] } },
        { itemNameSnapshot: { contains: shortRunId } },
        { targetNameSnapshot: { contains: shortRunId } },
      ],
    },
  });
  await prisma.menuAuditLog.deleteMany({
    where: {
      OR: [
        { outletId: { in: [outletId, otherOutletId] } },
        { targetLabel: { contains: shortRunId } },
      ],
    },
  });
  await prisma.menuHistoryState.deleteMany({
    where: { outletId: { in: [outletId, otherOutletId] } },
  });
  await prisma.menuRevision.deleteMany({
    where: {
      OR: [
        { outletId: { in: [outletId, otherOutletId] } },
        { targetLabel: { contains: shortRunId } },
      ],
    },
  });
  await prisma.outletMenuVersion.deleteMany({
    where: { outletId: { in: [outletId, otherOutletId] } },
  });
  await prisma.menuItem.deleteMany({
    where: {
      OR: [
        { outletId: { in: [outletId, otherOutletId] } },
        { name: { contains: shortRunId } },
      ],
    },
  });
  await prisma.sharedModifierGroup.deleteMany({
    where: {
      OR: [
        { outletId: { in: [outletId, otherOutletId] } },
        { name: { contains: shortRunId } },
      ],
    },
  });
  await prisma.category.deleteMany({
    where: {
      OR: [
        { outletId: { in: [outletId, otherOutletId] } },
        { slug: { contains: runId } },
      ],
    },
  });
  await prisma.adminSession.deleteMany({
    where: {
      user: { email: { in: [managerEmail, viewerEmail] } },
    },
  });
  await prisma.adminUser.deleteMany({
    where: { email: { in: [managerEmail, viewerEmail] } },
  });
  await prisma.outlet.deleteMany({
    where: { id: { in: [outletId, otherOutletId] } },
  });
}

async function main() {
  await cleanup();
  await ensureSiteAndOutlets();
  const modules = await loadModules();
  const fixture = await seedFixture();
  const users = await seedUsers();
  const managerToken = await createSession(modules.productionAuth, users.manager.id);
  const viewerToken = await createSession(modules.productionAuth, users.viewer.id);

  let itemLockVersion = fixture.item.lockVersion;
  let groupLockVersion = fixture.group.lockVersion;

  try {
    console.log("- case 1: viewer cannot update local add-on stock");
    await expectStatus(
      await modules.addonStockRoute.PATCH(
        routeRequest({
          path: `/api/admin/items/${fixture.item.id}/addons/${fixture.addon.id}/stock`,
          sessionToken: viewerToken,
          body: {
            lockVersion: itemLockVersion,
            stockMode: "MANUAL",
            isOutOfStock: true,
            stockQty: null,
            lowStockThreshold: null,
          },
        }),
        addonParamsOf(fixture.item.id, fixture.addon.id)
      ),
      403,
      "Viewer add-on stock update should be rejected",
      "forbidden"
    );

    console.log("- case 2: local add-on stock rejects restricted fields");
    await expectStatus(
      await modules.addonStockRoute.PATCH(
        routeRequest({
          path: `/api/admin/items/${fixture.item.id}/addons/${fixture.addon.id}/stock`,
          sessionToken: managerToken,
          body: {
            lockVersion: itemLockVersion,
            stockMode: "MANUAL",
            isOutOfStock: false,
            stockQty: null,
            lowStockThreshold: null,
            name: "Renamed by stock route",
          },
        }),
        addonParamsOf(fixture.item.id, fixture.addon.id)
      ),
      400,
      "Add-on stock route should reject non-stock fields",
      "invalid_payload"
    );

    console.log("- case 3: manager can switch local add-on to quantity stock");
    const addOnAuditBefore = await prisma.menuAuditLog.count({
      where: { outletId, targetType: "ITEM", targetId: fixture.item.id },
    });
    const addOnRevisionBefore = await prisma.menuRevision.count({
      where: { outletId, targetType: "ITEM", targetId: fixture.item.id },
    });
    const addonJson = await expectStatus(
      await modules.addonStockRoute.PATCH(
        routeRequest({
          path: `/api/admin/items/${fixture.item.id}/addons/${fixture.addon.id}/stock`,
          sessionToken: managerToken,
          body: {
            lockVersion: itemLockVersion,
            stockMode: "QUANTITY",
            isOutOfStock: true,
            stockQty: 5,
            lowStockThreshold: 2,
          },
        }),
        addonParamsOf(fixture.item.id, fixture.addon.id)
      ),
      200,
      "Manager add-on quantity stock update should succeed"
    );
    const addonResult = addonJson.addon as {
      stockMode: string;
      isOutOfStock: boolean;
      stockQty: number;
      lowStockThreshold: number;
      stockUpdatedById: string;
    };
    assert.equal(addonResult.stockMode, "QUANTITY");
    assert.equal(
      addonResult.isOutOfStock,
      false,
      "Quantity stock should normalize manual out-of-stock false."
    );
    assert.equal(addonResult.stockQty, 5);
    assert.equal(addonResult.lowStockThreshold, 2);
    assert.equal(addonResult.stockUpdatedById, users.manager.id);
    itemLockVersion = Number(addonJson.itemLockVersion);
    assert.equal(itemLockVersion, fixture.item.lockVersion + 1);

    const addonDb = await prisma.addonOption.findUniqueOrThrow({
      where: { id: fixture.addon.id },
    });
    assert.equal(addonDb.stockMode, "QUANTITY");
    assert.equal(addonDb.stockQty, 5);
    assert.equal(addonDb.lowStockThreshold, 2);
    assert.equal(addonDb.isOutOfStock, false);
    assert.equal(addonDb.stockUpdatedById, users.manager.id);
    const addonMovement = await prisma.stockMovement.findFirstOrThrow({
      where: {
        outletId,
        targetType: "ITEM_LOCAL_ADDON",
        addonOptionId: fixture.addon.id,
      },
    });
    assert.equal(addonMovement.delta, 5);
    assert.equal(addonMovement.beforeQty, null);
    assert.equal(addonMovement.afterQty, 5);
    assert.equal(addonMovement.actorId, users.manager.id);
    assert.equal(addonMovement.targetNameSnapshot, fixture.addon.name);
    assert.equal(
      await prisma.menuAuditLog.count({
        where: { outletId, targetType: "ITEM", targetId: fixture.item.id },
      }),
      addOnAuditBefore + 1,
      "Changed add-on stock should write exactly one item audit row."
    );
    assert.equal(
      await prisma.menuRevision.count({
        where: { outletId, targetType: "ITEM", targetId: fixture.item.id },
      }),
      addOnRevisionBefore + 1,
      "Changed add-on stock should write exactly one item menu revision."
    );

    console.log(
      "- case 3b: local add-on manual mode preserves dormant quantity values"
    );
    const addonManualJson = await expectStatus(
      await modules.addonStockRoute.PATCH(
        routeRequest({
          path: `/api/admin/items/${fixture.item.id}/addons/${fixture.addon.id}/stock`,
          sessionToken: managerToken,
          body: {
            lockVersion: itemLockVersion,
            stockMode: "MANUAL",
            isOutOfStock: true,
            stockQty: null,
            lowStockThreshold: null,
          },
        }),
        addonParamsOf(fixture.item.id, fixture.addon.id)
      ),
      200,
      "Manager add-on manual stock update should preserve dormant quantity"
    );
    const addonManualResult = addonManualJson.addon as {
      stockMode: string;
      isOutOfStock: boolean;
      stockQty: number | null;
      lowStockThreshold: number | null;
    };
    assert.equal(addonManualResult.stockMode, "MANUAL");
    assert.equal(addonManualResult.isOutOfStock, true);
    assert.equal(addonManualResult.stockQty, 5);
    assert.equal(addonManualResult.lowStockThreshold, 2);
    itemLockVersion = Number(addonManualJson.itemLockVersion);

    console.log("- case 4: stale local add-on lockVersion is rejected without side effects");
    const staleAddonMovementBefore = await prisma.stockMovement.count({
      where: { outletId, targetType: "ITEM_LOCAL_ADDON", addonOptionId: fixture.addon.id },
    });
    await expectStatus(
      await modules.addonStockRoute.PATCH(
        routeRequest({
          path: `/api/admin/items/${fixture.item.id}/addons/${fixture.addon.id}/stock`,
          sessionToken: managerToken,
          body: {
            lockVersion: fixture.item.lockVersion,
            stockMode: "QUANTITY",
            isOutOfStock: false,
            stockQty: 8,
            lowStockThreshold: 1,
          },
        }),
        addonParamsOf(fixture.item.id, fixture.addon.id)
      ),
      409,
      "Stale add-on stock update should be rejected",
      "stale_item"
    );
    assert.equal(
      await prisma.stockMovement.count({
        where: { outletId, targetType: "ITEM_LOCAL_ADDON", addonOptionId: fixture.addon.id },
      }),
      staleAddonMovementBefore,
      "Stale add-on update must not write stock movements."
    );
    assert.equal(
      (await prisma.addonOption.findUniqueOrThrow({ where: { id: fixture.addon.id } }))
        .stockQty,
      5,
      "Stale add-on update must not change stock quantity."
    );

    console.log("- case 5: active-outlet mismatch cannot update another outlet add-on");
    await expectStatus(
      await modules.addonStockRoute.PATCH(
        routeRequest({
          path: `/api/admin/items/${fixture.otherItem.id}/addons/${fixture.otherAddon.id}/stock`,
          sessionToken: managerToken,
          activeOutletId: outletId,
          body: {
            lockVersion: fixture.otherItem.lockVersion,
            stockMode: "MANUAL",
            isOutOfStock: true,
            stockQty: null,
            lowStockThreshold: null,
          },
        }),
        addonParamsOf(fixture.otherItem.id, fixture.otherAddon.id)
      ),
      403,
      "Manager without a role on the target outlet should be rejected",
      "no_outlet_access"
    );

    console.log("- case 6: modifier option stock rejects restricted fields");
    await expectStatus(
      await modules.modifierOptionStockRoute.PATCH(
        routeRequest({
          path: `/api/admin/modifier-groups/${fixture.group.id}/options/${fixture.option.id}/stock`,
          sessionToken: managerToken,
          body: {
            lockVersion: groupLockVersion,
            stockMode: "MANUAL",
            isOutOfStock: false,
            stockQty: null,
            lowStockThreshold: null,
            priceDelta: "9.99",
          },
        }),
        modifierOptionParamsOf(fixture.group.id, fixture.option.id)
      ),
      400,
      "Modifier option stock route should reject non-stock fields",
      "invalid_payload"
    );

    console.log("- case 7: manager can update attached reusable modifier option stock");
    const modifierVersionBefore =
      (
        await prisma.outletMenuVersion.findUnique({
          where: { outletId },
          select: { revision: true },
        })
      )?.revision ?? 1;
    const modifierAuditBefore = await prisma.menuAuditLog.count({
      where: { outletId, targetType: "MODIFIER_OPTION", targetId: fixture.option.id },
    });
    const modifierRevisionBefore = await prisma.menuRevision.count({
      where: { outletId, targetType: "MODIFIER_OPTION", targetId: fixture.option.id },
    });
    const optionJson = await expectStatus(
      await modules.modifierOptionStockRoute.PATCH(
        routeRequest({
          path: `/api/admin/modifier-groups/${fixture.group.id}/options/${fixture.option.id}/stock`,
          sessionToken: managerToken,
          body: {
            lockVersion: groupLockVersion,
            stockMode: "QUANTITY",
            isOutOfStock: true,
            stockQty: 3,
            lowStockThreshold: 1,
          },
        }),
        modifierOptionParamsOf(fixture.group.id, fixture.option.id)
      ),
      200,
      "Manager modifier option quantity stock update should succeed"
    );
    const modifierOptionResult = optionJson.option as {
      stockMode: string;
      isOutOfStock: boolean;
      stockQty: number;
      lowStockThreshold: number;
      stockUpdatedById: string;
    };
    assert.equal(modifierOptionResult.stockMode, "QUANTITY");
    assert.equal(modifierOptionResult.isOutOfStock, false);
    assert.equal(modifierOptionResult.stockQty, 3);
    assert.equal(modifierOptionResult.lowStockThreshold, 1);
    assert.equal(modifierOptionResult.stockUpdatedById, users.manager.id);
    groupLockVersion = Number(optionJson.groupLockVersion);
    assert.equal(groupLockVersion, fixture.group.lockVersion + 1);

    const modifierMovement = await prisma.stockMovement.findFirstOrThrow({
      where: {
        outletId,
        targetType: "SHARED_MODIFIER_OPTION",
        sharedModifierOptionId: fixture.option.id,
      },
    });
    assert.equal(modifierMovement.delta, 3);
    assert.equal(modifierMovement.beforeQty, null);
    assert.equal(modifierMovement.afterQty, 3);
    assert.equal(modifierMovement.actorId, users.manager.id);
    assert.equal(modifierMovement.targetNameSnapshot, fixture.option.name);
    assert.equal(
      await prisma.menuAuditLog.count({
        where: { outletId, targetType: "MODIFIER_OPTION", targetId: fixture.option.id },
      }),
      modifierAuditBefore + 1,
      "Changed modifier option stock should write exactly one modifier audit row."
    );
    assert.equal(
      await prisma.menuRevision.count({
        where: { outletId, targetType: "MODIFIER_OPTION", targetId: fixture.option.id },
      }),
      modifierRevisionBefore + 1,
      "Attached modifier stock should write a menu revision."
    );
    assert.equal(
      (
        await prisma.outletMenuVersion.findUniqueOrThrow({
          where: { outletId },
          select: { revision: true },
        })
      ).revision,
      modifierVersionBefore + 1,
      "Attached modifier stock should bump outlet menu freshness."
    );

    console.log(
      "- case 7b: modifier option manual mode preserves dormant quantity values"
    );
    const optionManualJson = await expectStatus(
      await modules.modifierOptionStockRoute.PATCH(
        routeRequest({
          path: `/api/admin/modifier-groups/${fixture.group.id}/options/${fixture.option.id}/stock`,
          sessionToken: managerToken,
          body: {
            lockVersion: groupLockVersion,
            stockMode: "MANUAL",
            isOutOfStock: true,
            stockQty: null,
            lowStockThreshold: null,
          },
        }),
        modifierOptionParamsOf(fixture.group.id, fixture.option.id)
      ),
      200,
      "Manager modifier option manual stock update should preserve dormant quantity"
    );
    const optionManualResult = optionManualJson.option as {
      stockMode: string;
      isOutOfStock: boolean;
      stockQty: number | null;
      lowStockThreshold: number | null;
    };
    assert.equal(optionManualResult.stockMode, "MANUAL");
    assert.equal(optionManualResult.isOutOfStock, true);
    assert.equal(optionManualResult.stockQty, 3);
    assert.equal(optionManualResult.lowStockThreshold, 1);
    groupLockVersion = Number(optionManualJson.groupLockVersion);

    console.log("- case 8: stale modifier group lockVersion is rejected without side effects");
    const staleModifierMovementBefore = await prisma.stockMovement.count({
      where: {
        outletId,
        targetType: "SHARED_MODIFIER_OPTION",
        sharedModifierOptionId: fixture.option.id,
      },
    });
    await expectStatus(
      await modules.modifierOptionStockRoute.PATCH(
        routeRequest({
          path: `/api/admin/modifier-groups/${fixture.group.id}/options/${fixture.option.id}/stock`,
          sessionToken: managerToken,
          body: {
            lockVersion: fixture.group.lockVersion,
            stockMode: "QUANTITY",
            isOutOfStock: false,
            stockQty: 7,
            lowStockThreshold: 2,
          },
        }),
        modifierOptionParamsOf(fixture.group.id, fixture.option.id)
      ),
      409,
      "Stale modifier option stock update should be rejected",
      "stale_modifier_group"
    );
    assert.equal(
      await prisma.stockMovement.count({
        where: {
          outletId,
          targetType: "SHARED_MODIFIER_OPTION",
          sharedModifierOptionId: fixture.option.id,
        },
      }),
      staleModifierMovementBefore,
      "Stale modifier option update must not write stock movements."
    );
    assert.equal(
      (
        await prisma.sharedModifierOption.findUniqueOrThrow({
          where: { id: fixture.option.id },
          select: { stockQty: true },
        })
      ).stockQty,
      3,
      "Stale modifier option update must not change stock quantity."
    );
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

main().catch(async (err) => {
  console.error(err);
  await cleanup().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
