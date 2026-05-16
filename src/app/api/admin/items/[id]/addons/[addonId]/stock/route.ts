import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApiPermissionContext } from "@/lib/admin-sessions";
import {
  itemSnapshotFromRecord,
  writeMenuAuditAndRevision,
} from "@/lib/menu-history";
import { recordAdminStockMovement } from "@/lib/menu-stock-movements";
import {
  optionStockFieldsChanged,
  optionStockPersistenceFields,
  validateOptionStockPatchInput,
} from "@/lib/admin/option-stock-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const ITEM_CONFLICT_ERROR =
  "Item changed since you opened it. Reload and try again.";

const ITEM_AUDIT_INCLUDE = {
  sizes: { orderBy: { sortOrder: "asc" } },
  addons: { orderBy: { sortOrder: "asc" } },
  upgradeOptions: {
    orderBy: { sortOrder: "asc" },
    include: {
      linkedItems: { orderBy: { sortOrder: "asc" } },
    },
  },
} satisfies Prisma.MenuItemInclude;

class AddonOptionNotFound extends Error {}
class ItemVersionConflict extends Error {}

function serializeAddonOption(
  option: Prisma.AddonOptionGetPayload<Record<string, never>>
) {
  return {
    id: option.id,
    itemId: option.itemId,
    name: option.name,
    priceDelta: Number(option.priceDelta),
    stockMode: option.stockMode,
    isOutOfStock: option.isOutOfStock,
    stockQty: option.stockQty,
    lowStockThreshold: option.lowStockThreshold,
    stockUpdatedAt: option.stockUpdatedAt?.toISOString() ?? null,
    stockUpdatedById: option.stockUpdatedById,
    sortOrder: option.sortOrder,
  };
}

async function getScope(id: string, addonId: string) {
  const addon = await prisma.addonOption.findUnique({
    where: { id: addonId },
    select: {
      id: true,
      itemId: true,
      item: { select: { outletId: true } },
    },
  });
  if (!addon || addon.itemId !== id) return null;
  return { id: addon.id, itemId: addon.itemId, outletId: addon.item.outletId };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; addonId: string }> }
) {
  const { id, addonId } = await params;
  const scope = await getScope(id, addonId);
  if (!scope) {
    return NextResponse.json(
      { error: "Add-on option not found", errorCode: "addon_option_not_found" },
      { status: 404 }
    );
  }

  const auth = await requireAdminApiPermissionContext(
    req,
    "admin.menu.write",
    scope.outletId
  );
  if (!auth.ok) return auth.response;

  const validation = validateOptionStockPatchInput(
    await req.json().catch(() => null)
  );
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.error, errorCode: "invalid_payload" },
      { status: 400 }
    );
  }

  const actorUserId = auth.context.actor.userId;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const beforeItem = await tx.menuItem.findUnique({
        where: { id },
        include: ITEM_AUDIT_INCLUDE,
      });
      if (!beforeItem || beforeItem.outletId !== scope.outletId) {
        throw new AddonOptionNotFound();
      }
      if (beforeItem.lockVersion !== validation.value.lockVersion) {
        throw new ItemVersionConflict();
      }

      const beforeAddon = beforeItem.addons.find(
        (option) => option.id === addonId
      );
      if (!beforeAddon) throw new AddonOptionNotFound();

      const changed = optionStockFieldsChanged(
        {
          stockMode: beforeAddon.stockMode,
          isOutOfStock: beforeAddon.isOutOfStock,
          stockQty: beforeAddon.stockQty,
          lowStockThreshold: beforeAddon.lowStockThreshold,
        },
        validation.value
      );
      if (!changed) {
        return {
          addon: beforeAddon,
          itemLockVersion: beforeItem.lockVersion,
          changed: false as const,
        };
      }

      const now = new Date();
      const persistedStock = optionStockPersistenceFields(
        {
          stockMode: beforeAddon.stockMode,
          isOutOfStock: beforeAddon.isOutOfStock,
          stockQty: beforeAddon.stockQty,
          lowStockThreshold: beforeAddon.lowStockThreshold,
        },
        validation.value
      );
      const touched = await tx.addonOption.updateMany({
        where: { id: addonId, itemId: id },
        data: {
          stockMode: persistedStock.stockMode,
          isOutOfStock: persistedStock.isOutOfStock,
          stockQty: persistedStock.stockQty,
          lowStockThreshold: persistedStock.lowStockThreshold,
          stockUpdatedAt: now,
          stockUpdatedById: actorUserId === "legacy" ? null : actorUserId,
        },
      });
      if (touched.count !== 1) throw new AddonOptionNotFound();

      const itemTouched = await tx.menuItem.updateMany({
        where: { id, lockVersion: validation.value.lockVersion },
        data: {
          lockVersion: { increment: 1 },
          updatedAt: now,
        },
      });
      if (itemTouched.count !== 1) throw new ItemVersionConflict();

      const refreshedItem = await tx.menuItem.findUniqueOrThrow({
        where: { id },
        include: ITEM_AUDIT_INCLUDE,
      });
      const refreshedAddon = refreshedItem.addons.find(
        (option) => option.id === addonId
      );
      if (!refreshedAddon) throw new AddonOptionNotFound();

      await recordAdminStockMovement(tx, {
        outletId: scope.outletId,
        addonOptionId: refreshedAddon.id,
        targetType: "ITEM_LOCAL_ADDON",
        targetId: refreshedAddon.id,
        targetNameSnapshot: refreshedAddon.name,
        itemNameSnapshot: refreshedItem.name,
        before: {
          stockMode: beforeAddon.stockMode,
          stockQty: beforeAddon.stockQty,
        },
        after: {
          stockMode: refreshedAddon.stockMode,
          stockQty: refreshedAddon.stockQty,
        },
        actor: {
          actorType: actorUserId === "legacy" ? "ADMIN_BASIC" : "ADMIN_USER",
          actorId: actorUserId === "legacy" ? null : actorUserId,
        },
      });

      await writeMenuAuditAndRevision(tx, {
        actionType: "ITEM_UPDATED",
        targetType: "ITEM",
        outletId: scope.outletId,
        targetId: refreshedItem.id,
        targetLabel: `${refreshedItem.name} add-on stock`,
        beforePayload: itemSnapshotFromRecord(beforeItem),
        afterPayload: itemSnapshotFromRecord(refreshedItem),
      });

      return {
        addon: refreshedAddon,
        itemLockVersion: refreshedItem.lockVersion,
        changed: true as const,
      };
    });

    return NextResponse.json({
      addon: serializeAddonOption(result.addon),
      itemLockVersion: result.itemLockVersion,
      changed: result.changed,
    });
  } catch (err) {
    if (err instanceof ItemVersionConflict) {
      return NextResponse.json(
        { error: ITEM_CONFLICT_ERROR, errorCode: "stale_item" },
        { status: 409 }
      );
    }
    if (
      err instanceof AddonOptionNotFound ||
      (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025")
    ) {
      return NextResponse.json(
        { error: "Add-on option not found", errorCode: "addon_option_not_found" },
        { status: 404 }
      );
    }
    return NextResponse.json(
      {
        error: "Add-on stock update failed",
        errorCode: "addon_stock_update_failed",
      },
      { status: 500 }
    );
  }
}
