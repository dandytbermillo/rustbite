/* eslint-disable no-console */
import { createRequire } from "node:module";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import "dotenv/config";
import { prisma } from "@/lib/db";

const require = createRequire(import.meta.url);
const shortRunId = Date.now().toString(36);
const runId = `route-scope-${shortRunId}`;
const outletAId = "cafeteria";
const outletBId = `${runId}-b`;
const staffOneOutletEmail = `${runId}-staff-a@example.test`;
const staffMultiOutletEmail = `${runId}-staff-multi@example.test`;

type LoadedModules = {
  categoriesRoute: typeof import("@/app/api/admin/categories/route");
  categoryRoute: typeof import("@/app/api/admin/categories/[id]/route");
  itemsRoute: typeof import("@/app/api/admin/items/route");
  itemRoute: typeof import("@/app/api/admin/items/[id]/route");
  orderRoute: typeof import("@/app/api/admin/orders/[id]/route");
  productionAuth: typeof import("@/lib/production-auth");
};

type JsonObject = Record<string, unknown>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${String(expected)}, got ${String(actual)}.`);
  }
}

function assertNotEqual<T>(actual: T, expected: T, message: string) {
  if (actual === expected) {
    throw new Error(`${message}. Did not expect ${String(expected)}.`);
  }
}

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

async function loadModules(): Promise<LoadedModules> {
  stubServerOnly();
  const [
    categoriesRoute,
    categoryRoute,
    itemsRoute,
    itemRoute,
    orderRoute,
    productionAuth,
  ] = await Promise.all([
    import("@/app/api/admin/categories/route"),
    import("@/app/api/admin/categories/[id]/route"),
    import("@/app/api/admin/items/route"),
    import("@/app/api/admin/items/[id]/route"),
    import("@/app/api/admin/orders/[id]/route"),
    import("@/lib/production-auth"),
  ]);

  return {
    categoriesRoute,
    categoryRoute,
    itemsRoute,
    itemRoute,
    orderRoute,
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
  sessionToken,
  activeOutletId,
  body,
}: {
  path: string;
  method?: string;
  sessionToken: string;
  activeOutletId?: string | null;
  body?: JsonObject;
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
    headers.referer = "http://localhost/admin/menu";
    headers["content-type"] = "application/json";
  }

  return new NextRequest(`http://localhost${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function readJson(response: NextResponse): Promise<JsonObject> {
  const text = await response.text();
  try {
    return JSON.parse(text) as JsonObject;
  } catch {
    return { raw: text };
  }
}

async function expectErrorCode(
  response: NextResponse,
  status: number,
  errorCodes: string[],
  message: string
) {
  const json = await readJson(response);
  assertEqual(response.status, status, message);
  assert(
    errorCodes.includes(String(json.errorCode)),
    `${message}. Expected one of ${errorCodes.join(", ")}, got ${
      json.errorCode ?? JSON.stringify(json)
    }.`
  );
}

async function createSession(
  productionAuth: LoadedModules["productionAuth"],
  userId: string
) {
  const token = productionAuth.createSessionToken();
  await prisma.adminSession.create({
    data: {
      userId,
      tokenHash: productionAuth.hashSessionToken(token),
      expiresAt: productionAuth.computeAdminSessionExpiry(),
      userAgent: "route-scope-test",
      ipHash: `${runId}-ip`,
    },
  });
  return token;
}

async function ensureBaseSiteAndOutlet() {
  await prisma.site.upsert({
    where: { id: "site" },
    update: {},
    create: {
      id: "site",
      name: "Rushbite",
      timezone: "America/Edmonton",
    },
  });

  await prisma.outlet.upsert({
    where: { id: outletAId },
    update: { isActive: true },
    create: {
      id: outletAId,
      siteId: "site",
      name: "Cafeteria",
      slug: "cafeteria",
      orderPrefix: "C",
      isActive: true,
    },
  });
}

