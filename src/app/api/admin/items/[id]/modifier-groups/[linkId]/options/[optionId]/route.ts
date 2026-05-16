import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApiPermissionContext } from "@/lib/admin-sessions";
import {
  hasItemModifierOverrideChanges,
  itemModifierOptionOverrideSnapshotFromRecord,
  itemModifierOverrideDataFromFields,
  serializeItemModifierOptionOverride,
  validateLockVersionInput,
  validatePatchItemModifierOptionOverrideInput,
  writeSharedModifierAudit,
} from "@/lib/admin/shared-modifier-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const ITEM_CONFLICT_ERROR =
  "Item changed since you opened it. Reload and try again.";

class ItemModifierLinkNotFound extends Error {}
class ItemModifierOptionNotFound extends Error {}
class ItemConflict extends Error {}
class ItemModifierOverrideBadRequest extends Error {}

async function getScope(id: string, linkId: string) {
  const link = await prisma.menuItemModifierGroup.findUnique({
    where: { id: linkId },
    select: {
      id: true,
      menuItemId: true,
      menuItem: { select: { outletId: true } },
    },
  });
  if (!link || link.menuItemId !== id) return null;
  return { outletId: link.menuItem.outletId };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; linkId: string; optionId: string }> }
) {
  const { id, linkId, optionId } = await params;
  const scope = await getScope(id, linkId);
  if (!scope) {
    return NextResponse.json(
      {
        error: "Item modifier group not found",
        errorCode: "item_modifier_group_not_found",
      },
      { status: 404 }
    );
  }

  const auth = await requireAdminApiPermissionContext(
    req,
    "admin.menu.write",
    scope.outletId
  );
  if (!auth.ok) return auth.response;

  const validation = validatePatchItemModifierOptionOverrideInput(
    await req.json().catch(() => null)
  );
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.error, errorCode: "invalid_payload" },
      { status: 400 }
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const [item, link, option, beforeOverride] = await Promise.all([
        tx.menuItem.findUnique({
          where: { id },
          select: {
            id: true,
            name: true,
            outletId: true,
            lockVersion: true,
            isActive: true,
          },
        }),
        tx.menuItemModifierGroup.findUnique({
          where: { id: linkId },
          select: {
            id: true,
            menuItemId: true,
            modifierGroupId: true,
            isActive: true,
            modifierGroup: { select: { name: true } },
          },
        }),
        tx.sharedModifierOption.findUnique({
          where: { id: optionId },
          select: { id: true, groupId: true, name: true },
        }),
        tx.menuItemModifierOptionOverride.findUnique({
          where: {
            menuItemModifierGroupId_modifierOptionId: {
              menuItemModifierGroupId: linkId,
              modifierOptionId: optionId,
            },
          },
          include: { modifierOption: true },
        }),
      ]);
      if (!item || !link || link.menuItemId !== id) {
        throw new ItemModifierLinkNotFound();
      }
      if (item.lockVersion !== validation.value.lockVersion) {
        throw new ItemConflict();
      }
      if (!option) throw new ItemModifierOptionNotFound();
      if (option.groupId !== link.modifierGroupId) {
        throw new ItemModifierOverrideBadRequest(
          "Modifier option does not belong to this item modifier group"
        );
      }

      if (!hasItemModifierOverrideChanges(beforeOverride, validation.value.fields)) {
        return {
          override: beforeOverride,
          itemLockVersion: item.lockVersion,
          changed: false as const,
        };
      }

      const touched = await tx.menuItem.updateMany({
        where: { id, lockVersion: validation.value.lockVersion },
        data: {
          lockVersion: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (touched.count !== 1) throw new ItemConflict();

      const override = beforeOverride
        ? await tx.menuItemModifierOptionOverride.update({
            where: { id: beforeOverride.id },
            data: {
              ...itemModifierOverrideDataFromFields(validation.value.fields),
              updatedAt: new Date(),
            },
            include: { modifierOption: true },
          })
        : await tx.menuItemModifierOptionOverride.create({
            data: {
              menuItemModifierGroupId: linkId,
              modifierOptionId: optionId,
              isHidden: validation.value.fields.isHidden ?? false,
              priceDeltaOverride:
                validation.value.fields.priceDeltaOverride == null
                  ? null
                  : new Prisma.Decimal(validation.value.fields.priceDeltaOverride),
              sortOrderOverride: validation.value.fields.sortOrderOverride ?? null,
            },
            include: { modifierOption: true },
          });
      const refreshedItem = await tx.menuItem.findUniqueOrThrow({
        where: { id },
        select: { lockVersion: true },
      });

      await writeSharedModifierAudit(tx, {
        actionType: "ITEM_MODIFIER_OVERRIDE_UPDATED",
        targetType: "ITEM_MODIFIER_OVERRIDE",
        outletId: item.outletId,
        targetId: override.id,
        targetLabel: `${item.name} / ${link.modifierGroup.name} / ${option.name}`,
        beforePayload: beforeOverride
          ? itemModifierOptionOverrideSnapshotFromRecord(beforeOverride)
          : {
              menuItemModifierGroupId: linkId,
              modifierOptionId: optionId,
              inherited: true,
            },
        afterPayload: itemModifierOptionOverrideSnapshotFromRecord(override),
        affectsAttachedMenu: item.isActive && link.isActive,
      });

      return {
        override,
        itemLockVersion: refreshedItem.lockVersion,
        changed: true as const,
      };
    });

    return NextResponse.json({
      override: result.override
        ? serializeItemModifierOptionOverride(result.override)
        : null,
      itemLockVersion: result.itemLockVersion,
      changed: result.changed,
    });
  } catch (err) {
    if (err instanceof ItemModifierOverrideBadRequest) {
      return NextResponse.json(
        { error: err.message, errorCode: "modifier_option_group_mismatch" },
        { status: 400 }
      );
    }
    if (err instanceof ItemConflict) {
      return NextResponse.json(
        { error: ITEM_CONFLICT_ERROR, errorCode: "stale_item" },
        { status: 409 }
      );
    }
    if (
      err instanceof ItemModifierLinkNotFound ||
      (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025")
    ) {
      return NextResponse.json(
        {
          error: "Item modifier group not found",
          errorCode: "item_modifier_group_not_found",
        },
        { status: 404 }
      );
    }
    if (err instanceof ItemModifierOptionNotFound) {
      return NextResponse.json(
        {
          error: "Modifier option not found",
          errorCode: "modifier_option_not_found",
        },
        { status: 404 }
      );
    }
    return NextResponse.json(
      {
        error: "Item modifier override update failed",
        errorCode: "item_modifier_override_update_failed",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; linkId: string; optionId: string }> }
) {
  const { id, linkId, optionId } = await params;
  const scope = await getScope(id, linkId);
  if (!scope) {
    return NextResponse.json(
      {
        error: "Item modifier group not found",
        errorCode: "item_modifier_group_not_found",
      },
      { status: 404 }
    );
  }

  const auth = await requireAdminApiPermissionContext(
    req,
    "admin.menu.write",
    scope.outletId
  );
  if (!auth.ok) return auth.response;

  const validation = validateLockVersionInput(await req.json().catch(() => null));
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.error, errorCode: "invalid_payload" },
      { status: 400 }
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const [item, link, option, beforeOverride] = await Promise.all([
        tx.menuItem.findUnique({
          where: { id },
          select: {
            id: true,
            name: true,
            outletId: true,
            lockVersion: true,
            isActive: true,
          },
        }),
        tx.menuItemModifierGroup.findUnique({
          where: { id: linkId },
          select: {
            id: true,
            menuItemId: true,
            modifierGroupId: true,
            isActive: true,
            modifierGroup: { select: { name: true } },
          },
        }),
        tx.sharedModifierOption.findUnique({
          where: { id: optionId },
          select: { id: true, groupId: true, name: true },
        }),
        tx.menuItemModifierOptionOverride.findUnique({
          where: {
            menuItemModifierGroupId_modifierOptionId: {
              menuItemModifierGroupId: linkId,
              modifierOptionId: optionId,
            },
          },
          include: { modifierOption: true },
        }),
      ]);
      if (!item || !link || link.menuItemId !== id) {
        throw new ItemModifierLinkNotFound();
      }
      if (item.lockVersion !== validation.value.lockVersion) {
        throw new ItemConflict();
      }
      if (!option) throw new ItemModifierOptionNotFound();
      if (option.groupId !== link.modifierGroupId) {
        throw new ItemModifierOverrideBadRequest(
          "Modifier option does not belong to this item modifier group"
        );
      }
      if (!beforeOverride) {
        return {
          override: null,
          itemLockVersion: item.lockVersion,
          changed: false as const,
        };
      }

      const touched = await tx.menuItem.updateMany({
        where: { id, lockVersion: validation.value.lockVersion },
        data: {
          lockVersion: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (touched.count !== 1) throw new ItemConflict();

      await tx.menuItemModifierOptionOverride.delete({
        where: { id: beforeOverride.id },
      });
      const refreshedItem = await tx.menuItem.findUniqueOrThrow({
        where: { id },
        select: { lockVersion: true },
      });

      await writeSharedModifierAudit(tx, {
        actionType: "ITEM_MODIFIER_OVERRIDE_CLEARED",
        targetType: "ITEM_MODIFIER_OVERRIDE",
        outletId: item.outletId,
        targetId: beforeOverride.id,
        targetLabel: `${item.name} / ${link.modifierGroup.name} / ${option.name}`,
        beforePayload: itemModifierOptionOverrideSnapshotFromRecord(beforeOverride),
        afterPayload: {
          menuItemModifierGroupId: linkId,
          modifierOptionId: optionId,
          inherited: true,
        },
        affectsAttachedMenu: item.isActive && link.isActive,
      });

      return {
        override: null,
        itemLockVersion: refreshedItem.lockVersion,
        changed: true as const,
      };
    });

    return NextResponse.json({
      override: result.override,
      itemLockVersion: result.itemLockVersion,
      changed: result.changed,
    });
  } catch (err) {
    if (err instanceof ItemModifierOverrideBadRequest) {
      return NextResponse.json(
        { error: err.message, errorCode: "modifier_option_group_mismatch" },
        { status: 400 }
      );
    }
    if (err instanceof ItemConflict) {
      return NextResponse.json(
        { error: ITEM_CONFLICT_ERROR, errorCode: "stale_item" },
        { status: 409 }
      );
    }
    if (
      err instanceof ItemModifierLinkNotFound ||
      (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025")
    ) {
      return NextResponse.json(
        {
          error: "Item modifier group not found",
          errorCode: "item_modifier_group_not_found",
        },
        { status: 404 }
      );
    }
    if (err instanceof ItemModifierOptionNotFound) {
      return NextResponse.json(
        {
          error: "Modifier option not found",
          errorCode: "modifier_option_not_found",
        },
        { status: 404 }
      );
    }
    return NextResponse.json(
      {
        error: "Item modifier override clear failed",
        errorCode: "item_modifier_override_clear_failed",
      },
      { status: 500 }
    );
  }
}
