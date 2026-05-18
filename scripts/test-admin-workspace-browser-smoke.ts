/* eslint-disable no-console */
import "dotenv/config";

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  chromium,
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { prisma } from "@/lib/db";
import {
  DEFAULT_DEAL_EXPIRATION_TIME,
  DEFAULT_DEAL_START_TIME,
  dealSchedulePresetTomorrow,
  isOnlyTodayPresetAvailable,
  toDealScheduleDateInputValue,
  toDealScheduleTimeInputValue,
} from "@/lib/deal-schedule";
import { getOutletMenuVersion } from "@/lib/outlet-menu-sync";

const baseUrl =
  process.env.ADMIN_WORKSPACE_BROWSER_BASE_URL ??
  process.env.BROWSER_BASE_URL ??
  "http://127.0.0.1:3001";

const shortRunId = Date.now().toString(36);
const runId = `workspace-smoke-${shortRunId}`;
const outletAId = `${runId}-a`;
const outletBId = `${runId}-b`;
const outletAName = `Workspace Smoke A ${shortRunId}`;
const outletBName = `Workspace Smoke B ${shortRunId}`;
const categoryAId = `${runId}-cat-a`;
const categoryDealsId = `${runId}-cat-deals`;
const categoryBId = `${runId}-cat-b`;
const itemAId = `${runId}-item-a`;
const itemLowId = `${runId}-item-low`;
const itemDealId = `${runId}-item-deal`;
const itemBId = `${runId}-item-b`;
const dealLimitSmokeQty = 7;
const dealLimitSmokeLowThreshold = 2;
const sharedModifierUseId = `${runId}-shared-use`;
const sharedModifierExactId = `${runId}-shared-exact`;
const sharedModifierAttachedId = `${runId}-shared-attached`;
const sharedModifierAttachedVisibleOptionId = `${runId}-shared-attached-visible-option`;
const sharedModifierAttachedHiddenOptionId = `${runId}-shared-attached-hidden-option`;
const sharedModifierAttachedSecondId = `${runId}-shared-attached-second`;
const sharedModifierAttachedSecondOptionId = `${runId}-shared-attached-second-option`;
const deviceOnlineId = `${runId}-device-online`;
const deviceIdleId = `${runId}-device-idle`;
const deviceOfflineId = `${runId}-device-offline`;
const deviceDisabledId = `${runId}-device-disabled`;
const deviceOtherOutletId = `${runId}-device-other`;
const userEmails = {
  owner: `${runId}-owner@example.test`,
  admin: `${runId}-admin@example.test`,
  manager: `${runId}-manager@example.test`,
  operator: `${runId}-operator@example.test`,
  viewer: `${runId}-viewer@example.test`,
};

const ADMIN_SESSION_COOKIE = "rb_admin_session";
const ADMIN_ACTIVE_OUTLET_COOKIE = "rb_admin_active_outlet";

type RoleKey = keyof typeof userEmails;

type Fixture = {
  tokens: Record<RoleKey, string>;
};

type WidgetId = "dashboard" | "orders" | "menu" | "devices" | "attention";

type WidgetStyle = {
  left: number;
  top: number;
  width: number;
  height: number;
};

function hashSessionToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

async function assertServerReachable() {
  try {
    const response = await fetch(`${baseUrl}/admin/login`, {
      redirect: "manual",
    });
    assert(
      response.status > 0,
      `Admin workspace smoke could not reach ${baseUrl}.`,
    );
  } catch (error) {
    throw new Error(
      `Admin workspace browser smoke requires an already-running Next server at ${baseUrl}. ` +
        `Start it first, or set ADMIN_WORKSPACE_BROWSER_BASE_URL to the correct URL. ` +
        `Original error: ${(error as Error).message}`,
    );
  }
}

async function launchSmokeBrowser() {
  const preferredChannel =
    process.env.ADMIN_WORKSPACE_BROWSER_CHANNEL ??
    process.env.ADMIN_DASHBOARD_BROWSER_CHANNEL ??
    (process.platform === "darwin" ? "chrome" : null);

  if (preferredChannel) {
    try {
      return await chromium.launch({
        headless: true,
        channel: preferredChannel,
      });
    } catch (error) {
      if (
        process.env.ADMIN_WORKSPACE_BROWSER_CHANNEL ||
        process.env.ADMIN_DASHBOARD_BROWSER_CHANNEL
      ) {
        throw error;
      }
      console.warn(
        `Could not launch Playwright channel ${preferredChannel}; falling back to bundled Chromium.`,
      );
    }
  }

  return chromium.launch({ headless: true });
}

async function createAdminSession(userId: string, role: RoleKey) {
  const token = createSessionToken();
  const stepUpAt = role === "owner" ? new Date() : null;
  await prisma.adminSession.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
      userAgent: `admin-workspace-browser-smoke-${role}`,
      ipHash: `${runId}-ip`,
      ...(stepUpAt
        ? {
            stepUpVerifiedAt: stepUpAt,
            stepUpExpiresAt: new Date(stepUpAt.getTime() + 10 * 60 * 1000),
          }
        : {}),
    },
  });
  return token;
}

async function seedFixture(): Promise<Fixture> {
  await prisma.site.upsert({
    where: { id: "site" },
    update: { timezone: "America/Edmonton" },
    create: {
      id: "site",
      name: "Rushbite",
      timezone: "America/Edmonton",
    },
  });

  await prisma.outlet.createMany({
    data: [
      {
        id: outletAId,
        siteId: "site",
        name: outletAName,
        slug: outletAId,
        orderPrefix: `WS${shortRunId.slice(-5).toUpperCase()}`,
        isActive: true,
      },
      {
        id: outletBId,
        siteId: "site",
        name: outletBName,
        slug: outletBId,
        orderPrefix: `WT${shortRunId.slice(-5).toUpperCase()}`,
        isActive: true,
      },
    ],
  });

  await prisma.category.createMany({
    data: [
      {
        id: categoryDealsId,
        outletId: outletAId,
        slug: "deals",
        name: `${runId} Deals`,
        icon: "D",
        sortOrder: 9989,
        isActive: true,
      },
      {
        id: categoryAId,
        outletId: outletAId,
        slug: `${runId}-cat-a`,
        name: `${runId} Category A`,
        icon: "A",
        sortOrder: 9990,
        isActive: true,
      },
      {
        id: categoryBId,
        outletId: outletBId,
        slug: `${runId}-cat-b`,
        name: `${runId} Category B`,
        icon: "B",
        sortOrder: 9991,
        isActive: true,
      },
    ],
  });

  await prisma.menuItem.createMany({
    data: [
      {
        id: itemDealId,
        outletId: outletAId,
        categoryId: categoryDealsId,
        comboNum: 1,
        name: `${runId} Attention Deal`,
        description: "Workspace smoke deal attention fixture",
        price: new Prisma.Decimal("8.00"),
        emoji: "D",
        bgColor: "#FFE8A3",
        sortOrder: 9989,
        isActive: true,
      },
      {
        id: itemAId,
        outletId: outletAId,
        categoryId: categoryAId,
        name: `${runId} Burger`,
        description: "Workspace smoke fixture",
        price: new Prisma.Decimal("10.00"),
        emoji: "B",
        bgColor: "#FFE3B3",
        sortOrder: 9990,
        isActive: true,
        isOutOfStock: true,
      },
      {
        id: itemLowId,
        outletId: outletAId,
        categoryId: categoryAId,
        name: `${runId} Low Stock Fries`,
        description: "Workspace smoke low-stock fixture",
        price: new Prisma.Decimal("4.50"),
        emoji: "F",
        bgColor: "#E8F5D8",
        sortOrder: 9991,
        isActive: true,
        stockMode: "QUANTITY",
        stockQty: 2,
        lowStockThreshold: 3,
      },
      {
        id: itemBId,
        outletId: outletBId,
        categoryId: categoryBId,
        name: `${runId} Other Outlet`,
        description: "Workspace smoke leak guard fixture",
        price: new Prisma.Decimal("99.00"),
        emoji: "O",
        bgColor: "#FFE3B3",
        sortOrder: 9991,
        isActive: true,
      },
    ],
  });

  await Promise.all([
    prisma.sizeOption.create({
      data: {
        itemId: itemAId,
        name: "Large",
        priceDelta: new Prisma.Decimal("2.00"),
        sortOrder: 1,
      },
    }),
    prisma.addonOption.create({
      data: {
        itemId: itemAId,
        name: "Bacon",
        priceDelta: new Prisma.Decimal("1.50"),
        sortOrder: 1,
      },
    }),
    prisma.upgradeOption.create({
      data: {
        itemId: itemDealId,
        customTitle: "Workspace Smoke Bundle",
        extraCharge: new Prisma.Decimal("0.00"),
        sortOrder: 1,
        linkedItems: {
          create: {
            linkedMenuItemId: itemAId,
            itemNameSnapshot: `${runId} Burger`,
            sortOrder: 1,
          },
        },
      },
    }),
  ]);

  await Promise.all([
    prisma.sharedModifierGroup.create({
      data: {
        id: sharedModifierUseId,
        outletId: outletAId,
        name: `${runId} Garden Sauce`,
        description: "Workspace smoke suggestion fixture",
        selectionMode: "OPTIONAL_SINGLE",
        minSelect: 0,
        maxSelect: 1,
        sortOrder: 1,
        isActive: true,
        options: {
          create: {
            name: "Garden sauce",
            priceDelta: new Prisma.Decimal("0.75"),
            sortOrder: 0,
            isActive: true,
            stockMode: "MANUAL",
            isOutOfStock: false,
          },
        },
      },
    }),
    prisma.sharedModifierGroup.create({
      data: {
        id: sharedModifierExactId,
        outletId: outletAId,
        name: `${runId} Zesty Pickles`,
        description: "Workspace smoke exact-match fixture",
        selectionMode: "OPTIONAL_MULTI",
        minSelect: 0,
        maxSelect: null,
        sortOrder: 2,
        isActive: true,
        options: {
          create: {
            name: "Zesty pickles",
            priceDelta: new Prisma.Decimal("0.50"),
            sortOrder: 0,
            isActive: true,
            stockMode: "QUANTITY",
            stockQty: 8,
            lowStockThreshold: 2,
            isOutOfStock: false,
          },
        },
      },
    }),
	    prisma.sharedModifierGroup.create({
	      data: {
	        id: sharedModifierAttachedId,
        outletId: outletAId,
        name: `${runId} Attached Pickles`,
        description: "Workspace smoke already-attached fixture",
        selectionMode: "OPTIONAL_SINGLE",
        minSelect: 0,
        maxSelect: 1,
        sortOrder: 3,
        isActive: true,
        options: {
          create: [
            {
              id: sharedModifierAttachedVisibleOptionId,
              name: "Attached pickles",
              priceDelta: new Prisma.Decimal("0.40"),
              sortOrder: 0,
              isActive: true,
              stockMode: "MANUAL",
              isOutOfStock: false,
            },
            {
              id: sharedModifierAttachedHiddenOptionId,
              name: "Attached onions",
              priceDelta: new Prisma.Decimal("0.60"),
              sortOrder: 1,
              isActive: true,
              stockMode: "QUANTITY",
              stockQty: 4,
              lowStockThreshold: 2,
              isOutOfStock: false,
            },
          ],
	        },
	      },
	    }),
	    prisma.sharedModifierGroup.create({
	      data: {
	        id: sharedModifierAttachedSecondId,
	        outletId: outletAId,
	        name: `${runId} Attached Sauce`,
	        description: "Workspace smoke second attached fixture",
	        selectionMode: "OPTIONAL_SINGLE",
	        minSelect: 0,
	        maxSelect: 1,
	        sortOrder: 4,
	        isActive: true,
	        options: {
	          create: {
	            id: sharedModifierAttachedSecondOptionId,
	            name: "Attached sauce",
	            priceDelta: new Prisma.Decimal("0.55"),
	            sortOrder: 0,
	            isActive: true,
	            stockMode: "QUANTITY",
	            stockQty: 6,
	            lowStockThreshold: 2,
	            isOutOfStock: false,
	          },
	        },
	      },
	    }),
	  ]);

	  await Promise.all([
	    prisma.menuItemModifierGroup.create({
	      data: {
	        outletId: outletAId,
	        menuItemId: itemAId,
	        modifierGroupId: sharedModifierAttachedId,
	        sortOrder: 0,
	        isActive: true,
	        optionOverrides: {
	          create: {
	            modifierOptionId: sharedModifierAttachedHiddenOptionId,
	            isHidden: true,
	          },
	        },
	      },
	    }),
	    prisma.menuItemModifierGroup.create({
	      data: {
	        outletId: outletAId,
	        menuItemId: itemAId,
	        modifierGroupId: sharedModifierAttachedSecondId,
	        sortOrder: 1,
	        isActive: true,
	      },
	    }),
	  ]);

  const now = new Date();
  const minutesAgo = (minutes: number) =>
    new Date(now.getTime() - minutes * 60 * 1000);
  const createOrder = ({
    suffix,
    outletId = outletAId,
    itemId = itemAId,
    status,
    total,
    qty,
    createdAt,
  }: {
    suffix: string;
    outletId?: string;
    itemId?: string;
    status: string;
    total: string;
    qty: number;
    createdAt: Date;
  }) =>
    prisma.order.create({
      data: {
        orderNumber: `${runId}-${suffix}`,
        outletId,
        kioskId: runId,
        orderType: "TO_GO",
        status,
        subtotal: new Prisma.Decimal(total),
        gst: new Prisma.Decimal("0.00"),
        total: new Prisma.Decimal(total),
        paymentMethod: status === "AWAITING_COUNTER_PAYMENT" ? "CASH" : "CARD",
        paymentProvider:
          status === "AWAITING_COUNTER_PAYMENT" ? "COUNTER" : "TEST",
        paymentStatus:
          status === "AWAITING_COUNTER_PAYMENT" ? "PENDING" : "PAID",
        createdAt,
        items: {
          create: {
            menuItemId: itemId,
            nameSnapshot:
              itemId === itemBId
                ? "Other Outlet Workspace Smoke"
                : "Workspace Smoke Burger",
            qty,
            addonsJson: [],
            isMeal: false,
            lineTotal: new Prisma.Decimal(total),
          },
        },
      },
    });

  await Promise.all([
    createOrder({
      suffix: "cash",
      status: "AWAITING_COUNTER_PAYMENT",
      total: "11.00",
      qty: 1,
      createdAt: minutesAgo(8),
    }),
    createOrder({
      suffix: "paid-1",
      status: "PAID",
      total: "12.00",
      qty: 1,
      createdAt: minutesAgo(7),
    }),
    createOrder({
      suffix: "paid-2",
      status: "PAID",
      total: "13.00",
      qty: 1,
      createdAt: minutesAgo(6),
    }),
    createOrder({
      suffix: "kitchen",
      status: "IN_KITCHEN",
      total: "14.00",
      qty: 1,
      createdAt: minutesAgo(15),
    }),
    createOrder({
      suffix: "ready",
      status: "READY",
      total: "15.00",
      qty: 1,
      createdAt: minutesAgo(5),
    }),
    createOrder({
      suffix: "completed",
      status: "COMPLETED",
      total: "16.00",
      qty: 1,
      createdAt: minutesAgo(4),
    }),
    createOrder({
      suffix: "other-outlet",
      outletId: outletBId,
      itemId: itemBId,
      status: "PAID",
      total: "99.00",
      qty: 1,
      createdAt: minutesAgo(3),
    }),
  ]);

  await prisma.device.createMany({
    data: [
      {
        id: deviceOnlineId,
        siteId: "site",
        outletId: outletAId,
        name: `${runId} online`,
        physicalLocation: "Workspace smoke online",
        role: "kiosk",
        secretHash: `${runId}-secret`,
        isActive: true,
        lastSeenAt: minutesAgo(1),
      },
      {
        id: deviceIdleId,
        siteId: "site",
        outletId: outletAId,
        name: `${runId} idle`,
        role: "counter",
        secretHash: `${runId}-secret`,
        isActive: true,
        lastSeenAt: minutesAgo(5),
      },
      {
        id: deviceOfflineId,
        siteId: "site",
        outletId: outletAId,
        name: `${runId} offline`,
        role: "kitchen",
        secretHash: `${runId}-secret`,
        isActive: true,
        lastSeenAt: minutesAgo(15),
      },
      {
        id: deviceDisabledId,
        siteId: "site",
        outletId: outletAId,
        name: `${runId} disabled`,
        role: "board",
        secretHash: `${runId}-secret`,
        isActive: false,
        lastSeenAt: null,
      },
      {
        id: deviceOtherOutletId,
        siteId: "site",
        outletId: outletBId,
        name: `${runId} other outlet device`,
        role: "kiosk",
        secretHash: `${runId}-secret`,
        isActive: true,
        lastSeenAt: minutesAgo(1),
      },
    ],
  });

  const [owner, admin, manager, operator, viewer] = await Promise.all([
    prisma.adminUser.create({
      data: {
        email: userEmails.owner,
        displayName: "Workspace Smoke Owner",
        passwordHash: `${runId}-hash`,
        accountType: "OWNER",
        siteRole: "OWNER",
        mfaEnabledAt: new Date(),
        mfaSecretCiphertext: `${runId}-mfa-secret`,
        isActive: true,
      },
    }),
    prisma.adminUser.create({
      data: {
        email: userEmails.admin,
        displayName: "Workspace Smoke Admin",
        passwordHash: `${runId}-hash`,
        accountType: "ADMIN",
        siteRole: "ADMIN",
        mfaEnabledAt: new Date(),
        mfaSecretCiphertext: `${runId}-admin-mfa-secret`,
        isActive: true,
      },
    }),
    prisma.adminUser.create({
      data: {
        email: userEmails.manager,
        displayName: "Workspace Smoke Manager",
        passwordHash: `${runId}-hash`,
        accountType: "STAFF",
        siteRole: null,
        isActive: true,
        outletRoles: {
          create: { outletId: outletAId, role: "MANAGER" },
        },
      },
    }),
    prisma.adminUser.create({
      data: {
        email: userEmails.operator,
        displayName: "Workspace Smoke Operator",
        passwordHash: `${runId}-hash`,
        accountType: "STAFF",
        siteRole: null,
        isActive: true,
        outletRoles: {
          create: { outletId: outletAId, role: "OPERATOR" },
        },
      },
    }),
    prisma.adminUser.create({
      data: {
        email: userEmails.viewer,
        displayName: "Workspace Smoke Viewer",
        passwordHash: `${runId}-hash`,
        accountType: "STAFF",
        siteRole: null,
        isActive: true,
        outletRoles: {
          create: { outletId: outletAId, role: "VIEWER" },
        },
      },
    }),
  ]);

  await prisma.deviceSession.create({
    data: {
      deviceId: deviceOnlineId,
      tokenHash: `${runId}-device-session-online`,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      lastSeenAt: minutesAgo(1),
      activeOutletId: outletAId,
      activeStaffUserId: manager.id,
      activeStaffOutletId: outletAId,
      activeStaffRole: "MANAGER",
      activeStaffVerifiedAt: minutesAgo(8),
      activeStaffLastActionAt: minutesAgo(1),
    },
  });

  return {
    tokens: {
      owner: await createAdminSession(owner.id, "owner"),
      admin: await createAdminSession(admin.id, "admin"),
      manager: await createAdminSession(manager.id, "manager"),
      operator: await createAdminSession(operator.id, "operator"),
      viewer: await createAdminSession(viewer.id, "viewer"),
    },
  };
}

