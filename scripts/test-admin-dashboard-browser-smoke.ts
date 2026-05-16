/* eslint-disable no-console */
import "dotenv/config";

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { chromium, expect, type Browser, type Page } from "@playwright/test";
import { prisma } from "@/lib/db";

const baseUrl =
  process.env.ADMIN_DASHBOARD_BROWSER_BASE_URL ??
  process.env.BROWSER_BASE_URL ??
  "http://127.0.0.1:3001";

const shortRunId = Date.now().toString(36);
const runId = `dash-smoke-${shortRunId}`;
const outletAId = `${runId}-a`;
const outletBId = `${runId}-b`;
const outletAName = `Dash Smoke A ${shortRunId}`;
const outletBName = `Dash Smoke B ${shortRunId}`;
const categoryAId = `${runId}-cat-a`;
const categoryBId = `${runId}-cat-b`;
const itemAId = `${runId}-item-a`;
const itemPremiumId = `${runId}-item-premium`;
const itemBId = `${runId}-item-b`;
const deviceOnlineId = `${runId}-device-online`;
const deviceIdleId = `${runId}-device-idle`;
const deviceOfflineId = `${runId}-device-offline`;
const deviceDisabledId = `${runId}-device-disabled`;
const deviceCounterId = `${runId}-device-counter`;
const deviceKitchenId = `${runId}-device-kitchen`;
const deviceBoardId = `${runId}-device-board`;
const deviceOtherOutletId = `${runId}-device-other`;
const userEmails = {
  owner: `${runId}-owner@example.test`,
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

function hashSessionToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

async function assertServerReachable() {
  try {
    const response = await fetch(`${baseUrl}/admin/login`, { redirect: "manual" });
    assert(response.status > 0, `Admin dashboard smoke could not reach ${baseUrl}.`);
  } catch (error) {
    throw new Error(
      `Admin dashboard browser smoke requires an already-running Next server at ${baseUrl}. ` +
        `Start it first, or set ADMIN_DASHBOARD_BROWSER_BASE_URL to the correct URL. ` +
        `Original error: ${(error as Error).message}`,
    );
  }
}

async function launchSmokeBrowser() {
  const preferredChannel =
    process.env.ADMIN_DASHBOARD_BROWSER_CHANNEL ??
    (process.platform === "darwin" ? "chrome" : null);

  if (preferredChannel) {
    try {
      return await chromium.launch({
        headless: true,
        channel: preferredChannel,
      });
    } catch (error) {
      if (process.env.ADMIN_DASHBOARD_BROWSER_CHANNEL) throw error;
      console.warn(
        `Could not launch Playwright channel ${preferredChannel}; falling back to bundled Chromium.`,
      );
    }
  }

  return chromium.launch({ headless: true });
}

async function createAdminSession(userId: string, role: RoleKey) {
  const token = createSessionToken();
  await prisma.adminSession.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
      userAgent: `admin-dashboard-browser-smoke-${role}`,
      ipHash: `${runId}-ip`,
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
        orderPrefix: `DS${shortRunId.slice(-5).toUpperCase()}`,
        isActive: true,
      },
      {
        id: outletBId,
        siteId: "site",
        name: outletBName,
        slug: outletBId,
        orderPrefix: `DT${shortRunId.slice(-5).toUpperCase()}`,
        isActive: true,
      },
    ],
  });

  await prisma.category.createMany({
    data: [
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
        id: itemAId,
        outletId: outletAId,
        categoryId: categoryAId,
        name: `${runId} Burger`,
        description: "Browser smoke fixture",
        price: new Prisma.Decimal("10.00"),
        emoji: "B",
        bgColor: "#FFE3B3",
        sortOrder: 9990,
        isActive: true,
      },
      {
        id: itemPremiumId,
        outletId: outletAId,
        categoryId: categoryAId,
        name: `${runId} Premium`,
        description: "Browser smoke premium fixture",
        price: new Prisma.Decimal("40.00"),
        emoji: "P",
        bgColor: "#FFE3B3",
        sortOrder: 9991,
        isActive: true,
      },
      {
        id: itemBId,
        outletId: outletBId,
        categoryId: categoryBId,
        name: `${runId} Other Outlet`,
        description: "Browser smoke leak guard fixture",
        price: new Prisma.Decimal("99.00"),
        emoji: "O",
        bgColor: "#FFE3B3",
        sortOrder: 9992,
        isActive: true,
      },
    ],
  });

  const createOrder = ({
    suffix,
    outletId = outletAId,
    itemId = itemAId,
    status,
    total,
    qty,
  }: {
    suffix: string;
    outletId?: string;
    itemId?: string;
    status: string;
    total: string;
    qty: number;
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
        items: {
          create: {
            menuItemId: itemId,
            nameSnapshot:
              itemId === itemPremiumId
                ? "Dashboard Smoke Premium"
                : itemId === itemBId
                  ? "Other Outlet Smoke"
                  : "Dashboard Smoke Burger",
            qty,
            addonsJson: [],
            isMeal: false,
            lineTotal: new Prisma.Decimal(total),
          },
        },
      },
    });

  await Promise.all([
    createOrder({ suffix: "paid", status: "PAID", total: "10.00", qty: 2 }),
    createOrder({
      suffix: "kitchen",
      status: "IN_KITCHEN",
      total: "20.00",
      qty: 3,
    }),
    createOrder({
      suffix: "cash",
      status: "AWAITING_COUNTER_PAYMENT",
      total: "7.00",
      qty: 1,
    }),
    createOrder({
      suffix: "premium",
      itemId: itemPremiumId,
      status: "PAID",
      total: "40.00",
      qty: 1,
    }),
    createOrder({
      suffix: "other-outlet",
      outletId: outletBId,
      itemId: itemBId,
      status: "PAID",
      total: "99.00",
      qty: 1,
    }),
  ]);

  const now = new Date();
  const minutesAgo = (minutes: number) =>
    new Date(now.getTime() - minutes * 60 * 1000);
  await prisma.device.createMany({
    data: [
      {
        id: deviceOnlineId,
        siteId: "site",
        outletId: outletAId,
        name: `${runId} online`,
        physicalLocation: "East kiosk bank",
        role: "KIOSK",
        secretHash: `${runId}-secret`,
        isActive: true,
        lastSeenAt: minutesAgo(1),
      },
      {
        id: deviceIdleId,
        siteId: "site",
        outletId: outletAId,
        name: `${runId} idle`,
        role: "KIOSK",
        secretHash: `${runId}-secret`,
        isActive: true,
        lastSeenAt: minutesAgo(5),
      },
      {
        id: deviceOfflineId,
        siteId: "site",
        outletId: outletAId,
        name: `${runId} offline`,
        role: "KIOSK",
        secretHash: `${runId}-secret`,
        isActive: true,
        lastSeenAt: minutesAgo(15),
      },
      {
        id: deviceDisabledId,
        siteId: "site",
        outletId: outletAId,
        name: `${runId} disabled`,
        role: "KIOSK",
        secretHash: `${runId}-secret`,
        isActive: false,
        lastSeenAt: null,
      },
      {
        id: deviceKitchenId,
        siteId: "site",
        outletId: outletAId,
        name: `${runId} kitchen`,
        role: "kitchen",
        secretHash: `${runId}-secret`,
        isActive: true,
        lastSeenAt: minutesAgo(1),
      },
      {
        id: deviceCounterId,
        siteId: "site",
        outletId: outletAId,
        name: `${runId} counter`,
        role: "counter",
        secretHash: `${runId}-secret`,
        isActive: true,
        lastSeenAt: minutesAgo(1),
      },
      {
        id: deviceBoardId,
        siteId: "site",
        outletId: outletAId,
        name: `${runId} board`,
        role: "board",
        secretHash: `${runId}-secret`,
        isActive: true,
        lastSeenAt: minutesAgo(1),
      },
      {
        id: deviceOtherOutletId,
        siteId: "site",
        outletId: outletBId,
        name: `${runId} other outlet device`,
        role: "KIOSK",
        secretHash: `${runId}-secret`,
        isActive: true,
        lastSeenAt: minutesAgo(1),
      },
    ],
  });

  const [owner, manager, operator, viewer] = await Promise.all([
    prisma.adminUser.create({
      data: {
        email: userEmails.owner,
        displayName: "Dash Smoke Owner",
        passwordHash: `${runId}-hash`,
        accountType: "OWNER",
        siteRole: "OWNER",
        mfaEnabledAt: new Date(),
        isActive: true,
      },
    }),
    prisma.adminUser.create({
      data: {
        email: userEmails.manager,
        displayName: "Dash Smoke Manager",
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
        displayName: "Dash Smoke Operator",
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
        displayName: "Dash Smoke Viewer",
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
      tokenHash: `${runId}-device-session`,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      lastSeenAt: minutesAgo(1),
      ipHash: `${runId}-device-ip`,
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
      manager: await createAdminSession(manager.id, "manager"),
      operator: await createAdminSession(operator.id, "operator"),
      viewer: await createAdminSession(viewer.id, "viewer"),
    },
  };
}

async function cleanup() {
  await prisma.adminSession.deleteMany({
    where: { user: { email: { in: Object.values(userEmails) } } },
  });
  await prisma.adminUser.deleteMany({
    where: { email: { in: Object.values(userEmails) } },
  });
  await prisma.deviceOutletAccess.deleteMany({
    where: { OR: [{ outletId: outletAId }, { outletId: outletBId }] },
  });
  await prisma.device.deleteMany({ where: { name: { startsWith: runId } } });
  await prisma.order.deleteMany({
    where: { orderNumber: { startsWith: runId } },
  });
  await prisma.menuItem.deleteMany({
    where: { id: { in: [itemAId, itemPremiumId, itemBId] } },
  });
  await prisma.category.deleteMany({
    where: { id: { in: [categoryAId, categoryBId] } },
  });
  await prisma.outlet.deleteMany({
    where: { id: { in: [outletAId, outletBId] } },
  });
}

async function assertNoSmokeRowsRemain() {
  const [outlets, orders, devices, users] = await Promise.all([
    prisma.outlet.count({ where: { id: { startsWith: runId } } }),
    prisma.order.count({ where: { orderNumber: { startsWith: runId } } }),
    prisma.device.count({ where: { name: { startsWith: runId } } }),
    prisma.adminUser.count({
      where: { email: { in: Object.values(userEmails) } },
    }),
  ]);
  assert.equal(outlets, 0, "Smoke cleanup left outlet rows behind.");
  assert.equal(orders, 0, "Smoke cleanup left order rows behind.");
  assert.equal(devices, 0, "Smoke cleanup left device rows behind.");
  assert.equal(users, 0, "Smoke cleanup left admin user rows behind.");
}

async function newAdminPage({
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
  await page.goto("/admin", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("admin-shell-header")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("Hero KPIs")).toBeVisible();
  return { context, page };
}

async function expectNav(page: Page, nav: string, visible: boolean) {
  const locator = page.getByTestId(`admin-nav-${nav}`);
  if (visible) {
    await expect(locator).toHaveCount(1);
    await expect(locator).toBeVisible();
  } else {
    await expect(locator).toHaveCount(0);
  }
}

async function expectMetric(page: Page, metric: string, visible: boolean) {
  const locator = page.getByTestId(`dashboard-metric-${metric}`);
  if (visible) {
    await expect(locator).toHaveCount(1);
    await expect(locator).toBeVisible();
  } else {
    await expect(locator).toHaveCount(0);
  }
}

async function expectChromeBase(page: Page, role: string, outletName = outletAName) {
  await expect(page.getByTestId("admin-active-outlet")).toContainText(outletName);
  await expect(page.getByTestId("admin-version-pill")).toHaveText("V1");
  await expect(page.getByTestId("admin-role-pill")).toHaveText(role);
  await expect(page.getByTestId("admin-user-pill")).toContainText(role);
  await expect(page.getByTestId("admin-attention-pill")).toBeVisible();
}

async function assertNoHorizontalOverflow(page: Page, label: string) {
  const metrics = await page.evaluate(() => {
    const doc = document.documentElement;
    const header = document.querySelector<HTMLElement>(
      '[data-testid="admin-shell-header"]',
    );
    const offenders = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="admin-shell-header"] *'),
    )
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          (rect.left < -1 || rect.right > window.innerWidth + 1)
        );
      })
      .slice(0, 5)
      .map((element) => ({
        testId: element.getAttribute("data-testid"),
        text: element.textContent?.trim().slice(0, 80) ?? "",
        left: Math.round(element.getBoundingClientRect().left),
        right: Math.round(element.getBoundingClientRect().right),
      }));

    return {
      viewportWidth: window.innerWidth,
      pageOverflow: doc.scrollWidth - doc.clientWidth,
      headerOverflow: header ? header.scrollWidth - header.clientWidth : 0,
      offenders,
    };
  });

  assert(
    metrics.pageOverflow <= 2,
    `${label}: page has horizontal overflow ${JSON.stringify(metrics)}`,
  );
  assert(
    metrics.headerOverflow <= 2,
    `${label}: admin header has horizontal overflow ${JSON.stringify(metrics)}`,
  );
  assert.deepEqual(
    metrics.offenders,
    [],
    `${label}: header elements overflow viewport`,
  );
}

