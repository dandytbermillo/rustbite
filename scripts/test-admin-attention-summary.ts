/* eslint-disable no-console */
import { createRequire } from "node:module";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import "dotenv/config";
import { prisma } from "@/lib/db";

const require = createRequire(import.meta.url);
const shortRunId = Date.now().toString(36);
const runId = `attention-${shortRunId}`;
const outletAId = `${runId}-a`;
const outletBId = `${runId}-b`;
const managerEmail = `${runId}-manager@example.test`;
const operatorEmail = `${runId}-operator@example.test`;
const multiOutletEmail = `${runId}-multi@example.test`;
const adminNeedsMfaEmail = `${runId}-admin-mfa@example.test`;

type SummaryRoute = typeof import("@/app/api/admin/attention/summary/route");
type ProductionAuth = typeof import("@/lib/production-auth");

type JsonObject = Record<string, unknown>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${String(expected)}, got ${String(actual)}.`);
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

async function loadModules(): Promise<{
  summaryRoute: SummaryRoute;
  productionAuth: ProductionAuth;
}> {
  stubServerOnly();
  const [summaryRoute, productionAuth] = await Promise.all([
    import("@/app/api/admin/attention/summary/route"),
    import("@/lib/production-auth"),
  ]);
  return { summaryRoute, productionAuth };
}

function cookieHeader(cookies: Record<string, string | null | undefined>) {
  return Object.entries(cookies)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join("; ");
}

function basicAuthHeader(password = "change-me-in-prod") {
  return `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`;
}

function request({
  sessionToken,
  activeOutletId,
  legacyBasicAuth = false,
}: {
  sessionToken?: string | null;
  activeOutletId?: string | null;
  legacyBasicAuth?: boolean;
} = {}) {
  const cookie = cookieHeader({
    rb_admin_session: sessionToken,
    rb_admin_active_outlet: activeOutletId,
  });
  return new NextRequest("http://localhost/api/admin/attention/summary", {
    method: "GET",
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(legacyBasicAuth ? { authorization: basicAuthHeader() } : {}),
    },
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

async function expectError(
  response: NextResponse,
  status: number,
  errorCode: string,
  message: string,
) {
  const json = await readJson(response);
  assertEqual(response.status, status, message);
  assertEqual(String(json.errorCode), errorCode, message);
}

async function createSession(
  productionAuth: ProductionAuth,
  userId: string,
): Promise<string> {
  const token = productionAuth.createSessionToken();
  await prisma.adminSession.create({
    data: {
      userId,
      tokenHash: productionAuth.hashSessionToken(token),
      expiresAt: productionAuth.computeAdminSessionExpiry(),
      userAgent: "attention-summary-test",
      ipHash: `${runId}-ip`,
    },
  });
  return token;
}

async function ensureSite() {
  await prisma.site.upsert({
    where: { id: "site" },
    update: {},
    create: {
      id: "site",
      name: "Rushbite",
      timezone: "America/Edmonton",
    },
  });
}

async function seedFixture() {
  await ensureSite();
  const [outletA, outletB] = await Promise.all([
    prisma.outlet.create({
      data: {
        id: outletAId,
        siteId: "site",
        name: `Attention Outlet A ${shortRunId}`,
        slug: outletAId,
        orderPrefix: `A${shortRunId.slice(-5).toUpperCase()}`,
        isActive: true,
      },
    }),
    prisma.outlet.create({
      data: {
        id: outletBId,
        siteId: "site",
        name: `Attention Outlet B ${shortRunId}`,
        slug: outletBId,
        orderPrefix: `B${shortRunId.slice(-5).toUpperCase()}`,
        isActive: true,
      },
    }),
  ]);

  const [dealsA, regularA, hiddenA, regularB] = await Promise.all([
    prisma.category.create({
      data: {
        outletId: outletA.id,
        slug: "deals",
        name: "Deals",
        icon: "🔥",
        sortOrder: 1,
        isActive: true,
      },
    }),
    prisma.category.create({
      data: {
        outletId: outletA.id,
        slug: `${runId}-regular`,
        name: `Attention Regular ${shortRunId}`,
        icon: "A",
        sortOrder: 2,
        isActive: true,
      },
    }),
    prisma.category.create({
      data: {
        outletId: outletA.id,
        slug: `${runId}-hidden`,
        name: `Attention Hidden ${shortRunId}`,
        icon: "H",
        sortOrder: 3,
        isActive: false,
      },
    }),
    prisma.category.create({
      data: {
        outletId: outletB.id,
        slug: `${runId}-b`,
        name: `Attention B ${shortRunId}`,
        icon: "B",
        sortOrder: 1,
        isActive: true,
      },
    }),
  ]);

  const [manualOut, quantityLow, quantityZero, hiddenCategoryOut, outletBOut] =
    await Promise.all([
      prisma.menuItem.create({
        data: {
          outletId: outletA.id,
          categoryId: regularA.id,
          name: `Manual Out ${shortRunId}`,
          description: "Manual out fixture",
          price: new Prisma.Decimal("2.00"),
          emoji: "A",
          bgColor: "#FFE3B3",
          isActive: true,
          isOutOfStock: true,
          stockMode: "MANUAL",
          sortOrder: 1,
        },
      }),
      prisma.menuItem.create({
        data: {
          outletId: outletA.id,
          categoryId: regularA.id,
          name: `Quantity Low ${shortRunId}`,
          description: "Low stock fixture",
          price: new Prisma.Decimal("3.00"),
          emoji: "L",
          bgColor: "#FFE3B3",
          isActive: true,
          stockMode: "QUANTITY",
          stockQty: 2,
          lowStockThreshold: 5,
          sortOrder: 2,
        },
      }),
      prisma.menuItem.create({
        data: {
          outletId: outletA.id,
          categoryId: regularA.id,
          name: `Quantity Zero ${shortRunId}`,
          description: "Zero stock fixture",
          price: new Prisma.Decimal("4.00"),
          emoji: "Z",
          bgColor: "#FFE3B3",
          isActive: true,
          stockMode: "QUANTITY",
          stockQty: 0,
          lowStockThreshold: 5,
          sortOrder: 3,
        },
      }),
      prisma.menuItem.create({
        data: {
          outletId: outletA.id,
          categoryId: hiddenA.id,
          name: `Hidden Category Out ${shortRunId}`,
          description: "Hidden category fixture",
          price: new Prisma.Decimal("5.00"),
          emoji: "H",
          bgColor: "#FFE3B3",
          isActive: true,
          isOutOfStock: true,
          stockMode: "MANUAL",
          sortOrder: 1,
        },
      }),
      prisma.menuItem.create({
        data: {
          outletId: outletB.id,
          categoryId: regularB.id,
          name: `Outlet B Out ${shortRunId}`,
          description: "Should not leak",
          price: new Prisma.Decimal("6.00"),
          emoji: "B",
          bgColor: "#FFE3B3",
          isActive: true,
          isOutOfStock: true,
          stockMode: "MANUAL",
          sortOrder: 1,
        },
      }),
    ]);

  const deal = await prisma.menuItem.create({
    data: {
      outletId: outletA.id,
      categoryId: dealsA.id,
      name: `Attention Deal ${shortRunId}`,
      description: "Deal with unavailable base",
      price: new Prisma.Decimal("7.00"),
      emoji: "D",
      bgColor: "#FFE3B3",
      badge: "DEAL",
      isActive: true,
      dealBaseMenuItemId: manualOut.id,
      dealExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      sortOrder: 1,
      upgradeOptions: {
        create: {
          extraCharge: new Prisma.Decimal("1.00"),
          sortOrder: 1,
          linkedItems: {
            create: {
              linkedMenuItemId: quantityLow.id,
              itemNameSnapshot: quantityLow.name,
              sortOrder: 1,
            },
          },
        },
      },
    },
  });

  await Promise.all([
    prisma.order.create({
      data: {
        orderNumber: `${runId}-awaiting`,
        outletId: outletA.id,
        kioskId: "attention-test",
        orderType: "TO_GO",
        status: "AWAITING_COUNTER_PAYMENT",
        subtotal: new Prisma.Decimal("1.00"),
        gst: new Prisma.Decimal("0.05"),
        total: new Prisma.Decimal("1.05"),
        paymentMethod: "CASH",
        paymentProvider: "COUNTER",
        paymentStatus: "PENDING",
      },
    }),
    prisma.order.create({
      data: {
        orderNumber: `${runId}-ready`,
        outletId: outletA.id,
        kioskId: "attention-test",
        orderType: "TO_GO",
        status: "READY",
        subtotal: new Prisma.Decimal("1.00"),
        gst: new Prisma.Decimal("0.05"),
        total: new Prisma.Decimal("1.05"),
        paymentMethod: "CASH",
        paymentProvider: "COUNTER",
        paymentStatus: "CAPTURED",
      },
    }),
    prisma.order.create({
      data: {
        orderNumber: `${runId}-kitchen`,
        outletId: outletA.id,
        kioskId: "attention-test",
        orderType: "TO_GO",
        status: "IN_KITCHEN",
        subtotal: new Prisma.Decimal("1.00"),
        gst: new Prisma.Decimal("0.05"),
        total: new Prisma.Decimal("1.05"),
        paymentMethod: "CASH",
        paymentProvider: "COUNTER",
        paymentStatus: "CAPTURED",
      },
    }),
    prisma.order.create({
      data: {
        orderNumber: `${runId}-b-ready`,
        outletId: outletB.id,
        kioskId: "attention-test",
        orderType: "TO_GO",
        status: "READY",
        subtotal: new Prisma.Decimal("9.00"),
        gst: new Prisma.Decimal("0.45"),
        total: new Prisma.Decimal("9.45"),
        paymentMethod: "CASH",
        paymentProvider: "COUNTER",
        paymentStatus: "CAPTURED",
      },
    }),
  ]);

  const [manager, operator, multiOutlet, adminNeedsMfa] = await Promise.all([
    prisma.adminUser.create({
      data: {
        email: managerEmail,
        displayName: "Attention Manager",
        passwordHash: "test-password-hash",
        accountType: "STAFF",
        siteRole: null,
        isActive: true,
      },
    }),
    prisma.adminUser.create({
      data: {
        email: operatorEmail,
        displayName: "Attention Operator",
        passwordHash: "test-password-hash",
        accountType: "STAFF",
        siteRole: null,
        isActive: true,
      },
    }),
    prisma.adminUser.create({
      data: {
        email: multiOutletEmail,
        displayName: "Attention Multi",
        passwordHash: "test-password-hash",
        accountType: "STAFF",
        siteRole: null,
        isActive: true,
      },
    }),
    prisma.adminUser.create({
      data: {
        email: adminNeedsMfaEmail,
        displayName: "Attention Admin MFA",
        passwordHash: "test-password-hash",
        accountType: "ADMIN",
        siteRole: "ADMIN",
        isActive: true,
      },
    }),
  ]);

  await prisma.adminUserOutletRole.createMany({
    data: [
      { userId: manager.id, outletId: outletA.id, role: "MANAGER" },
      { userId: operator.id, outletId: outletA.id, role: "OPERATOR" },
      { userId: multiOutlet.id, outletId: outletA.id, role: "MANAGER" },
      { userId: multiOutlet.id, outletId: outletB.id, role: "VIEWER" },
    ],
  });

  return {
    outletA,
    outletB,
    deal,
    manualOut,
    quantityLow,
    quantityZero,
    hiddenCategoryOut,
    outletBOut,
    manager,
    operator,
    multiOutlet,
    adminNeedsMfa,
  };
}

async function cleanup() {
  await prisma.adminSession.deleteMany({
    where: {
      user: {
        email: {
          in: [
            managerEmail,
            operatorEmail,
            multiOutletEmail,
            adminNeedsMfaEmail,
          ],
        },
      },
    },
  });
  await prisma.adminUser.deleteMany({
    where: {
      email: {
        in: [managerEmail, operatorEmail, multiOutletEmail, adminNeedsMfaEmail],
      },
    },
  });
  await prisma.stockMovement.deleteMany({
    where: {
      OR: [
        { outletId: { in: [outletAId, outletBId] } },
        { itemNameSnapshot: { contains: shortRunId } },
      ],
    },
  });
  await prisma.order.deleteMany({
    where: { orderNumber: { startsWith: runId } },
  });
  await prisma.menuItem.deleteMany({
    where: { outletId: { in: [outletAId, outletBId] } },
  });
  await prisma.category.deleteMany({
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
  await prisma.outletMenuVersion.deleteMany({
    where: { outletId: { in: [outletAId, outletBId] } },
  });
  await prisma.outlet.deleteMany({
    where: { id: { in: [outletAId, outletBId] } },
  });
}

function group(summary: JsonObject, id: string) {
  const groups = summary.groups as Array<{
    id: string;
    count: number;
    items: Array<{ id: string; count: number; href: string }>;
  }>;
  return groups.find((entry) => entry.id === id);
}

function itemCount(
  groupEntry: ReturnType<typeof group>,
  itemId: string,
): number {
  return groupEntry?.items.find((item) => item.id === itemId)?.count ?? 0;
}

async function main() {
  const { summaryRoute, productionAuth } = await loadModules();
  await cleanup();
  const fixture = await seedFixture();

  const managerToken = await createSession(productionAuth, fixture.manager.id);
  const operatorToken = await createSession(productionAuth, fixture.operator.id);
  const multiOutletToken = await createSession(
    productionAuth,
    fixture.multiOutlet.id,
  );
  const adminNeedsMfaToken = await createSession(
    productionAuth,
    fixture.adminNeedsMfa.id,
  );

  try {
    console.log("- case 1: no session is rejected");
    await expectError(
      await summaryRoute.GET(request()),
      401,
      "unauthorized",
      "No session should be unauthorized",
    );

    console.log("- case 2: legacy Basic Auth without session is rejected");
    await expectError(
      await summaryRoute.GET(request({ legacyBasicAuth: true })),
      401,
      "unauthorized",
      "Legacy Basic Auth should not be accepted by the summary endpoint",
    );

    console.log("- case 3: MFA enrollment required is rejected");
    await expectError(
      await summaryRoute.GET(
        request({ sessionToken: adminNeedsMfaToken, activeOutletId: outletAId }),
      ),
      428,
      "mfa_enrollment_required",
      "Admin without MFA should be blocked",
    );

    console.log("- case 4: multi-outlet staff without active outlet must choose context");
    await expectError(
      await summaryRoute.GET(request({ sessionToken: multiOutletToken })),
      409,
      "active_outlet_required",
      "Multi-outlet staff should require active outlet",
    );

    console.log("- case 5: manager sees active-outlet menu and order attention counts");
    const managerResponse = await summaryRoute.GET(
      request({ sessionToken: managerToken, activeOutletId: outletAId }),
    );
    assertEqual(managerResponse.status, 200, "Manager summary should succeed");
    assertEqual(
      managerResponse.headers.get("cache-control"),
      "no-store",
      "Summary response must not be cached",
    );
    const managerSummary = await readJson(managerResponse);
    assertEqual(managerSummary.outletId, outletAId, "Summary must be outlet scoped");
    const menuGroup = group(managerSummary, "menu");
    const ordersGroup = group(managerSummary, "orders");
    assert(menuGroup, "Manager should see menu group");
    assert(ordersGroup, "Manager should see orders group");
    assertEqual(itemCount(menuGroup, "deals"), 1, "Deal attention count should match fixture");
    assertEqual(itemCount(menuGroup, "inventory-out"), 2, "Out-of-stock count should match fixture");
    assertEqual(itemCount(menuGroup, "inventory-low"), 1, "Low-stock count should match fixture");
    assertEqual(
      itemCount(ordersGroup, "awaiting-payment"),
      1,
      "Awaiting payment count should match fixture",
    );
    assertEqual(itemCount(ordersGroup, "ready"), 1, "Ready count should match fixture");
    assertEqual(managerSummary.totalCount, 6, "Total count should sum visible groups");

    console.log("- case 6: operator sees orders group but not menu group");
    const operatorResponse = await summaryRoute.GET(
      request({ sessionToken: operatorToken, activeOutletId: outletAId }),
    );
    assertEqual(operatorResponse.status, 200, "Operator summary should succeed");
    const operatorSummary = await readJson(operatorResponse);
    assert(!group(operatorSummary, "menu"), "Operator should not see menu group");
    assert(group(operatorSummary, "orders"), "Operator should see orders group");
    assertEqual(operatorSummary.totalCount, 2, "Operator total should include orders only");

    console.log("- case 7: stale outlet-B cookie does not leak outlet-B counts");
    const staleCookieResponse = await summaryRoute.GET(
      request({ sessionToken: managerToken, activeOutletId: outletBId }),
    );
    assertEqual(staleCookieResponse.status, 200, "Stale cookie fallback should succeed");
    const staleCookieSummary = await readJson(staleCookieResponse);
    assertEqual(
      staleCookieSummary.outletId,
      outletAId,
      "One-outlet staff stale cookie should resolve back to their outlet",
    );
    const staleMenuGroup = group(staleCookieSummary, "menu");
    assertEqual(
      itemCount(staleMenuGroup, "inventory-out"),
      2,
      "Outlet B inventory issue must not leak into outlet A summary",
    );

    console.log("admin attention summary route tests passed");
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