async function cleanup() {
  await prisma.adminSession.deleteMany({
    where: { user: { email: { startsWith: `${runId}-` } } },
  });
  await prisma.adminUser.deleteMany({
    where: { email: { startsWith: `${runId}-` } },
  });
  await prisma.deviceOutletAccess.deleteMany({
    where: { OR: [{ outletId: outletAId }, { outletId: outletBId }] },
  });
  await prisma.device.deleteMany({ where: { name: { startsWith: runId } } });
  await prisma.paymentTransaction.deleteMany({
    where: { kioskId: { startsWith: runId } },
  });
  await prisma.order.deleteMany({
    where: { orderNumber: { startsWith: runId } },
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
  await prisma.outletMenuVersion.deleteMany({
    where: { outletId: { in: [outletAId, outletBId] } },
  });
  await prisma.menuItem.deleteMany({
    where: { outletId: { in: [outletAId, outletBId] } },
  });
  await prisma.sharedModifierGroup.deleteMany({
    where: { outletId: { in: [outletAId, outletBId] } },
  });
  await prisma.category.deleteMany({
    where: { outletId: { in: [outletAId, outletBId] } },
  });
  await prisma.outlet.deleteMany({
    where: { id: { in: [outletAId, outletBId] } },
  });
}

async function refreshDeviceHealthFixture() {
  const now = new Date();
  const minutesAgo = (minutes: number) =>
    new Date(now.getTime() - minutes * 60 * 1000);

  await Promise.all([
    prisma.device.update({
      where: { id: deviceOnlineId },
      data: { isActive: true, lastSeenAt: minutesAgo(1) },
    }),
    prisma.device.update({
      where: { id: deviceIdleId },
      data: { isActive: true, lastSeenAt: minutesAgo(5) },
    }),
    prisma.device.update({
      where: { id: deviceOfflineId },
      data: { isActive: true, lastSeenAt: minutesAgo(15) },
    }),
    prisma.device.update({
      where: { id: deviceDisabledId },
      data: { isActive: false, lastSeenAt: null },
    }),
    prisma.deviceSession.updateMany({
      where: { deviceId: deviceOnlineId },
      data: {
        expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
        lastSeenAt: minutesAgo(1),
        activeStaffLastActionAt: minutesAgo(1),
      },
    }),
  ]);
}

async function assertNoSmokeRowsRemain() {
  const [
    outlets,
    orders,
    paymentTransactions,
    devices,
    users,
    auditLogs,
    revisions,
    items,
    sharedModifierGroups,
    categories,
  ] = await Promise.all([
    prisma.outlet.count({ where: { id: { startsWith: runId } } }),
    prisma.order.count({ where: { orderNumber: { startsWith: runId } } }),
    prisma.paymentTransaction.count({
      where: { kioskId: { startsWith: runId } },
    }),
    prisma.device.count({ where: { name: { startsWith: runId } } }),
    prisma.adminUser.count({
      where: { email: { startsWith: `${runId}-` } },
    }),
    prisma.menuAuditLog.count({
      where: { outletId: { in: [outletAId, outletBId] } },
    }),
    prisma.menuRevision.count({
      where: { outletId: { in: [outletAId, outletBId] } },
    }),
    prisma.menuItem.count({
      where: { outletId: { in: [outletAId, outletBId] } },
    }),
    prisma.sharedModifierGroup.count({
      where: { outletId: { in: [outletAId, outletBId] } },
    }),
    prisma.category.count({
      where: { outletId: { in: [outletAId, outletBId] } },
    }),
  ]);
  assert.equal(outlets, 0, "Smoke cleanup left outlet rows behind.");
  assert.equal(orders, 0, "Smoke cleanup left order rows behind.");
  assert.equal(
    paymentTransactions,
    0,
    "Smoke cleanup left payment transaction rows behind.",
  );
  assert.equal(devices, 0, "Smoke cleanup left device rows behind.");
  assert.equal(users, 0, "Smoke cleanup left admin user rows behind.");
  assert.equal(auditLogs, 0, "Smoke cleanup left menu audit rows behind.");
  assert.equal(revisions, 0, "Smoke cleanup left menu revision rows behind.");
  assert.equal(items, 0, "Smoke cleanup left menu item rows behind.");
  assert.equal(
    sharedModifierGroups,
    0,
    "Smoke cleanup left shared modifier group rows behind.",
  );
  assert.equal(categories, 0, "Smoke cleanup left category rows behind.");
}

async function newWorkspacePage({
  browser,
  token,
  activeOutletId = outletAId,
  viewport,
}: {
  browser: Browser;
  token: string;
  activeOutletId?: string;
  viewport: { width: number; height: number };
}) {
  const context = await browser.newContext({ baseURL: baseUrl, viewport });
  await context.addCookies([
    {
      name: ADMIN_SESSION_COOKIE,
      value: token,
      url: baseUrl,
      httpOnly: true,
      sameSite: "Strict",
    },
    {
      name: ADMIN_ACTIVE_OUTLET_COOKIE,
      value: activeOutletId,
      url: baseUrl,
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);
  const page = await context.newPage();
  await page.goto("/admin/workspace", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("admin-workspace-header")).toBeVisible();
  await expect(page.getByTestId("admin-workspace-canvas")).toBeVisible();
  await expect(page.getByText("Admin Workspace")).toHaveCount(0);
  return { context, page };
}

async function assertWorkspaceFullscreenPreference(
  browser: Browser,
  token: string,
) {
  const installOrientationMock = async (page: Page) => {
    await page.evaluate(`
      (() => {
        const lockOrientation = async (nextOrientation) => {
          window.__workspaceFullscreenLock = nextOrientation;
        };
        const unlockOrientation = () => {
          window.__workspaceFullscreenUnlocked = true;
        };
        const orientation = window.screen.orientation;
        if (orientation) {
          Object.defineProperty(orientation, "lock", {
            configurable: true,
            value: lockOrientation,
          });
          Object.defineProperty(orientation, "unlock", {
            configurable: true,
            value: unlockOrientation,
          });
        }
        if ("ScreenOrientation" in window) {
          Object.defineProperty(ScreenOrientation.prototype, "lock", {
            configurable: true,
            value: lockOrientation,
          });
          Object.defineProperty(ScreenOrientation.prototype, "unlock", {
            configurable: true,
            value: unlockOrientation,
          });
        }
      })()
    `);
  };
  const context = await browser.newContext({
    baseURL: baseUrl,
    viewport: { width: 1280, height: 900 },
  });
  await context.addInitScript(() => {
    let fullscreenElement: Element | null = null;
    const requestFullscreen = async function requestFullscreen(this: Element) {
      fullscreenElement = this;
      document.dispatchEvent(new Event("fullscreenchange"));
    };
    const exitFullscreen = async () => {
      fullscreenElement = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    };
    Object.defineProperty(Document.prototype, "fullscreenElement", {
      configurable: true,
      get() {
        return fullscreenElement;
      },
    });
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get() {
        return fullscreenElement;
      },
    });
    Object.defineProperty(Element.prototype, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });
    Object.defineProperty(Document.prototype, "exitFullscreen", {
      configurable: true,
      value: exitFullscreen,
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: exitFullscreen,
    });
    const lockOrientation = async (nextOrientation: string) => {
      (window as typeof window & { __workspaceFullscreenLock?: string })
        .__workspaceFullscreenLock = nextOrientation;
    };
    const unlockOrientation = () => {
      (window as typeof window & { __workspaceFullscreenUnlocked?: boolean })
        .__workspaceFullscreenUnlocked = true;
    };
    const mockedOrientation = {
      type: "landscape-primary",
      lock: lockOrientation,
      unlock: unlockOrientation,
    };
    try {
      Object.defineProperty(window.screen, "orientation", {
        configurable: true,
        value: mockedOrientation,
      });
    } catch {
      // Chromium exposes screen.orientation as read-only in some contexts.
    }
    const orientation = window.screen.orientation as ScreenOrientation & {
      lock?: (orientation: string) => Promise<void>;
      unlock?: () => void;
    };
    try {
      Object.defineProperty(orientation, "lock", {
        configurable: true,
        value: lockOrientation,
      });
      Object.defineProperty(orientation, "unlock", {
        configurable: true,
        value: unlockOrientation,
      });
    } catch {
      // Defining on ScreenOrientation.prototype below still covers Chromium.
    }
    if ("ScreenOrientation" in window) {
      Object.defineProperty(ScreenOrientation.prototype, "lock", {
        configurable: true,
        value: lockOrientation,
      });
      Object.defineProperty(ScreenOrientation.prototype, "unlock", {
        configurable: true,
        value: unlockOrientation,
      });
    }
  });
  await context.addCookies([
    {
      name: ADMIN_SESSION_COOKIE,
      value: token,
      url: baseUrl,
      httpOnly: true,
      sameSite: "Strict",
    },
    {
      name: ADMIN_ACTIVE_OUTLET_COOKIE,
      value: outletAId,
      url: baseUrl,
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);

  const page = await context.newPage();
  try {
    await page.goto("/admin/workspace", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("admin-workspace-header")).toBeVisible();
    await installOrientationMock(page);
    const fullscreenButton = page.getByTestId("admin-fullscreen-toggle");
    await expect(fullscreenButton).toContainText("Fullscreen");

    await fullscreenButton.click();
    await expect(fullscreenButton).toContainText("Exit");
    let preference = await page.evaluate(() => {
      const raw = window.localStorage.getItem(
        "rushbite:admin-fullscreen-preference:v1",
      );
      return raw ? JSON.parse(raw) : null;
    });
    assert.equal(
      preference?.desiredFullscreen,
      true,
      "Entering fullscreen should persist the user's fullscreen preference.",
    );
    assert.equal(
      preference?.orientation,
      "landscape",
      "Entering fullscreen should remember the current screen orientation.",
    );
    await expect
      .poll(
        async () =>
          await page.evaluate(
            () =>
              (window as typeof window & { __workspaceFullscreenLock?: string })
                .__workspaceFullscreenLock,
          ),
        {
          message:
            "Entering fullscreen should try to lock the remembered orientation.",
        },
      )
      .toBe("landscape");

    await page.reload({ waitUntil: "domcontentloaded" });
    await installOrientationMock(page);
    await expect(page.getByTestId("admin-fullscreen-toggle")).toContainText(
      "Resume fullscreen",
    );
    await page.getByTestId("admin-fullscreen-toggle").click();
    await expect(page.getByTestId("admin-fullscreen-toggle")).toContainText(
      "Exit",
    );
    await page.getByTestId("admin-fullscreen-toggle").click();
    await expect(page.getByTestId("admin-fullscreen-toggle")).toContainText(
      "Fullscreen",
    );
    preference = await page.evaluate(() => {
      const raw = window.localStorage.getItem(
        "rushbite:admin-fullscreen-preference:v1",
      );
      return raw ? JSON.parse(raw) : null;
    });
    assert.equal(
      preference?.desiredFullscreen,
      false,
      "Exiting fullscreen should clear the resume preference.",
    );
    assert.equal(
      await page.evaluate(
        () =>
          (window as typeof window & {
            __workspaceFullscreenUnlocked?: boolean;
          }).__workspaceFullscreenUnlocked,
      ),
      true,
      "Exiting fullscreen should unlock the orientation when supported.",
    );
  } finally {
    await context.close();
  }
}

async function expectWorkspaceChrome({
  page,
  role,
  outletName = outletAName,
}: {
  page: Page;
  role: string;
  outletName?: string;
}) {
  await expect(page.getByTestId("admin-workspace-active-outlet")).toContainText(
    outletName,
  );
  await expect(page.getByTestId("admin-workspace-role-pill")).toHaveText(
    role.toUpperCase(),
  );
  await expect(page.getByText(/classic/i)).toHaveCount(0);
}

async function openWorkspaceMoreMenu(page: Page): Promise<{
  scope: Locator;
  inlineVisible: boolean;
}> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.waitForTimeout(100);
    const menu = page.getByTestId("admin-workspace-more-menu");
    const overflow = page.getByTestId("admin-workspace-nav-overflow");
    const overflowVisible = await overflow.isVisible().catch(() => false);
    const inlineVisible =
      !overflowVisible && (await menu.isVisible().catch(() => false));
    const scope = inlineVisible ? menu : overflow;

    try {
      if (inlineVisible) {
        await expect(menu).toBeVisible();
        await menu
          .getByTestId("admin-workspace-more-trigger")
          .click({ timeout: 5_000 });
        await expect(
          menu.getByTestId("admin-workspace-more-menu-panel"),
        ).toBeVisible({ timeout: 5_000 });
      } else {
        await expect(scope).toBeVisible();
        await scope.locator("summary").hover({ timeout: 5_000 });
        await expect(
          scope.getByTestId("admin-workspace-more-security"),
        ).toBeVisible({ timeout: 5_000 });
      }
      return { scope: workspaceMoreScope(page, inlineVisible), inlineVisible };
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(250);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Could not open Workspace More menu.");
}

function workspaceMoreScope(page: Page, inlineVisible: boolean): Locator {
  return inlineVisible
    ? page.getByTestId("admin-workspace-more-menu")
    : page.getByTestId("admin-workspace-nav-overflow");
}

async function expectWorkspaceMoreMenu({
  page,
  expectsProtectedLinks,
  expectsDevicesLink,
}: {
  page: Page;
  expectsProtectedLinks: boolean;
  expectsDevicesLink: boolean;
}) {
  const { scope, inlineVisible } = await openWorkspaceMoreMenu(page);

  await expect(scope.getByTestId("admin-workspace-more-security")).toBeVisible();
  await expect(scope.getByTestId("admin-workspace-more-sign-out")).toBeVisible();

  if (expectsProtectedLinks) {
    await expect(
      scope.getByTestId("admin-workspace-more-deal-history"),
    ).toBeVisible();
    await expect(
      scope.getByTestId("admin-workspace-more-settings"),
    ).toBeVisible();
  } else {
    await expect(
      scope.getByTestId("admin-workspace-more-deal-history"),
    ).toHaveCount(0);
    await expect(
      scope.getByTestId("admin-workspace-more-settings"),
    ).toHaveCount(0);
  }

  if (expectsDevicesLink) {
    await expect(
      scope.getByTestId("admin-workspace-more-manage-devices"),
    ).toBeVisible();
  } else {
    await expect(
      scope.getByTestId("admin-workspace-more-manage-devices"),
    ).toHaveCount(0);
  }

  const modalTestId = expectsProtectedLinks
    ? "admin-workspace-dealHistory-modal"
    : "admin-workspace-security-modal";
  await clickWorkspaceMoreAction(
    page,
    expectsProtectedLinks
      ? "admin-workspace-more-deal-history"
      : "admin-workspace-more-security",
  );
  await expect(page.getByTestId(modalTestId)).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/workspace/);
  await page.getByTestId("admin-workspace-utility-modal-close").click();
  await expect(page.getByTestId(modalTestId)).toHaveCount(0);

  if (expectsProtectedLinks) {
    await clickWorkspaceMoreAction(page, "admin-workspace-more-settings");
    await expect(page.getByTestId("admin-workspace-settings-modal")).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/workspace/);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("admin-workspace-settings-modal")).toHaveCount(0);

    await clickWorkspaceMoreAction(page, "admin-workspace-more-security");
    const securityModal = page.getByTestId("admin-workspace-security-modal");
    await expect(securityModal).toBeVisible();
    await expect(securityModal).toContainText("MULTI-FACTOR AUTHENTICATION");
    await expect(page).toHaveURL(/\/admin\/workspace/);
    await page.getByTestId("admin-workspace-utility-modal-close").click();
    await expect(securityModal).toHaveCount(0);
  }

  if (inlineVisible) {
    const menu = page.getByTestId("admin-workspace-more-menu");
    const panel = menu.getByTestId("admin-workspace-more-menu-panel");
    await page
      .getByTestId("admin-workspace-header")
      .click({ position: { x: 2, y: 2 } });
    await expect(panel).toBeHidden();
  } else {
    await page.mouse.move(0, 0);
  }
}

async function clickWorkspaceMoreAction(page: Page, testId: string) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const { inlineVisible } = await openWorkspaceMoreMenu(page);
      const action = workspaceMoreScope(page, inlineVisible).getByTestId(testId);
      await expect(action).toBeVisible({ timeout: 5_000 });
      await action.click({ timeout: 5_000 });
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(250);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`Could not click Workspace More action ${testId}.`);
}

async function assertWorkspaceSettingsModalSave(browser: Browser, token: string) {
  const { context, page } = await newWorkspacePage({
    browser,
    token,
    viewport: { width: 1440, height: 950 },
  });
  const settingsResponse = await page.request.get("/api/admin/settings");
  assert.equal(
    settingsResponse.status(),
    200,
    "Workspace Settings modal smoke requires settings read access.",
  );
  const settingsBody = (await settingsResponse.json()) as {
    settings: {
      storeName: string;
      storeLocation: string;
      gstRate: number;
      dealDefaultDiscountPct: number | null;
    };
  };
  const originalSettings = settingsBody.settings;
  const updatedStoreName = `${runId} Modal Store`;

  try {
    await clickWorkspaceMoreAction(page, "admin-workspace-more-settings");
    const modal = page.getByTestId("admin-workspace-settings-modal");
    await expect(modal).toBeVisible();
    await modal.locator("input").nth(0).fill(updatedStoreName);
    await modal.getByRole("button", { name: "SAVE SETTINGS" }).click();
    await expect(modal).toContainText("Settings saved.");
    await expect(page).toHaveURL(/\/admin\/workspace/);

    const savedResponse = await page.request.get("/api/admin/settings");
    assert.equal(savedResponse.status(), 200);
    const savedBody = (await savedResponse.json()) as typeof settingsBody;
    assert.equal(
      savedBody.settings.storeName,
      updatedStoreName,
      "Workspace Settings modal should save through the settings route.",
    );
  } finally {
    await page.request.patch("/api/admin/settings", {
      data: originalSettings,
    });
    await context.close();
  }
}

async function expectWorkspaceUtilityDeepLink({
  page,
  href,
  modalTestId,
  modalParam,
}: {
  page: Page;
  href: string;
  modalTestId: string;
  modalParam: string;
}) {
  await page.goto(href, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("admin-workspace-header")).toBeVisible();
  await expect(page.getByTestId(modalTestId)).toBeVisible();
  const openUrl = new URL(page.url());
  assert.equal(
    openUrl.pathname,
    "/admin/workspace",
    `${href} should resolve inside Workspace.`,
  );
  assert.equal(
    openUrl.searchParams.get("modal"),
    modalParam,
    `${href} should preserve the requested Workspace modal.`,
  );
  await page.getByTestId("admin-workspace-utility-modal-close").click();
  await expect(page.getByTestId(modalTestId)).toHaveCount(0);
  const closedUrl = new URL(page.url());
  assert.equal(closedUrl.pathname, "/admin/workspace");
  assert.equal(
    closedUrl.searchParams.get("modal"),
    null,
    "Closing a Workspace utility modal should clear the modal query param.",
  );
}

async function expectWidget(page: Page, widgetId: WidgetId, visible: boolean) {
  const widget = page.getByTestId(`admin-workspace-widget-${widgetId}`);
  const link = page.getByTestId(`admin-workspace-link-${widgetId}`);
  if (visible) {
    await expect(widget).toHaveCount(1);
    await expect(widget).toBeVisible();
    await expect(link).toHaveCount(1);
    if (!(await link.isVisible())) {
      const overflow = page.getByTestId("admin-workspace-nav-overflow");
      await expect(overflow).toHaveCount(1);
      await overflow.locator("summary").hover();
      await expect(link).toBeVisible();
      await page.mouse.move(0, 0);
    } else {
      await expect(link).toBeVisible();
    }
  } else {
    await expect(widget).toHaveCount(0);
    await expect(link).toHaveCount(0);
  }
}

async function expectDashboardWidgetData({
  page,
  expectsDeviceHealth,
}: {
  page: Page;
  expectsDeviceHealth: boolean;
}) {
  const response = await page.request.get(
    "/api/admin/workspace/dashboard/summary?range=today",
  );
  assert.equal(
    response.status(),
    200,
    "Workspace dashboard compact summary should load.",
  );
  const payload = (await response.json()) as Record<string, unknown>;
  assert.equal(
    "recentOrders" in payload,
    false,
    "Workspace dashboard summary must not include recent order payloads.",
  );
  assert.equal(
    "topSellers" in payload,
    false,
    "Workspace dashboard summary must not include seller payloads.",
  );
  assert.equal(
    "topSellersBySales" in payload,
    false,
    "Workspace dashboard summary must not include revenue-ranked seller payloads.",
  );
  assert.equal(
    "deviceFleet" in payload,
    false,
    "Workspace dashboard summary must not include device fleet detail rows.",
  );
  assert.equal(
    "operationsPreview" in payload,
    false,
    "Workspace dashboard summary must not include top-level operation previews.",
  );
  const operationBuckets = payload.operationBuckets as Record<
    string,
    Record<string, unknown>
  > | null;
  const awaitingPreviewOrders =
    operationBuckets?.awaitingCounterPayment?.previewOrders;
  assert.ok(
    Array.isArray(awaitingPreviewOrders),
    "Workspace dashboard operation buckets should include scoped preview rows for in-widget previews.",
  );
  assert.ok(
    awaitingPreviewOrders.length > 0 && awaitingPreviewOrders.length <= 3,
    "Workspace dashboard operation preview should stay bounded.",
  );
  const firstPreviewOrder = awaitingPreviewOrders[0] as Record<string, unknown>;
  for (const restrictedField of [
    "customer",
    "user",
    "userId",
    "sessionId",
    "paymentIntentId",
    "stripePaymentIntentId",
    "stripeSessionId",
  ]) {
    assert.equal(
      restrictedField in firstPreviewOrder,
      false,
      `Workspace dashboard preview orders must not expose ${restrictedField}.`,
    );
  }

  const dashboard = page.getByTestId("admin-workspace-widget-dashboard");
  await expect(page.getByTestId("workspace-dashboard-real-data")).toBeVisible();
  await expect(dashboard).not.toContainText("Workspace shell placeholder");
  await expect(dashboard).toContainText("Hero KPIs");
  await expect(dashboard).toContainText("Real-time operations");
  await expect(dashboard).not.toContainText("Open Classic Orders");
  const dashboardOpenOrdersLinks = dashboard.getByRole("link", {
    name: "Open Orders",
  });
  await expect(dashboardOpenOrdersLinks).toHaveCount(2);
  await expect(dashboardOpenOrdersLinks.first()).toHaveAttribute(
    "href",
    "/admin/workspace?widget=orders",
  );
  await expect(dashboardOpenOrdersLinks.nth(1)).toHaveAttribute(
    "href",
    "/admin/workspace?widget=orders",
  );
  await expect(dashboard).not.toContainText("Connected devices");
  await expect(dashboard).not.toContainText("Top sellers");
  await expect(page.getByTestId("workspace-dashboard-kpis")).toBeVisible();
  await expect(page.getByTestId("workspace-dashboard-attention")).toHaveCount(
    0,
  );
  await expect(
    page.getByTestId("workspace-dashboard-device-health"),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("workspace-dashboard-device-health-hidden"),
  ).toHaveCount(0);

  await expect(
    page.getByTestId("workspace-dashboard-operation-awaitingCounterPayment"),
  ).toContainText("1");
  await expect(
    page.getByTestId("workspace-dashboard-operation-paid"),
  ).toContainText("2");
  await expect(
    page.getByTestId("workspace-dashboard-operation-inKitchen"),
  ).toContainText("1");
  await expect(
    page.getByTestId("workspace-dashboard-operation-ready"),
  ).toContainText("1");
  await expect(
    page.getByTestId("workspace-dashboard-operation-completedToday"),
  ).toContainText("1");
  await expect(page.getByText(outletBName)).toHaveCount(0);
  await expect(page.getByText(`${runId} other outlet device`)).toHaveCount(0);

  if (expectsDeviceHealth) {
    await expect(
      page.getByTestId("admin-workspace-widget-devices"),
    ).toContainText("Device fleet");
  }
  await expect(
    page.getByTestId("admin-workspace-widget-attention"),
  ).toContainText("Attention");
  await expect(
    page.getByTestId("admin-workspace-widget-attention"),
  ).toContainText("Needs attention");
  await expect(
    page.getByTestId("admin-workspace-widget-attention"),
  ).toContainText("orders awaiting payment");
  await expect(
    page.getByTestId("admin-workspace-widget-attention"),
  ).toContainText("orders ready for pickup");
}

function assertNoRestrictedOrderFields(
  order: Record<string, unknown>,
  label: string,
) {
  for (const restrictedField of [
    "user",
    "userId",
    "customer",
    "customerId",
    "customerEmail",
    "session",
    "sessionId",
    "paymentTransaction",
    "providerReference",
    "stripePaymentIntentId",
    "stripeSessionId",
  ]) {
    assert.equal(
      restrictedField in order,
      false,
      `${label} must not expose ${restrictedField}.`,
    );
  }
}

async function expectOrdersWidgetData(page: Page) {
  const response = await page.request.get(
    "/api/admin/workspace/orders/summary",
  );
  assert.equal(
    response.status(),
    200,
    "Workspace Orders summary should load for order-read roles.",
  );
  const payload = (await response.json()) as Record<string, unknown>;
  for (const excludedField of [
    "kpis",
    "operations",
    "operationsPreview",
    "deviceFleet",
    "deviceHealth",
    "recentOrders",
    "topSellers",
    "topSellersBySales",
  ]) {
    assert.equal(
      excludedField in payload,
      false,
      `Workspace Orders summary must not include dashboard ${excludedField}.`,
    );
  }

  const counts = payload.counts as Record<string, unknown>;
  assert.equal(counts.all, 5, "Workspace Orders counts active orders.");
  assert.equal(counts.payment, 1, "Workspace Orders counts payment queue.");
  assert.equal(
    counts.kitchen,
    3,
    "Workspace Orders counts paid/in-kitchen queue.",
  );
  assert.equal(counts.ready, 1, "Workspace Orders counts ready queue.");

  const orders = payload.orders as Record<string, unknown>[];
  assert.equal(
    orders.length,
    5,
    "Workspace Orders returns bounded active rows.",
  );
  const orderNumbers = orders.map((order) => String(order.orderNumber));
  assert(
    orderNumbers.includes(`${runId}-cash`),
    "Workspace Orders includes active outlet payment orders.",
  );
  assert(
    !orderNumbers.includes(`${runId}-other-outlet`),
    "Workspace Orders excludes orders from other outlets.",
  );
  for (const order of orders) {
    assertNoRestrictedOrderFields(
      order,
      `Workspace order ${order.orderNumber}`,
    );
  }

  const paymentResponse = await page.request.get(
    "/api/admin/workspace/orders/summary?filter=payment",
  );
  assert.equal(paymentResponse.status(), 200);
  const paymentPayload = (await paymentResponse.json()) as Record<
    string,
    unknown
  >;
  assert.equal(
    (paymentPayload.orders as unknown[]).length,
    1,
    "Workspace Orders payment filter returns payment rows only.",
  );

  const widget = page.getByTestId("admin-workspace-widget-orders");
  await expect(widget.getByTestId("workspace-orders-real-data")).toBeVisible();
  await expect(
    widget.getByTestId("workspace-orders-real-data"),
  ).toHaveAttribute("data-hydrated", "true");
  await expect(widget).toContainText("Active orders");
  await expect(widget).toContainText(`${runId}-cash`);
  await expect(widget).toContainText(`${runId}-paid-1`);
  await expect(widget).not.toContainText(`${runId}-other-outlet`);

  await widget.getByTestId("workspace-orders-row").first().click();
  await expect(widget.getByTestId("workspace-order-detail")).toBeVisible();
  await expect(widget.getByTestId("workspace-order-detail")).toContainText(
    "Line items",
  );
  await expect(widget.getByTestId("workspace-order-detail")).toContainText(
    "Actions",
  );
  await expect(
    widget.getByTestId("workspace-order-detail").getByRole("button", {
      name: "COMPLETED",
    }),
  ).toBeVisible();

  await widget.getByTestId("workspace-orders-filter-payment").click();
  await expect(widget).toContainText("Showing 1 of 1.");
}

