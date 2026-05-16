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
const runId = `modifier-routes-${shortRunId}`;
const outletId = "cafeteria";
const otherOutletId = `${runId}-other`;
const managerEmail = `${runId}-manager@example.test`;
const viewerEmail = `${runId}-viewer@example.test`;

type GroupsRoute = typeof import("@/app/api/admin/modifier-groups/route");
type GroupsWithFirstOptionRoute =
  typeof import("@/app/api/admin/modifier-groups/with-first-option/route");
type GroupRoute = typeof import("@/app/api/admin/modifier-groups/[id]/route");
type GroupHardDeleteRoute =
  typeof import("@/app/api/admin/modifier-groups/[id]/hard-delete/route");
type GroupSaveRoute =
  typeof import("@/app/api/admin/modifier-groups/[id]/save/route");
type OptionsRoute =
  typeof import("@/app/api/admin/modifier-groups/[id]/options/route");
type OptionRoute =
  typeof import("@/app/api/admin/modifier-groups/[id]/options/[optionId]/route");
type OptionHardDeleteRoute =
  typeof import("@/app/api/admin/modifier-groups/[id]/options/[optionId]/hard-delete/route");
type ItemModifierGroupsRoute =
  typeof import("@/app/api/admin/items/[id]/modifier-groups/route");
type ItemModifierGroupRoute =
  typeof import("@/app/api/admin/items/[id]/modifier-groups/[linkId]/route");
type ItemModifierOverrideRoute =
  typeof import("@/app/api/admin/items/[id]/modifier-groups/[linkId]/options/[optionId]/route");
type ItemHardDeleteRoute =
  typeof import("@/app/api/admin/items/[id]/hard-delete/route");
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
  groupsRoute: GroupsRoute;
  groupsWithFirstOptionRoute: GroupsWithFirstOptionRoute;
  groupRoute: GroupRoute;
  groupHardDeleteRoute: GroupHardDeleteRoute;
  groupSaveRoute: GroupSaveRoute;
  optionsRoute: OptionsRoute;
  optionRoute: OptionRoute;
  optionHardDeleteRoute: OptionHardDeleteRoute;
	  itemModifierGroupsRoute: ItemModifierGroupsRoute;
	  itemModifierGroupRoute: ItemModifierGroupRoute;
	  itemModifierOverrideRoute: ItemModifierOverrideRoute;
	  itemHardDeleteRoute: ItemHardDeleteRoute;
	  productionAuth: ProductionAuth;
	}> {
  stubServerOnly();
  const [
    groupsRoute,
    groupsWithFirstOptionRoute,
    groupRoute,
    groupHardDeleteRoute,
    groupSaveRoute,
    optionsRoute,
    optionRoute,
    optionHardDeleteRoute,
	    itemModifierGroupsRoute,
	    itemModifierGroupRoute,
	    itemModifierOverrideRoute,
	    itemHardDeleteRoute,
	    productionAuth,
	  ] = await Promise.all([
    import("@/app/api/admin/modifier-groups/route"),
    import("@/app/api/admin/modifier-groups/with-first-option/route"),
    import("@/app/api/admin/modifier-groups/[id]/route"),
    import("@/app/api/admin/modifier-groups/[id]/hard-delete/route"),
    import("@/app/api/admin/modifier-groups/[id]/save/route"),
    import("@/app/api/admin/modifier-groups/[id]/options/route"),
    import("@/app/api/admin/modifier-groups/[id]/options/[optionId]/route"),
    import("@/app/api/admin/modifier-groups/[id]/options/[optionId]/hard-delete/route"),
	    import("@/app/api/admin/items/[id]/modifier-groups/route"),
	    import("@/app/api/admin/items/[id]/modifier-groups/[linkId]/route"),
	    import("@/app/api/admin/items/[id]/modifier-groups/[linkId]/options/[optionId]/route"),
	    import("@/app/api/admin/items/[id]/hard-delete/route"),
	    import("@/lib/production-auth"),
	  ]);
  return {
    groupsRoute,
    groupsWithFirstOptionRoute,
    groupRoute,
    groupHardDeleteRoute,
    groupSaveRoute,
    optionsRoute,
    optionRoute,
    optionHardDeleteRoute,
	    itemModifierGroupsRoute,
	    itemModifierGroupRoute,
	    itemModifierOverrideRoute,
	    itemHardDeleteRoute,
	    productionAuth,
	  };
	}

function cookieHeader(cookies: Record<string, string | null | undefined>) {
  return Object.entries(cookies)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join("; ");
}

