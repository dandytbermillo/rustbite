import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApiPermissionContext } from "@/lib/admin-sessions";
import { recordAdminStockMovement } from "@/lib/menu-stock-movements";
import {
  optionStockFieldsChanged,
  optionStockPersistenceFields,
  validateOptionStockPatchInput,
} from "@/lib/admin/option-stock-routes";
import {
  SHARED_MODIFIER_GROUP_INCLUDE,
  isModifierGroupAttachedToActiveItem,
  modifierOptionSnapshotFromRecord,
  serializeSharedModifierOption,
  writeSharedModifierAudit,
} from "@/lib/admin/shared-modifier-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const GROUP_CONFLICT_ERROR =
  "Modifier group changed since you opened it. Reload and try again.";

class ModifierOptionNotFound extends Error {}
class ModifierGroupConflict extends Error {}

async function getScope(id: string, optionId: string) {
  const option = await prisma.sharedModifierOption.findUnique({
    where: { id: optionId },
    select: {
      id: true,
      groupId: true,
      group: { select: { outletId: true } },
    },
  });
  if (!option || option.groupId !== id) return null;
  return { id: option.id, groupId: option.groupId, outletId: option.group.outletId };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; optionId: string }> }
) {
  const { id, optionId } = await params;
  const scope = await getScope(id, optionId);
  if (!scope) {
    return NextResponse.json(
      { error: "Modifier option not found", errorCode: "modifier_option_not_found" },
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
      const [group, beforeOption] = await Promise.all([
        tx.sharedModifierGroup.findUnique({
          where: { id },
          include: SHARED_MODIFIER_GROUP_INCLUDE,
        }),
        tx.sharedModifierOption.findUnique({ where: { id: optionId } }),
      ]);
      if (!group || !beforeOption || beforeOption.groupId !== id) {
        throw new ModifierOptionNotFound();
      }
      if (group.lockVersion !== validation.value.lockVersion) {
        throw new ModifierGroupConflict();
      }

      const changed = optionStockFieldsChanged(
        {
          stockMode: beforeOption.stockMode,
          isOutOfStock: beforeOption.isOutOfStock,
          stockQty: beforeOption.stockQty,
          lowStockThreshold: beforeOption.lowStockThreshold,
        },
        validation.value
      );
      if (!changed) {
        return {
          option: beforeOption,
          groupLockVersion: group.lockVersion,
          changed: false as const,
        };
      }

      const now = new Date();
      const persistedStock = optionStockPersistenceFields(
        {
          stockMode: beforeOption.stockMode,
          isOutOfStock: beforeOption.isOutOfStock,
          stockQty: beforeOption.stockQty,
          lowStockThreshold: beforeOption.lowStockThreshold,
        },
        validation.value
      );
      const touched = await tx.sharedModifierOption.updateMany({
        where: { id: optionId },
        data: {
          stockMode: persistedStock.stockMode,
          isOutOfStock: persistedStock.isOutOfStock,
          stockQty: persistedStock.stockQty,
          lowStockThreshold: persistedStock.lowStockThreshold,
          stockUpdatedAt: now,
          stockUpdatedById: actorUserId === "legacy" ? null : actorUserId,
          updatedAt: now,
        },
      });
      if (touched.count !== 1) throw new ModifierOptionNotFound();

      const groupTouched = await tx.sharedModifierGroup.updateMany({
        where: { id, lockVersion: validation.value.lockVersion },
        data: {
          lockVersion: { increment: 1 },
          updatedAt: now,
        },
      });
      if (groupTouched.count !== 1) throw new ModifierGroupConflict();

      const [refreshedGroup, refreshedOption] = await Promise.all([
        tx.sharedModifierGroup.findUniqueOrThrow({
          where: { id },
          select: { outletId: true, name: true, lockVersion: true },
        }),
        tx.sharedModifierOption.findUniqueOrThrow({ where: { id: optionId } }),
      ]);
      const affectsAttachedMenu = await isModifierGroupAttachedToActiveItem(tx, id);

      await recordAdminStockMovement(tx, {
        outletId: refreshedGroup.outletId,
        sharedModifierOptionId: refreshedOption.id,
        targetType: "SHARED_MODIFIER_OPTION",
        targetId: refreshedOption.id,
        targetNameSnapshot: refreshedOption.name,
        itemNameSnapshot: refreshedGroup.name,
        before: {
          stockMode: beforeOption.stockMode,
          stockQty: beforeOption.stockQty,
        },
        after: {
          stockMode: refreshedOption.stockMode,
          stockQty: refreshedOption.stockQty,
        },
        actor: {
          actorType: actorUserId === "legacy" ? "ADMIN_BASIC" : "ADMIN_USER",
          actorId: actorUserId === "legacy" ? null : actorUserId,
        },
      });

      await writeSharedModifierAudit(tx, {
        actionType: "MODIFIER_OPTION_UPDATED",
        targetType: "MODIFIER_OPTION",
        outletId: refreshedGroup.outletId,
        targetId: refreshedOption.id,
        targetLabel: `${refreshedOption.name} stock`,
        beforePayload: modifierOptionSnapshotFromRecord(beforeOption),
        afterPayload: modifierOptionSnapshotFromRecord(refreshedOption),
        affectsAttachedMenu,
      });

      return {
        option: refreshedOption,
        groupLockVersion: refreshedGroup.lockVersion,
        changed: true as const,
      };
    });

    return NextResponse.json({
      option: serializeSharedModifierOption(result.option),
      groupLockVersion: result.groupLockVersion,
      changed: result.changed,
    });
  } catch (err) {
    if (err instanceof ModifierGroupConflict) {
      return NextResponse.json(
        { error: GROUP_CONFLICT_ERROR, errorCode: "stale_modifier_group" },
        { status: 409 }
      );
    }
    if (
      err instanceof ModifierOptionNotFound ||
      (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025")
    ) {
      return NextResponse.json(
        { error: "Modifier option not found", errorCode: "modifier_option_not_found" },
        { status: 404 }
      );
    }
    return NextResponse.json(
      {
        error: "Modifier option stock update failed",
        errorCode: "modifier_option_stock_update_failed",
      },
      { status: 500 }
    );
  }
}