type WorkspaceActionOrder = {
  id: string;
  orderNumber: string;
};

async function createWorkspaceActionOrder({
  suffix,
  status,
  total = "10.00",
  qty = 1,
  itemId = itemAId,
  nameSnapshot = "Workspace Action Burger",
  paymentMethod,
  paymentProvider,
  paymentStatus,
  productionStartedAt,
  withPaymentTransaction = false,
  paymentTransactionStatus,
  stockRequirementsJson,
}: {
  suffix: string;
  status: string;
  total?: string;
  qty?: number;
  itemId?: string;
  nameSnapshot?: string;
  paymentMethod?: string;
  paymentProvider?: string;
  paymentStatus?: string;
  productionStartedAt?: Date;
  withPaymentTransaction?: boolean;
  paymentTransactionStatus?: string;
  stockRequirementsJson?: Prisma.InputJsonValue;
}): Promise<WorkspaceActionOrder> {
  const kioskId = `${runId}-${suffix}`;
  const resolvedPaymentMethod =
    paymentMethod ?? (status === "AWAITING_COUNTER_PAYMENT" ? "CASH" : "CARD");
  const resolvedPaymentProvider =
    paymentProvider ?? (resolvedPaymentMethod === "CASH" ? "COUNTER" : "MOCK");
  const resolvedPaymentStatus =
    paymentStatus ??
    (status === "AWAITING_COUNTER_PAYMENT" ? "PENDING" : "CAPTURED");

  return prisma.order.create({
    data: {
      orderNumber: `${runId}-${suffix}`,
      outletId: outletAId,
      kioskId,
      orderType: "TO_GO",
      status,
      subtotal: new Prisma.Decimal(total),
      gst: new Prisma.Decimal("0.00"),
      total: new Prisma.Decimal(total),
      paymentMethod: resolvedPaymentMethod,
      paymentProvider: resolvedPaymentProvider,
      paymentStatus: resolvedPaymentStatus,
      ...(productionStartedAt ? { productionStartedAt } : {}),
      createdAt: new Date(Date.now() - 2 * 60 * 1000),
      items: {
        create: {
          menuItemId: itemId,
          nameSnapshot,
          qty,
          addonsJson: [],
          isMeal: false,
          lineTotal: new Prisma.Decimal(total),
        },
      },
      ...(withPaymentTransaction
        ? {
            paymentTransaction: {
              create: {
                outletId: outletAId,
                kioskId,
                orderType: "TO_GO",
                paymentMethod: resolvedPaymentMethod,
                provider: resolvedPaymentProvider,
                status: paymentTransactionStatus ?? resolvedPaymentStatus,
                currency: "cad",
                subtotal: new Prisma.Decimal(total),
                gst: new Prisma.Decimal("0.00"),
                total: new Prisma.Decimal(total),
                cartSnapshot: [],
                ...(stockRequirementsJson ? { stockRequirementsJson } : {}),
                providerReference: `${runId}-${suffix}-ref`,
                completedAt: new Date(),
                lastSyncedAt: new Date(),
              },
            },
          }
        : {}),
    },
    select: { id: true, orderNumber: true },
  });
}

async function orderActionSnapshot(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      status: true,
      paymentStatus: true,
      productionStartedAt: true,
    },
  });
  return `${order?.status}:${order?.paymentStatus ?? "-"}:${
    order?.productionStartedAt ? "started" : "not-started"
  }`;
}

async function assertWorkspaceOrdersMutationRbac({
  browser,
  viewerToken,
  operatorToken,
}: {
  browser: Browser;
  viewerToken: string;
  operatorToken: string;
}) {
  const viewerDeniedOrder = await createWorkspaceActionOrder({
    suffix: "viewer-denied-status",
    status: "AWAITING_COUNTER_PAYMENT",
  });
  const operatorDeniedRefundOrder = await createWorkspaceActionOrder({
    suffix: "operator-denied-refund",
    status: "PAID",
    paymentMethod: "CARD",
    paymentProvider: "MOCK",
    paymentStatus: "CAPTURED",
    withPaymentTransaction: true,
    paymentTransactionStatus: "CAPTURED",
  });
  const deniedStockRequirement = [
    {
      menuItemId: itemLowId,
      nameSnapshot: `${runId} Low Stock Fries`,
      qty: 1,
      source: "NORMAL_ITEM",
      orderLineMenuItemId: itemLowId,
      upgradeOptionId: null,
      upgradeItemLinkId: null,
    },
  ] as Prisma.InputJsonValue;
  const operatorDeniedReturnStockOrder = await createWorkspaceActionOrder({
    suffix: "operator-denied-return-stock",
    status: "REFUNDED",
    itemId: itemLowId,
    nameSnapshot: `${runId} Low Stock Fries`,
    paymentMethod: "CARD",
    paymentProvider: "MOCK",
    paymentStatus: "REFUNDED",
    productionStartedAt: new Date(),
    withPaymentTransaction: true,
    paymentTransactionStatus: "REFUNDED",
    stockRequirementsJson: deniedStockRequirement,
  });
  const stockBefore = await prisma.menuItem.findUnique({
    where: { id: itemLowId },
    select: { stockQty: true },
  });

  const viewer = await newWorkspacePage({
    browser,
    token: viewerToken,
    viewport: { width: 1280, height: 900 },
  });
  try {
    const response = await viewer.page.request.patch(
      `/api/admin/orders/${viewerDeniedOrder.id}`,
      { data: { status: "PAID" } },
    );
    assert.equal(
      response.status(),
      403,
      "Viewer Workspace session must not update order status.",
    );
    assert.equal(
      await orderActionSnapshot(viewerDeniedOrder.id),
      "AWAITING_COUNTER_PAYMENT:PENDING:not-started",
      "Viewer-denied status mutation must leave the order unchanged.",
    );
  } finally {
    await viewer.context.close();
  }

  const operator = await newWorkspacePage({
    browser,
    token: operatorToken,
    viewport: { width: 1280, height: 900 },
  });
  try {
    const refundResponse = await operator.page.request.post(
      `/api/admin/orders/${operatorDeniedRefundOrder.id}/refund`,
    );
    assert.equal(
      refundResponse.status(),
      403,
      "Operator Workspace session must not refund orders.",
    );
    assert.equal(
      await orderActionSnapshot(operatorDeniedRefundOrder.id),
      "PAID:CAPTURED:not-started",
      "Operator-denied refund must leave the order unchanged.",
    );

    const returnStockResponse = await operator.page.request.post(
      `/api/admin/orders/${operatorDeniedReturnStockOrder.id}/return-stock`,
    );
    assert.equal(
      returnStockResponse.status(),
      403,
      "Operator Workspace session must not return order stock.",
    );
    const [stockAfter, returnMovements] = await Promise.all([
      prisma.menuItem.findUnique({
        where: { id: itemLowId },
        select: { stockQty: true },
      }),
      prisma.stockMovement.count({
        where: {
          orderId: operatorDeniedReturnStockOrder.id,
          reason: "ADMIN_RETURN_STOCK",
        },
      }),
    ]);
    assert.equal(
      stockAfter?.stockQty ?? null,
      stockBefore?.stockQty ?? null,
      "Operator-denied stock return must leave menu quantity unchanged.",
    );
    assert.equal(
      returnMovements,
      0,
      "Operator-denied stock return must not write stock movements.",
    );
  } finally {
    await operator.context.close();
  }
}

async function assertWorkspaceOrdersActions(browser: Browser, token: string) {
  const actionOrder = await createWorkspaceActionOrder({
    suffix: "status-flow",
    status: "AWAITING_COUNTER_PAYMENT",
  });
  const cancelOrder = await createWorkspaceActionOrder({
    suffix: "actions-cancel",
    status: "AWAITING_COUNTER_PAYMENT",
  });
  const refundOrder = await createWorkspaceActionOrder({
    suffix: "actions-refund",
    status: "PAID",
    paymentMethod: "CARD",
    paymentProvider: "MOCK",
    paymentStatus: "CAPTURED",
    withPaymentTransaction: true,
    paymentTransactionStatus: "CAPTURED",
  });
  const returnStockQty = 2;
  const stockBefore = await prisma.menuItem.findUnique({
    where: { id: itemLowId },
    select: { stockQty: true },
  });
  const returnStockOrder = await createWorkspaceActionOrder({
    suffix: "actions-return-stock",
    status: "REFUNDED",
    total: "9.00",
    qty: returnStockQty,
    itemId: itemLowId,
    nameSnapshot: `${runId} Low Stock Fries`,
    paymentMethod: "CARD",
    paymentProvider: "MOCK",
    paymentStatus: "REFUNDED",
    productionStartedAt: new Date(),
    withPaymentTransaction: true,
    paymentTransactionStatus: "REFUNDED",
    stockRequirementsJson: [
      {
        menuItemId: itemLowId,
        nameSnapshot: `${runId} Low Stock Fries`,
        qty: returnStockQty,
        source: "NORMAL_ITEM",
        orderLineMenuItemId: itemLowId,
        upgradeOptionId: null,
        upgradeItemLinkId: null,
      },
    ] as Prisma.InputJsonValue,
  });

  const { context, page } = await newWorkspacePage({
    browser,
    token,
    viewport: { width: 1440, height: 950 },
  });

  async function openWorkspaceOrderTarget(order: WorkspaceActionOrder) {
    await page.goto(`/admin/workspace?widget=orders&order=${order.id}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("admin-workspace-header")).toBeVisible();
    const widget = page.getByTestId("admin-workspace-widget-orders");
    await expect(widget).toHaveAttribute("data-active", "true");
    await expect(
      widget.getByTestId("workspace-orders-real-data"),
    ).toHaveAttribute("data-hydrated", "true");
    await expect(
      widget.getByTestId("workspace-orders-target-row"),
    ).toContainText(order.orderNumber);
    await expect(widget.getByTestId("workspace-order-detail")).toBeVisible();
    return widget;
  }

  async function clickAction({
    order,
    name,
    expectedSnapshot,
    toastMessage,
    confirmMessage,
  }: {
    order: WorkspaceActionOrder;
    name: string;
    expectedSnapshot: string;
    toastMessage: string;
    confirmMessage?: string;
  }) {
    const detail = page
      .getByTestId("admin-workspace-widget-orders")
      .getByTestId("workspace-order-detail");
    const actionButton = detail.getByRole("button", { name });
    if (confirmMessage) {
      await Promise.all([
        page.waitForEvent("dialog").then(async (dialog) => {
          assert(
            dialog.message().includes(confirmMessage),
            `Expected confirmation dialog to include "${confirmMessage}".`,
          );
          await dialog.accept();
        }),
        actionButton.click(),
      ]);
    } else {
      await actionButton.click();
    }
    await expect
      .poll(() => orderActionSnapshot(order.id))
      .toBe(expectedSnapshot);
    await expect(
      page
        .getByTestId("admin-workspace-toast")
        .filter({ hasText: toastMessage }),
    ).toBeVisible();
    assert.equal(
      new URL(page.url()).pathname,
      "/admin/workspace",
      "Workspace order actions should not navigate to Classic Orders.",
    );
  }

  try {
    const widget = await openWorkspaceOrderTarget(actionOrder);

    await clickAction({
      order: actionOrder,
      name: "MARK PAID",
      expectedSnapshot: "PAID:CAPTURED:not-started",
      toastMessage: `Order #${actionOrder.orderNumber} marked paid`,
    });
    await expect(widget).toContainText("Paid");

    await clickAction({
      order: actionOrder,
      name: "IN_KITCHEN",
      expectedSnapshot: "IN_KITCHEN:CAPTURED:started",
      toastMessage: `Order #${actionOrder.orderNumber} moved to in kitchen`,
    });
    await expect(widget).toContainText("In kitchen");

    await clickAction({
      order: actionOrder,
      name: "READY",
      expectedSnapshot: "READY:CAPTURED:started",
      toastMessage: `Order #${actionOrder.orderNumber} moved to ready`,
    });
    await expect(widget).toContainText("Ready");

    await clickAction({
      order: actionOrder,
      name: "COMPLETED",
      expectedSnapshot: "COMPLETED:CAPTURED:started",
      toastMessage: `Order #${actionOrder.orderNumber} moved to completed`,
    });
    await expect(widget).not.toContainText(actionOrder.orderNumber);

    const cancelWidget = await openWorkspaceOrderTarget(cancelOrder);
    await clickAction({
      order: cancelOrder,
      name: "CANCEL",
      expectedSnapshot: "CANCELLED:CANCELLED:not-started",
      toastMessage: `Order #${cancelOrder.orderNumber} cancelled`,
      confirmMessage: `Cancel order #${cancelOrder.orderNumber}?`,
    });
    await expect(cancelWidget).not.toContainText(cancelOrder.orderNumber);

    const refundWidget = await openWorkspaceOrderTarget(refundOrder);
    await clickAction({
      order: refundOrder,
      name: "REFUND PAYMENT",
      expectedSnapshot: "REFUNDED:REFUNDED:not-started",
      toastMessage: `Order #${refundOrder.orderNumber} refunded`,
      confirmMessage: `Refund order #${refundOrder.orderNumber}?`,
    });
    await expect(refundWidget).not.toContainText(refundOrder.orderNumber);

    const returnStockWidget = await openWorkspaceOrderTarget(returnStockOrder);
    await clickAction({
      order: returnStockOrder,
      name: "RETURN STOCK",
      expectedSnapshot: "REFUNDED:REFUNDED:started",
      toastMessage: `Stock returned for order #${returnStockOrder.orderNumber}`,
      confirmMessage: `Return frozen quantity stock for order #${returnStockOrder.orderNumber}?`,
    });
    await expect(
      returnStockWidget.getByTestId("workspace-orders-target-row"),
    ).toContainText(returnStockOrder.orderNumber);
    await expect(
      returnStockWidget.getByTestId("workspace-order-detail"),
    ).toContainText("STOCK RETURNED");
    await expect
      .poll(async () => {
        const [stockAfter, returnMovements] = await Promise.all([
          prisma.menuItem.findUnique({
            where: { id: itemLowId },
            select: { stockQty: true },
          }),
          prisma.stockMovement.count({
            where: {
              orderId: returnStockOrder.id,
              reason: "ADMIN_RETURN_STOCK",
            },
          }),
        ]);
        return `${stockAfter?.stockQty ?? null}:${returnMovements}`;
      })
      .toBe(`${(stockBefore?.stockQty ?? 0) + returnStockQty}:1`);
  } finally {
    await context.close();
  }
}

function assertNoRestrictedMenuFields(
  row: Record<string, unknown>,
  label: string,
) {
  for (const restrictedField of [
    "stockUpdatedById",
    "lockVersion",
    "sizes",
    "addons",
    "upgradeOptions",
    "stockMovements",
    "orderItems",
    "outlet",
    "outletId",
  ]) {
    assert.equal(
      restrictedField in row,
      false,
      `${label} must not expose ${restrictedField}.`,
    );
  }
}

