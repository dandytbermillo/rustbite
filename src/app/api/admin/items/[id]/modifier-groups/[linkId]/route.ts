import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApiPermissionContext } from "@/lib/admin-sessions";
import {
  ITEM_MODIFIER_LINK_INCLUDE,
  hasItemModifierGroupChanges,
  itemModifierGroupDataFromFields,
  itemModifierGroupLinkSnapshotFromRecord,
  serializeItemModifierGroupLink,
  validateItemModifierGroupRule,
  validateLockVersionInput,
  validatePatchItemModifierGroupInput,
  writeSharedModifierAudit,
} from "@/lib/admin/shared-modifier-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const ITEM_CONFLICT_ERROR =
  "Item changed since you opened it. Reload and try again.";

class ItemModifierLinkNotFound extends Error {}
class ItemConflict extends Error {}
class ItemModifierLinkBadRequest extends Error {}

async function getScope(id: string, linkId: string) {
  const link = await prisma.menuItemModifierGroup.findUnique({
    where: { id: linkId },
    select: {
      id: true,
      menuItemId: true,
      outletId: true,
      menuItem: {
        select: {
          outletId: true,
          category: { select: { slug: true } },
        },
      },
    },
  });
  if (!link || link.menuItemId !== id) return null;
  return {
    outletId: link.menuItem.outletId,
  };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; linkId: string }> }
) {
  const { id, linkId } = await params;
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

  const validation = validatePatchItemModifierGroupInput(
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
      const [item, beforeLink] = await Promise.all([
        tx.menuItem.findUnique({
          where: { id },
          select: {
            id: true,
            name: true,
            lockVersion: true,
            outletId: true,
            isActive: true,
            category: { select: { slug: true } },
          },
        }),
        tx.menuItemModifierGroup.findUnique({
          where: { id: linkId },
          include: ITEM_MODIFIER_LINK_INCLUDE,
        }),
      ]);
      if (!item || !beforeLink || beforeLink.menuItemId !== id) {
        throw new ItemModifierLinkNotFound();
      }
      if (item.lockVersion !== validation.value.lockVersion) {
        throw new ItemConflict();
      }
      if (item.category.slug === "deals") {
        throw new ItemModifierLinkBadRequest(
          "Shared modifier groups cannot be attached to deals"
        );
      }
      if (beforeLink.outletId !== item.outletId) {
        throw new ItemModifierLinkBadRequest(
          "Item modifier group outlet does not match item outlet"
        );
      }

      const hasMinOverride = Object.prototype.hasOwnProperty.call(
        validation.value.fields,
        "minSelectOverride"
      );
      const hasMaxOverride = Object.prototype.hasOwnProperty.call(
        validation.value.fields,
        "maxSelectOverride"
      );
      const nextMinSelectOverride = hasMinOverride
        ? validation.value.fields.minSelectOverride ?? null
        : beforeLink.minSelectOverride;
      const nextMaxSelectOverride = hasMaxOverride
        ? validation.value.fields.maxSelectOverride ?? null
        : beforeLink.maxSelectOverride;
      const rule = validateItemModifierGroupRule({
        selectionMode: beforeLink.modifierGroup.selectionMode,
        minSelect: beforeLink.modifierGroup.minSelect,
        maxSelect: beforeLink.modifierGroup.maxSelect,
        minSelectOverride: nextMinSelectOverride,
        maxSelectOverride: nextMaxSelectOverride,
      });
      if (!rule.ok) throw new ItemModifierLinkBadRequest(rule.error);

      if (!hasItemModifierGroupChanges(beforeLink, validation.value.fields)) {
        return {
          link: beforeLink,
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

      const link = await tx.menuItemModifierGroup.update({
        where: { id: linkId },
        data: {
          ...itemModifierGroupDataFromFields(validation.value.fields),
          updatedAt: new Date(),
        },
        include: ITEM_MODIFIER_LINK_INCLUDE,
      });
      const refreshedItem = await tx.menuItem.findUniqueOrThrow({
        where: { id },
        select: { lockVersion: true },
      });

      await writeSharedModifierAudit(tx, {
        actionType: link.isActive
          ? "ITEM_MODIFIER_GROUP_UPDATED"
          : "ITEM_MODIFIER_GROUP_DETACHED",
        targetType: "ITEM_MODIFIER_GROUP",
        outletId: item.outletId,
        targetId: link.id,
        targetLabel: `${item.name} / ${link.modifierGroup.name}`,
        beforePayload: itemModifierGroupLinkSnapshotFromRecord(beforeLink),
        afterPayload: itemModifierGroupLinkSnapshotFromRecord(link),
        affectsAttachedMenu: item.isActive && (beforeLink.isActive || link.isActive),
      });

      return {
        link,
        itemLockVersion: refreshedItem.lockVersion,
        changed: true as const,
      };
    });

    return NextResponse.json({
      link: serializeItemModifierGroupLink(result.link),
      itemLockVersion: result.itemLockVersion,
      changed: result.changed,
    });
  } catch (err) {
    if (err instanceof ItemModifierLinkBadRequest) {
      return NextResponse.json(
        { error: err.message, errorCode: "invalid_payload" },
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
    return NextResponse.json(
      {
        error: "Item modifier group update failed",
        errorCode: "item_modifier_group_update_failed",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; linkId: string }> }
) {
  const { id, linkId } = await params;
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
      const [item, beforeLink] = await Promise.all([
        tx.menuItem.findUnique({
          where: { id },
          select: {
            id: true,
            name: true,
            lockVersion: true,
            outletId: true,
            isActive: true,
          },
        }),
        tx.menuItemModifierGroup.findUnique({
          where: { id: linkId },
          include: ITEM_MODIFIER_LINK_INCLUDE,
        }),
      ]);
      if (!item || !beforeLink || beforeLink.menuItemId !== id) {
        throw new ItemModifierLinkNotFound();
      }
      if (item.lockVersion !== validation.value.lockVersion) {
        throw new ItemConflict();
      }
      if (!beforeLink.isActive) {
        return {
          link: beforeLink,
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

      const link = await tx.menuItemModifierGroup.update({
        where: { id: linkId },
        data: { isActive: false, updatedAt: new Date() },
        include: ITEM_MODIFIER_LINK_INCLUDE,
      });
      const refreshedItem = await tx.menuItem.findUniqueOrThrow({
        where: { id },
        select: { lockVersion: true },
      });

      await writeSharedModifierAudit(tx, {
        actionType: "ITEM_MODIFIER_GROUP_DETACHED",
        targetType: "ITEM_MODIFIER_GROUP",
        outletId: item.outletId,
        targetId: link.id,
        targetLabel: `${item.name} / ${link.modifierGroup.name}`,
        beforePayload: itemModifierGroupLinkSnapshotFromRecord(beforeLink),
        afterPayload: itemModifierGroupLinkSnapshotFromRecord(link),
        affectsAttachedMenu: item.isActive,
      });

      return {
        link,
        itemLockVersion: refreshedItem.lockVersion,
        changed: true as const,
      };
    });

    return NextResponse.json({
      link: serializeItemModifierGroupLink(result.link),
      itemLockVersion: result.itemLockVersion,
      changed: result.changed,
    });
  } catch (err) {
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
    return NextResponse.json(
      {
        error: "Item modifier group detach failed",
        errorCode: "item_modifier_group_detach_failed",
      },
      { status: 500 }
    );
  }
}