async function seedFixture() {
  await ensureBaseSiteAndOutlet();

  const outletB = await prisma.outlet.create({
    data: {
      id: outletBId,
      siteId: "site",
      name: `Route Scope Outlet B ${shortRunId}`,
      slug: outletBId,
      orderPrefix: `RS${shortRunId.slice(-5).toUpperCase()}`,
      isActive: true,
    },
  });

  const [categoryA, categoryB] = await Promise.all([
    prisma.category.create({
      data: {
        outletId: outletAId,
        slug: `${runId}-a`,
        name: `Scope A ${shortRunId}`,
        icon: "A",
        sortOrder: 9990,
        isActive: true,
      },
    }),
    prisma.category.create({
      data: {
        outletId: outletB.id,
        slug: `${runId}-b`,
        name: `Scope B ${shortRunId}`,
        icon: "B",
        sortOrder: 9991,
        isActive: true,
      },
    }),
  ]);

  const [itemA, itemB] = await Promise.all([
    prisma.menuItem.create({
      data: {
        outletId: outletAId,
        categoryId: categoryA.id,
        name: `Scope A Item ${shortRunId}`,
        description: "Outlet A route-scope fixture",
        price: new Prisma.Decimal("1.23"),
        emoji: "A",
        bgColor: "#FFE3B3",
        isActive: true,
        sortOrder: 9990,
      },
    }),
    prisma.menuItem.create({
      data: {
        outletId: outletB.id,
        categoryId: categoryB.id,
        name: `Scope B Item ${shortRunId}`,
        description: "Outlet B route-scope fixture",
        price: new Prisma.Decimal("9.87"),
        emoji: "B",
        bgColor: "#FFE3B3",
        isActive: true,
        sortOrder: 9991,
      },
    }),
  ]);

  const orderB = await prisma.order.create({
    data: {
      orderNumber: `RS-${shortRunId}`,
      outletId: outletB.id,
      kioskId: "route-scope-test",
      orderType: "TO_GO",
      status: "PAID",
      subtotal: new Prisma.Decimal("9.87"),
      gst: new Prisma.Decimal("0.49"),
      total: new Prisma.Decimal("10.36"),
      paymentMethod: "PAY_AT_COUNTER",
      paymentProvider: "COUNTER",
      paymentStatus: "CAPTURED",
      items: {
        create: {
          menuItemId: itemB.id,
          nameSnapshot: itemB.name,
          qty: 1,
          addonsJson: [],
          isMeal: false,
          lineTotal: new Prisma.Decimal("9.87"),
        },
      },
    },
  });

  const [staffOneOutlet, staffMultiOutlet] = await Promise.all([
    prisma.adminUser.create({
      data: {
        email: staffOneOutletEmail,
        displayName: "Route Scope Staff A",
        passwordHash: "test-password-hash",
        accountType: "STAFF",
        siteRole: null,
        isActive: true,
      },
    }),
    prisma.adminUser.create({
      data: {
        email: staffMultiOutletEmail,
        displayName: "Route Scope Staff Multi",
        passwordHash: "test-password-hash",
        accountType: "STAFF",
        siteRole: null,
        isActive: true,
      },
    }),
  ]);

  await prisma.adminUserOutletRole.createMany({
    data: [
      {
        userId: staffOneOutlet.id,
        outletId: outletAId,
        role: "MANAGER",
      },
      {
        userId: staffMultiOutlet.id,
        outletId: outletAId,
        role: "MANAGER",
      },
      {
        userId: staffMultiOutlet.id,
        outletId: outletB.id,
        role: "VIEWER",
      },
    ],
  });

  return {
    outletB,
    categoryA,
    categoryB,
    itemA,
    itemB,
    orderB,
    staffOneOutlet,
    staffMultiOutlet,
  };
}

async function cleanup() {
  await prisma.order.deleteMany({
    where: { orderNumber: { startsWith: "RS-" } },
  });
  await prisma.adminSession.deleteMany({
    where: {
      user: {
        email: { in: [staffOneOutletEmail, staffMultiOutletEmail] },
      },
    },
  });
  await prisma.adminUser.deleteMany({
    where: { email: { in: [staffOneOutletEmail, staffMultiOutletEmail] } },
  });
  await prisma.stockMovement.deleteMany({
    where: {
      OR: [
        { outletId: outletBId },
        { itemNameSnapshot: { contains: shortRunId } },
      ],
    },
  });
  await prisma.menuItem.deleteMany({
    where: {
      OR: [
        { outletId: outletBId },
        { name: { contains: shortRunId } },
      ],
    },
  });
  await prisma.category.deleteMany({
    where: {
      OR: [
        { outletId: outletBId },
        { slug: { contains: runId } },
        { name: { contains: shortRunId } },
      ],
    },
  });
  await prisma.menuHistoryState.deleteMany({
    where: { outletId: outletBId },
  });
  await prisma.menuRevision.deleteMany({
    where: { outletId: outletBId },
  });
  await prisma.menuAuditLog.deleteMany({
    where: { outletId: outletBId },
  });
  await prisma.outletMenuVersion.deleteMany({
    where: { outletId: outletBId },
  });
  await prisma.outlet.deleteMany({
    where: { id: outletBId },
  });
}

