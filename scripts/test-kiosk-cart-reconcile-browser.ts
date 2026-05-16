import "dotenv/config";

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { chromium, expect, type Page } from "@playwright/test";
import {
  buildDatabaseDeviceSessionValue,
  DEVICE_SESSION_COOKIE,
} from "@/lib/device-auth";
import { prisma } from "@/lib/db";
import { DEFAULT_SITE_ID } from "@/lib/outlets";
import { bumpOutletMenuVersion } from "@/lib/outlet-menu-sync";

const baseUrl =
  process.env.KIOSK_BROWSER_BASE_URL ??
  process.env.BROWSER_BASE_URL ??
  "http://127.0.0.1:3001";
const runId = `kiosk-cart-reconcile-browser-${Date.now()}`;
const shortRunId = String(Date.now()).slice(-6);
const outletId = `outlet-${runId}`;
const categoryId = `category-burgers-${runId}`;
const dealsCategoryId = `category-deals-${runId}`;
const baseItemId = `item-base-${runId}`;
const linkedItemId = `item-linked-${runId}`;
const dealItemId = `item-deal-${runId}`;
const upgradeOptionId = `upgrade-option-${runId}`;
const deviceId = `device-${runId}`;
const baseItemName = `Browser Base Burger ${shortRunId}`;
const linkedItemName = `Browser Side ${shortRunId}`;
const dealName = `Browser Limited Deal ${shortRunId}`;

function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

function hashSessionToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function assertServerReachable() {
  try {
    const response = await fetch(baseUrl, { redirect: "manual" });
    assert(
      response.status > 0,
      `Kiosk cart reconcile browser test could not reach ${baseUrl}.`
    );
  } catch (err) {
    throw new Error(
      `Kiosk cart reconcile browser test requires an already-running Next server at ${baseUrl}. ` +
        `Start it first, or set KIOSK_BROWSER_BASE_URL to the correct URL. ` +
        `Original error: ${(err as Error).message}`
    );
  }
}

