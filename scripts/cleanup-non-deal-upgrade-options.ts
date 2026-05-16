/* eslint-disable no-console */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const execute = process.argv.includes("--execute");

type LegacyUpgradeRow = {
  upgradeOptionId: string;
  parentItemId: string;
  parentItemName: string;
  categoryName: string;
  categorySlug: string;
  outletId: string;
  outletName: string;
  linkedItemCount: bigint;
  linkedItemNames: string | null;
  orderSnapshotCount: bigint;
};

function formatCount(value: bigint | number | null | undefined): number {
  return Number(value ?? 0);
}

async function findLegacyRows(): Promise<LegacyUpgradeRow[]> {
  return prisma.$queryRaw<LegacyUpgradeRow[]>`
    SELECT
      u.id AS "upgradeOptionId",
      parent.id AS "parentItemId",
      parent.name AS "parentItemName",
      category.name AS "categoryName",
      category.slug AS "categorySlug",
      outlet.id AS "outletId",
      outlet.name AS "outletName",
      COUNT(link.id)::bigint AS "linkedItemCount",
      STRING_AGG(
        COALESCE(linked.name, link."itemNameSnapshot", '(missing item)'),
        ' + '
        ORDER BY link."sortOrder" ASC
      ) AS "linkedItemNames",
      COUNT(DISTINCT order_item.id)::bigint AS "orderSnapshotCount"
    FROM "UpgradeOption" u
    JOIN "MenuItem" parent ON parent.id = u."itemId"
    JOIN "Category" category ON category.id = parent."categoryId"
    JOIN "Outlet" outlet ON outlet.id = parent."outletId"
    LEFT JOIN "UpgradeItemLink" link ON link."upgradeOptionId" = u.id
    LEFT JOIN "MenuItem" linked ON linked.id = link."linkedMenuItemId"
    LEFT JOIN "OrderItem" order_item
      ON order_item."upgradeSnapshotJson"->>'id' = u.id
    WHERE category.slug <> 'deals'
    GROUP BY
      u.id,
      parent.id,
      parent.name,
      category.name,
      category.slug,
      outlet.id,
      outlet.name
    ORDER BY outlet.name, category.name, parent.name, u.id;
  `;
}

async function main() {
  const rows = await findLegacyRows();
  const totalLinkedItems = rows.reduce(
    (sum, row) => sum + formatCount(row.linkedItemCount),
    0
  );
  const totalOrderSnapshots = rows.reduce(
    (sum, row) => sum + formatCount(row.orderSnapshotCount),
    0
  );
  const itemCount = new Set(rows.map((row) => row.parentItemId)).size;

  console.log(
    `${execute ? "EXECUTE" : "DRY RUN"}: found ${rows.length} non-deal upgrade option row(s) on ${itemCount} item(s).`
  );
  console.log(
    `Linked item rows that will cascade-delete: ${totalLinkedItems}. Historical order snapshots referencing these upgrade ids: ${totalOrderSnapshots}.`
  );

  if (rows.length > 0) {
    console.table(
      rows.map((row) => ({
        outlet: row.outletName,
        category: `${row.categoryName} (${row.categorySlug})`,
        item: row.parentItemName,
        upgradeOptionId: row.upgradeOptionId,
        linkedItems: row.linkedItemNames ?? "(none)",
        linkedItemCount: formatCount(row.linkedItemCount),
        orderSnapshots: formatCount(row.orderSnapshotCount),
      }))
    );
  }

  if (!execute) {
    console.log("No rows were deleted. Re-run with --execute to delete these legacy rows.");
    return;
  }

  const ids = rows.map((row) => row.upgradeOptionId);
  if (ids.length === 0) {
    console.log("Nothing to delete.");
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.upgradeItemLink.deleteMany({
      where: { upgradeOptionId: { in: ids } },
    });
    return tx.upgradeOption.deleteMany({
      where: { id: { in: ids } },
    });
  });

  console.log(`Deleted ${result.count} non-deal upgrade option row(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