async function expectMenuWidgetData(page: Page, expectsMenuWrite: boolean) {
  await expect(page.getByTestId("admin-workspace-widget-menu")).toBeVisible({
    timeout: 15_000,
  });

  const response = await page.request.get("/api/admin/workspace/menu/summary");
  assert.equal(response.status(), 200, "Workspace Menu summary should load.");
  const payload = (await response.json()) as Record<string, unknown>;
  assert.equal(
    "auditLogs" in payload,
    false,
    "Workspace Menu summary must not include audit logs.",
  );
  assert.equal(
    "revisions" in payload,
    false,
    "Workspace Menu summary must not include menu revision history.",
  );
  const counts = payload.counts as Record<string, unknown>;
  assert.equal(counts.items, 3, "Workspace Menu counts active outlet items.");
  const attention = counts.attention as Record<string, unknown>;
  assert.equal(attention.deals, 1, "Workspace Menu counts deal attention.");
  assert.equal(
    attention["inventory-out"],
    1,
    "Workspace Menu counts out-of-stock attention.",
  );
  assert.equal(
    attention["inventory-low"],
    1,
    "Workspace Menu counts low-stock attention.",
  );

  const sections = payload.sections as Array<Record<string, unknown>>;
  const rows = sections.flatMap(
    (section) => section.items as Array<Record<string, unknown>>,
  );
  assert(
    rows.some((row) => row.name === `${runId} Burger`),
    "Workspace Menu includes active outlet rows.",
  );
  assert(
    rows.some((row) => row.name === `${runId} Attention Deal`),
    "Workspace Menu includes deal attention rows.",
  );
  assert(
    !rows.some((row) => row.name === `${runId} Other Outlet`),
    "Workspace Menu excludes other outlet rows.",
  );
  for (const row of rows) {
    assertNoRestrictedMenuFields(row, `Workspace menu row ${row.name}`);
  }
  const burgerPayload = rows.find((row) => row.name === `${runId} Burger`);
  assert(
    Array.isArray(burgerPayload?.sizeOptions) &&
      burgerPayload.sizeOptions.length === 1,
    "Workspace Menu includes sanitized size details.",
  );
  assert(
    Array.isArray(burgerPayload?.addonOptions) &&
      burgerPayload.addonOptions.length === 1,
    "Workspace Menu includes sanitized add-on details.",
  );
  const dealPayload = rows.find(
    (row) => row.name === `${runId} Attention Deal`,
  );
  assert(
    Array.isArray(dealPayload?.dealOptions) &&
      dealPayload.dealOptions.length === 1,
    "Workspace Menu includes sanitized deal option details.",
  );

  const lowResponse = await page.request.get(
    "/api/admin/workspace/menu/summary?attention=inventory-low",
  );
  assert.equal(lowResponse.status(), 200);
  const lowPayload = (await lowResponse.json()) as Record<string, unknown>;
  const lowRows = (
    lowPayload.sections as Array<Record<string, unknown>>
  ).flatMap((section) => section.items as Array<Record<string, unknown>>);
  assert.equal(
    lowRows.length,
    1,
    "Workspace Menu low-stock filter returns low-stock rows only.",
  );
  assert.equal(lowRows[0]?.name, `${runId} Low Stock Fries`);

  const widget = page.getByTestId("admin-workspace-widget-menu");
  await expect(widget).toBeVisible({ timeout: 15_000 });
  await expect(widget.getByTestId("workspace-menu-real-data")).toBeVisible();
  await expect(widget).toContainText(`${runId} Burger`);
  await expect(widget).toContainText(`${runId} Attention Deal`);
  await expect(widget).not.toContainText(`${runId} Other Outlet`);
  await expect(widget).not.toContainText("placeholder");
  if (expectsMenuWrite) {
    await expect(
      widget.getByTestId("workspace-menu-create-category"),
    ).toBeVisible();
    await expect(
      widget.getByTestId("workspace-menu-create-item"),
    ).toBeVisible();
    await expect(
      widget.getByTestId("workspace-menu-create-deal"),
    ).toBeVisible();
    await expect(
      widget.getByTestId("workspace-menu-edit-category").first(),
    ).toBeVisible();
    await expect(
      widget.getByTestId("workspace-menu-toggle-category").first(),
    ).toBeVisible();
  } else {
    await expect(
      widget.getByTestId("workspace-menu-create-category"),
    ).toHaveCount(0);
    await expect(widget.getByTestId("workspace-menu-create-item")).toHaveCount(
      0,
    );
    await expect(widget.getByTestId("workspace-menu-create-deal")).toHaveCount(
      0,
    );
    await expect(
      widget.getByTestId("workspace-menu-edit-category"),
    ).toHaveCount(0);
    await expect(
      widget.getByTestId("workspace-menu-toggle-category"),
    ).toHaveCount(0);
  }

  await widget
    .getByTestId("workspace-menu-row")
    .filter({ hasText: `${runId} Burger` })
    .first()
    .click();
  const detail = widget.getByTestId("workspace-menu-row-detail").first();
  await expect(detail).toContainText("Sizes");
  await expect(detail).toContainText("Large");
  await expect(detail).not.toContainText("Item-specific add-ons");
  await expect(detail.getByTestId("workspace-menu-addon-stock-edit")).toHaveCount(
    0,
  );
  await expect(detail.getByRole("link", { name: "Open in Classic" })).toHaveCount(0);
  if (expectsMenuWrite) {
    await expect(detail.getByTestId("workspace-menu-open-addons")).toBeVisible();
    await detail.getByTestId("workspace-menu-open-addons").click();
    const rowAddOnsDialog = page.getByRole("dialog", { name: "Add-ons" });
    await expect(rowAddOnsDialog).toBeVisible();
    await expect(
      rowAddOnsDialog.getByRole("button", { name: "Save add-on set" }),
    ).toBeVisible();
    await rowAddOnsDialog.getByRole("button", { name: "Close add-ons" }).click();
    await expect(rowAddOnsDialog).toBeHidden();
    await expect(
      widget
        .getByTestId("workspace-menu-row")
        .filter({ hasText: `${runId} Burger` })
        .first()
        .getByTestId("workspace-menu-reorder-handle"),
    ).toBeVisible();
    await expect(
      detail.getByTestId("workspace-menu-quick-stock"),
    ).toContainText("Mark in stock");
    await expect(
      detail.getByTestId("workspace-menu-item-out-of-stock-helper"),
    ).toContainText("Customers can see this item, but cannot order it.");
    await expect(
      detail.getByRole("button", { name: "Save stock" }),
    ).toHaveCount(0);
  } else {
    await expect(detail.getByTestId("workspace-menu-open-addons")).toHaveCount(0);
  }
  if (expectsMenuWrite) {
    const editorContextResponse = await page.request.get(
      "/api/admin/workspace/menu/editor-context",
    );
    const editorContextBody = editorContextResponse.ok()
      ? ""
      : await editorContextResponse.text();
    assert.equal(
      editorContextResponse.status(),
      200,
      `Workspace Menu editor context should load for menu-write roles. Body: ${editorContextBody}`,
    );
    const editButton = detail.getByTestId("workspace-menu-edit-item");
    await expect(editButton).toBeVisible();
    await editButton.click();
    const dialog = page.getByRole("dialog", { name: "Edit item" });
    await expect(dialog).toBeVisible();
    await dialog
      .getByTestId("item-editor-section-nav")
      .getByRole("button", { name: "Add-on sets" })
      .click();
    await expect(
      dialog.getByTestId("workspace-item-addon-or-divider"),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", {
        name: "Advanced item-specific add-ons",
      }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "Add item-specific add-on" }),
    ).toHaveCount(0);
    await expect(dialog.getByLabel("New add-on stock mode")).toHaveValue(
      "QUANTITY",
    );
    await expect(dialog.getByLabel("New add-on quantity")).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Manage Add-ons" }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Manage Add-ons" }).click();
    const addOnsDialog = page.getByRole("dialog", { name: "Add-ons" });
    await expect(addOnsDialog).toBeVisible();
    await expect(
      addOnsDialog.getByRole("button", { name: "Save add-on set" }),
    ).toBeVisible();
    await expect(
      addOnsDialog.getByRole("button", { name: "Save stock" }),
    ).toHaveCount(0);
	    await expect(
	      addOnsDialog.getByRole("button", { name: /^Save$/ }),
	    ).toHaveCount(0);
	    await addOnsDialog.getByRole("button", { name: "Close add-ons" }).click();
	    await expect(addOnsDialog).toBeHidden();

	    const attachedSetCard = dialog
	      .getByTestId("workspace-item-addon-set-card")
	      .filter({ hasText: `${runId} Attached Pickles` })
	      .first();
	    await expect(attachedSetCard).toBeVisible();
	    await expect(
	      attachedSetCard.getByTestId("workspace-item-addon-set-manage-stock"),
	    ).toBeVisible();
	    await expect(
	      attachedSetCard.getByRole("button", { name: "Edit stock" }),
	    ).toHaveCount(0);
	    await attachedSetCard
	      .getByTestId("workspace-item-addon-set-manage-stock")
	      .click();

	    const focusedAddOnsDialog = page.getByRole("dialog", { name: "Add-ons" });
	    await expect(focusedAddOnsDialog).toBeVisible();
	    await expect(
	      focusedAddOnsDialog.getByTestId("workspace-addon-manager-focus-banner"),
	    ).toContainText(`${runId} Burger`);
	    await expect(
	      focusedAddOnsDialog.getByTestId("workspace-addon-manager-focus-banner"),
	    ).toContainText(`${runId} Attached Pickles`);
	    await expect(
	      focusedAddOnsDialog.getByTestId("workspace-addon-manager-set-list-item"),
	    ).toHaveCount(2);
	    await expect(
	      focusedAddOnsDialog.getByTestId("workspace-addon-manager-focused-options-panel"),
	    ).toBeVisible();
	    await expect(
	      focusedAddOnsDialog.getByText("New add-on set", { exact: true }),
	    ).toHaveCount(0);
	    const focusedOptionRows = focusedAddOnsDialog.getByTestId(
	      "workspace-addon-manager-option-row",
	    );
	    await expect(focusedOptionRows).toHaveCount(1);
	    await expect(
	      focusedAddOnsDialog.getByLabel("Option name for Attached pickles"),
	    ).toBeVisible();
	    await expect(
	      focusedAddOnsDialog.getByLabel("Option name for Attached onions"),
	    ).toHaveCount(0);
	    await focusedAddOnsDialog
	      .getByTestId("workspace-addon-manager-set-list-item")
	      .filter({ hasText: `${runId} Attached Sauce` })
	      .click();
	    await expect(
	      focusedAddOnsDialog.getByTestId("workspace-addon-manager-focus-banner"),
	    ).toContainText(`${runId} Attached Sauce`);
	    await expect(focusedOptionRows).toHaveCount(1);
	    await expect(
	      focusedAddOnsDialog.getByLabel("Option name for Attached sauce"),
	    ).toBeVisible();
	    const attachedSauceStockRow = focusedOptionRows.first();
	    await expect(
	      attachedSauceStockRow.getByLabel("Option quantity on hand"),
	    ).toHaveValue("6");
	    await attachedSauceStockRow.locator("select").selectOption("MANUAL");
	    await attachedSauceStockRow.locator("select").selectOption("QUANTITY");
	    await expect(
	      attachedSauceStockRow.getByLabel("Option quantity on hand"),
	    ).toHaveValue("6");
	    await expect(
	      focusedAddOnsDialog.getByLabel("Option name for Attached pickles"),
	    ).toHaveCount(0);
	    await focusedAddOnsDialog
	      .getByTestId("workspace-addon-manager-clear-filter")
	      .click();
	    await expect(
	      focusedAddOnsDialog.getByTestId("workspace-addon-manager-focus-banner"),
	    ).toHaveCount(0);
	    await expect(
	      focusedAddOnsDialog.getByTestId("workspace-addon-manager-focused-options-panel"),
	    ).toHaveCount(0);
	    await expect(
	      focusedAddOnsDialog.getByTestId("workspace-addon-manager-full-library-banner"),
	    ).toBeVisible();
	    await expect(
	      focusedAddOnsDialog.getByText("New add-on set", { exact: true }),
	    ).toBeVisible();
	    await expect(focusedAddOnsDialog).toContainText(`${runId} Garden Sauce`);
	    await expect(focusedAddOnsDialog).toContainText(`${runId} Attached Sauce`);
	    await focusedAddOnsDialog
	      .getByTestId("workspace-addon-manager-back-to-item-addons")
	      .click();
	    await expect(
	      focusedAddOnsDialog.getByTestId("workspace-addon-manager-full-library-banner"),
	    ).toHaveCount(0);
	    await expect(
	      focusedAddOnsDialog.getByTestId("workspace-addon-manager-focus-banner"),
	    ).toContainText(`${runId} Attached Pickles`);
	    await expect(
	      focusedAddOnsDialog.getByTestId("workspace-addon-manager-set-list-item"),
	    ).toHaveCount(2);
	    await expect(
	      focusedAddOnsDialog.getByText("New add-on set", { exact: true }),
	    ).toHaveCount(0);
	    await expect(focusedOptionRows).toHaveCount(1);
	    await expect(
	      focusedAddOnsDialog.getByLabel("Option name for Attached onions"),
	    ).toHaveCount(0);
	    await focusedAddOnsDialog
	      .getByTestId("workspace-addon-manager-clear-filter")
	      .click();
	    await expect(
	      focusedAddOnsDialog.getByTestId("workspace-addon-manager-full-library-banner"),
	    ).toBeVisible();
	    await focusedAddOnsDialog
	      .getByTestId("workspace-addon-manager-set-list-item")
	      .filter({ hasText: `${runId} Attached Pickles` })
	      .click();
	    await expect(focusedOptionRows).toHaveCount(2);
	    await expect(
	      focusedAddOnsDialog.getByLabel("Option name for Attached onions"),
	    ).toBeVisible();
	    await expect(
	      focusedAddOnsDialog.getByTestId("workspace-addon-manager-item-context-banner"),
	    ).toContainText(`${runId} Burger`);
	    await expect(
	      focusedAddOnsDialog.getByTestId("workspace-addon-manager-item-option-badge"),
	    ).toHaveCount(1);
	    await expect(
	      focusedAddOnsDialog
	        .getByTestId("workspace-addon-manager-item-option-badge")
	        .first(),
	    ).toContainText(`Used by ${runId} Burger`);
	    await focusedAddOnsDialog
	      .getByRole("button", { name: "Close add-ons" })
	      .click();
	    await expect(focusedAddOnsDialog).toBeHidden();
	    await dialog.getByRole("button", { name: "Cancel" }).click();
	    await expect(dialog).toBeHidden();
  } else {
    const editorContextResponse = await page.request.get(
      "/api/admin/workspace/menu/editor-context",
    );
    assert.equal(
      editorContextResponse.status(),
      403,
      "Workspace Menu editor context should require menu-write permission.",
    );
    await expect(detail.getByTestId("workspace-menu-quick-stock")).toHaveCount(
      0,
    );
    await expect(detail.getByTestId("workspace-menu-edit-item")).toHaveCount(0);
    await expect(
      detail.getByTestId("workspace-menu-addon-stock-edit"),
    ).toHaveCount(0);
    await expect(widget.getByTestId("workspace-menu-reorder-handle")).toHaveCount(
      0,
    );
  }

  await widget
    .getByTestId("workspace-menu-row")
    .filter({ hasText: `${runId} Low Stock Fries` })
    .first()
    .click();
  const lowStockDetail = widget.getByTestId("workspace-menu-row-detail").first();
  await expect(lowStockDetail).toContainText("Sizes");
  await expect(lowStockDetail).not.toContainText("Item-specific add-ons");
  await expect(
    lowStockDetail.getByTestId("workspace-menu-addon-stock-edit"),
  ).toHaveCount(0);

  await widget
    .getByTestId("workspace-menu-row")
    .filter({ hasText: `${runId} Attention Deal` })
    .first()
    .click();
  const dealDetail = widget.getByTestId("workspace-menu-row-detail").first();
  await expect(dealDetail).toContainText("Workspace Smoke Bundle");
  await expect(dealDetail).toContainText("$10.00");
  await expect(dealDetail).toContainText("Deal contents");
  await expect(dealDetail).not.toContainText("Stock mode");
  await expect(dealDetail).not.toContainText("Manual stock");
  await expect(dealDetail).not.toContainText("No sizes.");
  await expect(dealDetail).not.toContainText("No add-on sets.");
  await expect(dealDetail).not.toContainText("OK");
  await expect(
    dealDetail.getByTestId("workspace-menu-deal-linked-icon"),
  ).toHaveCount(1);

  await widget.getByTestId("workspace-menu-search").fill("Low Stock");
  await expect(widget).toContainText(`${runId} Low Stock Fries`);
  await expect(widget).not.toContainText(`${runId} Burger`);

  await widget.getByTestId("workspace-menu-search").fill("");
  await widget
    .getByTestId("workspace-menu-category-filter")
    .selectOption("deals");
  await expect(widget).toContainText(`${runId} Attention Deal`);
  await expect(widget).not.toContainText(`${runId} Low Stock Fries`);

  await widget.getByRole("button", { name: "Clear filters" }).click();
  await expect(widget.getByTestId("workspace-menu-category-filter")).toHaveValue(
    "",
  );
  await expect(widget).toContainText(`${runId} Burger`);
  await widget.getByTestId("workspace-menu-filter-inventory-out").click();
  await expect(
    widget.getByTestId("workspace-menu-filter-inventory-out"),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(widget).toContainText(`${runId} Burger`);
  await expect(widget).not.toContainText(`${runId} Low Stock Fries`);

  await page.goto("/admin/workspace?widget=menu&stock=out", {
    waitUntil: "domcontentloaded",
  });
  const structuredWidget = page.getByTestId("admin-workspace-widget-menu");
  await expect(
    structuredWidget.getByTestId("workspace-menu-real-data"),
  ).toBeVisible();
  await expect(structuredWidget).toContainText(`${runId} Burger`);
  await expect(structuredWidget).not.toContainText(`${runId} Low Stock Fries`);
  await expect(
    structuredWidget.getByRole("link", { name: "Open in Classic" }),
  ).toHaveCount(0);

  await page.goto("/admin/workspace?widget=menu", { waitUntil: "domcontentloaded" });
  await expect(
    structuredWidget.getByTestId("workspace-menu-real-data"),
  ).toBeVisible();
  await expect(structuredWidget).toContainText(`${runId} Attention Deal`);

  await structuredWidget.getByLabel("Open filter builder").click();
  const stockDialog = page.getByRole("dialog", { name: "Filter builder" });
  await expect(stockDialog).toBeVisible();
  await stockDialog.getByTestId("menu-filter-builder-field-stock").click();
  await stockDialog.getByTestId("menu-filter-builder-value-stock-out").click();
  await stockDialog.getByTestId("menu-filter-builder-apply").click();
  await expect(stockDialog).toBeHidden();
  await expect(structuredWidget).toContainText(`${runId} Burger`);
  await expect(structuredWidget).not.toContainText(`${runId} Low Stock Fries`);
  const builderStockUrl = new URL(page.url());
  assert.equal(
    builderStockUrl.searchParams.get("stock"),
    "out",
    "Workspace Menu filter builder should write stock filters into the Workspace URL.",
  );

  await structuredWidget.getByRole("button", { name: "Clear filters" }).click();
  await structuredWidget.getByLabel("Open filter builder").click();
  const attentionDialog = page.getByRole("dialog", { name: "Filter builder" });
  await expect(attentionDialog).toBeVisible();
  await attentionDialog
    .getByTestId("menu-filter-builder-field-attention")
    .click();
  await attentionDialog
    .getByTestId("menu-filter-builder-value-attention-inventory-low")
    .click();
  await attentionDialog.getByTestId("menu-filter-builder-apply").click();
  await expect(attentionDialog).toBeHidden();
  await expect(structuredWidget).toContainText(`${runId} Low Stock Fries`);
  await expect(structuredWidget).not.toContainText(`${runId} Burger`);
  const builderAttentionUrl = new URL(page.url());
  assert.deepEqual(
    builderAttentionUrl.searchParams.getAll("attention"),
    ["inventory-low"],
    "Workspace Menu filter builder should write attention filters into the Workspace URL.",
  );
  await expect(
    structuredWidget.getByRole("link", { name: "Open in Classic" }),
  ).toHaveCount(0);
}