async function assertOwnerDashboard(page: Page) {
  await expectChromeBase(page, "OWNER");
  await expectNav(page, "dashboard", true);
  await expectNav(page, "orders", true);
  await expectNav(page, "menu", true);
  await expectNav(page, "devices", true);
  await expectNav(page, "users", true);
  await expectMetric(page, "net-sales", true);
  await expectMetric(page, "average-ticket", true);
  await expectMetric(page, "orders", true);
  await expectMetric(page, "active-orders", true);
  await expect(page.getByTestId("dashboard-operations")).toContainText(
    "Active orders by status",
  );
  await expect(page.getByTestId("dashboard-device-health")).toContainText(
    "Connected devices",
  );
  await expect(page.getByTestId("dashboard-operations")).toContainText(
    `Counter POS: ${runId} counter`,
  );
  await expect(page.getByTestId("dashboard-operations")).toContainText(
    `Kitchen display: ${runId} kitchen`,
  );
  await expect(page.getByTestId("dashboard-operations")).toContainText(
    `Pickup board: ${runId} board`,
  );
  await expect(page.getByRole("link", { name: "Manage devices" })).toBeVisible();
  await expect(page.getByText(`${runId} online`)).toBeVisible();
  await expect(page.getByText(`${runId} other outlet device`)).toHaveCount(0);
  await expect(page.getByTestId("dashboard-device-detail")).toHaveCount(0);
  const onlineDeviceTile = page.getByTestId(
    `dashboard-device-tile-${deviceOnlineId}`,
  );
  await expect(onlineDeviceTile).toHaveAttribute("aria-expanded", "false");
  await onlineDeviceTile.click();
  const deviceDetail = page.getByTestId("dashboard-device-detail");
  await expect(deviceDetail).toBeVisible();
  await expect(onlineDeviceTile).toHaveAttribute("aria-expanded", "true");
  await expect(deviceDetail).toContainText(`${runId} online`);
  await expect(deviceDetail).toContainText("Kiosk ordering");
  await expect(deviceDetail).toContainText("1 active session");
  await expect(deviceDetail).toContainText("Active operator");
  await expect(deviceDetail).toContainText("Dash Smoke Manager");
  await expect(deviceDetail).toContainText("Manager");
  await expect(deviceDetail).toContainText("East kiosk bank");
  await expect(deviceDetail.getByRole("button", { name: "Ping" })).toHaveCount(0);
  await expect(
    deviceDetail.getByRole("button", { name: "Restart device" }),
  ).toHaveCount(0);
  await deviceDetail.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("dashboard-device-detail")).toHaveCount(0);
  await expect(onlineDeviceTile).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("Top by sales")).toBeVisible();
  await expect(page.getByTestId("dashboard-operation-preview")).toHaveCount(0);
  const awaitingBucket = page.getByTestId(
    "dashboard-operation-bucket-awaitingCounterPayment",
  );
  await expect(awaitingBucket).toHaveAttribute("aria-expanded", "false");
  await awaitingBucket.click();
  const preview = page.getByTestId("dashboard-operation-preview");
  await expect(preview).toBeVisible();
  await expect(awaitingBucket).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("dashboard-operation-preview-row")).not.toHaveCount(0);
  await preview.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("dashboard-operation-preview")).toHaveCount(0);
  await expect(awaitingBucket).toHaveAttribute("aria-expanded", "false");
}

