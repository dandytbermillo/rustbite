import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApiPermissionContext } from "@/lib/admin-sessions";
import {
  ITEM_MODIFIER_LINK_INCLUDE,
  itemModifierGroupLinkSnapshotFromRecord,
  serializeItemModifierGroupLink,
  validateAttachItemModifierGroupInput,
  validateItemModifierGroupRule,
  writeSharedModifierAudit,
} from "@/lib/admin/shared-modifier-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const ITEM_CONFLICT_ERROR =
  "Item changed since you opened it. Reload and try again.";

class ItemNotFound extends Error {}
class ItemConflict extends Error {}
class ModifierGroupNotFound extends Error {}
class ModifierGroupDuplicate extends Error {}
class ModifierGroupBadRequest extends Error {}

async function getItemScope(id: string) {
  return prisma.menuItem.findUnique({
    where: { id },
    select: {
      id: true,
      outletId: true,
      category: { select: { slug: true } },
    },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const item = await getItemScope(id);
  if (!item) {
    return NextResponse.json(
      { error: "Item not found", errorCode: "item_not_found" },
      { status: 404 }
    );
  }

  const auth = await requireAdminApiPermissionContext(
    req,
    "admin.menu.read",
    item.outletId
  );
  if (!auth.ok) return auth.response;

  const links = await prisma.menuItemModifierGroup.findMany({
    where: { menuItemId: id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: ITEM_MODIFIER_LINK_INCLUDE,
  });

  return NextResponse.json({ links: links.map(serializeItemModifierGroupLink) });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const item = await getItemScope(id);
  if (!item) {
    return NextResponse.json(
      { error: "Item not found", errorCode: "item_not_found" },
      { status: 404 }
    );
  }

  const auth = await requireAdminApiPermissionContext(
    req,
    "admin.menu.write",
    item.outletId
  );
  if (!auth.ok) return auth.response;

  const validation = validateAttachItemModifierGroupInput(
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
      const [currentItem, group] = await Promise.all([
        tx.menuItem.findUnique({
          where: { id },
          select: {
            id: true,
            name: true,
            outletId: true,
            lockVersion: true,
            isActive: true,
            category: { select: { slug: true } },
          },
        }),
        tx.sharedModifierGroup.findUnique({
          where: { id: validation.value.modifierGroupId },
          select: {
            id: true,
            outletId: true,
            name: true,
            selectionMode: true,
            minSelect: true,
            maxSelect: true,
            isActive: true,
          },
        }),
      ]);
      if (!currentItem) throw new ItemNotFound();
      if (currentItem.lockVersion !== validation.value.lockVersion) {
        throw new ItemConflict();
      }
      if (currentItem.category.slug === "deals") {
        throw new ModifierGroupBadRequest(
          "Shared modifier groups cannot be attached to deals"
        );
      }
      if (!group || !group.isActive) throw new ModifierGroupNotFound();
      if (group.outletId !== currentItem.outletId) {
        throw new ModifierGroupBadRequest(
          "Modifier group belongs to a different outlet"
        );
      }

      const rule = validateItemModifierGroupRule({
        selectionMode: group.selectionMode,
        minSelect: group.minSelect,
        maxSelect: group.maxSelect,
        minSelectOverride: validation.value.minSelectOverride,
        maxSelectOverride: validation.value.maxSelectOverride,
      });
      if (!rule.ok) throw new ModifierGroupBadRequest(rule.error);

      const beforeLink = await tx.menuItemModifierGroup.findUnique({
        where: {
          menuItemId_modifierGroupId: {
            menuItemId: id,
            modifierGroupId: group.id,
          },
        },
        include: ITEM_MODIFIER_LINK_INCLUDE,
      });
      if (beforeLink?.isActive) throw new ModifierGroupDuplicate();

      const touched = await tx.menuItem.updateMany({
        where: { id, lockVersion: validation.value.lockVersion },
        data: {
          lockVersion: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (touched.count !== 1) throw new ItemConflict();

      const link = beforeLink
        ? await tx.menuItemModifierGroup.update({
            where: { id: beforeLink.id },
            data: {
              sortOrder: validation.value.sortOrder,
              minSelectOverride: validation.value.minSelectOverride,
              maxSelectOverride: validation.value.maxSelectOverride,
              isActive: validation.value.isActive,
              updatedAt: new Date(),
            },
            include: ITEM_MODIFIER_LINK_INCLUDE,
          })
        : await tx.menuItemModifierGroup.create({
            data: {
              outletId: currentItem.outletId,
              menuItemId: currentItem.id,
              modifierGroupId: group.id,
              sortOrder: validation.value.sortOrder,
              minSelectOverride: validation.value.minSelectOverride,
              maxSelectOverride: validation.value.maxSelectOverride,
              isActive: validation.value.isActive,
            },
            include: ITEM_MODIFIER_LINK_INCLUDE,
          });

      await tx.menuItemModifierGroupAttachmentHistory.upsert({
        where: {
          menuItemIdSnapshot_modifierGroupId: {
            menuItemIdSnapshot: currentItem.id,
            modifierGroupId: group.id,
          },
        },
        update: {
          outletId: currentItem.outletId,
          menuItemId: currentItem.id,
          menuItemNameSnapshot: currentItem.name,
          modifierGroupNameSnapshot: group.name,
          updatedAt: new Date(),
        },
        create: {
          outletId: currentItem.outletId,
          menuItemId: currentItem.id,
          menuItemIdSnapshot: currentItem.id,
          menuItemNameSnapshot: currentItem.name,
          modifierGroupId: group.id,
          modifierGroupNameSnapshot: group.name,
        },
      });

      const refreshedItem = await tx.menuItem.findUniqueOrThrow({
        where: { id },
        select: { lockVersion: true },
      });

      await writeSharedModifierAudit(tx, {
        actionType: "ITEM_MODIFIER_GROUP_ATTACHED",
        targetType: "ITEM_MODIFIER_GROUP",
        outletId: currentItem.outletId,
        targetId: link.id,
        targetLabel: `${currentItem.name} / ${group.name}`,
        beforePayload: beforeLink
          ? itemModifierGroupLinkSnapshotFromRecord(beforeLink)
          : {
              menuItemId: currentItem.id,
              modifierGroupId: group.id,
              attached: false,
            },
        afterPayload: itemModifierGroupLinkSnapshotFromRecord(link),
        affectsAttachedMenu: currentItem.isActive && link.isActive,
      });

      return { link, itemLockVersion: refreshedItem.lockVersion };
    });

    return NextResponse.json(
      {
        link: serializeItemModifierGroupLink(result.link),
        itemLockVersion: result.itemLockVersion,
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof ModifierGroupBadRequest) {
      return NextResponse.json(
        { error: err.message, errorCode: "invalid_payload" },
        { status: 400 }
      );
    }
    if (err instanceof ModifierGroupDuplicate) {
      return NextResponse.json(
        {
          error: "Modifier group is already attached to this item",
          errorCode: "duplicate_item_modifier_group",
        },
        { status: 409 }
      );
    }
    if (err instanceof ItemConflict) {
      return NextResponse.json(
        { error: ITEM_CONFLICT_ERROR, errorCode: "stale_item" },
        { status: 409 }
      );
    }
    if (
      err instanceof ItemNotFound ||
      (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025")
    ) {
      return NextResponse.json(
        { error: "Item not found", errorCode: "item_not_found" },
        { status: 404 }
      );
    }
    if (err instanceof ModifierGroupNotFound) {
      return NextResponse.json(
        { error: "Modifier group not found", errorCode: "modifier_group_not_found" },
        { status: 404 }
      );
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        {
          error: "Modifier group is already attached to this item",
          errorCode: "duplicate_item_modifier_group",
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      {
        error: "Item modifier group attach failed",
        errorCode: "item_modifier_group_attach_failed",
      },
      { status: 500 }
    );
  }
}