async function assertWorkspaceMenuEditorSave(browser: Browser, token: string) {
  const { context, page } = await newWorkspacePage({
    browser,
    token,
    viewport: { width: 1440, height: 950 },
  });
  try {
    const widget = page.getByTestId("admin-workspace-widget-menu");
    await widget
      .getByTestId("workspace-menu-row")
      .filter({ hasText: `${runId} Burger` })
      .first()
      .click();
    const detail = widget.getByTestId("workspace-menu-row-detail").first();
    await detail.getByTestId("workspace-menu-edit-item").click();

    const dialog = page.getByRole("dialog", { name: "Edit item" });
    await expect(dialog).toBeVisible();

    const sectionNav = dialog.getByTestId("item-editor-section-nav");
    await expect(sectionNav).toBeVisible();
    assert.deepEqual(
      (await sectionNav.getByRole("button").allTextContents()).map((text) =>
        text.trim(),
      ),
      [
        "Basics",
        "Inventory",
        "Sizes",
        "Add-on sets",
        "Appearance",
        "Image",
      ],
      "Non-deal item editor should expose the reduced-scroll section order.",
    );
    await expect(
      sectionNav.getByRole("button", { name: "Pricing" }),
    ).toHaveCount(0);
    await expect(dialog.getByText("Bundle savings", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      dialog.getByTestId("item-editor-section-basics"),
    ).toContainText("Base price");
    await expect(
      dialog.getByTestId("item-editor-section-addons"),
    ).toContainText("Add-on sets");

    for (const sectionId of [
      "sizes",
      "inventory",
      "appearance",
      "image",
    ]) {
      await expect(
        dialog.getByTestId(`item-editor-section-body-${sectionId}`),
      ).toBeHidden();
      await sectionNav
        .getByRole("button", {
          name: sectionId === "image"
            ? "Image"
            : sectionId[0].toUpperCase() + sectionId.slice(1),
        })
        .click();
      await expect(
        dialog.getByTestId(`item-editor-section-body-${sectionId}`),
      ).toBeVisible();
      if (sectionId === "inventory") {
        const inventoryBody = dialog.getByTestId(
          "item-editor-section-body-inventory",
        );
        await expect(inventoryBody).toContainText("Ordering availability");
        await expect(
          inventoryBody.getByRole("button", {
            name: /Pause selling|Resume selling|Mark out of stock|Mark in stock/,
          }),
        ).toBeVisible();
      }
    }

    const updatedDescription = `${runId} edited in workspace`;
    await sectionNav.getByRole("button", { name: "Basics" }).click();
    await expect(
      dialog.getByTestId("item-editor-section-body-basics"),
    ).toBeVisible();
    await dialog.locator("textarea").first().fill(updatedDescription);
    await dialog.getByRole("button", { name: "Save item" }).click();
    await expect(dialog).toBeHidden();

    assert.equal(
      new URL(page.url()).pathname,
      "/admin/workspace",
      "Workspace Menu edit save should not navigate out of Workspace.",
    );
    await expect(widget).toContainText(updatedDescription);

    const saved = await prisma.menuItem.findUnique({
      where: { id: itemAId },
      select: { description: true },
    });
    assert.equal(
      saved?.description,
      updatedDescription,
      "Workspace Menu edit should persist through the shared item mutation route.",
    );
  } finally {
    await context.close();
  }
}

async function assertWorkspaceMenuAddonSetQuickAttach(
  browser: Browser,
  token: string,
) {
  const { context, page } = await newWorkspacePage({
    browser,
    token,
    viewport: { width: 1440, height: 950 },
  });
  try {
    const widget = page.getByTestId("admin-workspace-widget-menu");
    await widget
      .getByTestId("workspace-menu-row")
      .filter({ hasText: `${runId} Burger` })
      .first()
      .click();
    await widget
      .getByTestId("workspace-menu-row-detail")
      .first()
      .getByTestId("workspace-menu-edit-item")
      .click();

    const dialog = page.getByRole("dialog", { name: "Edit item" });
    await expect(dialog).toBeVisible();
    await dialog
      .getByTestId("item-editor-section-nav")
      .getByRole("button", { name: "Add-on sets" })
      .click();
    const kioskPreview = dialog.locator('[aria-label="Live kiosk preview"]');
    const nameInput = dialog.getByLabel("New add-on name");

    await nameInput.fill("Garden");
    const suggestion = dialog
      .getByRole("button", { name: new RegExp(`${runId} Garden Sauce`) })
      .first();
    await expect(suggestion).toBeVisible();
    await suggestion.click();
    await expect(dialog).toContainText(`${runId} Garden Sauce`);
    assert.equal(
      await prisma.menuItemModifierGroup.count({
        where: {
          menuItemId: itemAId,
          modifierGroupId: sharedModifierUseId,
          isActive: true,
        },
      }),
      0,
      "Workspace Menu quick add Use should stage an existing add-on set until Save item.",
    );
    await expect(kioskPreview).toContainText("Garden sauce");
    await expect(kioskPreview).toContainText("+$0.75");

    await dialog.getByLabel("New add-on price").fill("-1");
    await dialog.getByLabel("New add-on quantity").fill("bad");
    await nameInput.fill(`${runId} Zesty Pickles`);
    await nameInput.press("Enter");
    await expect(dialog).toContainText(`${runId} Zesty Pickles`);
    await expect(kioskPreview).toContainText("Zesty pickles");
    await expect(kioskPreview).toContainText("8 left");
    await expect(dialog.getByText("Price must be 0 or more.")).toHaveCount(0);
    await expect(
      dialog.getByText("Quantity must be a whole number 0 or more."),
    ).toHaveCount(0);

    await nameInput.fill(`${runId} Attached Pickles`);
    await nameInput.press("Enter");
    await expect(
      dialog.getByText("That add-on set is already attached to this item."),
    ).toBeVisible();

    let promptMessage = "";
    const discardPrompt = new Promise<void>((resolve) => {
      page.once("dialog", async (prompt) => {
        promptMessage = prompt.message();
        await prompt.accept();
        resolve();
      });
    });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await discardPrompt;
    assert.match(promptMessage, /Discard unsaved item changes/);
    await expect(dialog).toBeHidden();

    assert.equal(
      await prisma.menuItemModifierGroup.count({
        where: {
          menuItemId: itemAId,
          modifierGroupId: { in: [sharedModifierUseId, sharedModifierExactId] },
          isActive: true,
        },
      }),
      0,
      "Workspace Menu staged add-on set quick attachments should be discarded without Save item.",
    );
  } finally {
    await context.close();
  }
}

async function assertWorkspaceMenuDirtyGuards(browser: Browser, token: string) {
  const { context, page } = await newWorkspacePage({
    browser,
    token,
    viewport: { width: 1440, height: 950 },
  });
  const clickAndHandlePrompt = async (
    action: () => Promise<unknown>,
    disposition: "accept" | "dismiss",
  ) => {
    let message = "";
    const promptHandled = new Promise<void>((resolve) => {
      page.once("dialog", async (dialog) => {
        message = dialog.message();
        if (disposition === "accept") await dialog.accept();
        else await dialog.dismiss();
        resolve();
      });
    });
    await action();
    await promptHandled;
    return message;
  };
  try {
    const widget = page.getByTestId("admin-workspace-widget-menu");
    await widget
      .getByTestId("workspace-menu-row")
      .filter({ hasText: `${runId} Burger` })
      .first()
      .click();
    const detail = widget.getByTestId("workspace-menu-row-detail").first();
    await detail.getByTestId("workspace-menu-edit-item").click();

    const itemDialog = page.getByRole("dialog", { name: "Edit item" });
    await expect(itemDialog).toBeVisible();
    await itemDialog
      .getByTestId("item-editor-section-nav")
      .getByRole("button", { name: "Basics" })
      .click();
    await expect(
      itemDialog.getByTestId("item-editor-section-body-basics"),
    ).toBeVisible();
    await itemDialog
      .locator("textarea")
      .first()
      .fill(`${runId} unsaved item edit`);

    let prompt = await clickAndHandlePrompt(
      () => itemDialog.getByRole("button", { name: "Cancel" }).click(),
      "dismiss",
    );
    assert.match(prompt, /Discard unsaved item changes/);
    await expect(itemDialog).toBeVisible();

    await clickAndHandlePrompt(
      () => itemDialog.getByRole("button", { name: "Cancel" }).click(),
      "accept",
    );
    await expect(itemDialog).toBeHidden();

    await widget
      .getByTestId("workspace-menu-row")
      .filter({ hasText: `${runId} Attention Deal` })
      .first()
      .click();
    const dealDetail = widget.getByTestId("workspace-menu-row-detail").first();
    await dealDetail.getByTestId("workspace-menu-edit-item").click();
    const dealDialog = page.getByRole("dialog", { name: "Edit deal" });
    await expect(dealDialog).toBeVisible();
    await dealDialog.locator('input[type="date"]').first().fill("2026-12-31");

    prompt = await clickAndHandlePrompt(
      () => dealDialog.getByRole("button", { name: "Cancel" }).click(),
      "dismiss",
    );
    assert.match(prompt, /Discard unsaved deal changes/);
    await expect(dealDialog).toBeVisible();

    await clickAndHandlePrompt(
      () => dealDialog.getByRole("button", { name: "Cancel" }).click(),
      "accept",
    );
    await expect(dealDialog).toBeHidden();

    await widget.getByTestId("workspace-menu-create-category").click();
    const categoryDialog = page.getByRole("dialog", {
      name: "Create category",
    });
    await expect(categoryDialog).toBeVisible();
    await categoryDialog
      .getByTestId("workspace-menu-category-name")
      .fill(`Dirty Guard ${shortRunId}`);

    prompt = await clickAndHandlePrompt(
      () => categoryDialog.getByRole("button", { name: "Cancel" }).click(),
      "dismiss",
    );
    assert.match(prompt, /Discard unsaved category changes/);
    await expect(categoryDialog).toBeVisible();

    await clickAndHandlePrompt(
      () => categoryDialog.getByRole("button", { name: "Cancel" }).click(),
      "accept",
    );
    await expect(categoryDialog).toBeHidden();
  } finally {
    await context.close();
  }
}

async function assertWorkspaceDealLimitEditorContext(
  browser: Browser,
  token: string,
) {
  const dealUpgrade = await prisma.upgradeOption.findFirst({
    where: { itemId: itemDealId },
    select: { id: true },
  });
  assert(dealUpgrade, "Workspace deal limit smoke requires a deal option.");
  const originalDealState = await prisma.menuItem.findUnique({
    where: { id: itemDealId },
    select: {
      dealBaseMenuItemId: true,
      dealBaseSizeId: true,
      dealBaseSizeNameSnapshot: true,
      dealStartsAt: true,
      dealExpiresAt: true,
      dealLimitMode: true,
      dealLimitQty: true,
      dealLimitLowThreshold: true,
      isActive: true,
    },
  });
  assert(originalDealState, "Workspace deal limit smoke requires a deal row.");
  const originalDealLinks = await prisma.upgradeItemLink.findMany({
    where: { upgradeOptionId: dealUpgrade.id },
    select: {
      id: true,
      linkedMenuItemId: true,
      linkedSizeId: true,
      itemNameSnapshot: true,
      sizeNameSnapshot: true,
    },
  });
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  async function openDealEditor() {
    assert(page, "Workspace deal limit smoke page was not initialized.");
    const workspacePage = page;
    await workspacePage.goto(`/admin/workspace?widget=menu&item=${itemDealId}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(workspacePage.getByTestId("admin-workspace-header")).toBeVisible();
    const widget = workspacePage.getByTestId("admin-workspace-widget-menu");
    const targetRow = widget.getByTestId("workspace-menu-target-row");
    await expect(targetRow).toContainText(`${runId} Attention Deal`);
    await targetRow.getByTestId("workspace-menu-edit-item").click();
    const dialog = workspacePage.getByRole("dialog", { name: "Edit deal" });
    await expect(dialog).toBeVisible();
    return dialog;
  }

  async function expectLimitedDealState(dialog: Locator) {
    const sectionNav = dialog.getByTestId("deal-editor-section-nav");
    await sectionNav.getByRole("button", { name: "Availability" }).click();
    const availabilityBody = dialog.getByTestId(
      "deal-editor-section-body-availability",
    );
    await expect(availabilityBody).toBeVisible();
    await expect(
      availabilityBody.getByRole("button", { name: "Limit number sold" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      availabilityBody.getByRole("button", { name: "Unlimited" }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(availabilityBody.getByLabel("Quantity available")).toHaveValue(
      String(dealLimitSmokeQty),
    );
    await expect(availabilityBody.getByLabel("Low alert")).toHaveValue(
      String(dealLimitSmokeLowThreshold),
    );
  }

  async function clickAndAcceptPrompt(action: () => Promise<unknown>) {
    assert(page, "Workspace deal limit smoke page was not initialized.");
    const workspacePage = page;
    let message = "";
    const promptHandled = new Promise<void>((resolve) => {
      workspacePage.once("dialog", async (dialog) => {
        message = dialog.message();
        await dialog.accept();
        resolve();
      });
    });
    await action();
    await promptHandled;
    return message;
  }

  try {
    await prisma.menuItem.update({
      where: { id: itemDealId },
      data: {
        dealBaseMenuItemId: itemLowId,
        dealBaseSizeId: null,
        dealBaseSizeNameSnapshot: null,
        dealStartsAt: new Date(Date.now() - 60 * 1000),
        dealExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        dealLimitMode: "LIMITED",
        dealLimitQty: dealLimitSmokeQty,
        dealLimitLowThreshold: dealLimitSmokeLowThreshold,
        isActive: true,
      },
    });
    await prisma.upgradeItemLink.updateMany({
      where: { upgradeOptionId: dealUpgrade.id },
      data: {
        linkedMenuItemId: itemLowId,
        linkedSizeId: null,
        itemNameSnapshot: `${runId} Low Stock Fries`,
        sizeNameSnapshot: null,
      },
    });

    const workspace = await newWorkspacePage({
      browser,
      token,
      viewport: { width: 1440, height: 950 },
    });
    context = workspace.context;
    page = workspace.page;

    let dialog = await openDealEditor();
    const optionSection = dialog.getByTestId("deal-editor-section-options");
    await expect(optionSection).toContainText("1 complete option");
    await expect(optionSection).toContainText(/Customer pays \$\d+\.\d{2}/);
    await expect(optionSection).toContainText(/Saves \$\d+\.\d{2}/);
    await expect(optionSection).toContainText("Workspace Smoke Bundle");
    await expect(optionSection).not.toContainText("Option 1:");

    await expectLimitedDealState(dialog);

    await expect(dialog.getByRole("button", { name: "Hide deal" })).toBeVisible();
    await dialog.getByRole("button", { name: "Hide deal" }).click();
    await expect(dialog.getByRole("button", { name: "Show deal" })).toBeVisible();
    await expect(dialog).toContainText("Will hide after save");
    await expect(dialog).toContainText("UNSAVED VISIBILITY CHANGE");
    await expect(dialog).toContainText("Not saved yet. Click Save deal to hide this deal from the kiosk.");
    const afterDraftHide = await prisma.menuItem.findUnique({
      where: { id: itemDealId },
      select: { isActive: true },
    });
    assert.equal(
      afterDraftHide?.isActive,
      true,
      "Workspace deal Hide deal should remain draft-only until Save deal.",
    );
    const prompt = await clickAndAcceptPrompt(() =>
      dialog.getByRole("button", { name: "Cancel" }).click(),
    );
    assert.match(prompt, /Discard unsaved deal changes/);
    await expect(dialog).toBeHidden();

    const beforeHideVersion = await getOutletMenuVersion(prisma, outletAId);
    dialog = await openDealEditor();
    await expectLimitedDealState(dialog);
    await expect(dialog.getByRole("button", { name: "Hide deal" })).toBeVisible();
    await dialog.getByRole("button", { name: "Hide deal" }).click();
    await expect(dialog.getByRole("button", { name: "Show deal" })).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Save deal" }),
    ).toBeEnabled();
    await dialog.getByRole("button", { name: "Save deal" }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    const afterSavedHide = await prisma.menuItem.findUnique({
      where: { id: itemDealId },
      select: { isActive: true },
    });
    assert.equal(
      afterSavedHide?.isActive,
      false,
      "Workspace deal Hide deal should persist after Save deal.",
    );
    const afterHideVersion = await getOutletMenuVersion(prisma, outletAId);
    assert(
      afterHideVersion.revision > beforeHideVersion.revision,
      "Workspace deal Hide deal save should bump kiosk menu freshness.",
    );

    dialog = await openDealEditor();
    await expectLimitedDealState(dialog);
    await expect(dialog.getByRole("button", { name: "Show deal" })).toBeVisible();
    await dialog.getByRole("button", { name: "Show deal" }).click();
    await expect(dialog.getByRole("button", { name: "Hide deal" })).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Save deal" }),
    ).toBeEnabled();
    await dialog.getByRole("button", { name: "Save deal" }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    const afterSavedShow = await prisma.menuItem.findUnique({
      where: { id: itemDealId },
      select: { isActive: true },
    });
    assert.equal(
      afterSavedShow?.isActive,
      true,
      "Workspace deal Show deal should persist after Save deal.",
    );
    const afterShowVersion = await getOutletMenuVersion(prisma, outletAId);
    assert(
      afterShowVersion.revision > afterHideVersion.revision,
      "Workspace deal Show deal save should bump kiosk menu freshness.",
    );

    dialog = await openDealEditor();
    await expectLimitedDealState(dialog);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
  } finally {
    await prisma.menuItem.update({
      where: { id: itemDealId },
      data: {
        dealBaseMenuItemId: originalDealState.dealBaseMenuItemId,
        dealBaseSizeId: originalDealState.dealBaseSizeId,
        dealBaseSizeNameSnapshot: originalDealState.dealBaseSizeNameSnapshot,
        dealStartsAt: originalDealState.dealStartsAt,
        dealExpiresAt: originalDealState.dealExpiresAt,
        dealLimitMode: originalDealState.dealLimitMode,
        dealLimitQty: originalDealState.dealLimitQty,
        dealLimitLowThreshold: originalDealState.dealLimitLowThreshold,
        isActive: originalDealState.isActive,
      },
    });
    await Promise.all(
      originalDealLinks.map((link) =>
        prisma.upgradeItemLink.update({
          where: { id: link.id },
          data: {
            linkedMenuItemId: link.linkedMenuItemId,
            linkedSizeId: link.linkedSizeId,
            itemNameSnapshot: link.itemNameSnapshot,
            sizeNameSnapshot: link.sizeNameSnapshot,
          },
        }),
      ),
    );
    await context?.close();
  }
}

async function assertWorkspaceMenuQuickStock(browser: Browser, token: string) {
  const { context, page } = await newWorkspacePage({
    browser,
    token,
    viewport: { width: 1440, height: 950 },
  });
  page.on("dialog", (dialog) => dialog.accept());

  async function openBurgerDetail() {
    const widget = page.getByTestId("admin-workspace-widget-menu");
    const row = widget
      .getByTestId("workspace-menu-row")
      .filter({ hasText: `${runId} Burger` })
      .first();
    await row.click();
    return {
      widget,
      detail: row.getByTestId("workspace-menu-row-detail"),
    };
  }

  try {
    let { widget, detail } = await openBurgerDetail();
    await expect(
      detail.getByTestId("workspace-menu-quick-stock"),
    ).toContainText("Mark in stock");
    await expect(
      detail.getByTestId("workspace-menu-item-out-of-stock-helper"),
    ).toContainText("Customers can see this item, but cannot order it.");
    await detail.getByTestId("workspace-menu-quick-stock").click();
    await expect(
      widget.getByTestId("workspace-menu-quick-stock"),
    ).toContainText("Mark out of stock");
    await expect(
      detail.getByTestId("workspace-menu-item-out-of-stock-helper"),
    ).toHaveCount(0);
    assert.equal(
      new URL(page.url()).pathname,
      "/admin/workspace",
      "Workspace Menu quick stock should not navigate out of Workspace.",
    );
    let saved = await prisma.menuItem.findUnique({
      where: { id: itemAId },
      select: { isOutOfStock: true },
    });
    assert.equal(
      saved?.isOutOfStock,
      false,
      "Workspace Menu quick stock should mark the item in stock through the shared mutation route.",
    );

    await detail.getByTestId("workspace-menu-quick-stock").click();
    await expect(
      widget.getByTestId("workspace-menu-quick-stock"),
    ).toContainText("Mark in stock");
    saved = await prisma.menuItem.findUnique({
      where: { id: itemAId },
      select: { isOutOfStock: true },
    });
    assert.equal(
      saved?.isOutOfStock,
      true,
      "Workspace Menu quick stock should restore the item to out of stock.",
    );

    await expect(
      detail.getByTestId("workspace-menu-quick-stock"),
    ).toContainText("Mark in stock");
    await expect(
      detail.getByTestId("workspace-menu-item-out-of-stock-helper"),
    ).toContainText("Customers can see this item, but cannot order it.");

    const visibilityButton = detail.getByTestId(
      "workspace-menu-toggle-item-visibility",
    );
    await expect(visibilityButton).toContainText("Hide item");
    await visibilityButton.click();
    await expect(
      detail.getByTestId("workspace-menu-toggle-item-visibility"),
    ).toContainText("Show item", { timeout: 10_000 });
    await expect(
      detail.getByTestId("workspace-menu-item-hidden-helper"),
    ).toContainText("Customers cannot see this item on the kiosk.");
    let activeSaved = await prisma.menuItem.findUnique({
      where: { id: itemAId },
      select: { isActive: true },
    });
    assert.equal(
      activeSaved?.isActive,
      false,
      "Workspace Menu row visibility toggle should hide a standard item.",
    );

    await detail.getByTestId("workspace-menu-toggle-item-visibility").click();
    await expect(
      detail.getByTestId("workspace-menu-toggle-item-visibility"),
    ).toContainText("Hide item", { timeout: 10_000 });
    await expect(
      detail.getByTestId("workspace-menu-item-hidden-helper"),
    ).toHaveCount(0);
    activeSaved = await prisma.menuItem.findUnique({
      where: { id: itemAId },
      select: { isActive: true },
    });
    assert.equal(
      activeSaved?.isActive,
      true,
      "Workspace Menu row visibility toggle should show a standard item again.",
    );
  } finally {
    await context.close();
  }
}

async function assertWorkspaceMenuReorder(browser: Browser, token: string) {
  const { context, page } = await newWorkspacePage({
    browser,
    token,
    viewport: { width: 1440, height: 950 },
  });
  try {
    const widget = page.getByTestId("admin-workspace-widget-menu");
    const section = widget
      .getByTestId("workspace-menu-category-section")
      .filter({ hasText: `${runId} Category A` })
      .first();
    const rows = section.getByTestId("workspace-menu-row");
    await expect(rows.nth(0)).toContainText(`${runId} Burger`);
    await expect(rows.nth(1)).toContainText(`${runId} Low Stock Fries`);

    const burgerRow = rows.filter({ hasText: `${runId} Burger` }).first();
    const lowRow = rows.filter({ hasText: `${runId} Low Stock Fries` }).first();
    await lowRow
      .getByTestId("workspace-menu-reorder-handle")
      .dragTo(burgerRow);
    await expect(rows.nth(0)).toContainText(`${runId} Low Stock Fries`, {
      timeout: 10_000,
    });
    assert.equal(
      new URL(page.url()).pathname,
      "/admin/workspace",
      "Workspace Menu reorder should not navigate out of Workspace.",
    );

    await expect
      .poll(async () => {
        const [burger, lowStock] = await Promise.all([
          prisma.menuItem.findUnique({
            where: { id: itemAId },
            select: { sortOrder: true },
          }),
          prisma.menuItem.findUnique({
            where: { id: itemLowId },
            select: { sortOrder: true },
          }),
        ]);
        return Boolean(
          lowStock != null &&
            burger != null &&
            lowStock.sortOrder < burger.sortOrder,
        );
      })
      .toBe(true);

    await rows
      .filter({ hasText: `${runId} Low Stock Fries` })
      .first()
      .getByTestId("workspace-menu-reorder-handle")
      .dragTo(rows.filter({ hasText: `${runId} Burger` }).first());
    await expect(rows.nth(0)).toContainText(`${runId} Burger`, {
      timeout: 10_000,
    });
    await expect
      .poll(async () => {
        const [burger, lowStock] = await Promise.all([
          prisma.menuItem.findUnique({
            where: { id: itemAId },
            select: { sortOrder: true },
          }),
          prisma.menuItem.findUnique({
            where: { id: itemLowId },
            select: { sortOrder: true },
          }),
        ]);
        return Boolean(
          lowStock != null &&
            burger != null &&
            burger.sortOrder < lowStock.sortOrder,
        );
      })
      .toBe(true);
  } finally {
    await context.close();
  }
}

async function assertWorkspaceMenuCreateItemAndDeal(
  browser: Browser,
  token: string,
) {
  const historyDealId = `${runId}-history-deal`;
  const historyDealName = `${runId} Hidden History Deal`;
  const historyScheduleDay = new Date();
  historyScheduleDay.setDate(historyScheduleDay.getDate() + 1);
  historyScheduleDay.setHours(10, 15, 0, 0);
  const historyDealStartsAt = new Date(historyScheduleDay);
  const historyDealExpiresAt = new Date(historyScheduleDay);
  historyDealExpiresAt.setHours(15, 45, 0, 0);
  const burgerSize = await prisma.sizeOption.findFirst({
    where: { itemId: itemAId },
    select: { id: true, name: true },
  });
  assert(
    burgerSize,
    "Workspace Menu deal history fixture requires a sized item.",
  );
  await prisma.menuItem.create({
    data: {
      id: historyDealId,
      outletId: outletAId,
      categoryId: categoryDealsId,
      dealBaseMenuItemId: itemAId,
      comboNum: 75,
      name: historyDealName,
      description: "Workspace smoke deal history fixture",
      price: new Prisma.Decimal("9.25"),
      emoji: "R",
      bgColor: "#FFF3C4",
      sortOrder: 9997,
      isActive: false,
      dealStartsAt: historyDealStartsAt,
      dealExpiresAt: historyDealExpiresAt,
      upgradeOptions: {
        create: {
          customTitle: "History restore option",
          extraCharge: new Prisma.Decimal("10.80"),
          savingsLabel: new Prisma.Decimal("1.20"),
          discountPct: new Prisma.Decimal("10.00"),
          sortOrder: 0,
          linkedItems: {
            create: {
              linkedMenuItemId: itemAId,
              linkedSizeId: burgerSize.id,
              itemNameSnapshot: `${runId} Burger`,
              sizeNameSnapshot: burgerSize.name,
              sortOrder: 0,
            },
          },
        },
      },
    },
  });

  const { context, page } = await newWorkspacePage({
    browser,
    token,
    viewport: { width: 1440, height: 950 },
  });
  try {
    const widget = page.getByTestId("admin-workspace-widget-menu");
    const itemName = `${runId} Workspace Created Item`;
    const itemDescription = `${runId} created inside workspace`;

    await widget.scrollIntoViewIfNeeded();
    await widget.getByTestId("workspace-menu-deal-history").click();
    const menuHistoryDialog = page.getByTestId("workspace-menu-deal-history-modal");
    await expect(menuHistoryDialog).toBeVisible();
    await expect(menuHistoryDialog).toContainText("Restore a previous deal");
    await expect(
      menuHistoryDialog.locator("h1").filter({ hasText: /^Deal history$/i }),
    ).toHaveCount(0);
    const menuHistorySearch = menuHistoryDialog.locator(
      'input[placeholder="Search deals, items, combo..."]',
    );
    await expect(menuHistorySearch).toBeVisible({ timeout: 15_000 });
    await menuHistoryDialog.getByRole("button", { name: "Close" }).click();
    await expect(menuHistoryDialog).toHaveCount(0);

    await clickWorkspaceMoreAction(page, "admin-workspace-more-deal-history");
    const historyDialog = page.getByTestId("admin-workspace-dealHistory-modal");
    await expect(historyDialog).toBeVisible();
    const historySearch = historyDialog.locator(
      'input[placeholder="Search deals, items, combo..."]',
    );
    await expect(historySearch).toBeVisible({ timeout: 15_000 });
    await historySearch.fill(historyDealName);
    await expect(historyDialog).toContainText(historyDealName);
    await historyDialog
      .getByRole("button", { name: "Restore as draft" })
      .click();
    await expect(historyDialog).toHaveCount(0);
    const restoredDealDialog = page.getByRole("dialog", {
      name: "Create deal",
    });
    await expect(restoredDealDialog).toBeVisible();
    await expect(restoredDealDialog).toContainText(historyDealName);
    const restoredStartDateInput = restoredDealDialog.getByLabel("Starts on", {
      exact: true,
    });
    const restoredEndDateInput = restoredDealDialog.getByLabel("Ends on", {
      exact: true,
    });
    const restoredStartTimeInput = restoredDealDialog.getByLabel("Start", {
      exact: true,
    });
    const restoredEndTimeInput = restoredDealDialog.getByLabel("End", {
      exact: true,
    });
    await expect(restoredStartDateInput).toHaveValue(
      toDealScheduleDateInputValue(historyDealStartsAt.toISOString()),
    );
    await expect(restoredEndDateInput).toHaveValue(
      toDealScheduleDateInputValue(historyDealExpiresAt.toISOString()),
    );
    await expect(restoredStartTimeInput).toHaveValue(
      toDealScheduleTimeInputValue(historyDealStartsAt.toISOString()),
    );
    await expect(restoredEndTimeInput).toHaveValue(
      toDealScheduleTimeInputValue(historyDealExpiresAt.toISOString()),
    );

    const startDateBox = await restoredStartDateInput.boundingBox();
    const endDateBox = await restoredEndDateInput.boundingBox();
    assert(
      startDateBox && endDateBox,
      "Workspace deal schedule date inputs should be visible and measurable.",
    );
    assert(
      startDateBox.x < endDateBox.x &&
        Math.abs(startDateBox.y - endDateBox.y) < 12,
      "Workspace deal editor should keep start and end date fields next to each other.",
    );

    const startsNowReference = new Date();
    await restoredDealDialog
      .getByRole("button", { name: "Starts now" })
      .click();
    await expect(restoredStartDateInput).toHaveValue(
      toDealScheduleDateInputValue(startsNowReference.toISOString()),
    );

    const onlyTodayButton = restoredDealDialog.getByRole("button", {
      name: "Only today",
    });
    if (isOnlyTodayPresetAvailable()) {
      await expect(onlyTodayButton).toBeEnabled();
      await onlyTodayButton.click();
      await expect(restoredEndDateInput).toHaveValue(
        toDealScheduleDateInputValue(new Date().toISOString()),
      );
      await expect(restoredEndTimeInput).toHaveValue(
        DEFAULT_DEAL_EXPIRATION_TIME,
      );
    } else {
      await expect(onlyTodayButton).toBeDisabled();
    }

    const savedSchedulePreset = dealSchedulePresetTomorrow();
    await restoredDealDialog
      .getByRole("button", { name: "Only tomorrow" })
      .click();
    await expect(restoredStartDateInput).toHaveValue(
      toDealScheduleDateInputValue(savedSchedulePreset.startsAt),
    );
    await expect(restoredEndDateInput).toHaveValue(
      toDealScheduleDateInputValue(savedSchedulePreset.expiresAt),
    );
    await expect(restoredStartTimeInput).toHaveValue(DEFAULT_DEAL_START_TIME);
    await expect(restoredEndTimeInput).toHaveValue(
      DEFAULT_DEAL_EXPIRATION_TIME,
    );

    await expect(
      restoredDealDialog.getByRole("button", { name: "Show deal" }),
    ).toBeVisible();
    await restoredDealDialog.getByRole("button", { name: "Show deal" }).click();
    await expect(
      restoredDealDialog.getByRole("button", { name: "Hide deal" }),
    ).toBeVisible();
    await restoredDealDialog.getByRole("button", { name: "Hide deal" }).click();
    await expect(
      restoredDealDialog.getByRole("button", { name: "Show deal" }),
    ).toBeVisible();
    await restoredDealDialog.getByRole("button", { name: "Show deal" }).click();
    await expect(
      restoredDealDialog.getByRole("button", { name: "Save deal" }),
    ).toBeEnabled();
    await restoredDealDialog.getByRole("button", { name: "Save deal" }).click();
    await expect(restoredDealDialog).toBeHidden({ timeout: 15_000 });

    assert.equal(
      new URL(page.url()).pathname,
      "/admin/workspace",
      "Workspace More deal history restore should not navigate out of Workspace.",
    );
    const restoredDeal = await prisma.menuItem.findFirst({
      where: {
        outletId: outletAId,
        categoryId: categoryDealsId,
        name: historyDealName,
        id: { not: historyDealId },
      },
      include: { upgradeOptions: { include: { linkedItems: true } } },
    });
    assert(
      restoredDeal,
      "Workspace Menu deal history restore should persist a new deal draft.",
    );
    assert.equal(
      restoredDeal.dealBaseMenuItemId,
      itemAId,
      "Workspace Menu deal history restore should keep the historical base item when it is still valid.",
    );
    assert.equal(
      restoredDeal.isActive,
      true,
      "Workspace Menu restored deal draft Show deal should persist as live.",
    );
    assert.equal(
      toDealScheduleDateInputValue(
        restoredDeal.dealStartsAt?.toISOString() ?? null,
      ),
      toDealScheduleDateInputValue(savedSchedulePreset.startsAt),
      "Workspace Menu restored deal draft should persist the edited start date.",
    );
    assert.equal(
      toDealScheduleTimeInputValue(
        restoredDeal.dealStartsAt?.toISOString() ?? null,
      ),
      DEFAULT_DEAL_START_TIME,
      "Workspace Menu restored deal draft should persist the edited start time.",
    );
    assert.equal(
      toDealScheduleDateInputValue(
        restoredDeal.dealExpiresAt?.toISOString() ?? null,
      ),
      toDealScheduleDateInputValue(savedSchedulePreset.expiresAt),
      "Workspace Menu restored deal draft should persist the edited end date.",
    );
    assert.equal(
      toDealScheduleTimeInputValue(
        restoredDeal.dealExpiresAt?.toISOString() ?? null,
      ),
      DEFAULT_DEAL_EXPIRATION_TIME,
      "Workspace Menu restored deal draft should persist the edited end time.",
    );
    assert.equal(
      restoredDeal.upgradeOptions[0]?.linkedItems[0]?.linkedSizeId,
      burgerSize.id,
      "Workspace Menu deal history restore should keep valid linked item sizes.",
    );

    await widget.getByTestId("workspace-menu-create-item").click();
    const itemDialog = page.getByRole("dialog", { name: "Create item" });
    await expect(itemDialog).toBeVisible();
    await itemDialog.locator("input[data-modal-autofocus]").fill(itemName);
    await itemDialog.locator("textarea").first().fill(itemDescription);
    await itemDialog.locator('input[type="number"]').first().fill("9.25");
    await itemDialog.getByRole("button", { name: "Save item" }).click();
    await expect(itemDialog).toBeHidden();

    assert.equal(
      new URL(page.url()).pathname,
      "/admin/workspace",
      "Workspace Menu item create should not navigate out of Workspace.",
    );
    await expect(widget.getByTestId("workspace-menu-target-row")).toContainText(
      itemName,
    );

    const createdItem = await prisma.menuItem.findFirst({
      where: {
        outletId: outletAId,
        name: itemName,
        category: { slug: { not: "deals" } },
      },
      select: { id: true, description: true },
    });
    assert(
      createdItem,
      "Workspace Menu item create should persist a menu item.",
    );
    assert.equal(
      createdItem.description,
      itemDescription,
      "Workspace Menu item create should persist through the shared item mutation route.",
    );

    await widget.getByTestId("workspace-menu-create-deal").click();
    const dealDialog = page.getByRole("dialog", { name: "Create deal" });
    await expect(dealDialog).toBeVisible();
    await dealDialog.getByRole("button", { name: "Set base" }).click();
    const picker = page.getByRole("dialog", { name: "Pick a menu item" });
    await expect(picker).toBeVisible();
    await picker.locator("input").first().fill(itemName);
    await picker
      .getByRole("button", { name: new RegExp(itemName) })
      .first()
      .click();
    await expect(picker).toBeHidden();
    await expect(dealDialog).toContainText(itemName);
    await expect(
      dealDialog.getByRole("button", { name: "Save deal" }),
    ).toBeEnabled();
    await dealDialog.getByRole("button", { name: "Save deal" }).click();
    try {
      await expect(dealDialog).toBeHidden({ timeout: 15_000 });
    } catch (error) {
      const alertText = await dealDialog
        .locator('[role="alert"]')
        .allTextContents()
        .catch(() => []);
      throw new Error(
        `Workspace Menu deal create modal did not close. Alerts: ${alertText.join(" | ")}`,
        { cause: error },
      );
    }

    assert.equal(
      new URL(page.url()).pathname,
      "/admin/workspace",
      "Workspace Menu deal create should not navigate out of Workspace.",
    );
    await expect(widget.getByTestId("workspace-menu-target-row")).toContainText(
      itemName,
    );

    const createdDeal = await prisma.menuItem.findFirst({
      where: {
        outletId: outletAId,
        categoryId: categoryDealsId,
        dealBaseMenuItemId: createdItem.id,
        name: itemName,
      },
      include: { upgradeOptions: { include: { linkedItems: true } } },
    });
    assert(createdDeal, "Workspace Menu deal create should persist a deal.");
    assert.equal(
      createdDeal.upgradeOptions.length,
      1,
      "Workspace Menu deal create should seed one deal option.",
    );
    assert.equal(
      createdDeal.upgradeOptions[0]?.linkedItems[0]?.linkedMenuItemId,
      createdItem.id,
      "Workspace Menu deal create should seed the base item as the required bundle item.",
    );
  } finally {
    await context.close();
  }
}

async function assertWorkspaceMenuCategoryManagement(
  browser: Browser,
  token: string,
) {
  const { context, page } = await newWorkspacePage({
    browser,
    token,
    viewport: { width: 1440, height: 950 },
  });
  try {
    const widget = page.getByTestId("admin-workspace-widget-menu");
    const categoryName = `WS Cat ${shortRunId}`;
    const categorySlug = `ws-cat-${shortRunId}`;
    const editedName = `WS Edited ${shortRunId}`;
    const editedSlug = `ws-edited-${shortRunId}`;

    await widget.getByTestId("workspace-menu-create-category").click();
    const createDialog = page.getByRole("dialog", { name: "Create category" });
    await expect(createDialog).toBeVisible();
    await createDialog
      .getByTestId("workspace-menu-category-name")
      .fill(categoryName);
    await createDialog.getByTestId("workspace-menu-category-icon").fill("W");
    await createDialog
      .getByTestId("workspace-menu-category-slug")
      .fill(categorySlug);
    await createDialog.getByTestId("workspace-menu-save-category").click();
    await expect(createDialog).toBeHidden({ timeout: 10_000 });

    assert.equal(
      new URL(page.url()).pathname,
      "/admin/workspace",
      "Workspace Menu category create should not navigate out of Workspace.",
    );
    let category = await prisma.category.findFirst({
      where: { outletId: outletAId, slug: categorySlug },
      select: { id: true, name: true, slug: true, isActive: true },
    });
    assert(
      category,
      "Workspace Menu category create should persist a category.",
    );
    assert.equal(category.name, categoryName);
    assert.equal(category.isActive, true);

    let section = widget
      .getByTestId("workspace-menu-category-section")
      .filter({ hasText: categoryName })
      .first();
    await expect(section).toBeVisible();
    await expect(section).toContainText("No rows in this category.");

    await section.getByTestId("workspace-menu-edit-category").click();
    const editDialog = page.getByRole("dialog", { name: "Edit category" });
    await expect(editDialog).toBeVisible();
    await editDialog
      .getByTestId("workspace-menu-category-name")
      .fill(editedName);
    await editDialog
      .getByTestId("workspace-menu-category-slug")
      .fill(editedSlug);
    await editDialog.getByTestId("workspace-menu-save-category").click();
    await expect(editDialog).toBeHidden({ timeout: 10_000 });
    await expect(widget).toContainText(editedName);

    category = await prisma.category.findFirst({
      where: { outletId: outletAId, slug: editedSlug },
      select: { id: true, name: true, slug: true, isActive: true },
    });
    assert(
      category,
      "Workspace Menu category edit should persist the category.",
    );
    assert.equal(category.name, editedName);

    section = widget
      .getByTestId("workspace-menu-category-section")
      .filter({ hasText: editedName })
      .first();
    await section.getByTestId("workspace-menu-toggle-category").click();
    await expect(
      section.getByTestId("workspace-menu-toggle-category"),
    ).toHaveAttribute("aria-label", `Show category ${editedName}`, {
      timeout: 10_000,
    });
    await expect(section).toContainText("HIDDEN FROM KIOSK");
    await expect(section).toContainText("Hidden · 0 items");
    await expect(
      section.getByTestId("workspace-menu-category-hidden-helper"),
    ).toContainText("Customers cannot see this category or its items on the kiosk.");
    await expect(
      section.getByTestId("workspace-menu-toggle-category"),
    ).toContainText("Show");
    let saved = await prisma.category.findUnique({
      where: { id: category.id },
      select: { isActive: true },
    });
    assert.equal(
      saved?.isActive,
      false,
      "Workspace Menu category hide should persist through the shared route.",
    );

    await section.getByTestId("workspace-menu-toggle-category").click();
    await expect(
      section.getByTestId("workspace-menu-toggle-category"),
    ).toHaveAttribute("aria-label", `Hide category ${editedName}`, {
      timeout: 10_000,
    });
    await expect(section).not.toContainText("HIDDEN FROM KIOSK");
    await expect(
      section.getByTestId("workspace-menu-category-hidden-helper"),
    ).toHaveCount(0);
    await expect(
      section.getByTestId("workspace-menu-toggle-category"),
    ).toContainText("Hide");
    saved = await prisma.category.findUnique({
      where: { id: category.id },
      select: { isActive: true },
    });
    assert.equal(
      saved?.isActive,
      true,
      "Workspace Menu category show should persist through the shared route.",
    );
  } finally {
    await context.close();
  }
}

async function assertWorkspaceMenuDeleteHardDelete(
  browser: Browser,
  token: string,
) {
  const hardDeleteItemId = `${runId}-hard-delete-item`;
  const hardDeleteItemName = `${runId} Hard Delete Item`;
  const dealDeleteId = `${runId}-delete-deal`;
  const dealDeleteName = `${runId} Delete Deal`;

  await prisma.menuItem.create({
    data: {
      id: hardDeleteItemId,
      outletId: outletAId,
      categoryId: categoryAId,
      name: hardDeleteItemName,
      description: "Workspace smoke hard delete fixture",
      price: new Prisma.Decimal("6.50"),
      emoji: "H",
      bgColor: "#F5F4EF",
      sortOrder: 9998,
      isActive: false,
    },
  });

  await prisma.menuItem.create({
    data: {
      id: dealDeleteId,
      outletId: outletAId,
      categoryId: categoryDealsId,
      dealBaseMenuItemId: itemAId,
      comboNum: 91,
      name: dealDeleteName,
      description: "Workspace smoke deal delete fixture",
      price: new Prisma.Decimal("7.25"),
      emoji: "X",
      bgColor: "#FFE8A3",
      sortOrder: 9998,
      isActive: true,
      dealExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      upgradeOptions: {
        create: {
          customTitle: null,
          extraCharge: new Prisma.Decimal("1.00"),
          savingsLabel: new Prisma.Decimal("0.50"),
          discountPct: new Prisma.Decimal("10.00"),
          sortOrder: 0,
          linkedItems: {
            create: {
              linkedMenuItemId: itemLowId,
              itemNameSnapshot: `${runId} Low Stock Fries`,
              sortOrder: 0,
            },
          },
        },
      },
    },
  });

  const { context, page } = await newWorkspacePage({
    browser,
    token,
    viewport: { width: 1440, height: 950 },
  });
  page.on("dialog", (dialog) => dialog.accept());
  try {
    await page.goto(`/admin/workspace?widget=menu&item=${hardDeleteItemId}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("admin-workspace-header")).toBeVisible();
    const widget = page.getByTestId("admin-workspace-widget-menu");
    await expect(widget.getByTestId("workspace-menu-target-row")).toContainText(
      hardDeleteItemName,
    );
    await widget
      .getByTestId("workspace-menu-target-row")
      .getByTestId("workspace-menu-edit-item")
      .click();
    const itemDialog = page.getByRole("dialog", { name: "Edit item" });
    await expect(itemDialog).toBeVisible();
    await itemDialog.getByRole("button", { name: "Hard delete", exact: true }).click();
    await expect(itemDialog).toBeHidden({ timeout: 10_000 });
    assert.equal(
      new URL(page.url()).pathname,
      "/admin/workspace",
      "Workspace Menu hard delete should not navigate out of Workspace.",
    );
    assert.equal(
      new URL(page.url()).searchParams.get("item"),
      null,
      "Workspace Menu hard delete should clear stale item focus.",
    );
    const deleted = await prisma.menuItem.findUnique({
      where: { id: hardDeleteItemId },
      select: { id: true },
    });
    assert.equal(
      deleted,
      null,
      "Workspace Menu hard delete should remove the item.",
    );

    await page.goto(`/admin/workspace?widget=menu&item=${dealDeleteId}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("admin-workspace-header")).toBeVisible();
    await expect(widget.getByTestId("workspace-menu-target-row")).toContainText(
      dealDeleteName,
    );
    await widget
      .getByTestId("workspace-menu-target-row")
      .getByTestId("workspace-menu-edit-item")
      .click();
    const dealDialog = page.getByRole("dialog", { name: "Edit deal" });
    await expect(dealDialog).toBeVisible();
    const deleteDeal = dealDialog.getByRole("button", {
      name: "Hard delete deal",
    });
    await deleteDeal.click();
    await dealDialog
      .getByRole("button", { name: "Click again to delete" })
      .click();
    await expect(dealDialog).toBeHidden({ timeout: 10_000 });
    assert.equal(
      new URL(page.url()).pathname,
      "/admin/workspace",
      "Workspace Menu deal hard delete should not navigate out of Workspace.",
    );
    assert.equal(
      new URL(page.url()).searchParams.get("item"),
      null,
      "Workspace Menu deal hard delete should clear stale item focus.",
    );
    const deletedDeal = await prisma.menuItem.findUnique({
      where: { id: dealDeleteId },
      select: { id: true },
    });
    assert.equal(
      deletedDeal,
      null,
      "Workspace Menu deal hard delete should remove the deal.",
    );
  } finally {
    await context.close();
  }
}

function assertNoRestrictedDeviceFields(
  device: Record<string, unknown>,
  label: string,
) {
  for (const restrictedField of [
    "secretHash",
    "accessCode",
    "sessions",
    "outletAccess",
    "activeOutletId",
    "activeStaffOutletId",
    "activeStaffUserId",
    "token",
    "tokenHash",
    "expiresAt",
    "revokedAt",
  ]) {
    assert.equal(
      restrictedField in device,
      false,
      `${label} must not expose ${restrictedField}.`,
    );
  }

  const activeOperator = device.activeOperator as
    | Record<string, unknown>
    | null
    | undefined;
  if (activeOperator) {
    for (const restrictedField of ["id", "userId", "email", "sessionId"]) {
      assert.equal(
        restrictedField in activeOperator,
        false,
        `${label} active operator must not expose ${restrictedField}.`,
      );
    }
  }
}

async function expectDevicesWidgetData(
  page: Page,
  expectsDeviceManage: boolean,
) {
  await refreshDeviceHealthFixture();

  const response = await page.request.get(
    "/api/admin/workspace/devices/summary",
  );
  assert.equal(
    response.status(),
    200,
    "Workspace Devices summary should load for device-read roles.",
  );
  const payload = (await response.json()) as Record<string, unknown>;
  for (const excludedField of [
    "kpis",
    "operations",
    "operationsPreview",
    "recentOrders",
    "topSellers",
    "topSellersBySales",
  ]) {
    assert.equal(
      excludedField in payload,
      false,
      `Workspace Devices summary must not include dashboard ${excludedField}.`,
    );
  }

  const deviceHealth = payload.deviceHealth as Record<string, unknown>;
  assert.equal(
    deviceHealth.online,
    1,
    "Workspace Devices counts online devices.",
  );
  assert.equal(deviceHealth.idle, 1, "Workspace Devices counts idle devices.");
  assert.equal(
    deviceHealth.offline,
    1,
    "Workspace Devices counts offline devices.",
  );
  assert.equal(
    deviceHealth.disabled,
    1,
    "Workspace Devices counts disabled devices.",
  );

  const deviceFleet = payload.deviceFleet as Record<string, unknown>;
  const fleetDevices = deviceFleet.devices as Record<string, unknown>[];
  const deviceNames = fleetDevices.map((device) => String(device.name));
  assert(
    deviceNames.includes(`${runId} online`),
    "Workspace Devices includes scoped outlet devices.",
  );
  assert(
    !deviceNames.includes(`${runId} other outlet device`),
    "Workspace Devices excludes devices scoped only to another outlet.",
  );
  for (const device of fleetDevices) {
    assertNoRestrictedDeviceFields(device, `Workspace device ${device.name}`);
  }
  const devices = payload.devices as Record<string, unknown>[];
  const workspaceDeviceNames = devices.map((device) => String(device.name));
  assert(
    workspaceDeviceNames.includes(`${runId} online`),
    "Workspace Devices action rows include scoped outlet devices.",
  );
  assert(
    !workspaceDeviceNames.includes(`${runId} other outlet device`),
    "Workspace Devices action rows exclude other outlet devices.",
  );
  for (const device of devices) {
    assertNoRestrictedDeviceFields(
      device,
      `Workspace device action row ${device.name}`,
    );
  }

  const widget = page.getByTestId("admin-workspace-widget-devices");
  await expect(widget.getByTestId("workspace-devices-real-data")).toBeVisible();
  await expect(widget).toContainText("Device fleet");
  await expect(widget).toContainText(`${runId} online`);
  await expect(widget).toContainText(`${runId} idle`);
  await expect(widget).toContainText(`${runId} offline`);
  await expect(widget).toContainText(`${runId} disabled`);
  await expect(widget).not.toContainText(`${runId} other outlet device`);

  await widget.getByTestId(`workspace-device-row-${deviceOnlineId}`).click();
  await expect(widget.getByTestId("workspace-device-detail")).toBeVisible();
  await expect(widget.getByTestId("workspace-device-detail")).toContainText(
    `${runId} online`,
  );
  await expect(widget.getByTestId("workspace-device-detail")).toContainText(
    "Kiosk",
  );
  await expect(
    widget.getByTestId("workspace-device-active-user"),
  ).toContainText("Workspace Smoke Manager");
  if (expectsDeviceManage) {
    await expect(widget.getByTestId("workspace-device-edit")).toBeVisible();
    await expect(
      widget.getByTestId("workspace-device-toggle-active"),
    ).toBeVisible();
    await expect(
      widget.getByTestId("workspace-device-rotate-code"),
    ).toBeVisible();
  } else {
    await expect(widget.getByTestId("workspace-device-edit")).toHaveCount(0);
    await expect(
      widget.getByTestId("workspace-device-toggle-active"),
    ).toHaveCount(0);
    await expect(
      widget.getByTestId("workspace-device-rotate-code"),
    ).toHaveCount(0);
    await expect(widget).toContainText(
      "Management actions require device manage permission.",
    );
  }
}

async function expectDevicesWidgetForbidden(page: Page) {
  const response = await page.request.get(
    "/api/admin/workspace/devices/summary",
  );
  assert.equal(
    response.status(),
    403,
    "Workspace Devices summary should require device-read permission.",
  );
}

async function openWorkspaceUsersModal(page: Page): Promise<Locator> {
  const { inlineVisible } = await openWorkspaceMoreMenu(page);
  const scope = workspaceMoreScope(page, inlineVisible);
  const action = scope.getByTestId("admin-workspace-more-manage-users");
  await expect(action).toBeVisible();
  await action.click();
  await expect(action).toBeHidden();

  const modal = page.getByTestId("admin-workspace-users-modal");
  await expect(modal).toBeVisible();
  const url = new URL(page.url());
  assert.equal(
    url.pathname,
    "/admin/workspace",
    "Workspace Users modal should stay on the Workspace route.",
  );
  assert.equal(
    url.searchParams.get("modal"),
    "users",
    "Workspace Users modal should set modal=users.",
  );
  assert.notEqual(
    url.pathname,
    "/admin/users",
    "Workspace Users modal must not navigate to Classic Users.",
  );
  return modal;
}

async function assertWorkspaceUsersModal({
  browser,
  ownerToken,
  adminToken,
  managerToken,
}: {
  browser: Browser;
  ownerToken: string;
  adminToken: string;
  managerToken: string;
}) {
  const manager = await newWorkspacePage({
    browser,
    token: managerToken,
    viewport: { width: 1280, height: 900 },
  });
  try {
    const { scope } = await openWorkspaceMoreMenu(manager.page);
    await expect(
      scope.getByTestId("admin-workspace-more-manage-users"),
    ).toHaveCount(0);
    await manager.page.goto("/admin/workspace?modal=users", {
      waitUntil: "domcontentloaded",
    });
    await expect(
      manager.page.getByTestId("admin-workspace-users-modal"),
    ).toHaveCount(0);
  } finally {
    await manager.context.close();
  }

  const admin = await newWorkspacePage({
    browser,
    token: adminToken,
    viewport: { width: 1280, height: 900 },
  });
  try {
    const { scope } = await openWorkspaceMoreMenu(admin.page);
    await expect(
      scope.getByTestId("admin-workspace-more-manage-users"),
    ).toBeVisible();
  } finally {
    await admin.context.close();
  }

  const { context, page } = await newWorkspacePage({
    browser,
    token: ownerToken,
    viewport: { width: 1440, height: 950 },
  });
  try {
    await page.goto("/admin/workspace?modal=users", {
      waitUntil: "domcontentloaded",
    });
    let modal = page.getByTestId("admin-workspace-users-modal");
    await expect(modal).toBeVisible();
    await expect(modal).toContainText(userEmails.owner);
    await expect(modal).toContainText(userEmails.admin);
    assert.equal(new URL(page.url()).searchParams.get("modal"), "users");
    await page.getByTestId("admin-workspace-utility-modal-close").click();
    await expect(modal).toHaveCount(0);

    modal = await openWorkspaceUsersModal(page);
    await modal.getByTestId("admin-users-create-open").click();
    const createForm = modal.getByTestId("admin-users-create-inline-form");
    await expect(createForm).toBeVisible();

    const dirtyEmail = `${runId}-dirty-user@example.test`;
    await createForm.getByLabel("Email address").fill(dirtyEmail);
    const dismissedDirtyClose = new Promise<void>((resolve) => {
      page.once("dialog", async (dialog) => {
        assert.equal(dialog.type(), "confirm");
        assert.match(dialog.message(), /Discard unsaved user changes/);
        await dialog.dismiss();
        resolve();
      });
    });
    await page.getByTestId("admin-workspace-utility-modal-close").click();
    await dismissedDirtyClose;
    await expect(modal).toBeVisible();
    await expect(createForm.getByLabel("Email address")).toHaveValue(dirtyEmail);

    const createRoute = "**/api/admin/users";
    await page.route(createRoute, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 428,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Enter your MFA code before this sensitive action.",
          errorCode: "step_up_required",
        }),
      });
    });
    await createForm.getByLabel("Display name").fill("Workspace Modal Admin");
    await createForm.locator('input[type="password"]').fill(`${runId}-Password1!`);
    await createForm.getByRole("button", { name: /Admin/ }).click();
    await createForm
      .getByRole("button", { name: "CREATE USER", exact: true })
      .click();
    await expect(modal.getByTestId("admin-users-step-up-inline")).toBeVisible();
    await expect(createForm.getByLabel("Email address")).toHaveValue(dirtyEmail);
    await page.unroute(createRoute);

    await page.route(createRoute, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 428,
        contentType: "application/json",
        body: JSON.stringify({
          error: "MFA enrollment is required before this sensitive action.",
          errorCode: "mfa_enrollment_required",
        }),
      });
    });
    await createForm
      .getByRole("button", { name: "CREATE USER", exact: true })
      .click();
    await expect(modal.getByTestId("admin-users-step-up-inline")).toHaveCount(0);
    await expect(modal.getByTestId("admin-users-inline-error")).toContainText(
      "Open Security > MFA setup first.",
    );
    await expect(createForm.getByLabel("Email address")).toHaveValue(dirtyEmail);
    await page.unroute(createRoute);

    const createdEmail = `${runId}-modal-admin@example.test`;
    const capturedPayload: { current: Record<string, unknown> | null } = {
      current: null,
    };
    await page.route(createRoute, async (route) => {
      if (route.request().method() === "POST") {
        capturedPayload.current = route.request().postDataJSON() as Record<
          string,
          unknown
        >;
      }
      await route.continue();
    });
    await createForm.getByLabel("Email address").fill(createdEmail);
    await createForm
      .getByRole("button", { name: "CREATE USER", exact: true })
      .click();
    await expect(modal.getByText(createdEmail)).toBeVisible();
    assert(capturedPayload.current, "Workspace users create payload was captured.");
    assert.equal(capturedPayload.current.email, createdEmail);
    assert.equal(capturedPayload.current.displayName, "Workspace Modal Admin");
    assert.equal(capturedPayload.current.accountType, "ADMIN");
    assert.equal(capturedPayload.current.siteRole, "ADMIN");
    assert.deepEqual(capturedPayload.current.outletRoles, []);
    await expect
      .poll(async () => {
        const user = await prisma.adminUser.findUnique({
          where: { email: createdEmail },
          select: { accountType: true, siteRole: true },
        });
        return `${user?.accountType}:${user?.siteRole}`;
      })
      .toBe("ADMIN:ADMIN");
    await page.unroute(createRoute);

    await page.getByTestId("admin-workspace-utility-modal-close").click();
    await expect(modal).toHaveCount(0);
    await page.goto("/admin/users", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Users").first()).toBeVisible();
  } finally {
    await context.close();
  }
}

async function openWorkspaceDevicesModal(page: Page): Promise<Locator> {
  const { inlineVisible } = await openWorkspaceMoreMenu(page);
  const scope = workspaceMoreScope(page, inlineVisible);
  const action = scope.getByTestId("admin-workspace-more-manage-devices");
  await expect(action).toBeVisible();
  await action.click();
  await expect(action).toBeHidden();

  const modal = page.getByTestId("admin-workspace-devices-modal");
  await expect(modal).toBeVisible();
  const url = new URL(page.url());
  assert.equal(
    url.pathname,
    "/admin/workspace",
    "Workspace Devices modal should stay on the Workspace route.",
  );
  assert.equal(
    url.searchParams.get("modal"),
    "devices",
    "Workspace Devices modal should set modal=devices.",
  );
  assert.notEqual(
    url.pathname,
    "/admin/devices",
    "Workspace Devices modal must not navigate to Classic Devices.",
  );
  return modal;
}

async function assertWorkspaceDevicesModalReadOnly(page: Page) {
  const modal = await openWorkspaceDevicesModal(page);
  await expect(modal.getByTestId(`workspace-device-row-${deviceOnlineId}`)).toBeVisible();
  await modal.getByTestId(`workspace-device-row-${deviceOnlineId}`).click();
  await expect(modal.getByTestId("workspace-device-detail")).toContainText(
    `${runId} online`,
  );
  await expect(modal.getByTestId("workspace-device-edit")).toHaveCount(0);
  await expect(modal.getByTestId("workspace-device-toggle-active")).toHaveCount(0);
  await expect(modal.getByTestId("workspace-device-rotate-code")).toHaveCount(0);
  await expect(modal.getByTestId("workspace-device-enrollment-form")).toHaveCount(0);
  await expect(modal).toContainText(
    "Management actions require device manage permission.",
  );
  await page.getByTestId("admin-workspace-utility-modal-close").click();
  await expect(modal).toHaveCount(0);
}

async function assertWorkspaceDevicesModalOwner(page: Page) {
  await page.goto(`/admin/workspace?modal=devices&device=${deviceOfflineId}`, {
    waitUntil: "domcontentloaded",
  });
  let modal = page.getByTestId("admin-workspace-devices-modal");
  await expect(modal).toBeVisible();
  await expect(modal.getByTestId("workspace-device-detail")).toContainText(
    `${runId} offline`,
  );
  await expect(
    modal.getByTestId(`workspace-device-row-${deviceOfflineId}`),
  ).toHaveAttribute("aria-current", "true");
  await page.getByTestId("admin-workspace-utility-modal-close").click();
  await expect(modal).toHaveCount(0);
  const closedDeepLinkUrl = new URL(page.url());
  assert.equal(
    closedDeepLinkUrl.searchParams.get("modal"),
    null,
    "Closing the Devices modal should clear modal state.",
  );
  assert.equal(
    closedDeepLinkUrl.searchParams.get("device"),
    null,
    "Closing the Devices modal should clear focused device state.",
  );

  modal = await openWorkspaceDevicesModal(page);
  await expect(modal.getByTestId(`workspace-device-row-${deviceOnlineId}`)).toBeVisible();
  await modal.getByRole("button", { name: "Refresh" }).click();
  await expect(modal.getByTestId("workspace-devices-real-data")).toBeVisible();

  const enrollmentForm = modal.getByTestId("workspace-device-enrollment-form");
  const enrollmentName = modal.getByTestId(
    "workspace-device-enrollment-name-input",
  );
  const enrollmentLocation = modal.getByTestId(
    "workspace-device-enrollment-location-input",
  );
  const enrollmentRole = modal.getByTestId(
    "workspace-device-enrollment-role-select",
  );
  await expect(enrollmentForm).toBeVisible();
  await expect(
    modal.getByTestId("workspace-device-enrollment-outlet"),
  ).toContainText(outletAName);

  await enrollmentName.fill(`${runId} dirty enrollment`);
  const dismissedEnrollmentDirtyClose = new Promise<void>((resolve) => {
    page.once("dialog", async (dialog) => {
      assert.equal(dialog.type(), "confirm");
      assert.match(dialog.message(), /Discard unsaved device changes/);
      await dialog.dismiss();
      resolve();
    });
  });
  await page.getByTestId("admin-workspace-utility-modal-close").click();
  await dismissedEnrollmentDirtyClose;
  await expect(modal).toBeVisible();
  await expect(enrollmentName).toHaveValue(`${runId} dirty enrollment`);
  await modal.getByTestId("workspace-device-enrollment-reset").click();
  await expect(enrollmentName).toHaveValue("");
  await expect(enrollmentLocation).toHaveValue("");
  await expect(enrollmentRole).toHaveValue("kiosk");

  const createRoute = "**/api/admin/devices";
  await page.route(createRoute, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 428,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Enter your MFA code before this sensitive action.",
        errorCode: "step_up_required",
      }),
    });
  });
  await enrollmentName.fill(`${runId} modal step-up`);
  await enrollmentLocation.fill("Workspace step-up bay");
  await enrollmentRole.selectOption("counter");
  await modal.getByTestId("workspace-device-enrollment-submit").click();
  await expect(modal.getByTestId("workspace-device-step-up")).toBeVisible();
  await expect(modal.getByTestId("workspace-device-action-error")).toContainText(
    "Verify below, then run the action again.",
  );
  await expect(enrollmentName).toHaveValue(`${runId} modal step-up`);
  await expect(enrollmentLocation).toHaveValue("Workspace step-up bay");
  await expect(enrollmentRole).toHaveValue("counter");
  await page.unroute(createRoute);

  await page.route(createRoute, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 428,
      contentType: "application/json",
      body: JSON.stringify({
        error: "MFA enrollment is required before this sensitive action.",
        errorCode: "mfa_enrollment_required",
      }),
    });
  });
  await modal.getByTestId("workspace-device-enrollment-submit").click();
  await expect(modal.getByTestId("workspace-device-step-up")).toHaveCount(0);
  await expect(modal.getByTestId("workspace-device-action-error")).toContainText(
    "Open Security > MFA setup first.",
  );
  await expect(enrollmentName).toHaveValue(`${runId} modal step-up`);
  await expect(enrollmentLocation).toHaveValue("Workspace step-up bay");
  await expect(enrollmentRole).toHaveValue("counter");
  await page.unroute(createRoute);

  const enrolledDeviceName = `${runId} modal enrolled`;
  const capturedCreatePayload: { current: Record<string, unknown> | null } = {
    current: null,
  };
  await page.route(createRoute, async (route) => {
    if (route.request().method() === "POST") {
      capturedCreatePayload.current = route.request().postDataJSON() as Record<
        string,
        unknown
      >;
    }
    await route.continue();
  });
  const summaryRoute = "**/api/admin/workspace/devices/summary";
  await page.route(summaryRoute, async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "forced_devices_summary_refresh_failure" }),
    });
  });
  await enrollmentName.fill(enrolledDeviceName);
  await enrollmentLocation.fill("Workspace enrollment bay");
  await enrollmentRole.selectOption("counter");
  await modal.getByTestId("workspace-device-enrollment-submit").click();
  await expect(modal.getByTestId("workspace-device-create-access-code")).toBeVisible();
  await expect(modal).toContainText("Device refresh failed");
  assert(
    capturedCreatePayload.current,
    "Workspace enrollment create payload was captured.",
  );
  const createPayload = capturedCreatePayload.current;
  assert.equal(createPayload.outletId, outletAId);
  assert.equal(createPayload.isSharedAcrossOutlets, false);
  assert.deepEqual(createPayload.sharedOutletIds, []);
  assert.equal(createPayload.role, "counter");
  assert.equal(createPayload.physicalLocation, "Workspace enrollment bay");

  let enrolledDeviceId: string | null = null;
  await expect
    .poll(async () => {
      const device = await prisma.device.findFirst({
        where: { name: enrolledDeviceName },
        select: {
          id: true,
          outletId: true,
          physicalLocation: true,
          role: true,
          isSharedAcrossOutlets: true,
        },
      });
      enrolledDeviceId = device?.id ?? null;
      return [
        device?.outletId,
        device?.physicalLocation,
        device?.role,
        String(device?.isSharedAcrossOutlets),
      ].join(":");
    })
    .toBe(`${outletAId}:Workspace enrollment bay:counter:false`);
  assert(enrolledDeviceId, "Workspace enrollment should create a device row.");
  assert.equal(
    await prisma.deviceOutletAccess.count({
      where: { deviceId: enrolledDeviceId },
    }),
    0,
    "Workspace enrollment should not create shared outlet access rows.",
  );
  await page.unroute(summaryRoute);
  await page.unroute(createRoute);
  await modal.getByRole("button", { name: "Refresh" }).click();
  await expect(modal.getByTestId(`workspace-device-row-${enrolledDeviceId}`)).toBeVisible();

  await modal.getByTestId(`workspace-device-row-${deviceOnlineId}`).click();
  await expect(modal.getByTestId("workspace-device-detail")).toContainText(
    `${runId} online`,
  );

  await modal.getByTestId("workspace-device-edit").click();
  await expect(modal.getByTestId("workspace-device-inline-editor")).toBeVisible();
  await expect(page.getByTestId("workspace-device-editor-modal")).toHaveCount(0);
  await modal
    .getByTestId("workspace-device-editor-name-input")
    .fill(`${runId} online modal renamed`);
  await modal
    .getByTestId("workspace-device-editor-location-input")
    .fill("Workspace modal counter");

  const dismissedDirtyClose = new Promise<void>((resolve) => {
    page.once("dialog", async (dialog) => {
      assert.equal(dialog.type(), "confirm");
      assert.match(dialog.message(), /Discard unsaved device changes/);
      await dialog.dismiss();
      resolve();
    });
  });
  await page.getByTestId("admin-workspace-utility-modal-close").click();
  await dismissedDirtyClose;
  await expect(modal).toBeVisible();
  await expect(modal.getByTestId("workspace-device-inline-editor")).toBeVisible();

  await modal.getByTestId("workspace-device-editor-save").click();
  await expect(modal.getByTestId("workspace-device-inline-editor")).toHaveCount(0);
  await expect
    .poll(async () => {
      const device = await prisma.device.findUnique({
        where: { id: deviceOnlineId },
        select: { name: true, physicalLocation: true },
      });
      return `${device?.name}:${device?.physicalLocation}`;
    })
    .toBe(`${runId} online modal renamed:Workspace modal counter`);
  await expect(
    page
      .getByTestId("admin-workspace-toast")
      .filter({ hasText: `Device updated: ${runId} online modal renamed` }),
  ).toBeVisible();

  const activeRoute = `**/api/admin/devices/${deviceOnlineId}/active`;
  await page.route(activeRoute, async (route) => {
    await route.fulfill({
      status: 428,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Enter your MFA code before this sensitive action.",
        errorCode: "step_up_required",
      }),
    });
  });
  await modal.getByTestId("workspace-device-toggle-active").click();
  await expect(modal.getByTestId("workspace-device-step-up")).toBeVisible();
  await expect(modal.getByTestId("workspace-device-action-error")).toContainText(
    "Verify below, then run the action again.",
  );
  await page.unroute(activeRoute);

  const rotateRoute = `**/api/admin/devices/${deviceOnlineId}/rotate`;
  await page.route(rotateRoute, async (route) => {
    await route.fulfill({
      status: 428,
      contentType: "application/json",
      body: JSON.stringify({
        error: "MFA enrollment is required before this sensitive action.",
        errorCode: "mfa_enrollment_required",
      }),
    });
  });
  await modal.getByTestId("workspace-device-rotate-code").click();
  await expect(modal.getByTestId("workspace-device-step-up")).toHaveCount(0);
  await expect(modal.getByTestId("workspace-device-action-error")).toContainText(
    "Open Security > MFA setup first.",
  );
  await page.unroute(rotateRoute);

  await modal.getByTestId("workspace-device-rotate-code").click();
  await expect(modal.getByTestId("workspace-device-access-code")).toBeVisible();
  await page.getByTestId("admin-workspace-utility-modal-close").click();
  await expect(modal).toHaveCount(0);
  const closedUrl = new URL(page.url());
  assert.equal(
    closedUrl.searchParams.get("modal"),
    null,
    "Closing the Devices modal should clear modal=devices.",
  );
  await expect(page.getByTestId("admin-workspace-widget-devices")).toContainText(
    enrolledDeviceName,
  );

  modal = await openWorkspaceDevicesModal(page);
  await expect(modal.getByTestId("workspace-device-create-access-code")).toHaveCount(0);
  await modal.getByTestId(`workspace-device-row-${deviceOnlineId}`).click();
  await expect(modal.getByTestId("workspace-device-access-code")).toHaveCount(0);
  await page.getByTestId("admin-workspace-utility-modal-close").click();
  await expect(modal).toHaveCount(0);
}

async function assertWorkspaceDevicesActions({
  browser,
  ownerToken,
  managerToken,
}: {
  browser: Browser;
  ownerToken: string;
  managerToken: string;
}) {
  const manager = await newWorkspacePage({
    browser,
    token: managerToken,
    viewport: { width: 1280, height: 900 },
  });
  try {
    const deniedActive = await manager.page.request.post(
      `/api/admin/devices/${deviceOnlineId}/active`,
      {
        data: { isActive: false },
      },
    );
    assert.equal(
      deniedActive.status(),
      403,
      "Manager Workspace session must not toggle device active state.",
    );
    const deniedRotate = await manager.page.request.post(
      `/api/admin/devices/${deviceOnlineId}/rotate`,
    );
    assert.equal(
      deniedRotate.status(),
      403,
      "Manager Workspace session must not rotate device access codes.",
    );
    const unchanged = await prisma.device.findUnique({
      where: { id: deviceOnlineId },
      select: { isActive: true, rotatedAt: true },
    });
    assert.equal(
      unchanged?.isActive,
      true,
      "Denied manager active toggle must leave the device enabled.",
    );
    assert.equal(
      unchanged?.rotatedAt,
      null,
      "Denied manager rotate must not rotate the device code.",
    );
    await assertWorkspaceDevicesModalReadOnly(manager.page);
  } finally {
    await manager.context.close();
  }

  const { context, page } = await newWorkspacePage({
    browser,
    token: ownerToken,
    viewport: { width: 1440, height: 950 },
  });
  try {
    await page.goto("/admin/workspace?widget=devices", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("admin-workspace-header")).toBeVisible();
    const widget = page.getByTestId("admin-workspace-widget-devices");
    await expect(widget).toHaveAttribute("data-active", "true");
    await expect(
      widget.getByTestId("workspace-devices-real-data"),
    ).toBeVisible();

    await widget.getByTestId(`workspace-device-row-${deviceIdleId}`).click();
    const detail = widget.getByTestId("workspace-device-detail");
    await expect(detail).toContainText(`${runId} idle`);
    await expect(
      detail.getByTestId("workspace-device-name-value"),
    ).toContainText(`${runId} idle`);
    await detail.getByTestId("workspace-device-edit").click();
    const editor = page.getByTestId("workspace-device-editor-modal");
    await expect(editor).toBeVisible();
    await editor
      .getByTestId("workspace-device-editor-name-input")
      .fill(`${runId} idle renamed`);
    await editor
      .getByTestId("workspace-device-editor-location-input")
      .fill("Workspace counter bay");
    await expect(
      detail.getByTestId("workspace-device-active-user"),
    ).toContainText("No active user");
    await editor.getByTestId("workspace-device-editor-save").click();
    await expect(editor).toHaveCount(0);
    await expect
      .poll(async () => {
        const device = await prisma.device.findUnique({
          where: { id: deviceIdleId },
          select: { name: true, physicalLocation: true },
        });
        return `${device?.name}:${device?.physicalLocation}`;
      })
      .toBe(`${runId} idle renamed:Workspace counter bay`);
    await expect(
      page
        .getByTestId("admin-workspace-toast")
        .filter({ hasText: `Device updated: ${runId} idle renamed` }),
    ).toBeVisible();
    assert.equal(
      new URL(page.url()).pathname,
      "/admin/workspace",
      "Workspace device save should not navigate to Classic Devices.",
    );

    await widget
      .getByTestId(`workspace-device-row-${deviceDisabledId}`)
      .click();
    await expect(widget.getByTestId("workspace-device-detail")).toContainText(
      `${runId} disabled`,
    );
    await widget.getByTestId("workspace-device-toggle-active").click();
    await expect
      .poll(async () => {
        const device = await prisma.device.findUnique({
          where: { id: deviceDisabledId },
          select: { isActive: true },
        });
        return device?.isActive;
      })
      .toBe(true);
    await expect(
      page
        .getByTestId("admin-workspace-toast")
        .filter({ hasText: `Device enabled: ${runId} disabled` }),
    ).toBeVisible();
    assert.equal(
      new URL(page.url()).pathname,
      "/admin/workspace",
      "Workspace device active toggle should not navigate to Classic Devices.",
    );

    await widget.getByTestId(`workspace-device-row-${deviceOfflineId}`).click();
    await expect(widget.getByTestId("workspace-device-detail")).toContainText(
      `${runId} offline`,
    );
    await widget.getByTestId("workspace-device-rotate-code").click();
    await expect
      .poll(async () => {
        const device = await prisma.device.findUnique({
          where: { id: deviceOfflineId },
          select: { rotatedAt: true },
        });
        return Boolean(device?.rotatedAt);
      })
      .toBe(true);
    await expect(
      widget.getByTestId("workspace-device-access-code"),
    ).toBeVisible();
    await expect(
      page
        .getByTestId("admin-workspace-toast")
        .filter({ hasText: `Access code rotated: ${runId} offline` }),
    ).toBeVisible();
    assert.equal(
      new URL(page.url()).pathname,
      "/admin/workspace",
      "Workspace device rotate should not navigate to Classic Devices.",
    );

    await assertWorkspaceDevicesModalOwner(page);
  } finally {
    await context.close();
  }
}

async function assertNoViewportOverflow(page: Page, label: string) {
  const metrics = await page.evaluate(() => {
    const doc = document.documentElement;
    const header = document.querySelector<HTMLElement>(
      '[data-testid="admin-workspace-header"]',
    );
    return {
      pageOverflow: doc.scrollWidth - doc.clientWidth,
      headerOverflow: header ? header.scrollWidth - header.clientWidth : 0,
    };
  });

  assert(
    metrics.pageOverflow <= 2,
    `${label}: workspace page has horizontal overflow ${JSON.stringify(metrics)}`,
  );
  assert(
    metrics.headerOverflow <= 2,
    `${label}: workspace header has horizontal overflow ${JSON.stringify(metrics)}`,
  );
}

async function assertRoleWorkspace({
  browser,
  role,
  token,
  expectsMenu,
  expectsMenuWrite,
  expectsDeviceHealth,
  expectsDeviceManage,
}: {
  browser: Browser;
  role: RoleKey;
  token: string;
  expectsMenu: boolean;
  expectsMenuWrite: boolean;
  expectsDeviceHealth: boolean;
  expectsDeviceManage: boolean;
}) {
  for (const viewport of [
    { width: 1440, height: 950 },
    { width: 820, height: 1180 },
  ]) {
    const { context, page } = await newWorkspacePage({
      browser,
      token,
      viewport,
    });
    try {
      await expectWorkspaceChrome({
        page,
        role,
      });
      await expectWorkspaceMoreMenu({
        page,
        expectsProtectedLinks: role !== "operator",
        expectsDevicesLink: expectsDeviceHealth,
      });
      await expect(page.getByTestId("admin-mode-switch")).toHaveCount(0);
      await expect(page.getByTestId("admin-mode-workspace")).toHaveCount(0);
      await expect(page.getByTestId("admin-mode-classic")).toHaveCount(0);
      await expectWidget(page, "dashboard", true);
      await expectWidget(page, "attention", true);
      await expectDashboardWidgetData({ page, expectsDeviceHealth });
      await expectWidget(page, "orders", true);
      await expectOrdersWidgetData(page);
      await expectWidget(page, "menu", expectsMenu);
      await expectWidget(page, "devices", expectsDeviceHealth);
      if (expectsMenu) {
        await expectMenuWidgetData(page, expectsMenuWrite);
      }
      if (expectsDeviceHealth) {
        await expect(
          page.getByTestId("admin-workspace-widget-devices"),
        ).toContainText("Device fleet");
        await expectDevicesWidgetData(page, expectsDeviceManage);
      } else {
        await expectDevicesWidgetForbidden(page);
      }
      await assertNoViewportOverflow(
        page,
        `${role} ${viewport.width}x${viewport.height}`,
      );
    } finally {
      await context.close();
    }
  }
}

async function widgetStyle(
  page: Page,
  widgetId: WidgetId,
): Promise<WidgetStyle> {
  return page
    .getByTestId(`admin-workspace-widget-${widgetId}`)
    .evaluate((element) => {
      const style = (element as HTMLElement).style;
      return {
        left: Number.parseFloat(style.left),
        top: Number.parseFloat(style.top),
        width: Number.parseFloat(style.width),
        height: Number.parseFloat(style.height),
      };
    });
}

async function waitForStoredWidgetStyle(
  page: Page,
  widgetId: WidgetId,
  expected: Partial<WidgetStyle>,
) {
  await page.waitForFunction(
    ({ widgetId, expected }) => {
      const storageKeys = Object.keys(window.localStorage).filter(
        (key) =>
          key.startsWith("rushbite:admin-workspace-layout:") &&
          key.endsWith(":v2"),
      );
      for (const storageKey of storageKeys) {
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw) as {
            widgets?: Array<{
              id?: string;
              x?: number;
              y?: number;
              width?: number;
              height?: number;
            }>;
          };
          const widget = parsed.widgets?.find((entry) => entry.id === widgetId);
          if (!widget) continue;
          const matches =
            (expected.left === undefined || widget.x === expected.left) &&
            (expected.top === undefined || widget.y === expected.top) &&
            (expected.width === undefined || widget.width === expected.width) &&
            (expected.height === undefined ||
              widget.height === expected.height);
          if (matches) return true;
        } catch {
          continue;
        }
      }
      return false;
    },
    { widgetId, expected },
  );
}

async function waitForRenderedWidgetStyle(
  page: Page,
  widgetId: WidgetId,
  expected: Partial<WidgetStyle>,
) {
  await page.waitForFunction(
    ({ widgetId, expected }) => {
      const element = document.querySelector<HTMLElement>(
        `[data-testid="admin-workspace-widget-${widgetId}"]`,
      );
      if (!element) return false;
      const matches =
        (expected.left === undefined ||
          Number.parseFloat(element.style.left) === expected.left) &&
        (expected.top === undefined ||
          Number.parseFloat(element.style.top) === expected.top) &&
        (expected.width === undefined ||
          Number.parseFloat(element.style.width) === expected.width) &&
        (expected.height === undefined ||
          Number.parseFloat(element.style.height) === expected.height);
      return matches;
    },
    { widgetId, expected },
  );
}

async function workspaceScrollPosition(page: Page) {
  return page
    .getByTestId("admin-workspace-scroll-container")
    .evaluate((element) => ({
      left: (element as HTMLElement).scrollLeft,
      top: (element as HTMLElement).scrollTop,
    }));
}

async function dragResizeHandle(
  page: Page,
  widgetId: WidgetId,
  deltaX: number,
  deltaY: number,
) {
  const handle = page.getByTestId(`admin-workspace-resize-handle-${widgetId}`);
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  assert(box, `${widgetId} resize handle should have a browser bounding box.`);
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 8 });
  await expect(
    page.getByTestId("admin-workspace-resize-preview"),
  ).toBeVisible();
  await page.mouse.up();
  await expect(page.getByTestId("admin-workspace-resize-preview")).toHaveCount(
    0,
  );
}

async function assertWorkspaceInteractions(browser: Browser, token: string) {
  const { context, page } = await newWorkspacePage({
    browser,
    token,
    viewport: { width: 1440, height: 950 },
  });
  try {
    const orders = page.getByTestId("admin-workspace-widget-orders");
    const ordersHeader = page.getByTestId(
      "admin-workspace-widget-header-orders",
    );
    const initialOrders = await widgetStyle(page, "orders");
    assert.equal(
      initialOrders.left,
      744,
      "Orders widget should start in the default x position.",
    );
    assert.equal(
      initialOrders.top,
      24,
      "Orders widget should start in the default y position.",
    );

    const headerBox = await ordersHeader.boundingBox();
    assert(
      headerBox,
      "Orders widget header should have a browser bounding box.",
    );
    await page.mouse.move(headerBox.x + 96, headerBox.y + 18);
    await page.mouse.down();
    await page.mouse.move(headerBox.x + 430, headerBox.y + 245, { steps: 8 });
    await page.mouse.up();

    await page.waitForFunction(() => {
      const element = document.querySelector<HTMLElement>(
        '[data-testid="admin-workspace-widget-orders"]',
      );
      if (!element) return false;
      return (
        Number.parseFloat(element.style.left) !== 744 &&
        Number.parseFloat(element.style.top) !== 24
      );
    });
    const movedOrders = await widgetStyle(page, "orders");
    await waitForStoredWidgetStyle(page, "orders", {
      left: movedOrders.left,
      top: movedOrders.top,
    });

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(orders).toBeVisible();
    await waitForRenderedWidgetStyle(page, "orders", {
      left: movedOrders.left,
      top: movedOrders.top,
    });
    assert.deepEqual(
      await widgetStyle(page, "orders"),
      movedOrders,
      "Dragged widget position should persist across reloads in the same browser context.",
    );

    await dragResizeHandle(page, "orders", 210, 0);
    await waitForRenderedWidgetStyle(page, "orders", {
      width: 884,
      height: movedOrders.height,
    });
    const widthOnlyResizedOrders = await widgetStyle(page, "orders");
    assert.equal(
      widthOnlyResizedOrders.width,
      884,
      "Orders widget should resize wider by dragging the corner horizontally.",
    );
    assert.equal(
      widthOnlyResizedOrders.height,
      movedOrders.height,
      "Horizontal corner resize should not force a matching height change.",
    );

    await dragResizeHandle(page, "orders", 0, 210);
    await waitForRenderedWidgetStyle(page, "orders", {
      width: 884,
      height: 704,
    });
    const resizedOrders = await widgetStyle(page, "orders");
    assert.equal(
      resizedOrders.width,
      884,
      "Vertical corner resize should preserve the already resized width.",
    );
    assert.equal(
      resizedOrders.height,
      704,
      "Orders widget should resize taller by dragging the corner vertically.",
    );
    await waitForStoredWidgetStyle(page, "orders", { width: 884, height: 704 });

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(orders).toBeVisible();
    await waitForRenderedWidgetStyle(page, "orders", {
      width: 884,
      height: 704,
    });
    assert.deepEqual(
      {
        width: (await widgetStyle(page, "orders")).width,
        height: (await widgetStyle(page, "orders")).height,
      },
      { width: 884, height: 704 },
      "Resized widget dimensions should persist across reloads in the same browser context.",
    );

    // The in-canvas "Reset layout" button was temporarily removed; the
    // equivalent recovery path is to wipe the workspace layout keys
    // from localStorage and reload, which the canvas's load-time path
    // treats as a first-run and renders the default layout.
    await page.evaluate(() => {
      Object.keys(localStorage)
        .filter((key) => key.startsWith("rushbite:admin-workspace-layout"))
        .forEach((key) => localStorage.removeItem(key));
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => {
      const element = document.querySelector<HTMLElement>(
        '[data-testid="admin-workspace-widget-orders"]',
      );
      if (!element) return false;
      return (
        Number.parseFloat(element.style.left) === 744 &&
        Number.parseFloat(element.style.top) === 24 &&
        Number.parseFloat(element.style.width) === 704 &&
        Number.parseFloat(element.style.height) === 524
      );
    });

    await page.goto("/admin/workspace?widget=menu&stock=out", {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByTestId("admin-workspace-widget-menu"),
    ).toHaveAttribute("data-active", "true");
    await expect
      .poll(async () => (await workspaceScrollPosition(page)).top > 0)
      .toBe(true);
    await page
      .getByTestId("admin-workspace-scroll-container")
      .evaluate((element) => {
        (element as HTMLElement).scrollTo({ left: 0, top: 0 });
      });
    await expect
      .poll(async () => (await workspaceScrollPosition(page)).top)
      .toBe(0);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByTestId("admin-workspace-widget-menu"),
    ).toHaveAttribute("data-active", "true");
    assert.deepEqual(
      await workspaceScrollPosition(page),
      { left: 0, top: 0 },
      "Reloading a workspace URL with widget params should restore the saved canvas viewport instead of revealing the widget again.",
    );
  } finally {
    await context.close();
  }
}

async function assertStaleOutletFallback(browser: Browser, token: string) {
  const { context, page } = await newWorkspacePage({
    browser,
    token,
    activeOutletId: outletBId,
    viewport: { width: 1024, height: 900 },
  });
  try {
    await expectWorkspaceChrome({
      page,
      role: "operator",
      outletName: outletAName,
    });
    await expect(page.getByText(outletBName)).toHaveCount(0);
    await expectWidget(page, "attention", true);
    await expectWidget(page, "menu", false);
    await expectWidget(page, "devices", false);
    await expectDashboardWidgetData({ page, expectsDeviceHealth: false });
    await assertNoViewportOverflow(page, "operator stale active outlet");
  } finally {
    await context.close();
  }
}

async function assertModeSwitchAndDeepLinks(browser: Browser, token: string) {
  const context = await browser.newContext({
    baseURL: baseUrl,
    viewport: { width: 1280, height: 900 },
  });
  await context.addCookies([
    {
      name: ADMIN_SESSION_COOKIE,
      value: token,
      url: baseUrl,
      httpOnly: true,
      sameSite: "Strict",
    },
    {
      name: ADMIN_ACTIVE_OUTLET_COOKIE,
      value: outletAId,
      url: baseUrl,
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);

  const page = await context.newPage();
  try {
    await page.goto("/admin/orders?id=not-real", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("admin-shell-header")).toBeVisible();
    assert.equal(
      new URL(page.url()).pathname,
      "/admin/orders",
      "Classic orders deep links should remain Classic during rollout.",
    );

    await page.goto("/admin/orders?id=not-real&mode=workspace", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("admin-workspace-header")).toBeVisible();
    const workspaceUrl = new URL(page.url());
    assert.equal(workspaceUrl.pathname, "/admin/workspace");
    assert.equal(workspaceUrl.searchParams.get("widget"), "orders");
    assert.equal(workspaceUrl.searchParams.get("order"), "not-real");

    await expect(page.getByTestId("admin-mode-switch")).toHaveCount(0);
    await page.goto("/admin?mode=classic", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("admin-shell-header")).toBeVisible();
    await expect(page.getByTestId("admin-mode-switch")).toHaveCount(0);
    await expect(page.getByTestId("admin-mode-classic")).toHaveCount(0);
    await expect(page.getByTestId("admin-workspace-return-link")).toHaveAttribute(
      "href",
      "/admin/workspace",
    );
    await expect(page.getByTestId("admin-shell-header")).not.toContainText(
      "Classic",
    );
    await expect(page.getByTestId("admin-nav-dealHistory")).toHaveAttribute(
      "href",
      "/admin/workspace?modal=deal-history",
    );
    await expect(page.getByTestId("admin-nav-settings")).toHaveAttribute(
      "href",
      "/admin/workspace?modal=settings",
    );
    await expect(page.getByTestId("admin-nav-security")).toHaveAttribute(
      "href",
      "/admin/workspace?modal=security",
    );
    assert.equal(
      new URL(page.url()).pathname,
      "/admin",
      "Explicit Classic mode should still route to Classic while the Workspace header hides the switch.",
    );

    await page.goto("/admin/workspace", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("admin-workspace-header")).toBeVisible();
    const dashboardWidget = page.getByTestId(
      "admin-workspace-widget-dashboard",
    );
    const ordersWidget = page.getByTestId("admin-workspace-widget-orders");
    await expect(dashboardWidget).toHaveAttribute("data-active", "true");
    const paidOperation = page.getByTestId("workspace-dashboard-operation-paid");
    await expect(paidOperation).toBeVisible();
    await paidOperation.scrollIntoViewIfNeeded();
    await paidOperation.click();
    await expect(paidOperation).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("dashboard-operation-preview")).toBeVisible();
    await expect(page.getByTestId("dashboard-operation-preview")).toContainText(
      "Paid / new",
    );
    await expect(
      page.getByTestId("dashboard-operation-preview-row").first(),
    ).toBeVisible();
    const paidOrdersUrl = new URL(page.url());
    assert.equal(
      paidOrdersUrl.pathname,
      "/admin/workspace",
      "Workspace operation cards should keep the operator inside the Workspace widget.",
    );
    await page
      .getByTestId("dashboard-operation-preview")
      .getByRole("button", { name: "Open queue" })
      .click();
    await expect(ordersWidget).toHaveAttribute("data-active", "true");
    await expect(
      ordersWidget.getByTestId("workspace-orders-filter-kitchen"),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByTestId("admin-workspace-return-orders"),
    ).toContainText("Back to Dashboard");
    const dashboardQueueUrl = new URL(page.url());
    assert.equal(
      dashboardQueueUrl.pathname,
      "/admin/workspace",
      "Workspace dashboard queue links should keep operators inside Workspace.",
    );
    assert.equal(dashboardQueueUrl.searchParams.get("widget"), "orders");
    assert.equal(dashboardQueueUrl.searchParams.get("status"), "PAID");
    await page.getByTestId("admin-workspace-return-orders").click();
    await expect(dashboardWidget).toHaveAttribute("data-active", "true");
    await expect(page.getByTestId("admin-workspace-return-orders")).toHaveCount(
      0,
    );
    const dashboardReturnUrl = new URL(page.url());
    assert.equal(dashboardReturnUrl.searchParams.get("widget"), "dashboard");
    assert.equal(dashboardReturnUrl.searchParams.get("status"), null);

    const attentionWidget = page.getByTestId(
      "admin-workspace-widget-attention",
    );
    await attentionWidget.scrollIntoViewIfNeeded();
    await attentionWidget
      .getByTestId("dashboard-attention-item-orders-awaiting-payment")
      .click();
    await expect(ordersWidget).toHaveAttribute("data-active", "true");
    await expect(
      ordersWidget.getByTestId("workspace-orders-filter-payment"),
    ).toHaveAttribute("aria-pressed", "true");
    const paymentFocusUrl = new URL(page.url());
    assert.equal(
      paymentFocusUrl.pathname,
      "/admin/workspace",
      "Workspace attention order links should keep operators inside Workspace.",
    );
    assert.equal(paymentFocusUrl.searchParams.get("widget"), "orders");
    assert.equal(
      paymentFocusUrl.searchParams.get("status"),
      "AWAITING_COUNTER_PAYMENT",
    );
    await expect(
      page.getByTestId("admin-workspace-return-orders"),
    ).toContainText("Back to Attention");
    await page.getByTestId("admin-workspace-return-orders").click();
    await expect(attentionWidget).toHaveAttribute("data-active", "true");
    await expect(page.getByTestId("admin-workspace-return-orders")).toHaveCount(
      0,
    );
    const paymentReturnUrl = new URL(page.url());
    assert.equal(paymentReturnUrl.searchParams.get("widget"), "attention");
    assert.equal(paymentReturnUrl.searchParams.get("status"), null);

    await attentionWidget.scrollIntoViewIfNeeded();
    await attentionWidget
      .getByTestId("dashboard-attention-item-orders-ready")
      .click();
    await expect(ordersWidget).toHaveAttribute("data-active", "true");
    await expect(
      ordersWidget.getByTestId("workspace-orders-filter-ready"),
    ).toHaveAttribute("aria-pressed", "true");
    const readyFocusUrl = new URL(page.url());
    assert.equal(readyFocusUrl.pathname, "/admin/workspace");
    assert.equal(readyFocusUrl.searchParams.get("widget"), "orders");
    assert.equal(readyFocusUrl.searchParams.get("status"), "READY");

    const menuWidget = page.getByTestId("admin-workspace-widget-menu");
    await attentionWidget.scrollIntoViewIfNeeded();
    await attentionWidget
      .getByTestId("dashboard-attention-item-menu-inventory-out")
      .click();
    await expect(menuWidget).toHaveAttribute("data-active", "true");
    await expect(
      menuWidget.getByTestId("workspace-menu-filter-inventory-out"),
    ).toHaveAttribute("aria-pressed", "true");
    const menuFocusUrl = new URL(page.url());
    assert.equal(
      menuFocusUrl.pathname,
      "/admin/workspace",
      "Workspace attention menu links should keep operators inside Workspace.",
    );
    assert.equal(menuFocusUrl.searchParams.get("widget"), "menu");
    assert.equal(menuFocusUrl.searchParams.get("attention"), "inventory-out");
    assert.equal(
      menuFocusUrl.searchParams.get("status"),
      null,
      "Workspace attention menu links should clear stale order status filters.",
    );
    assert.equal(
      menuFocusUrl.searchParams.get("stock"),
      null,
      "Workspace attention menu links should clear stale menu stock filters.",
    );
    await expect(page.getByTestId("admin-workspace-return-menu")).toContainText(
      "Back to Attention",
    );
    await page.getByTestId("admin-workspace-return-menu").click();
    await expect(attentionWidget).toHaveAttribute("data-active", "true");
    await expect(page.getByTestId("admin-workspace-return-menu")).toHaveCount(
      0,
    );
    const menuReturnUrl = new URL(page.url());
    assert.equal(menuReturnUrl.searchParams.get("widget"), "attention");
    assert.equal(menuReturnUrl.searchParams.get("attention"), null);

    await page.goto(`/admin/workspace?widget=menu&item=${itemLowId}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("admin-workspace-header")).toBeVisible();
    await expect(
      page.getByTestId("admin-workspace-widget-menu"),
    ).toHaveAttribute("data-active", "true");
    await expect(page.getByTestId("workspace-menu-target-row")).toContainText(
      `${runId} Low Stock Fries`,
    );
    await expect(page.getByTestId("workspace-menu-row-detail")).toBeVisible();

    await page.goto("/admin/workspace", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("admin-workspace-header")).toBeVisible();
    assert.equal(
      new URL(page.url()).pathname,
      "/admin/workspace",
      "Direct Workspace navigation should stay in the Workspace shell.",
    );

    await expectWorkspaceUtilityDeepLink({
      page,
      href: "/admin/workspace?modal=settings",
      modalTestId: "admin-workspace-settings-modal",
      modalParam: "settings",
    });
    await expectWorkspaceUtilityDeepLink({
      page,
      href: "/admin/settings",
      modalTestId: "admin-workspace-settings-modal",
      modalParam: "settings",
    });
    await expectWorkspaceUtilityDeepLink({
      page,
      href: "/admin/workspace?modal=security",
      modalTestId: "admin-workspace-security-modal",
      modalParam: "security",
    });
    await expectWorkspaceUtilityDeepLink({
      page,
      href: "/admin/security/mfa",
      modalTestId: "admin-workspace-security-modal",
      modalParam: "security",
    });
    await expectWorkspaceUtilityDeepLink({
      page,
      href: "/admin/workspace?modal=deal-history",
      modalTestId: "admin-workspace-dealHistory-modal",
      modalParam: "deal-history",
    });
    await expectWorkspaceUtilityDeepLink({
      page,
      href: "/admin/deals/history",
      modalTestId: "admin-workspace-dealHistory-modal",
      modalParam: "deal-history",
    });

    await page.goto("/admin?mode=classic", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("admin-shell-header")).toBeVisible();
    assert.equal(
      new URL(page.url()).pathname,
      "/admin",
      "Explicit Classic mode should override stored Workspace preference.",
    );
  } finally {
    await context.close();
  }
}

async function main() {
  await assertServerReachable();
  await cleanup();
  const fixture = await seedFixture();
  const browser = await launchSmokeBrowser();

  try {
    if (process.env.ADMIN_WORKSPACE_BROWSER_SMOKE_ONLY === "users") {
      await assertWorkspaceUsersModal({
        browser,
        ownerToken: fixture.tokens.owner,
        adminToken: fixture.tokens.admin,
        managerToken: fixture.tokens.manager,
      });
      console.log("- workspace users modal smoke passed");
      console.log("Admin workspace browser smoke passed.");
      return;
    }

    if (process.env.ADMIN_WORKSPACE_BROWSER_SMOKE_ONLY === "devices") {
      await assertWorkspaceDevicesActions({
        browser,
        ownerToken: fixture.tokens.owner,
        managerToken: fixture.tokens.manager,
      });
      console.log("- workspace device actions smoke passed");
      console.log("Admin workspace browser smoke passed.");
      return;
    }

    if (process.env.ADMIN_WORKSPACE_BROWSER_SMOKE_ONLY === "fullscreen") {
      await assertWorkspaceFullscreenPreference(browser, fixture.tokens.owner);
      console.log("- workspace fullscreen preference smoke passed");
      console.log("Admin workspace browser smoke passed.");
      return;
    }

    await assertRoleWorkspace({
      browser,
      role: "owner",
      token: fixture.tokens.owner,
      expectsMenu: true,
      expectsMenuWrite: true,
      expectsDeviceHealth: true,
      expectsDeviceManage: true,
    });
    console.log("- owner workspace browser smoke passed");

    await assertWorkspaceSettingsModalSave(browser, fixture.tokens.owner);
    console.log("- workspace settings modal save smoke passed");

    await assertWorkspaceMenuEditorSave(browser, fixture.tokens.owner);
    console.log("- workspace menu editor modal save smoke passed");

    await assertWorkspaceMenuAddonSetQuickAttach(browser, fixture.tokens.owner);
    console.log("- workspace menu add-on set quick attach smoke passed");

    await assertWorkspaceMenuDirtyGuards(browser, fixture.tokens.owner);
    console.log("- workspace menu dirty guard smoke passed");

    await assertWorkspaceDealLimitEditorContext(browser, fixture.tokens.owner);
    console.log("- workspace deal limit editor-context smoke passed");

    await assertWorkspaceMenuQuickStock(browser, fixture.tokens.owner);
    console.log("- workspace menu quick stock smoke passed");

    await assertWorkspaceMenuReorder(browser, fixture.tokens.owner);
    console.log("- workspace menu reorder smoke passed");

    await assertWorkspaceInteractions(browser, fixture.tokens.owner);
    console.log(
      "- workspace drag, resize, persistence, and reset smoke passed",
    );

    await assertModeSwitchAndDeepLinks(browser, fixture.tokens.owner);
    console.log("- workspace mode switch and deep-link smoke passed");

    await assertWorkspaceFullscreenPreference(browser, fixture.tokens.owner);
    console.log("- workspace fullscreen preference smoke passed");

    await assertRoleWorkspace({
      browser,
      role: "manager",
      token: fixture.tokens.manager,
      expectsMenu: true,
      expectsMenuWrite: true,
      expectsDeviceHealth: true,
      expectsDeviceManage: false,
    });
    console.log("- manager workspace browser smoke passed");

    await assertRoleWorkspace({
      browser,
      role: "operator",
      token: fixture.tokens.operator,
      expectsMenu: false,
      expectsMenuWrite: false,
      expectsDeviceHealth: false,
      expectsDeviceManage: false,
    });
    console.log("- operator workspace browser smoke passed");

    await assertRoleWorkspace({
      browser,
      role: "viewer",
      token: fixture.tokens.viewer,
      expectsMenu: true,
      expectsMenuWrite: false,
      expectsDeviceHealth: false,
      expectsDeviceManage: false,
    });
    console.log("- viewer workspace browser smoke passed");

    await assertWorkspaceMenuCreateItemAndDeal(browser, fixture.tokens.owner);
    console.log("- workspace menu create item/deal smoke passed");

    await assertWorkspaceMenuCategoryManagement(browser, fixture.tokens.owner);
    console.log("- workspace menu category management smoke passed");

    await assertWorkspaceMenuDeleteHardDelete(browser, fixture.tokens.owner);
    console.log("- workspace menu delete/hard-delete smoke passed");

    await assertStaleOutletFallback(browser, fixture.tokens.operator);
    console.log("- stale active-outlet workspace browser smoke passed");

    await assertWorkspaceDevicesActions({
      browser,
      ownerToken: fixture.tokens.owner,
      managerToken: fixture.tokens.manager,
    });
    console.log("- workspace device actions smoke passed");

    await assertWorkspaceOrdersMutationRbac({
      browser,
      viewerToken: fixture.tokens.viewer,
      operatorToken: fixture.tokens.operator,
    });
    console.log("- workspace order mutation RBAC smoke passed");

    await assertWorkspaceOrdersActions(browser, fixture.tokens.owner);
    console.log("- workspace order actions smoke passed");

    console.log("Admin workspace browser smoke passed.");
  } finally {
    await browser.close();
  }
}

main()
  .catch((error) => {
    console.error("Admin workspace browser smoke failed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((error) => {
      console.error("Admin workspace browser smoke cleanup failed.");
      console.error(error);
      process.exitCode = 1;
    });
    await assertNoSmokeRowsRemain().catch((error) => {
      console.error("Admin workspace browser smoke cleanup assertion failed.");
      console.error(error);
      process.exitCode = 1;
    });
    await prisma.$disconnect();
  });