function routeRequest({
  path,
  method = "GET",
  body,
  sessionToken,
  activeOutletId = outletId,
}: {
  path: string;
  method?: string;
  body?: JsonObject;
  sessionToken?: string;
  activeOutletId?: string | null;
}) {
  const cookie = cookieHeader({
    rb_admin_session: sessionToken,
    rb_admin_active_outlet: activeOutletId,
  });
  const headers: Record<string, string> = {
    ...(cookie ? { cookie } : {}),
  };
  if (method !== "GET") {
    headers.origin = "http://localhost";
    headers.referer = "http://localhost/admin/workspace";
    headers["content-type"] = "application/json";
  }

  return new NextRequest(`http://localhost${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function paramsOf(id: string) {
  return { params: Promise.resolve({ id }) };
}

function optionParamsOf(id: string, optionId: string) {
  return { params: Promise.resolve({ id, optionId }) };
}

function linkParamsOf(id: string, linkId: string) {
  return { params: Promise.resolve({ id, linkId }) };
}

function overrideParamsOf(id: string, linkId: string, optionId: string) {
  return { params: Promise.resolve({ id, linkId, optionId }) };
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
      userAgent: "shared-modifier-route-test",
      ipHash: `${runId}-ip`,
    },
  });
  return token;
}

async function ensureBaseOutlet() {
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
    update: { isActive: true },
    create: {
      id: outletId,
      siteId: DEFAULT_SITE_ID,
      name: "Cafeteria",
      slug: outletId,
      orderPrefix: "C",
      isActive: true,
    },
  });
}

async function seedMenuFixture() {
  const otherOutlet = await prisma.outlet.create({
    data: {
      id: otherOutletId,
      siteId: DEFAULT_SITE_ID,
      name: `Modifier Routes Other ${shortRunId}`,
      slug: otherOutletId,
      orderPrefix: `MR${shortRunId.slice(-4).toUpperCase()}`,
      isActive: true,
    },
  });

  const category = await prisma.category.create({
    data: {
      outletId,
      slug: `${runId}-category`,
      name: `Modifier Routes Category ${shortRunId}`,
      icon: "🍔",
      sortOrder: 9800,
      isActive: true,
    },
  });

  const item = await prisma.menuItem.create({
    data: {
      outletId,
      categoryId: category.id,
      name: `Modifier Routes Burger ${shortRunId}`,
      description: "Modifier route fixture",
      price: new Prisma.Decimal("9.99"),
      emoji: "🍔",
      bgColor: "#FFE3B3",
      isActive: true,
      sortOrder: 9800,
    },
  });

  const crossOutletGroup = await prisma.sharedModifierGroup.create({
    data: {
      outletId: otherOutlet.id,
      name: `Cross Outlet Sauces ${shortRunId}`,
      selectionMode: "OPTIONAL_MULTI",
      minSelect: 0,
      maxSelect: null,
      isActive: true,
    },
  });

  const mismatchGroup = await prisma.sharedModifierGroup.create({
    data: {
      outletId,
      name: `Mismatch Group ${shortRunId}`,
      selectionMode: "OPTIONAL_MULTI",
      minSelect: 0,
      maxSelect: null,
      isActive: true,
      options: {
        create: {
          name: `Mismatch Option ${shortRunId}`,
          priceDelta: new Prisma.Decimal("0.25"),
          sortOrder: 1,
          isActive: true,
        },
      },
    },
    include: { options: true },
  });

  return {
    category,
    item,
    crossOutletGroup,
    mismatchOption: mismatchGroup.options[0],
  };
}

async function seedUsers() {
  const [manager, viewer] = await Promise.all([
    prisma.adminUser.create({
      data: {
        email: managerEmail,
        displayName: "Modifier Routes Manager",
        passwordHash: "test-password-hash",
        accountType: "STAFF",
        siteRole: null,
        isActive: true,
      },
    }),
    prisma.adminUser.create({
      data: {
        email: viewerEmail,
        displayName: "Modifier Routes Viewer",
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

async function cleanup() {
  const groups = await prisma.sharedModifierGroup.findMany({
    where: { name: { contains: shortRunId } },
    select: { id: true },
  });
  const groupIds = groups.map((group) => group.id);

  await prisma.menuAuditLog.deleteMany({
    where: {
      OR: [
        { targetId: { in: groupIds } },
        { targetLabel: { contains: shortRunId } },
      ],
    },
  });
  await prisma.menuRevision.deleteMany({
    where: {
      OR: [
        { targetId: { in: groupIds } },
        { targetLabel: { contains: shortRunId } },
      ],
    },
  });
  await prisma.stockMovement.deleteMany({
    where: {
      OR: [
        { targetNameSnapshot: { contains: shortRunId } },
        { itemNameSnapshot: { contains: shortRunId } },
        { targetIdSnapshot: { contains: shortRunId } },
      ],
    },
  });
  await prisma.menuItem.deleteMany({
    where: { name: { contains: shortRunId } },
  });
  await prisma.menuItemModifierGroupAttachmentHistory.deleteMany({
    where: {
      OR: [
        { modifierGroupId: { in: groupIds } },
        { menuItemNameSnapshot: { contains: shortRunId } },
        { modifierGroupNameSnapshot: { contains: shortRunId } },
      ],
    },
  });
  await prisma.category.deleteMany({
    where: {
      OR: [
        { slug: { contains: runId } },
        { name: { contains: shortRunId } },
      ],
    },
  });
  await prisma.sharedModifierGroup.deleteMany({
    where: { id: { in: groupIds } },
  });
  await prisma.adminSession.deleteMany({
    where: {
      user: { email: { in: [managerEmail, viewerEmail] } },
    },
  });
  await prisma.adminUser.deleteMany({
    where: { email: { in: [managerEmail, viewerEmail] } },
  });
  await prisma.outlet.deleteMany({ where: { id: otherOutletId } });
}

async function restoreOutletMenuVersion(
  version: { revision: number; updatedAt: Date } | null
) {
  if (!version) {
    await prisma.outletMenuVersion.deleteMany({ where: { outletId } });
    return;
  }
  await prisma.outletMenuVersion.upsert({
    where: { outletId },
    update: {
      revision: version.revision,
      updatedAt: version.updatedAt,
    },
    create: {
      outletId,
      revision: version.revision,
      updatedAt: version.updatedAt,
    },
  });
}

async function main() {
  await cleanup();
  await ensureBaseOutlet();
  const initialMenuVersion = await prisma.outletMenuVersion.findUnique({
    where: { outletId },
    select: { revision: true, updatedAt: true },
  });
  const modules = await loadModules();
  const fixture = await seedMenuFixture();
  const users = await seedUsers();
  const managerToken = await createSession(modules.productionAuth, users.manager.id);
  const viewerToken = await createSession(modules.productionAuth, users.viewer.id);

  let groupId = "";
  let groupLockVersion = 0;
  let optionId = "";
  let itemLockVersion = fixture.item.lockVersion;
  let itemModifierLinkId = "";
  let overrideId = "";

  try {
    console.log("- case 1: modifier group list requires an admin session");
    await expectStatus(
      await modules.groupsRoute.GET(
        routeRequest({ path: "/api/admin/modifier-groups", activeOutletId: null })
      ),
      401,
      "Unauthenticated modifier group list should be rejected",
      "unauthorized"
    );

    console.log("- case 2: viewer cannot create modifier groups");
    await expectStatus(
      await modules.groupsRoute.POST(
        routeRequest({
          path: "/api/admin/modifier-groups",
          method: "POST",
          sessionToken: viewerToken,
          body: { name: `Viewer Blocked ${shortRunId}` },
        })
      ),
      403,
      "Viewer modifier group create should be rejected",
      "forbidden"
    );

    console.log("- case 3: group create rejects restricted fields");
    await expectStatus(
      await modules.groupsRoute.POST(
        routeRequest({
          path: "/api/admin/modifier-groups",
          method: "POST",
          sessionToken: managerToken,
          body: {
            name: `Restricted ${shortRunId}`,
            outletId: "other-outlet",
          },
        })
      ),
      400,
      "Modifier group create should reject outletId",
      "invalid_payload"
    );

    console.log("- case 4: group create rejects unsafe selection rules");
    await expectStatus(
      await modules.groupsRoute.POST(
        routeRequest({
          path: "/api/admin/modifier-groups",
          method: "POST",
          sessionToken: managerToken,
          body: {
            name: `Invalid Max ${shortRunId}`,
            selectionMode: "OPTIONAL_MULTI",
            minSelect: 0,
            maxSelect: 0,
          },
        })
      ),
      400,
      "Modifier group create should reject OPTIONAL_MULTI maxSelect 0",
      "invalid_payload"
    );

    console.log("- case 5: manager can create an unattached modifier group");
    const createJson = await expectStatus(
      await modules.groupsRoute.POST(
        routeRequest({
          path: "/api/admin/modifier-groups",
          method: "POST",
          sessionToken: managerToken,
          body: {
            name: `Sauces ${shortRunId}`,
            description: "Optional sauces",
            selectionMode: "OPTIONAL_MULTI",
            minSelect: 0,
            maxSelect: null,
            sortOrder: 10,
          },
        })
      ),
      201,
      "Modifier group create should succeed"
    );
    const createdGroup = createJson.group as {
      id: string;
      outletId: string;
      lockVersion: number;
      options: unknown[];
    };
    groupId = createdGroup.id;
    groupLockVersion = createdGroup.lockVersion;
    assert.equal(createdGroup.outletId, outletId, "Group must stay scoped to outlet.");
    assert.equal(groupLockVersion, 0, "Created group should start at lockVersion 0.");
    assert.deepEqual(createdGroup.options, [], "Created group should start without options.");

    const createAuditCount = await prisma.menuAuditLog.count({
      where: {
        actionType: "MODIFIER_GROUP_CREATED",
        targetType: "MODIFIER_GROUP",
        targetId: groupId,
      },
    });
    assert.equal(createAuditCount, 1, "Group create should write exactly one audit row.");
    const createRevisionCount = await prisma.menuRevision.count({
      where: { targetType: "MODIFIER_GROUP", targetId: groupId },
    });
    assert.equal(
      createRevisionCount,
      0,
      "Unattached modifier group create must not write a menu revision."
    );

    console.log("- case 5a: group-with-first-option rejects restricted option fields");
    await expectStatus(
      await modules.groupsWithFirstOptionRoute.POST(
        routeRequest({
          path: "/api/admin/modifier-groups/with-first-option",
          method: "POST",
          sessionToken: managerToken,
          body: {
            group: {
              name: `Restricted Composite ${shortRunId}`,
              selectionMode: "OPTIONAL_SINGLE",
              minSelect: 0,
              maxSelect: 1,
            },
            firstOption: {
              name: `Blocked Option ${shortRunId}`,
              priceDelta: "0.75",
              groupId: "wrong-scope",
            },
          },
        })
      ),
      400,
      "Composite modifier create should reject firstOption groupId",
      "invalid_payload"
    );

    console.log("- case 5b: manager can create a group with its first option");
    const compositeJson = await expectStatus(
      await modules.groupsWithFirstOptionRoute.POST(
        routeRequest({
          path: "/api/admin/modifier-groups/with-first-option",
          method: "POST",
          sessionToken: managerToken,
          body: {
            group: {
              name: `Composite Sauces ${shortRunId}`,
              description: null,
              selectionMode: "OPTIONAL_SINGLE",
              minSelect: 0,
              maxSelect: 1,
              sortOrder: 11,
            },
            firstOption: {
              name: `Composite Ranch ${shortRunId}`,
              priceDelta: "0.75",
              stockMode: "QUANTITY",
              stockQty: 4,
              lowStockThreshold: 1,
            },
          },
        })
      ),
      201,
      "Composite modifier create should succeed"
    );
    const compositeGroup = compositeJson.group as {
      id: string;
      outletId: string;
      lockVersion: number;
      options: Array<{
        id: string;
        name: string;
        priceDelta: number;
        stockMode: string;
        stockQty: number | null;
        lowStockThreshold: number | null;
      }>;
    };
    assert.equal(compositeGroup.outletId, outletId);
    assert.equal(compositeGroup.lockVersion, 0);
    assert.equal(compositeGroup.options.length, 1);
    assert.equal(compositeGroup.options[0].name, `Composite Ranch ${shortRunId}`);
    assert.equal(compositeGroup.options[0].priceDelta, 0.75);
    assert.equal(compositeGroup.options[0].stockMode, "QUANTITY");
    assert.equal(compositeGroup.options[0].stockQty, 4);
    assert.equal(compositeGroup.options[0].lowStockThreshold, 1);
    assert.equal(
      await prisma.menuAuditLog.count({
        where: {
          targetType: { in: ["MODIFIER_GROUP", "MODIFIER_OPTION"] },
          OR: [
            { targetId: compositeGroup.id },
            { targetId: compositeGroup.options[0].id },
          ],
        },
      }),
      2,
      "Composite create should audit both the group and first option."
    );
    assert.equal(
      await prisma.menuRevision.count({
        where: {
          OR: [
            { targetId: compositeGroup.id },
            { targetId: compositeGroup.options[0].id },
          ],
        },
      }),
      0,
      "Unattached composite modifier create must not write menu revisions."
    );

    console.log("- case 5c: group save commits set fields, option fields, and stock once");
    const compositeSaveJson = await expectStatus(
      await modules.groupSaveRoute.PATCH(
        routeRequest({
          path: `/api/admin/modifier-groups/${compositeGroup.id}/save`,
          method: "PATCH",
          sessionToken: managerToken,
          body: {
            lockVersion: compositeGroup.lockVersion,
            group: {
              name: `Composite Sauces Saved ${shortRunId}`,
              description: "Saved together",
              selectionMode: "OPTIONAL_SINGLE",
              minSelect: 0,
              maxSelect: 1,
            },
            options: [
              {
                id: compositeGroup.options[0].id,
                name: `Composite Ranch Saved ${shortRunId}`,
                priceDelta: "1.25",
                isActive: true,
                stockMode: "QUANTITY",
                isOutOfStock: false,
                stockQty: 2,
                lowStockThreshold: 1,
              },
            ],
          },
        }),
        paramsOf(compositeGroup.id)
      ),
      200,
      "Composite modifier save should succeed"
    );
    const savedCompositeGroup = compositeSaveJson.group as {
      id: string;
      lockVersion: number;
      name: string;
      description: string | null;
      options: Array<{
        id: string;
        name: string;
        priceDelta: number;
        stockMode: string;
        isOutOfStock: boolean;
        stockQty: number | null;
        lowStockThreshold: number | null;
      }>;
    };
    assert.equal(savedCompositeGroup.lockVersion, 1);
    assert.equal(savedCompositeGroup.name, `Composite Sauces Saved ${shortRunId}`);
    assert.equal(savedCompositeGroup.description, "Saved together");
    assert.equal(
      savedCompositeGroup.options[0].name,
      `Composite Ranch Saved ${shortRunId}`
    );
    assert.equal(savedCompositeGroup.options[0].priceDelta, 1.25);
    assert.equal(savedCompositeGroup.options[0].stockQty, 2);

    console.log(
      "- case 5c.1: group save manual mode preserves dormant quantity values"
    );
    const manualCompositeSaveJson = await expectStatus(
      await modules.groupSaveRoute.PATCH(
        routeRequest({
          path: `/api/admin/modifier-groups/${compositeGroup.id}/save`,
          method: "PATCH",
          sessionToken: managerToken,
          body: {
            lockVersion: savedCompositeGroup.lockVersion,
            group: {
              name: savedCompositeGroup.name,
              description: savedCompositeGroup.description,
              selectionMode: "OPTIONAL_SINGLE",
              minSelect: 0,
              maxSelect: 1,
            },
            options: [
              {
                id: savedCompositeGroup.options[0].id,
                name: savedCompositeGroup.options[0].name,
                priceDelta: "1.25",
                isActive: true,
                stockMode: "MANUAL",
                isOutOfStock: true,
                stockQty: null,
                lowStockThreshold: null,
              },
            ],
          },
        }),
        paramsOf(compositeGroup.id)
      ),
      200,
      "Composite modifier save should preserve dormant quantity"
    );
    const manualCompositeGroup = manualCompositeSaveJson.group as {
      lockVersion: number;
      options: Array<{
        stockMode: string;
        isOutOfStock: boolean;
        stockQty: number | null;
        lowStockThreshold: number | null;
      }>;
    };
    assert.equal(manualCompositeGroup.lockVersion, 2);
    assert.equal(manualCompositeGroup.options[0].stockMode, "MANUAL");
    assert.equal(manualCompositeGroup.options[0].isOutOfStock, true);
    assert.equal(manualCompositeGroup.options[0].stockQty, 2);
    assert.equal(manualCompositeGroup.options[0].lowStockThreshold, 1);

    console.log("- case 5d: viewer cannot hard-delete add-on sets");
    const viewerHardDeleteGroup = await prisma.sharedModifierGroup.create({
      data: {
        outletId,
        name: `Viewer Hard Delete Block ${shortRunId}`,
        selectionMode: "OPTIONAL_SINGLE",
        minSelect: 0,
        maxSelect: 1,
        isActive: true,
        options: {
          create: {
            name: `Viewer Hard Delete Option ${shortRunId}`,
            priceDelta: new Prisma.Decimal("0.25"),
            isActive: true,
          },
        },
      },
      include: { options: true },
    });
    const viewerHardDeleteOption = viewerHardDeleteGroup.options[0];
    await expectStatus(
      await modules.groupHardDeleteRoute.POST(
        routeRequest({
          path: `/api/admin/modifier-groups/${viewerHardDeleteGroup.id}/hard-delete`,
          method: "POST",
          sessionToken: viewerToken,
          body: { lockVersion: viewerHardDeleteGroup.lockVersion },
        }),
        paramsOf(viewerHardDeleteGroup.id)
      ),
      403,
      "Viewer hard-delete should be rejected",
      "forbidden"
    );
    await expectStatus(
      await modules.optionHardDeleteRoute.POST(
        routeRequest({
          path: `/api/admin/modifier-groups/${viewerHardDeleteGroup.id}/options/${viewerHardDeleteOption.id}/hard-delete`,
          method: "POST",
          sessionToken: viewerToken,
          body: { lockVersion: viewerHardDeleteGroup.lockVersion },
        }),
        optionParamsOf(viewerHardDeleteGroup.id, viewerHardDeleteOption.id)
      ),
      403,
      "Viewer option hard-delete should be rejected",
      "forbidden"
    );

    console.log("- case 5e: hard-delete rejects malformed payloads and stale locks");
    await expectStatus(
      await modules.groupHardDeleteRoute.POST(
        routeRequest({
          path: `/api/admin/modifier-groups/${viewerHardDeleteGroup.id}/hard-delete`,
          method: "POST",
          sessionToken: managerToken,
          body: {
            lockVersion: viewerHardDeleteGroup.lockVersion,
            id: viewerHardDeleteGroup.id,
          },
        }),
        paramsOf(viewerHardDeleteGroup.id)
      ),
      400,
      "Hard-delete should reject unknown payload fields",
      "invalid_payload"
    );
    await expectStatus(
      await modules.groupHardDeleteRoute.POST(
        routeRequest({
          path: `/api/admin/modifier-groups/${viewerHardDeleteGroup.id}/hard-delete`,
          method: "POST",
          sessionToken: managerToken,
          body: { lockVersion: viewerHardDeleteGroup.lockVersion + 99 },
        }),
        paramsOf(viewerHardDeleteGroup.id)
      ),
      409,
      "Stale group hard-delete should be rejected",
      "stale_modifier_group"
    );
    assert.ok(
      await prisma.sharedModifierGroup.findUnique({
        where: { id: viewerHardDeleteGroup.id },
      }),
      "Stale hard-delete must not remove the group."
    );

    console.log("- case 5f: manager can hard-delete an unattached option with stock history");
    const optionHardDeleteGroup = await prisma.sharedModifierGroup.create({
      data: {
        outletId,
        name: `Option Hard Delete Group ${shortRunId}`,
        selectionMode: "OPTIONAL_SINGLE",
        minSelect: 0,
        maxSelect: 1,
        isActive: true,
        options: {
          create: {
            name: `Option Hard Delete Choice ${shortRunId}`,
            priceDelta: new Prisma.Decimal("0.60"),
            stockMode: "QUANTITY",
            stockQty: 3,
            lowStockThreshold: 1,
            isActive: true,
          },
        },
      },
      include: { options: true },
    });
    const optionHardDeleteOption = optionHardDeleteGroup.options[0];
    const optionMovement = await prisma.stockMovement.create({
      data: {
        outletId,
        targetType: "SHARED_MODIFIER_OPTION",
        targetIdSnapshot: optionHardDeleteOption.id,
        targetNameSnapshot: optionHardDeleteOption.name,
        sharedModifierOptionId: optionHardDeleteOption.id,
        itemNameSnapshot: optionHardDeleteOption.name,
        delta: 3,
        reason: "ADMIN_SET",
        beforeQty: null,
        afterQty: 3,
        actorType: "TEST",
        actorId: users.manager.id,
        note: `Option hard-delete movement ${shortRunId}`,
      },
    });
    const optionHardDeleteJson = await expectStatus(
      await modules.optionHardDeleteRoute.POST(
        routeRequest({
          path: `/api/admin/modifier-groups/${optionHardDeleteGroup.id}/options/${optionHardDeleteOption.id}/hard-delete`,
          method: "POST",
          sessionToken: managerToken,
          body: { lockVersion: optionHardDeleteGroup.lockVersion },
        }),
        optionParamsOf(optionHardDeleteGroup.id, optionHardDeleteOption.id)
      ),
      200,
      "Unattached option hard-delete should succeed"
    );
    assert.equal(optionHardDeleteJson.deleted, true);
    assert.equal(optionHardDeleteJson.groupLockVersion, 1);
    assert.equal(
      await prisma.sharedModifierOption.findUnique({
        where: { id: optionHardDeleteOption.id },
      }),
      null,
      "Hard-deleted option should be removed."
    );
    const preservedOptionMovement = await prisma.stockMovement.findUniqueOrThrow({
      where: { id: optionMovement.id },
      select: {
        sharedModifierOptionId: true,
        targetIdSnapshot: true,
        targetNameSnapshot: true,
      },
    });
    assert.equal(preservedOptionMovement.sharedModifierOptionId, null);
    assert.equal(preservedOptionMovement.targetIdSnapshot, optionHardDeleteOption.id);
    assert.equal(
      preservedOptionMovement.targetNameSnapshot,
      optionHardDeleteOption.name
    );
    assert.equal(
      await prisma.menuAuditLog.count({
        where: {
          actionType: "MODIFIER_OPTION_HARD_DELETED",
          targetType: "MODIFIER_OPTION",
          targetId: optionHardDeleteOption.id,
        },
      }),
      1,
      "Option hard-delete should write one audit row."
    );
    assert.equal(
      await prisma.menuRevision.count({
        where: {
          targetType: "MODIFIER_OPTION",
          targetId: optionHardDeleteOption.id,
        },
      }),
      0,
      "Unattached option hard-delete must not write menu revisions."
    );

    console.log("- case 5g: manager can hard-delete an unattached set with option stock history");
    const groupHardDelete = await prisma.sharedModifierGroup.create({
      data: {
        outletId,
        name: `Group Hard Delete ${shortRunId}`,
        selectionMode: "OPTIONAL_SINGLE",
        minSelect: 0,
        maxSelect: 1,
        isActive: true,
        options: {
          create: {
            name: `Group Hard Delete Choice ${shortRunId}`,
            priceDelta: new Prisma.Decimal("0.90"),
            stockMode: "QUANTITY",
            stockQty: 2,
            lowStockThreshold: 1,
            isActive: true,
          },
        },
      },
      include: { options: true },
    });
    const groupHardDeleteOption = groupHardDelete.options[0];
    const groupMovement = await prisma.stockMovement.create({
      data: {
        outletId,
        targetType: "SHARED_MODIFIER_OPTION",
        targetIdSnapshot: groupHardDeleteOption.id,
        targetNameSnapshot: groupHardDeleteOption.name,
        sharedModifierOptionId: groupHardDeleteOption.id,
        itemNameSnapshot: groupHardDeleteOption.name,
        delta: 2,
        reason: "ADMIN_SET",
        beforeQty: null,
        afterQty: 2,
        actorType: "TEST",
        actorId: users.manager.id,
        note: `Group hard-delete movement ${shortRunId}`,
      },
    });
    const groupHardDeleteJson = await expectStatus(
      await modules.groupHardDeleteRoute.POST(
        routeRequest({
          path: `/api/admin/modifier-groups/${groupHardDelete.id}/hard-delete`,
          method: "POST",
          sessionToken: managerToken,
          body: { lockVersion: groupHardDelete.lockVersion },
        }),
        paramsOf(groupHardDelete.id)
      ),
      200,
      "Unattached group hard-delete should succeed"
    );
    assert.equal(groupHardDeleteJson.deleted, true);
    assert.equal(
      await prisma.sharedModifierGroup.findUnique({
        where: { id: groupHardDelete.id },
      }),
      null,
      "Hard-deleted group should be removed."
    );
    assert.equal(
      await prisma.sharedModifierOption.findUnique({
        where: { id: groupHardDeleteOption.id },
      }),
      null,
      "Group hard-delete should cascade its options."
    );
    const preservedGroupMovement = await prisma.stockMovement.findUniqueOrThrow({
      where: { id: groupMovement.id },
      select: {
        sharedModifierOptionId: true,
        targetIdSnapshot: true,
        targetNameSnapshot: true,
      },
    });
    assert.equal(preservedGroupMovement.sharedModifierOptionId, null);
    assert.equal(preservedGroupMovement.targetIdSnapshot, groupHardDeleteOption.id);
    assert.equal(
      preservedGroupMovement.targetNameSnapshot,
      groupHardDeleteOption.name
    );
    assert.equal(
      await prisma.menuAuditLog.count({
        where: {
          actionType: "MODIFIER_GROUP_HARD_DELETED",
          targetType: "MODIFIER_GROUP",
          targetId: groupHardDelete.id,
        },
      }),
      1,
      "Group hard-delete should write one audit row."
    );
    assert.equal(
      await prisma.menuRevision.count({
        where: {
          OR: [
            { targetType: "MODIFIER_GROUP", targetId: groupHardDelete.id },
            { targetType: "MODIFIER_OPTION", targetId: groupHardDeleteOption.id },
          ],
        },
      }),
      0,
      "Unattached group hard-delete must not write menu revisions."
    );

    console.log("- case 6: duplicate active group names are rejected");
    await expectStatus(
      await modules.groupsRoute.POST(
        routeRequest({
          path: "/api/admin/modifier-groups",
          method: "POST",
          sessionToken: managerToken,
          body: { name: ` sauces ${shortRunId} ` },
        })
      ),
      409,
      "Duplicate active group name should be rejected",
      "duplicate_modifier_group"
    );

    console.log("- case 7: stale group lockVersion is rejected without mutation");
    await expectStatus(
      await modules.groupRoute.PATCH(
        routeRequest({
          path: `/api/admin/modifier-groups/${groupId}`,
          method: "PATCH",
          sessionToken: managerToken,
          body: {
            lockVersion: groupLockVersion + 99,
            name: `Stale ${shortRunId}`,
          },
        }),
        paramsOf(groupId)
      ),
      409,
      "Stale group patch should be rejected",
      "stale_modifier_group"
    );
    const afterStaleGroup = await prisma.sharedModifierGroup.findUniqueOrThrow({
      where: { id: groupId },
    });
    assert.equal(afterStaleGroup.name, `Sauces ${shortRunId}`);
    assert.equal(afterStaleGroup.lockVersion, groupLockVersion);

    console.log("- case 8: group patch validates merged selection rules");
    await expectStatus(
      await modules.groupRoute.PATCH(
        routeRequest({
          path: `/api/admin/modifier-groups/${groupId}`,
          method: "PATCH",
          sessionToken: managerToken,
          body: {
            lockVersion: groupLockVersion,
            selectionMode: "REQUIRED_SINGLE",
            minSelect: 0,
            maxSelect: 1,
          },
        }),
        paramsOf(groupId)
      ),
      400,
      "Invalid merged group selection rule should be rejected",
      "invalid_payload"
    );

    console.log("- case 9: group patch increments lockVersion and audits once");
    const patchJson = await expectStatus(
      await modules.groupRoute.PATCH(
        routeRequest({
          path: `/api/admin/modifier-groups/${groupId}`,
          method: "PATCH",
          sessionToken: managerToken,
          body: {
            lockVersion: groupLockVersion,
            name: `Sauces Updated ${shortRunId}`,
            description: "",
            sortOrder: 11,
          },
        }),
        paramsOf(groupId)
      ),
      200,
      "Valid group patch should succeed"
    );
    const patchedGroup = patchJson.group as {
      id: string;
      lockVersion: number;
      description: string | null;
    };
    groupLockVersion = patchedGroup.lockVersion;
    assert.equal(groupLockVersion, 1, "Group patch should increment lockVersion.");
    assert.equal(patchedGroup.description, null, "Blank description should normalize to null.");

    console.log("- case 10: option create rejects over-precision prices");
    await expectStatus(
      await modules.optionsRoute.POST(
        routeRequest({
          path: `/api/admin/modifier-groups/${groupId}/options`,
          method: "POST",
          sessionToken: managerToken,
          body: {
            lockVersion: groupLockVersion,
            name: `Too Precise ${shortRunId}`,
            priceDelta: "1.234",
          },
        }),
        paramsOf(groupId)
      ),
      400,
      "Option create should reject over-precision priceDelta",
      "invalid_payload"
    );

    console.log("- case 11: option create increments the parent group lockVersion");
    const optionCreateJson = await expectStatus(
      await modules.optionsRoute.POST(
        routeRequest({
          path: `/api/admin/modifier-groups/${groupId}/options`,
          method: "POST",
          sessionToken: managerToken,
          body: {
            lockVersion: groupLockVersion,
            name: `Ranch ${shortRunId}`,
            priceDelta: "1.50",
            sortOrder: 1,
            stockMode: "QUANTITY",
            stockQty: 7,
            lowStockThreshold: 2,
          },
        }),
        paramsOf(groupId)
      ),
      201,
      "Option create should succeed"
    );
    const createdOption = optionCreateJson.option as {
      id: string;
      priceDelta: number;
      isActive: boolean;
      stockMode: string;
      isOutOfStock: boolean;
      stockQty: number | null;
      lowStockThreshold: number | null;
    };
    optionId = createdOption.id;
    groupLockVersion = Number(optionCreateJson.groupLockVersion);
    assert.equal(createdOption.priceDelta, 1.5);
    assert.equal(createdOption.isActive, true);
    assert.equal(createdOption.stockMode, "QUANTITY");
    assert.equal(createdOption.isOutOfStock, false);
    assert.equal(createdOption.stockQty, 7);
    assert.equal(createdOption.lowStockThreshold, 2);
    assert.equal(groupLockVersion, 2, "Option create should increment group lockVersion.");

    console.log("- case 12: duplicate active option names are rejected");
    await expectStatus(
      await modules.optionsRoute.POST(
        routeRequest({
          path: `/api/admin/modifier-groups/${groupId}/options`,
          method: "POST",
          sessionToken: managerToken,
          body: {
            lockVersion: groupLockVersion,
            name: ` ranch ${shortRunId} `,
            priceDelta: "0.50",
          },
        }),
        paramsOf(groupId)
      ),
      409,
      "Duplicate active option name should be rejected",
      "duplicate_modifier_option"
    );

    console.log("- case 13: stale option mutation is rejected");
    await expectStatus(
      await modules.optionRoute.PATCH(
        routeRequest({
          path: `/api/admin/modifier-groups/${groupId}/options/${optionId}`,
          method: "PATCH",
          sessionToken: managerToken,
          body: {
            lockVersion: groupLockVersion - 1,
            priceDelta: "2.00",
          },
        }),
        optionParamsOf(groupId, optionId)
      ),
      409,
      "Stale option patch should be rejected",
      "stale_modifier_group"
    );

    console.log("- case 14: option patch writes audit and increments parent lockVersion");
    const optionPatchJson = await expectStatus(
      await modules.optionRoute.PATCH(
        routeRequest({
          path: `/api/admin/modifier-groups/${groupId}/options/${optionId}`,
          method: "PATCH",
          sessionToken: managerToken,
          body: {
            lockVersion: groupLockVersion,
            name: `Ranch Updated ${shortRunId}`,
            priceDelta: "2.25",
          },
        }),
        optionParamsOf(groupId, optionId)
      ),
      200,
      "Valid option patch should succeed"
    );
    groupLockVersion = Number(optionPatchJson.groupLockVersion);
    assert.equal(groupLockVersion, 3, "Option patch should increment group lockVersion.");

    const preAttachRevisionCount = await prisma.menuRevision.count({
      where: {
        OR: [
          { targetType: "MODIFIER_GROUP", targetId: groupId },
          { targetType: "MODIFIER_OPTION", targetId: optionId },
        ],
      },
    });
    assert.equal(
      preAttachRevisionCount,
      0,
      "Unattached modifier library mutations must not write menu revisions."
    );

    console.log("- case 15: item attach rejects cross-outlet groups");
    await expectStatus(
      await modules.itemModifierGroupsRoute.POST(
        routeRequest({
          path: `/api/admin/items/${fixture.item.id}/modifier-groups`,
          method: "POST",
          sessionToken: managerToken,
          body: {
            lockVersion: itemLockVersion,
            modifierGroupId: fixture.crossOutletGroup.id,
          },
        }),
        paramsOf(fixture.item.id)
      ),
      400,
      "Cross-outlet modifier group attach should be rejected",
      "invalid_payload"
    );

    console.log("- case 16: item attach increments item lockVersion and bumps menu version");
    const versionBeforeAttach =
      (
        await prisma.outletMenuVersion.findUnique({
          where: { outletId },
          select: { revision: true },
        })
      )?.revision ?? 1;
    const attachJson = await expectStatus(
      await modules.itemModifierGroupsRoute.POST(
        routeRequest({
          path: `/api/admin/items/${fixture.item.id}/modifier-groups`,
          method: "POST",
          sessionToken: managerToken,
          body: {
            lockVersion: itemLockVersion,
            modifierGroupId: groupId,
            sortOrder: 1,
          },
        }),
        paramsOf(fixture.item.id)
      ),
      201,
      "Item modifier group attach should succeed"
    );
    const attachedLink = attachJson.link as {
      id: string;
      isActive: boolean;
      modifierGroupId: string;
    };
    itemModifierLinkId = attachedLink.id;
    itemLockVersion = Number(attachJson.itemLockVersion);
    assert.equal(attachedLink.isActive, true, "Attached link should be active.");
    assert.equal(attachedLink.modifierGroupId, groupId);
    assert.equal(itemLockVersion, fixture.item.lockVersion + 1);
    const versionAfterAttach =
      (
        await prisma.outletMenuVersion.findUnique({
          where: { outletId },
          select: { revision: true },
        })
      )?.revision ?? 1;
    assert.equal(
      versionAfterAttach,
      versionBeforeAttach + 1,
      "Item attach should bump outlet menu version."
    );

    console.log("- case 16b: active item links block hard-delete");
    await expectStatus(
      await modules.groupHardDeleteRoute.POST(
        routeRequest({
          path: `/api/admin/modifier-groups/${groupId}/hard-delete`,
          method: "POST",
          sessionToken: managerToken,
          body: { lockVersion: groupLockVersion },
        }),
        paramsOf(groupId)
      ),
      409,
      "Attached group hard-delete should be rejected",
      "modifier_group_attached"
    );
    await expectStatus(
      await modules.optionHardDeleteRoute.POST(
        routeRequest({
          path: `/api/admin/modifier-groups/${groupId}/options/${optionId}/hard-delete`,
          method: "POST",
          sessionToken: managerToken,
          body: { lockVersion: groupLockVersion },
        }),
        optionParamsOf(groupId, optionId)
      ),
      409,
      "Option hard-delete in an attached group should be rejected",
      "modifier_group_attached"
    );
    assert.ok(
      await prisma.sharedModifierGroup.findUnique({ where: { id: groupId } }),
      "Rejected hard-delete must leave the attached group."
    );
    assert.ok(
      await prisma.sharedModifierOption.findUnique({ where: { id: optionId } }),
      "Rejected hard-delete must leave the attached option."
    );

    console.log("- case 17: active item link cannot be attached twice");
    await expectStatus(
      await modules.itemModifierGroupsRoute.POST(
        routeRequest({
          path: `/api/admin/items/${fixture.item.id}/modifier-groups`,
          method: "POST",
          sessionToken: managerToken,
          body: {
            lockVersion: itemLockVersion,
            modifierGroupId: groupId,
          },
        }),
        paramsOf(fixture.item.id)
      ),
      409,
      "Duplicate active item modifier group should be rejected",
      "duplicate_item_modifier_group"
    );

    console.log("- case 18: attached group mutation bumps menu version");
    const versionBeforeAttachedGroupPatch =
      (
        await prisma.outletMenuVersion.findUnique({
          where: { outletId },
          select: { revision: true },
        })
      )?.revision ?? 1;
    const attachedGroupPatchJson = await expectStatus(
      await modules.groupRoute.PATCH(
        routeRequest({
          path: `/api/admin/modifier-groups/${groupId}`,
          method: "PATCH",
          sessionToken: managerToken,
          body: {
            lockVersion: groupLockVersion,
            sortOrder: 12,
          },
        }),
        paramsOf(groupId)
      ),
      200,
      "Attached group patch should succeed"
    );
    groupLockVersion = Number(
      (attachedGroupPatchJson.group as { lockVersion: number }).lockVersion
    );
    assert.equal(groupLockVersion, 4, "Attached group patch should increment lockVersion.");
    const versionAfterAttachedGroupPatch =
      (
        await prisma.outletMenuVersion.findUnique({
          where: { outletId },
          select: { revision: true },
        })
      )?.revision ?? 1;
    assert.equal(
      versionAfterAttachedGroupPatch,
      versionBeforeAttachedGroupPatch + 1,
      "Attached group patch should bump outlet menu version."
    );

    console.log("- case 19: stale item-link patch is rejected without audit/version");
    const linkAuditBefore = await prisma.menuAuditLog.count({
      where: {
        targetType: "ITEM_MODIFIER_GROUP",
        targetId: itemModifierLinkId,
      },
    });
    const staleLinkVersionBefore =
      (
        await prisma.outletMenuVersion.findUnique({
          where: { outletId },
          select: { revision: true },
        })
      )?.revision ?? 1;
    await expectStatus(
      await modules.itemModifierGroupRoute.PATCH(
        routeRequest({
          path: `/api/admin/items/${fixture.item.id}/modifier-groups/${itemModifierLinkId}`,
          method: "PATCH",
          sessionToken: managerToken,
          body: {
            lockVersion: itemLockVersion + 99,
            sortOrder: 2,
          },
        }),
        linkParamsOf(fixture.item.id, itemModifierLinkId)
      ),
      409,
      "Stale item modifier group patch should be rejected",
      "stale_item"
    );
    assert.equal(
      await prisma.menuAuditLog.count({
        where: {
          targetType: "ITEM_MODIFIER_GROUP",
          targetId: itemModifierLinkId,
        },
      }),
      linkAuditBefore,
      "Stale item-link patch must not write audit rows."
    );
    assert.equal(
      (
        await prisma.outletMenuVersion.findUnique({
          where: { outletId },
          select: { revision: true },
        })
      )?.revision ?? 1,
      staleLinkVersionBefore,
      "Stale item-link patch must not bump menu version."
    );

    console.log("- case 20: item-link patch increments item lockVersion");
    const linkPatchJson = await expectStatus(
      await modules.itemModifierGroupRoute.PATCH(
        routeRequest({
          path: `/api/admin/items/${fixture.item.id}/modifier-groups/${itemModifierLinkId}`,
          method: "PATCH",
          sessionToken: managerToken,
          body: {
            lockVersion: itemLockVersion,
            sortOrder: 2,
            minSelectOverride: 0,
            maxSelectOverride: null,
          },
        }),
        linkParamsOf(fixture.item.id, itemModifierLinkId)
      ),
      200,
      "Item modifier group patch should succeed"
    );
    itemLockVersion = Number(linkPatchJson.itemLockVersion);
    assert.equal(itemLockVersion, fixture.item.lockVersion + 2);

    console.log("- case 21: negative item-level override price is rejected");
    await expectStatus(
      await modules.itemModifierOverrideRoute.PATCH(
        routeRequest({
          path: `/api/admin/items/${fixture.item.id}/modifier-groups/${itemModifierLinkId}/options/${optionId}`,
          method: "PATCH",
          sessionToken: managerToken,
          body: {
            lockVersion: itemLockVersion,
            priceDeltaOverride: "-1.00",
          },
        }),
        overrideParamsOf(fixture.item.id, itemModifierLinkId, optionId)
      ),
      400,
      "Negative item-level price override should be rejected",
      "invalid_payload"
    );

    console.log("- case 22: override option from another group is rejected");
    await expectStatus(
      await modules.itemModifierOverrideRoute.PATCH(
        routeRequest({
          path: `/api/admin/items/${fixture.item.id}/modifier-groups/${itemModifierLinkId}/options/${fixture.mismatchOption.id}`,
          method: "PATCH",
          sessionToken: managerToken,
          body: {
            lockVersion: itemLockVersion,
            isHidden: true,
          },
        }),
        overrideParamsOf(
          fixture.item.id,
          itemModifierLinkId,
          fixture.mismatchOption.id
        )
      ),
      400,
      "Override option from a different group should be rejected",
      "modifier_option_group_mismatch"
    );

    console.log("- case 23: item-level override increments item lockVersion");
    const overridePatchJson = await expectStatus(
      await modules.itemModifierOverrideRoute.PATCH(
        routeRequest({
          path: `/api/admin/items/${fixture.item.id}/modifier-groups/${itemModifierLinkId}/options/${optionId}`,
          method: "PATCH",
          sessionToken: managerToken,
          body: {
            lockVersion: itemLockVersion,
            isHidden: true,
            priceDeltaOverride: "1.00",
            sortOrderOverride: 9,
          },
        }),
        overrideParamsOf(fixture.item.id, itemModifierLinkId, optionId)
      ),
      200,
      "Item modifier option override patch should succeed"
    );
    const patchedOverride = overridePatchJson.override as {
      id: string;
      isHidden: boolean;
      priceDeltaOverride: number;
    };
    overrideId = patchedOverride.id;
    itemLockVersion = Number(overridePatchJson.itemLockVersion);
    assert.equal(patchedOverride.isHidden, true);
    assert.equal(patchedOverride.priceDeltaOverride, 1);
    assert.equal(itemLockVersion, fixture.item.lockVersion + 3);

    console.log("- case 24: clearing an override restores inheritance");
    const overrideDeleteJson = await expectStatus(
      await modules.itemModifierOverrideRoute.DELETE(
        routeRequest({
          path: `/api/admin/items/${fixture.item.id}/modifier-groups/${itemModifierLinkId}/options/${optionId}`,
          method: "DELETE",
          sessionToken: managerToken,
          body: { lockVersion: itemLockVersion },
        }),
        overrideParamsOf(fixture.item.id, itemModifierLinkId, optionId)
      ),
      200,
      "Item modifier option override clear should succeed"
    );
    itemLockVersion = Number(overrideDeleteJson.itemLockVersion);
    assert.equal(overrideDeleteJson.override, null);
    assert.equal(itemLockVersion, fixture.item.lockVersion + 4);

    console.log("- case 25: item modifier group delete deactivates the link");
    const linkDeleteJson = await expectStatus(
      await modules.itemModifierGroupRoute.DELETE(
        routeRequest({
          path: `/api/admin/items/${fixture.item.id}/modifier-groups/${itemModifierLinkId}`,
          method: "DELETE",
          sessionToken: managerToken,
          body: { lockVersion: itemLockVersion },
        }),
        linkParamsOf(fixture.item.id, itemModifierLinkId)
      ),
      200,
      "Item modifier group detach should succeed"
    );
    itemLockVersion = Number(linkDeleteJson.itemLockVersion);
    const detachedLink = linkDeleteJson.link as { isActive: boolean };
    assert.equal(detachedLink.isActive, false);
    assert.equal(itemLockVersion, fixture.item.lockVersion + 5);

    console.log("- case 25b: historical item links still block hard-delete");
    await expectStatus(
      await modules.groupHardDeleteRoute.POST(
        routeRequest({
          path: `/api/admin/modifier-groups/${groupId}/hard-delete`,
          method: "POST",
          sessionToken: managerToken,
          body: { lockVersion: groupLockVersion },
        }),
        paramsOf(groupId)
      ),
      409,
      "Previously attached group hard-delete should be rejected",
      "modifier_group_attached"
    );
    await expectStatus(
      await modules.optionHardDeleteRoute.POST(
        routeRequest({
          path: `/api/admin/modifier-groups/${groupId}/options/${optionId}/hard-delete`,
          method: "POST",
          sessionToken: managerToken,
          body: { lockVersion: groupLockVersion },
        }),
        optionParamsOf(groupId, optionId)
      ),
      409,
      "Option hard-delete in a historically attached group should be rejected",
      "modifier_group_attached"
    );
    assert.ok(
      await prisma.sharedModifierGroup.findUnique({ where: { id: groupId } }),
      "Historical-link hard-delete rejection must leave the group."
    );
    assert.ok(
      await prisma.sharedModifierOption.findUnique({ where: { id: optionId } }),
      "Historical-link hard-delete rejection must leave the option."
    );

    console.log(
      "- case 25c: attachment history blocks hard-delete after item hard-delete"
    );
    const historyGroup = await prisma.sharedModifierGroup.create({
      data: {
        outletId,
        name: `History Guard Group ${shortRunId}`,
        selectionMode: "OPTIONAL_SINGLE",
        minSelect: 0,
        maxSelect: 1,
        isActive: true,
        options: {
          create: {
            name: `History Guard Option ${shortRunId}`,
            priceDelta: new Prisma.Decimal("0.40"),
            isActive: true,
          },
        },
      },
      include: { options: true },
    });
    const historyOption = historyGroup.options[0];
    const historyItem = await prisma.menuItem.create({
      data: {
        outletId,
        categoryId: fixture.category.id,
        name: `History Guard Item ${shortRunId}`,
        description: "Attached then hard-deleted item",
        price: new Prisma.Decimal("4.50"),
        emoji: "🥗",
        bgColor: "#E5F5DD",
        isActive: false,
        sortOrder: 9801,
      },
    });
    const historyAttachJson = await expectStatus(
      await modules.itemModifierGroupsRoute.POST(
        routeRequest({
          path: `/api/admin/items/${historyItem.id}/modifier-groups`,
          method: "POST",
          sessionToken: managerToken,
          body: {
            lockVersion: historyItem.lockVersion,
            modifierGroupId: historyGroup.id,
            sortOrder: 0,
          },
        }),
        paramsOf(historyItem.id)
      ),
      201,
      "History guard item attach should succeed"
    );
    const historyItemLockVersion = Number(historyAttachJson.itemLockVersion);
    assert.equal(
      await prisma.menuItemModifierGroupAttachmentHistory.count({
        where: { modifierGroupId: historyGroup.id },
      }),
      1,
      "Attaching an add-on set should record durable attachment history."
    );
    await expectStatus(
      await modules.itemHardDeleteRoute.DELETE(
        routeRequest({
          path: `/api/admin/items/${historyItem.id}/hard-delete`,
          method: "DELETE",
          sessionToken: managerToken,
          body: { lockVersion: historyItemLockVersion },
        }),
        paramsOf(historyItem.id)
      ),
      200,
      "Hard-deleting the attached menu item should succeed"
    );
    assert.equal(
      await prisma.menuItemModifierGroup.count({
        where: { modifierGroupId: historyGroup.id },
      }),
      0,
      "Menu item hard-delete should remove current item modifier links."
    );
    const preservedHistory =
      await prisma.menuItemModifierGroupAttachmentHistory.findFirstOrThrow({
        where: { modifierGroupId: historyGroup.id },
        select: {
          menuItemId: true,
          menuItemIdSnapshot: true,
          menuItemNameSnapshot: true,
          modifierGroupNameSnapshot: true,
        },
      });
    assert.equal(preservedHistory.menuItemId, null);
    assert.equal(preservedHistory.menuItemIdSnapshot, historyItem.id);
    assert.equal(preservedHistory.menuItemNameSnapshot, historyItem.name);
    assert.equal(preservedHistory.modifierGroupNameSnapshot, historyGroup.name);
    await expectStatus(
      await modules.groupHardDeleteRoute.POST(
        routeRequest({
          path: `/api/admin/modifier-groups/${historyGroup.id}/hard-delete`,
          method: "POST",
          sessionToken: managerToken,
          body: { lockVersion: historyGroup.lockVersion },
        }),
        paramsOf(historyGroup.id)
      ),
      409,
      "Attachment history should block group hard-delete after item deletion",
      "modifier_group_attached"
    );
    await expectStatus(
      await modules.optionHardDeleteRoute.POST(
        routeRequest({
          path: `/api/admin/modifier-groups/${historyGroup.id}/options/${historyOption.id}/hard-delete`,
          method: "POST",
          sessionToken: managerToken,
          body: { lockVersion: historyGroup.lockVersion },
        }),
        optionParamsOf(historyGroup.id, historyOption.id)
      ),
      409,
      "Attachment history should block option hard-delete after item deletion",
      "modifier_group_attached"
    );
    assert.ok(
      await prisma.sharedModifierGroup.findUnique({
        where: { id: historyGroup.id },
      }),
      "History-guarded hard-delete rejection must leave the group."
    );
    assert.ok(
      await prisma.sharedModifierOption.findUnique({
        where: { id: historyOption.id },
      }),
      "History-guarded hard-delete rejection must leave the option."
    );

    console.log("- case 26: option delete deactivates instead of hard deleting");
    const optionDeleteJson = await expectStatus(
      await modules.optionRoute.DELETE(
        routeRequest({
          path: `/api/admin/modifier-groups/${groupId}/options/${optionId}`,
          method: "DELETE",
          sessionToken: managerToken,
          body: { lockVersion: groupLockVersion },
        }),
        optionParamsOf(groupId, optionId)
      ),
      200,
      "Option deactivate should succeed"
    );
    groupLockVersion = Number(optionDeleteJson.groupLockVersion);
    const deletedOption = optionDeleteJson.option as { isActive: boolean };
    assert.equal(deletedOption.isActive, false, "Option DELETE should deactivate.");
    assert.equal(groupLockVersion, 5, "Option delete should increment group lockVersion.");

    console.log("- case 27: group delete deactivates instead of hard deleting");
    const groupDeleteJson = await expectStatus(
      await modules.groupRoute.DELETE(
        routeRequest({
          path: `/api/admin/modifier-groups/${groupId}`,
          method: "DELETE",
          sessionToken: managerToken,
          body: { lockVersion: groupLockVersion },
        }),
        paramsOf(groupId)
      ),
      200,
      "Group deactivate should succeed"
    );
    const deletedGroup = groupDeleteJson.group as {
      isActive: boolean;
      lockVersion: number;
    };
    groupLockVersion = deletedGroup.lockVersion;
    assert.equal(deletedGroup.isActive, false, "Group DELETE should deactivate.");
    assert.equal(groupLockVersion, 6, "Group delete should increment lockVersion.");

    const finalLibraryRevisionCount = await prisma.menuRevision.count({
      where: {
        OR: [
          { targetType: "MODIFIER_GROUP", targetId: groupId },
          { targetType: "MODIFIER_OPTION", targetId: optionId },
        ],
      },
    });
    assert.equal(
      finalLibraryRevisionCount,
      1,
      "Only the attached group mutation should write a library-targeted menu revision."
    );
    const itemModifierRevisionCount = await prisma.menuRevision.count({
      where: {
        OR: [
          { targetType: "ITEM_MODIFIER_GROUP", targetId: itemModifierLinkId },
          { targetType: "ITEM_MODIFIER_OVERRIDE", targetId: overrideId },
        ],
      },
    });
    assert.equal(
      itemModifierRevisionCount,
      5,
      "Attach, link update, override update, override clear, and detach should write revisions."
    );

    const auditActions = await prisma.menuAuditLog.findMany({
      where: {
        OR: [
          { targetType: "MODIFIER_GROUP", targetId: groupId },
          { targetType: "MODIFIER_OPTION", targetId: optionId },
        ],
      },
      select: { actionType: true },
      orderBy: { createdAt: "asc" },
    });
    assert.deepEqual(
      auditActions.map((entry) => entry.actionType).sort(),
      [
        "MODIFIER_GROUP_CREATED",
        "MODIFIER_GROUP_DEACTIVATED",
        "MODIFIER_GROUP_UPDATED",
        "MODIFIER_GROUP_UPDATED",
        "MODIFIER_OPTION_CREATED",
        "MODIFIER_OPTION_DEACTIVATED",
        "MODIFIER_OPTION_UPDATED",
      ].sort(),
      "Successful modifier route mutations should each write exactly one audit row."
    );
    const itemAuditActions = await prisma.menuAuditLog.findMany({
      where: {
        OR: [
          { targetType: "ITEM_MODIFIER_GROUP", targetId: itemModifierLinkId },
          { targetType: "ITEM_MODIFIER_OVERRIDE", targetId: overrideId },
        ],
      },
      select: { actionType: true },
    });
    assert.deepEqual(
      itemAuditActions.map((entry) => entry.actionType).sort(),
      [
        "ITEM_MODIFIER_GROUP_ATTACHED",
        "ITEM_MODIFIER_GROUP_DETACHED",
        "ITEM_MODIFIER_GROUP_UPDATED",
        "ITEM_MODIFIER_OVERRIDE_CLEARED",
        "ITEM_MODIFIER_OVERRIDE_UPDATED",
      ].sort(),
      "Successful item modifier mutations should each write exactly one audit row."
    );
  } finally {
    await cleanup();
    await restoreOutletMenuVersion(initialMenuVersion);
    await prisma.$disconnect();
  }
}

main().catch(async (err) => {
  console.error(err);
  await cleanup().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