async function assertManagerDashboard(page: Page) {
  await expectChromeBase(page, "MANAGER");
  await expectNav(page, "dashboard", true);
  await expectNav(page, "orders", true);
  await expectNav(page, "menu", true);
  await expectNav(page, "devices", false);
  await expectNav(page, "users", false);
  await expectMetric(page, "net-sales", true);
  await expectMetric(page, "average-ticket", true);
  await expect(page.getByTestId("dashboard-device-health")).toContainText(
    "Connected devices",
  );
  await expect(page.getByTestId("dashboard-operations")).toContainText(
    `Counter POS: ${runId} counter`,
  );
  await expect(page.getByTestId("dashboard-operations")).toContainText(
    `Kitchen display: ${runId} kitchen`,
  );
  await expect(page.getByTestId("dashboard-operations")).toContainText(
    `Pickup board: ${runId} board`,
  );
  await expect(page.getByText(`${runId} online`)).toBeVisible();
  await expect(page.getByText(`${runId} other outlet device`)).toHaveCount(0);
  await expect(
    page.getByTestId(`dashboard-device-tile-${deviceOnlineId}`),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Manage devices" })).toHaveCount(0);
}

async function assertOperatorDashboard(page: Page) {
  await expectChromeBase(page, "OPERATOR");
  await expectNav(page, "dashboard", true);
  await expectNav(page, "orders", true);
  await expectNav(page, "menu", false);
  await expectNav(page, "devices", false);
  await expectNav(page, "users", false);
  await expectMetric(page, "net-sales", false);
  await expectMetric(page, "average-ticket", false);
  await expectMetric(page, "cash-due", false);
  await expectMetric(page, "orders", true);
  await expectMetric(page, "active-orders", true);
  await expect(page.getByText("Top by sales")).toHaveCount(0);
  await expect(page.getByTestId("dashboard-operations")).toContainText(
    "Active orders by status",
  );
  await expect(page.getByTestId("dashboard-operations")).toContainText(
    "Kitchen display",
  );
  await expect(page.getByTestId("dashboard-operations")).not.toContainText(
    `${runId} kitchen`,
  );
  await expect(page.getByTestId("dashboard-operations")).not.toContainText(
    `${runId} counter`,
  );
  await expect(page.getByTestId("dashboard-operations")).not.toContainText(
    `${runId} board`,
  );
  await expect(page.getByTestId("dashboard-device-health")).toContainText(
    "Device health hidden",
  );
  await expect(page.getByText(`${runId} online`)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Manage devices" })).toHaveCount(0);
}

async function assertViewerDashboard(page: Page) {
  await expectChromeBase(page, "VIEWER");
  await expectNav(page, "dashboard", true);
  await expectNav(page, "orders", true);
  await expectNav(page, "menu", true);
  await expectNav(page, "devices", false);
  await expectNav(page, "users", false);
  await expectMetric(page, "net-sales", false);
  await expectMetric(page, "average-ticket", false);
  await expect(page.getByText("Top by sales")).toHaveCount(0);
  await expect(page.getByTestId("dashboard-operations")).toContainText(
    "Active orders by status",
  );
  await expect(page.getByTestId("dashboard-device-health")).toContainText(
    "Device health hidden",
  );
  await expect(page.getByText(`${runId} online`)).toHaveCount(0);
}

async function assertDashboardOrderDeepLink(browser: Browser, token: string) {
  const { context, page } = await newAdminPage({
    browser,
    token,
    viewport: { width: 1440, height: 950 },
  });
  try {
    const awaitingBucket = page.getByTestId(
      "dashboard-operation-bucket-awaitingCounterPayment",
    );
    await awaitingBucket.click();
    const previewRow = page.getByTestId("dashboard-operation-preview-row").first();
    const orderLink = previewRow.getByRole("link", { name: "Open in Orders" });
    await expect(orderLink).toHaveAttribute(
      "href",
      /\/admin\/orders\?status=AWAITING_COUNTER_PAYMENT&order=/,
    );
    await orderLink.click();
    await page.waitForURL(/\/admin\/orders\?.*order=/);
    assert(
      page.url().includes("status=AWAITING_COUNTER_PAYMENT"),
      "Dashboard order deep link should preserve the source status bucket.",
    );
    await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();
    const targetRow = page.getByTestId("orders-target-row");
    await expect(targetRow).toHaveCount(1);
    await expect(targetRow).toBeVisible();
    await expect(targetRow).toHaveAttribute("aria-current", "true");
    await expect(targetRow).toContainText(`${runId}-cash`);
    await expect(targetRow).toContainText("Dashboard Smoke Burger");
  } finally {
    await context.close();
  }
}

async function runRoleSmoke({
  browser,
  role,
  token,
  assertDashboard,
}: {
  browser: Browser;
  role: RoleKey;
  token: string;
  assertDashboard: (page: Page) => Promise<void>;
}) {
  for (const viewport of [
    { width: 1440, height: 950 },
    { width: 820, height: 1180 },
  ]) {
    const { context, page } = await newAdminPage({
      browser,
      token,
      viewport,
    });
    try {
      await assertDashboard(page);
      await assertNoHorizontalOverflow(
        page,
        `${role} ${viewport.width}x${viewport.height}`,
      );
    } finally {
      await context.close();
    }
  }
}

async function main() {
  await assertServerReachable();
  await cleanup();
  const fixture = await seedFixture();
  const browser = await launchSmokeBrowser();

  try {
    await runRoleSmoke({
      browser,
      role: "owner",
      token: fixture.tokens.owner,
      assertDashboard: assertOwnerDashboard,
    });
    console.log("- owner browser smoke passed");

    await assertDashboardOrderDeepLink(browser, fixture.tokens.owner);
    console.log("- order deep-link highlight browser smoke passed");

    await runRoleSmoke({
      browser,
      role: "manager",
      token: fixture.tokens.manager,
      assertDashboard: assertManagerDashboard,
    });
    console.log("- manager browser smoke passed");

    await runRoleSmoke({
      browser,
      role: "operator",
      token: fixture.tokens.operator,
      assertDashboard: assertOperatorDashboard,
    });
    console.log("- operator browser smoke passed");

    await runRoleSmoke({
      browser,
      role: "viewer",
      token: fixture.tokens.viewer,
      assertDashboard: assertViewerDashboard,
    });
    console.log("- viewer browser smoke passed");

    const { context, page } = await newAdminPage({
      browser,
      token: fixture.tokens.operator,
      activeOutletId: outletBId,
      viewport: { width: 1024, height: 900 },
    });
    try {
      await expectChromeBase(page, "OPERATOR", outletAName);
      await expect(page.getByText(outletBName)).toHaveCount(0);
      await assertNoHorizontalOverflow(page, "operator stale active outlet");
      console.log("- stale active-outlet cookie browser smoke passed");
    } finally {
      await context.close();
    }

    console.log("Admin dashboard browser smoke passed.");
  } finally {
    await browser.close();
  }
}

main()
  .catch((error) => {
    console.error("Admin dashboard browser smoke failed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((error) => {
      console.error("Admin dashboard browser smoke cleanup failed.");
      console.error(error);
      process.exitCode = 1;
    });
    await assertNoSmokeRowsRemain().catch((error) => {
      console.error("Admin dashboard browser smoke cleanup assertion failed.");
      console.error(error);
      process.exitCode = 1;
    });
    await prisma.$disconnect();
  });
