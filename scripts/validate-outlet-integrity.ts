import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Violation = {
  check: string;
  rows: unknown[];
};

async function main() {
  const violations: Violation[] = [];

  const missingActiveCafeteriaOutlet = await prisma.$queryRaw`
    SELECT 'cafeteria' AS id
    WHERE NOT EXISTS (
      SELECT 1
      FROM "Outlet"
      WHERE id = 'cafeteria'
        AND "isActive" = true
    )
  `;

  const unexpectedNonCafeteriaOutlets = await prisma.$queryRaw`
    SELECT id, name, slug, "isActive"
    FROM "Outlet"
    WHERE id <> 'cafeteria'
  `;

  const itemCategoryMismatches = await prisma.$queryRaw`
    SELECT
      i.id,
      i.name,
      i."outletId" AS "itemOutletId",
      c.id AS "categoryId",
      c."outletId" AS "categoryOutletId"
    FROM "MenuItem" i
    JOIN "Category" c ON c.id = i."categoryId"
    WHERE i."outletId" <> c."outletId"
  `;

  const upgradeLinkedItemMismatches = await prisma.$queryRaw`
    SELECT
      u.id AS "upgradeOptionId",
      parent.id AS "parentItemId",
      parent.name AS "parentItemName",
      parent."outletId" AS "parentOutletId",
      linked.id AS "linkedItemId",
      linked.name AS "linkedItemName",
      linked."outletId" AS "linkedOutletId"
    FROM "UpgradeOption" u
    JOIN "MenuItem" parent ON parent.id = u."itemId"
    JOIN "UpgradeItemLink" link ON link."upgradeOptionId" = u.id
    JOIN "MenuItem" linked ON linked.id = link."linkedMenuItemId"
    WHERE parent."outletId" <> linked."outletId"
  `;

  const upgradeLinkedSizeMismatches = await prisma.$queryRaw`
    SELECT
      link.id AS "upgradeItemLinkId",
      link."linkedMenuItemId",
      link."linkedSizeId",
      size."itemId" AS "sizeOwnerItemId"
    FROM "UpgradeItemLink" link
    JOIN "SizeOption" size ON size.id = link."linkedSizeId"
    WHERE link."linkedMenuItemId" IS NULL
      OR link."linkedMenuItemId" <> size."itemId"
  `;

  const paymentOrderOutletMismatches = await prisma.$queryRaw`
    SELECT
      payment.id AS "paymentTransactionId",
      payment."outletId" AS "paymentOutletId",
      ord.id AS "orderId",
      ord."outletId" AS "orderOutletId"
    FROM "PaymentTransaction" payment
    JOIN "Order" ord ON ord.id = payment."orderId"
    WHERE payment."outletId" <> ord."outletId"
  `;

  const finalizedPaymentOrderOutletMismatches = await prisma.$queryRaw`
    SELECT
      payment.id AS "paymentTransactionId",
      payment."outletId" AS "paymentOutletId",
      payment."finalizedOrderId",
      ord."outletId" AS "finalizedOrderOutletId"
    FROM "PaymentTransaction" payment
    JOIN "Order" ord ON ord.id = payment."finalizedOrderId"
    WHERE payment."outletId" <> ord."outletId"
  `;

  const menuRevisionCategoryOutletMismatches = await prisma.$queryRaw`
    SELECT
      revision.id AS "menuRevisionId",
      revision."outletId" AS "revisionOutletId",
      category.id AS "categoryId",
      category."outletId" AS "categoryOutletId"
    FROM "MenuRevision" revision
    JOIN "Category" category ON category.id = revision."targetId"
    WHERE revision."targetType" = 'CATEGORY'
      AND revision."outletId" <> category."outletId"
  `;

  const menuRevisionItemOutletMismatches = await prisma.$queryRaw`
    SELECT
      revision.id AS "menuRevisionId",
      revision."outletId" AS "revisionOutletId",
      item.id AS "itemId",
      item."outletId" AS "itemOutletId"
    FROM "MenuRevision" revision
    JOIN "MenuItem" item ON item.id = revision."targetId"
    WHERE revision."targetType" = 'ITEM'
      AND revision."outletId" <> item."outletId"
  `;

  const menuAuditCategoryOutletMismatches = await prisma.$queryRaw`
    SELECT
      audit.id AS "menuAuditLogId",
      audit."outletId" AS "auditOutletId",
      category.id AS "categoryId",
      category."outletId" AS "categoryOutletId"
    FROM "MenuAuditLog" audit
    JOIN "Category" category ON category.id = audit."targetId"
    WHERE audit."targetType" = 'CATEGORY'
      AND audit."outletId" <> category."outletId"
  `;

  const menuAuditItemOutletMismatches = await prisma.$queryRaw`
    SELECT
      audit.id AS "menuAuditLogId",
      audit."outletId" AS "auditOutletId",
      item.id AS "itemId",
      item."outletId" AS "itemOutletId"
    FROM "MenuAuditLog" audit
    JOIN "MenuItem" item ON item.id = audit."targetId"
    WHERE audit."targetType" = 'ITEM'
      AND audit."outletId" <> item."outletId"
  `;

  const menuHistoryRevisionOutletMismatches = await prisma.$queryRaw`
    SELECT
      state.id AS "menuHistoryStateId",
      state."outletId" AS "stateOutletId",
      revision.id AS "currentRevisionId",
      revision."outletId" AS "revisionOutletId"
    FROM "MenuHistoryState" state
    JOIN "MenuRevision" revision ON revision.id = state."currentRevisionId"
    WHERE state."outletId" <> revision."outletId"
  `;

  const menuHistoryStateIdMismatches = await prisma.$queryRaw`
    SELECT
      id,
      "outletId",
      ('outlet:' || "outletId") AS "expectedId"
    FROM "MenuHistoryState"
    WHERE id <> ('outlet:' || "outletId")
  `;

  const nonSharedDevicesWithoutOutlet = await prisma.$queryRaw`
    SELECT id, name, role
    FROM "Device"
    WHERE "isSharedAcrossOutlets" = false
      AND "outletId" IS NULL
  `;

  const sharedDevicesWithoutOutletAccess = await prisma.$queryRaw`
    SELECT device.id, device.name, device.role
    FROM "Device" device
    LEFT JOIN "DeviceOutletAccess" access ON access."deviceId" = device.id
    WHERE device."isSharedAcrossOutlets" = true
    GROUP BY device.id, device.name, device.role
    HAVING COUNT(access.id) = 0
  `;

  addViolation(violations, "missing active cafeteria outlet", missingActiveCafeteriaOutlet);
  addViolation(violations, "unexpected non-cafeteria outlet", unexpectedNonCafeteriaOutlets);
  addViolation(violations, "menu item category outlet mismatch", itemCategoryMismatches);
  addViolation(violations, "upgrade linked item outlet mismatch", upgradeLinkedItemMismatches);
  addViolation(violations, "upgrade linked size does not belong to linked item", upgradeLinkedSizeMismatches);
  addViolation(violations, "payment transaction order outlet mismatch", paymentOrderOutletMismatches);
  addViolation(violations, "finalized payment order outlet mismatch", finalizedPaymentOrderOutletMismatches);
  addViolation(violations, "menu revision category outlet mismatch", menuRevisionCategoryOutletMismatches);
  addViolation(violations, "menu revision item outlet mismatch", menuRevisionItemOutletMismatches);
  addViolation(violations, "menu audit category outlet mismatch", menuAuditCategoryOutletMismatches);
  addViolation(violations, "menu audit item outlet mismatch", menuAuditItemOutletMismatches);
  addViolation(violations, "menu history current revision outlet mismatch", menuHistoryRevisionOutletMismatches);
  addViolation(violations, "menu history state id is not outlet-scoped", menuHistoryStateIdMismatches);
  addViolation(violations, "non-shared device has no outlet", nonSharedDevicesWithoutOutlet);
  addViolation(violations, "shared device has no outlet access rows", sharedDevicesWithoutOutletAccess);

  if (violations.length > 0) {
    console.error("Outlet integrity validation failed.");
    for (const violation of violations) {
      console.error(`\n${violation.check}: ${violation.rows.length}`);
      console.error(JSON.stringify(violation.rows, null, 2));
    }
    process.exitCode = 1;
    return;
  }

  console.log("Outlet integrity validation passed.");
}

function addViolation(violations: Violation[], check: string, rows: unknown) {
  if (Array.isArray(rows) && rows.length > 0) {
    violations.push({ check, rows });
  }
}

main()
  .catch((error) => {
    console.error("Outlet integrity validation crashed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
