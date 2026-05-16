/* eslint-disable no-console */
import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";

function assertDevResetAllowed() {
  if (process.env.ALLOW_DEV_DATA_RESET !== "1") {
    throw new Error(
      "Refusing to delete data without ALLOW_DEV_DATA_RESET=1.",
    );
  }

  const databaseUrl = process.env.DATABASE_URL ?? "";
  const lowerUrl = databaseUrl.toLowerCase();
  const productionLike =
    process.env.NODE_ENV === "production" ||
    lowerUrl.includes("prod") ||
    lowerUrl.includes("production");
  if (productionLike) {
    throw new Error("Refusing to run against a production-looking database.");
  }
}

function backupReplacer(_key: string, value: unknown) {
  if (value && typeof value === "object" && "toString" in value) {
    const constructorName = value.constructor?.name;
    if (constructorName === "Decimal") return value.toString();
  }
  return value;
}

async function main() {
  assertDevResetAllowed();

  const dealCategories = await prisma.category.findMany({
    where: { slug: "deals" },
    select: { id: true, outletId: true, slug: true, name: true },
    orderBy: [{ outletId: "asc" }, { sortOrder: "asc" }],
  });

  if (dealCategories.length === 0) {
    console.log("No Deals categories found. Nothing deleted.");
    return;
  }

  const dealCategoryIds = dealCategories.map((category) => category.id);
  const dealItems = await prisma.menuItem.findMany({
    where: { categoryId: { in: dealCategoryIds } },
    include: {
      category: true,
      sizes: true,
      addons: true,
      modifierGroupLinks: { include: { optionOverrides: true } },
      upgradeOptions: { include: { linkedItems: true } },
    },
    orderBy: [{ outletId: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });

  if (dealItems.length === 0) {
    console.log(
      `Found ${dealCategories.length} Deals categor${
        dealCategories.length === 1 ? "y" : "ies"
      }, but no deal-category items. Nothing deleted.`,
    );
    return;
  }

  const dealItemIds = dealItems.map((item) => item.id);
  const orderItemCount = await prisma.orderItem.count({
    where: { menuItemId: { in: dealItemIds } },
  });
  if (orderItemCount > 0) {
    throw new Error(
      `Refusing to delete ${dealItems.length} deal item(s): ${orderItemCount} order item(s) still reference them. ` +
        "Clear orders first or add a purpose-built order cleanup step.",
    );
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(
    process.cwd(),
    "docs",
    "backups",
    `deal-category-items-${timestamp}`,
  );
  await mkdir(backupDir, { recursive: true });
  await writeFile(
    path.join(backupDir, "deal-category-items.json"),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        deletedCategoryIds: dealCategoryIds,
        categoriesPreserved: dealCategories,
        itemCount: dealItems.length,
        items: dealItems,
      },
      backupReplacer,
      2,
    ),
  );

  const deleted = await prisma.menuItem.deleteMany({
    where: { id: { in: dealItemIds } },
  });

  const remainingCategories = await prisma.category.count({
    where: { id: { in: dealCategoryIds } },
  });
  console.log(`Backed up ${dealItems.length} deal item(s) to ${backupDir}`);
  console.log(`Deleted ${deleted.count} deal-category item(s).`);
  console.log(`Preserved ${remainingCategories} Deals categor${
    remainingCategories === 1 ? "y" : "ies"
  }.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
