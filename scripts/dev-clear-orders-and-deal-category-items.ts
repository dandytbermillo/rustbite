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

  const [orders, dealCategories] = await Promise.all([
    prisma.order.findMany({
      include: {
        items: true,
        paymentTransaction: true,
        stockMovements: true,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.category.findMany({
      where: { slug: "deals" },
      select: { id: true, outletId: true, slug: true, name: true },
      orderBy: [{ outletId: "asc" }, { sortOrder: "asc" }],
    }),
  ]);

  const dealCategoryIds = dealCategories.map((category) => category.id);
  const dealItems = dealCategoryIds.length
    ? await prisma.menuItem.findMany({
        where: { categoryId: { in: dealCategoryIds } },
        include: {
          category: true,
          sizes: true,
          addons: true,
          modifierGroupLinks: { include: { optionOverrides: true } },
          upgradeOptions: { include: { linkedItems: true } },
        },
        orderBy: [{ outletId: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      })
    : [];

  if (orders.length === 0 && dealItems.length === 0) {
    console.log("No orders or deal-category items found. Nothing deleted.");
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(
    process.cwd(),
    "docs",
    "backups",
    `orders-and-deal-category-items-${timestamp}`,
  );
  await mkdir(backupDir, { recursive: true });
  await writeFile(
    path.join(backupDir, "orders-and-deal-category-items.json"),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        orders,
        dealCategoriesPreserved: dealCategories,
        dealItems,
      },
      backupReplacer,
      2,
    ),
  );

  const orderIds = orders.map((order) => order.id);
  const dealItemIds = dealItems.map((item) => item.id);
  const orderItemCount = orders.reduce(
    (sum, order) => sum + order.items.length,
    0,
  );

  const deleted = await prisma.$transaction(async (tx) => {
    const paymentTransactions = orderIds.length
      ? await tx.paymentTransaction.deleteMany({
          where: { orderId: { in: orderIds } },
        })
      : { count: 0 };
    const stockMovements = orderIds.length
      ? await tx.stockMovement.deleteMany({
          where: { orderId: { in: orderIds } },
        })
      : { count: 0 };
    const ordersDeleted = orderIds.length
      ? await tx.order.deleteMany({ where: { id: { in: orderIds } } })
      : { count: 0 };
    const dealItemsDeleted = dealItemIds.length
      ? await tx.menuItem.deleteMany({ where: { id: { in: dealItemIds } } })
      : { count: 0 };

    return {
      paymentTransactions: paymentTransactions.count,
      stockMovements: stockMovements.count,
      orders: ordersDeleted.count,
      dealItems: dealItemsDeleted.count,
    };
  });

  const remainingDealCategories = await prisma.category.count({
    where: { id: { in: dealCategoryIds } },
  });

  console.log(`Backup written to ${backupDir}`);
  console.log(
    `Deleted ${deleted.orders} order(s), ${orderItemCount} order item(s), ` +
      `${deleted.paymentTransactions} payment transaction(s), and ` +
      `${deleted.stockMovements} order-linked stock movement(s).`,
  );
  console.log(`Deleted ${deleted.dealItems} deal-category item(s).`);
  console.log(
    `Preserved ${remainingDealCategories} Deals categor${
      remainingDealCategories === 1 ? "y" : "ies"
    }.`,
  );
  console.log(
    "Note: menu item/add-on stock quantities were not reset; only order records and order-linked stock movement rows were cleared.",
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
