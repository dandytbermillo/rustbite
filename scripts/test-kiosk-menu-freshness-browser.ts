import "dotenv/config";

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { chromium, expect } from "@playwright/test";
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
const runId = `kiosk-fresh-browser-${Date.now()}`;
const outletId = `outlet-${runId}`;
const categoryId = `category-${runId}`;
const selectedItemId = `item-selected-${runId}`;
const unrelatedItemId = `item-unrelated-${runId}`;
const deviceId = `device-${runId}`;
const selectedItemName = `Browser Fresh Burger ${Date.now()}`;
const unrelatedItemName = `Browser Fresh Fries ${Date.now()}`;
const pickAgainMessage = "Menu changed. Please pick this item again.";

function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

function hashSessionToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

async function assertServerReachable() {
  try {
    const response = await fetch(baseUrl, { redirect: "manual" });
    assert(
      response.status > 0,
      `Browser freshness test could not reach ${baseUrl}.`
    );
  } catch (err) {
    throw new Error(
      `Browser freshness test requires an already-running Next server at ${baseUrl}. ` +
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
      name: `Kiosk browser freshness ${runId}`,
      slug: outletId,
      orderPrefix: `B${String(Date.now()).slice(-6)}`,
      isActive: true,
    },
  });

  await prisma.category.create({
    data: {
      id: categoryId,
      outletId,
      slug: `browser-burgers-${runId}`,
      name: "Burgers",
      icon: "burger",
      sortOrder: 0,
      isActive: true,
    },
  });

  await prisma.menuItem.createMany({
    data: [
      {
        id: selectedItemId,
        outletId,
        categoryId,
        name: selectedItemName,
        description: "Selected item for kiosk browser freshness test",
        price: 10,
        emoji: "burger",
        bgColor: "#FFF3BF",
        sortOrder: 0,
        isActive: true,
        isOutOfStock: false,
      },
      {
        id: unrelatedItemId,
        outletId,
        categoryId,
        name: unrelatedItemName,
        description: "Unrelated item for kiosk browser freshness test",
        price: 3,
        emoji: "fries",
        bgColor: "#FFF3BF",
        sortOrder: 1,
        isActive: true,
        isOutOfStock: false,
      },
    ],
  });

  await prisma.device.create({
    data: {
      id: deviceId,
      siteId: DEFAULT_SITE_ID,
      outletId,
      name: `Kiosk browser test ${runId}`,
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
  await prisma.deviceSession.deleteMany({ where: { deviceId } });
  await prisma.deviceOutletAccess.deleteMany({ where: { deviceId } });
  await prisma.device.deleteMany({ where: { id: deviceId } });
  await prisma.addonOption.deleteMany({
    where: { itemId: { in: [selectedItemId, unrelatedItemId] } },
  });
  await prisma.sizeOption.deleteMany({
    where: { itemId: { in: [selectedItemId, unrelatedItemId] } },
  });
  await prisma.upgradeItemLink.deleteMany({
    where: {
      OR: [
        { linkedMenuItemId: { in: [selectedItemId, unrelatedItemId] } },
        { upgradeOption: { itemId: { in: [selectedItemId, unrelatedItemId] } } },
      ],
    },
  });
  await prisma.upgradeOption.deleteMany({
    where: { itemId: { in: [selectedItemId, unrelatedItemId] } },
  });
  await prisma.menuItem.deleteMany({
    where: { id: { in: [selectedItemId, unrelatedItemId] } },
  });
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.menuHistoryState.deleteMany({ where: { outletId } });
  await prisma.menuRevision.deleteMany({ where: { outletId } });
  await prisma.menuAuditLog.deleteMany({ where: { outletId } });
  await prisma.outletMenuVersion.deleteMany({ where: { outletId } });
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
    await page.getByRole("button", { name: /tap to order/i }).click();
    await page.getByRole("button", { name: /takeout/i }).click();
    await page.getByRole("button", { name: new RegExp(`Add ${selectedItemName}`) }).click();
    await expect(page.getByRole("heading", { name: selectedItemName })).toBeVisible();
    await expect(page.getByRole("button", { name: /add to order/i })).toBeVisible();

    await bumpAfterMenuMutation((tx) =>
      tx.menuItem.update({
        where: { id: unrelatedItemId },
        data: { description: "Unrelated menu change should not close customize" },
      })
    );

    await page.waitForTimeout(3_000);
    await expect(page.getByRole("heading", { name: selectedItemName })).toBeVisible();
    await expect(page.getByRole("button", { name: /add to order/i })).toBeVisible();
    await expect(page.getByText(pickAgainMessage)).toHaveCount(0);

    await bumpAfterMenuMutation((tx) =>
      tx.menuItem.update({
        where: { id: selectedItemId },
        data: { isOutOfStock: true },
      })
    );

    await expect(page.getByText(pickAgainMessage)).toBeVisible({ timeout: 6_000 });
    await expect(page.getByRole("button", { name: /add to order/i })).toHaveCount(0);

    console.log("Kiosk browser freshness test passed.");
  } finally {
    await browser.close();
  }
}

main()
  .catch((err) => {
    console.error("Kiosk browser freshness test failed.");
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch(() => {});
    await prisma.$disconnect();
  });