async function main() {
  const modules = await loadModules();
  await cleanup();
  const fixture = await seedFixture();
  const staffOneOutletToken = await createSession(
    modules.productionAuth,
    fixture.staffOneOutlet.id
  );
  const staffMultiOutletToken = await createSession(
    modules.productionAuth,
    fixture.staffMultiOutlet.id
  );

  try {
    const previousAllowedOrigins = process.env.ADMIN_ALLOWED_ORIGINS;
    delete process.env.ADMIN_ALLOWED_ORIGINS;
    try {
      const localhostOrigins = modules.productionAuth.getAllowedAdminOrigins(
        new NextRequest("http://localhost:3001/api/admin/items")
      );
      assert(
        localhostOrigins.has("http://127.0.0.1:3001"),
        "Dev origin fallback should allow the localhost/127.0.0.1 loopback alias"
      );
      const loopbackOrigins = modules.productionAuth.getAllowedAdminOrigins(
        new NextRequest("http://127.0.0.1:3001/api/admin/items")
      );
      assert(
        loopbackOrigins.has("http://localhost:3001"),
        "Dev origin fallback should allow the 127.0.0.1/localhost loopback alias"
      );
    } finally {
      if (previousAllowedOrigins == null) delete process.env.ADMIN_ALLOWED_ORIGINS;
      else process.env.ADMIN_ALLOWED_ORIGINS = previousAllowedOrigins;
    }

    console.log("- case 1: stale outlet-B cookie falls back to Staff outlet A for category reads");
    const categoriesResponse = await modules.categoriesRoute.GET(
      routeRequest({
        path: "/api/admin/categories",
        sessionToken: staffOneOutletToken,
        activeOutletId: fixture.outletB.id,
      })
    );
    assertEqual(categoriesResponse.status, 200, "Stale cookie category read should succeed");
    const categoriesJson = await readJson(categoriesResponse);
    const categories = categoriesJson.categories as Array<{ id: string; outletId: string }>;
    assert(
      categories.some((category) => category.id === fixture.categoryA.id),
      "Outlet A category should be visible"
    );
    assert(
      !categories.some((category) => category.id === fixture.categoryB.id),
      "Outlet B category should not leak through stale cookie"
    );

    console.log("- case 2: stale outlet-B cookie falls back to Staff outlet A for item reads");
    const itemsResponse = await modules.itemsRoute.GET(
      routeRequest({
        path: "/api/admin/items",
        sessionToken: staffOneOutletToken,
        activeOutletId: fixture.outletB.id,
      })
    );
    assertEqual(itemsResponse.status, 200, "Stale cookie item read should succeed");
    const itemsJson = await readJson(itemsResponse);
    const items = itemsJson.items as Array<{ id: string; outletId: string }>;
    assert(
      items.some((item) => item.id === fixture.itemA.id),
      "Outlet A item should be visible"
    );
    assert(
      !items.some((item) => item.id === fixture.itemB.id),
      "Outlet B item should not leak through stale cookie"
    );

    console.log("- case 3: direct outlet-B item read is blocked for Staff without outlet-B role");
    const directItemResponse = await modules.itemRoute.GET(
      routeRequest({
        path: `/api/admin/items/${fixture.itemB.id}`,
        sessionToken: staffOneOutletToken,
        activeOutletId: outletAId,
      }),
      { params: Promise.resolve({ id: fixture.itemB.id }) }
    );
    await expectErrorCode(
      directItemResponse,
      403,
      ["no_outlet_access"],
      "Direct outlet-B item read should be forbidden"
    );

    console.log("- case 4: direct outlet-B category mutation is blocked and leaves data unchanged");
    const categoryNameBefore = fixture.categoryB.name;
    const categoryPatchResponse = await modules.categoryRoute.PATCH(
      routeRequest({
        path: `/api/admin/categories/${fixture.categoryB.id}`,
        method: "PATCH",
        sessionToken: staffOneOutletToken,
        activeOutletId: outletAId,
        body: {
          updatedAt: fixture.categoryB.updatedAt.toISOString(),
          slug: fixture.categoryB.slug,
          name: `${categoryNameBefore} MUTATED`,
          icon: fixture.categoryB.icon,
          sortOrder: fixture.categoryB.sortOrder,
          isActive: fixture.categoryB.isActive,
        },
      }),
      { params: Promise.resolve({ id: fixture.categoryB.id }) }
    );
    await expectErrorCode(
      categoryPatchResponse,
      403,
      ["no_outlet_access"],
      "Direct outlet-B category mutation should be forbidden"
    );
    const categoryAfter = await prisma.category.findUniqueOrThrow({
      where: { id: fixture.categoryB.id },
    });
    assertEqual(categoryAfter.name, categoryNameBefore, "Outlet B category must not mutate");

    console.log("- case 5: direct outlet-B item mutation is blocked and leaves data unchanged");
    const itemNameBefore = fixture.itemB.name;
    const itemPatchResponse = await modules.itemRoute.PATCH(
      routeRequest({
        path: `/api/admin/items/${fixture.itemB.id}`,
        method: "PATCH",
        sessionToken: staffOneOutletToken,
        activeOutletId: outletAId,
        body: {
          updatedAt: fixture.itemB.updatedAt.toISOString(),
          name: `${itemNameBefore} MUTATED`,
        },
      }),
      { params: Promise.resolve({ id: fixture.itemB.id }) }
    );
    await expectErrorCode(
      itemPatchResponse,
      403,
      ["no_outlet_access"],
      "Direct outlet-B item mutation should be forbidden"
    );
    const itemAfter = await prisma.menuItem.findUniqueOrThrow({
      where: { id: fixture.itemB.id },
    });
    assertEqual(itemAfter.name, itemNameBefore, "Outlet B item must not mutate");

    console.log("- case 6: direct outlet-B order mutation is blocked and leaves data unchanged");
    const orderStatusBefore = fixture.orderB.status;
    const orderPatchResponse = await modules.orderRoute.PATCH(
      routeRequest({
        path: `/api/admin/orders/${fixture.orderB.id}`,
        method: "PATCH",
        sessionToken: staffOneOutletToken,
        activeOutletId: outletAId,
        body: { status: "READY" },
      }),
      { params: Promise.resolve({ id: fixture.orderB.id }) }
    );
    await expectErrorCode(
      orderPatchResponse,
      403,
      ["no_outlet_access"],
      "Direct outlet-B order mutation should be forbidden"
    );
    const orderAfter = await prisma.order.findUniqueOrThrow({
      where: { id: fixture.orderB.id },
    });
    assertEqual(orderAfter.status, orderStatusBefore, "Outlet B order must not mutate");

    console.log("- case 7: stale outlet-B cookie cannot redirect category creation into outlet B");
    const createCategoryResponse = await modules.categoriesRoute.POST(
      routeRequest({
        path: "/api/admin/categories",
        method: "POST",
        sessionToken: staffOneOutletToken,
        activeOutletId: fixture.outletB.id,
        body: {
          slug: `${runId}-created`,
          name: `Created A ${shortRunId}`,
          icon: "C",
          sortOrder: 9992,
          isActive: true,
        },
      })
    );
    assertEqual(createCategoryResponse.status, 201, "Category create should use Staff outlet A");
    const createdCategory = (await readJson(createCategoryResponse)) as {
      id: string;
      outletId: string;
      updatedAt: string;
      slug: string;
      name: string;
      icon: string;
      sortOrder: number;
      isActive: boolean;
    };
    assertEqual(
      createdCategory.outletId,
      outletAId,
      "Stale outlet-B cookie must not write into outlet B"
    );
    assertNotEqual(
      createdCategory.outletId,
      fixture.outletB.id,
      "Created category should not belong to outlet B"
    );

    const deleteCreatedCategoryResponse = await modules.categoryRoute.DELETE(
      routeRequest({
        path: `/api/admin/categories/${createdCategory.id}`,
        method: "DELETE",
        sessionToken: staffOneOutletToken,
        activeOutletId: outletAId,
        body: { updatedAt: createdCategory.updatedAt },
      }),
      { params: Promise.resolve({ id: createdCategory.id }) }
    );
    assertEqual(
      deleteCreatedCategoryResponse.status,
      200,
      "Created category cleanup should succeed"
    );

    console.log("- case 8: multi-outlet Staff without active outlet must choose context");
    const needsPickerResponse = await modules.categoriesRoute.GET(
      routeRequest({
        path: "/api/admin/categories",
        sessionToken: staffMultiOutletToken,
        activeOutletId: null,
      })
    );
    await expectErrorCode(
      needsPickerResponse,
      409,
      ["active_outlet_required"],
      "Multi-outlet Staff with no active outlet should not get implicit data"
    );

    console.log(
      "- note: /api/admin/settings is site-level AppSettings today, so it is intentionally not treated as an outlet-scope violation"
    );
    console.log("admin route data-scope regression tests passed");
  } finally {
    await cleanup();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