async function seed() {
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
      name: `Kiosk cart reconcile browser ${runId}`,
      slug: outletId,
      orderPrefix: `R${String(Date.now()).slice(-6)}`,
      isActive: true,
    },
  });

  await prisma.category.createMany({
    data: [
      {
        id: categoryId,
        outletId,
        slug: `browser-burgers-${runId}`,
        name: "Burgers",
        icon: "🍔",
        sortOrder: 0,
        isActive: true,
      },
      {
        id: dealsCategoryId,
        outletId,
        slug: "deals",
        name: "Deals",
        icon: "🔥",
        sortOrder: 1,
        isActive: true,
      },
    ],
  });

  await prisma.menuItem.createMany({
    data: [
      {
        id: baseItemId,
        outletId,
        categoryId,
        name: baseItemName,
        description: "Base item for kiosk cart reconcile browser test",
        price: 10,
        emoji: "🍔",
        bgColor: "#FFE3E0",
        sortOrder: 0,
        isActive: true,
        isOutOfStock: false,
      },
      {
        id: linkedItemId,
        outletId,
        categoryId,
        name: linkedItemName,
        description: "Linked item for kiosk cart reconcile browser test",
        price: 4,
        emoji: "🍟",
        bgColor: "#FFF3BF",
        sortOrder: 1,
        isActive: true,
        isOutOfStock: false,
      },
      {
        id: dealItemId,
        outletId,
        categoryId: dealsCategoryId,
        dealBaseMenuItemId: baseItemId,
        dealStartsAt: new Date(Date.now() - 60 * 1000),
        dealExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        dealLimitMode: "LIMITED",
        dealLimitQty: 2,
        dealLimitLowThreshold: 1,
        name: dealName,
        description: "Limited deal for kiosk cart reconcile browser test",
        price: 12,
        emoji: "🍔",
        bgColor: "#FFF3BF",
        badge: "DEAL",
        sortOrder: 0,
        isActive: true,
        isOutOfStock: false,
      },
    ],
  });

  await prisma.upgradeOption.create({
    data: {
      id: upgradeOptionId,
      itemId: dealItemId,
      customTitle: "Deal option",
      extraCharge: 1,
      savingsLabel: 1,
      sortOrder: 0,
      linkedItems: {
        create: [
          {
            linkedMenuItemId: linkedItemId,
            itemNameSnapshot: linkedItemName,
            sortOrder: 0,
          },
        ],
      },
    },
  });

  await prisma.device.create({
    data: {
      id: deviceId,
      siteId: DEFAULT_SITE_ID,
      outletId,
      name: `Kiosk cart reconcile browser test ${runId}`,
      role: "kiosk",
      secretHash: "unused",
      isActive: true,
    },
  });

  const token = createSessionToken();
  await prisma.deviceSession.create({
    data: {
      deviceId,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  return buildDatabaseDeviceSessionValue("kiosk", token);
}

async function cleanup() {
  await prisma.paymentTransaction.deleteMany({ where: { outletId } });
  await prisma.stockMovement.deleteMany({ where: { outletId } });
  await prisma.order.deleteMany({ where: { outletId } });
  await prisma.deviceSession.deleteMany({ where: { deviceId } });
  await prisma.deviceOutletAccess.deleteMany({ where: { deviceId } });
  await prisma.device.deleteMany({ where: { id: deviceId } });
  await prisma.upgradeItemLink.deleteMany({
    where: {
      OR: [
        { upgradeOptionId },
        { linkedMenuItemId: { in: [baseItemId, linkedItemId, dealItemId] } },
      ],
    },
  });
  await prisma.upgradeOption.deleteMany({
    where: {
      OR: [{ id: upgradeOptionId }, { itemId: dealItemId }],
    },
  });
  await prisma.addonOption.deleteMany({
    where: { itemId: { in: [baseItemId, linkedItemId, dealItemId] } },
  });
  await prisma.sizeOption.deleteMany({
    where: { itemId: { in: [baseItemId, linkedItemId, dealItemId] } },
  });
  await prisma.menuItemModifierGroupAttachmentHistory.deleteMany({
    where: { outletId },
  });
  await prisma.menuItemModifierGroup.deleteMany({ where: { outletId } });
  await prisma.menuItem.deleteMany({
    where: { id: { in: [dealItemId, baseItemId, linkedItemId] } },
  });
  await prisma.sharedModifierGroup.deleteMany({ where: { outletId } });
  await prisma.category.deleteMany({
    where: { id: { in: [categoryId, dealsCategoryId] } },
  });
  await prisma.menuHistoryState.deleteMany({ where: { outletId } });
  await prisma.menuRevision.deleteMany({ where: { outletId } });
  await prisma.menuAuditLog.deleteMany({ where: { outletId } });
  await prisma.outletMenuVersion.deleteMany({ where: { outletId } });
  await prisma.outletOrderVersion.deleteMany({ where: { outletId } });
  await prisma.outletDailyOrderSequence.deleteMany({ where: { outletId } });
  await prisma.outlet.deleteMany({ where: { id: outletId } });
}

async function bumpAfterMenuMutation(
  mutation: (tx: Prisma.TransactionClient) => Promise<unknown>
) {
  await prisma.$transaction(async (tx) => {
    await mutation(tx);
    await bumpOutletMenuVersion(tx, outletId);
  });
}

async function promptKioskMenuRefresh(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}

async function expectPayNowDisabled(page: Page) {
  await expect(page.getByRole("button", { name: /pay now/i })).toBeDisabled();
}

async function expectPayNowEnabled(page: Page) {
  await expect(page.getByRole("button", { name: /pay now/i })).toBeEnabled();
}

async function main() {
  await assertServerReachable();
  await cleanup();
  const cookieValue = await seed();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: baseUrl });
  await context.addCookies([
    {
      name: DEVICE_SESSION_COOKIE,
      value: cookieValue,
      url: baseUrl,
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);

  const page = await context.newPage();

  try {
    await page.goto("/kiosk", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /tap to order/i }).click({ force: true });
    await page.getByRole("button", { name: /takeout/i }).click();
    await page.getByRole("button", { name: "Category Deals" }).click();
    await page
      .getByRole("button", { name: new RegExp(`Add ${escapeRegExp(dealName)}`) })
      .click();
    await expect(page.getByRole("heading", { name: dealName })).toBeVisible();
    await page.getByRole("button", { name: /add to order/i }).click();
    await page.getByRole("button", { name: /checkout/i }).click();
    await expect(page.getByText("REVIEW YOUR ORDER")).toBeVisible();
    await expect(page.getByText(dealName)).toBeVisible();

    await page.getByRole("button", { name: "Increase quantity" }).click();
    await expect(page.getByText(dealName)).toBeVisible();

    await bumpAfterMenuMutation((tx) =>
      tx.menuItem.update({
        where: { id: dealItemId },
        data: { dealLimitQty: 1 },
      })
    );
    await promptKioskMenuRefresh(page);

    const lowerQuantityNotice = `Only 1 left for ${dealName}. Lower the quantity from 2 before paying.`;
    const lineQuantityNotice = `Only 1 left for ${dealName}. You have 2 in your order.`;
    await expect(page.getByText(lowerQuantityNotice, { exact: true })).toBeVisible({
      timeout: 8_000,
    });
    await expect(page.getByText(lineQuantityNotice, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Reduce$/i })).toBeVisible();
    await expectPayNowDisabled(page);

    await page.getByRole("button", { name: /^Reduce$/i }).click();
    await expect(page.getByText(lowerQuantityNotice, { exact: true })).toHaveCount(0);
    await expect(page.getByText(lineQuantityNotice, { exact: true })).toHaveCount(0);
    await expectPayNowEnabled(page);

    await bumpAfterMenuMutation((tx) =>
      tx.menuItem.update({
        where: { id: dealItemId },
        data: { isActive: false },
      })
    );
    await promptKioskMenuRefresh(page);

    const unavailableNotice = `${dealName} is no longer available. Remove it before paying.`;
    await expect(page.getByText(unavailableNotice, { exact: true }).first()).toBeVisible({
      timeout: 8_000,
    });
    await expect(page.getByRole("button", { name: /^Remove$/i })).toBeVisible();
    await expectPayNowDisabled(page);

    await bumpAfterMenuMutation((tx) =>
      tx.menuItem.update({
        where: { id: dealItemId },
        data: { isActive: true, dealLimitQty: 2 },
      })
    );
    await promptKioskMenuRefresh(page);

    await expect(page.getByText(unavailableNotice, { exact: true })).toHaveCount(0, {
      timeout: 8_000,
    });
    await expect(page.getByRole("button", { name: /^Remove$/i })).toHaveCount(0);
    await expectPayNowEnabled(page);

    await bumpAfterMenuMutation((tx) =>
      tx.menuItem.update({
        where: { id: dealItemId },
        data: { isActive: false },
      })
    );
    await promptKioskMenuRefresh(page);
    await expect(page.getByText(unavailableNotice, { exact: true }).first()).toBeVisible({
      timeout: 8_000,
    });
    await page.getByRole("button", { name: /^Remove$/i }).click();
    await expect(page.getByText(unavailableNotice, { exact: true })).toHaveCount(0);
    await expect(page.getByText(dealName)).toHaveCount(0);

    console.log("Kiosk cart reconcile browser regression test passed.");
  } finally {
    await browser.close();
  }
}

main()
  .catch((err) => {
    console.error("Kiosk cart reconcile browser regression test failed.");
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch(() => {});
    await prisma.$disconnect();
  });
