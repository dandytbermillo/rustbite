import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiPermissionContext } from "@/lib/admin-sessions";
import {
  modifierOptionSnapshotFromRecord,
  validateLockVersionInput,
  writeSharedModifierAudit,
} from "@/lib/admin/shared-modifier-routes";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const GROUP_CONFLICT_ERROR =
  "Modifier group changed since you opened it. Reload and try again.";

class ModifierOptionNotFound extends Error {}
class ModifierGroupConflict extends Error {}
class ModifierGroupAttached extends Error {}
class ModifierOptionOverrideExists extends Error {}

function isDeleteRaceError(err: unknown) {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    (err.code === "P2003" || err.code === "P2014")
  );
}

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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; optionId: string }> },
) {
  const { id, optionId } = await params;
  const scope = await getScope(id, optionId);
  if (!scope) {
    return NextResponse.json(
      { error: "Modifier option not found", errorCode: "modifier_option_not_found" },
      { status: 404 },
    );
  }

  const auth = await requireAdminApiPermissionContext(
    req,
    "admin.menu.write",
    scope.outletId,
  );
  if (!auth.ok) return auth.response;

  const validation = validateLockVersionInput(await req.json().catch(() => null));
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.error, errorCode: "invalid_payload" },
      { status: 400 },
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const [group, beforeOption] = await Promise.all([
        tx.sharedModifierGroup.findUnique({
          where: { id },
          select: {
            id: true,
            outletId: true,
            name: true,
            lockVersion: true,
          },
        }),
        tx.sharedModifierOption.findUnique({ where: { id: optionId } }),
      ]);
      if (!group || !beforeOption || beforeOption.groupId !== id) {
        throw new ModifierOptionNotFound();
      }
      if (group.lockVersion !== validation.value.lockVersion) {
        throw new ModifierGroupConflict();
      }

      const itemLinkCount = await tx.menuItemModifierGroup.count({
        where: { modifierGroupId: id },
      });
      if (itemLinkCount > 0) throw new ModifierGroupAttached();

      const attachmentHistoryCount =
        await tx.menuItemModifierGroupAttachmentHistory.count({
          where: { modifierGroupId: id },
        });
      if (attachmentHistoryCount > 0) throw new ModifierGroupAttached();

      const optionOverrideCount = await tx.menuItemModifierOptionOverride.count({
        where: { modifierOptionId: optionId },
      });
      if (optionOverrideCount > 0) throw new ModifierOptionOverrideExists();

      const groupTouched = await tx.sharedModifierGroup.updateMany({
        where: { id, lockVersion: validation.value.lockVersion },
        data: {
          lockVersion: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (groupTouched.count !== 1) throw new ModifierGroupConflict();

      const snapshot = modifierOptionSnapshotFromRecord(beforeOption);
      await tx.sharedModifierOption.delete({ where: { id: optionId } });

      const refreshedGroup = await tx.sharedModifierGroup.findUniqueOrThrow({
        where: { id },
        select: { lockVersion: true },
      });

      await writeSharedModifierAudit(tx, {
        actionType: "MODIFIER_OPTION_HARD_DELETED",
        targetType: "MODIFIER_OPTION",
        outletId: group.outletId,
        targetId: beforeOption.id,
        targetLabel: beforeOption.name,
        beforePayload: snapshot,
        afterPayload: { deleted: true },
        affectsAttachedMenu: false,
      });

      return {
        groupId: group.id,
        groupName: group.name,
        groupLockVersion: refreshedGroup.lockVersion,
        optionId: beforeOption.id,
        optionName: beforeOption.name,
      };
    });

    return NextResponse.json({
      deleted: true,
      groupId: result.groupId,
      groupName: result.groupName,
      groupLockVersion: result.groupLockVersion,
      optionId: result.optionId,
      optionName: result.optionName,
    });
  } catch (err) {
    if (err instanceof ModifierGroupConflict) {
      return NextResponse.json(
        { error: GROUP_CONFLICT_ERROR, errorCode: "stale_modifier_group" },
        { status: 409 },
      );
    }
    if (err instanceof ModifierGroupAttached) {
      return NextResponse.json(
        {
          error:
            "This add-on option belongs to a set that has been attached to menu items. Hide it instead of deleting it.",
          errorCode: "modifier_group_attached",
        },
        { status: 409 },
      );
    }
    if (err instanceof ModifierOptionOverrideExists) {
      return NextResponse.json(
        {
          error:
            "This add-on option has item-specific changes. Hide it instead of deleting it.",
          errorCode: "modifier_option_override_exists",
        },
        { status: 409 },
      );
    }
    if (isDeleteRaceError(err)) {
      return NextResponse.json(
        {
          error:
            "This add-on option belongs to a set that has been attached to menu items. Hide it instead of deleting it.",
          errorCode: "modifier_group_attached",
        },
        { status: 409 },
      );
    }
    if (
      err instanceof ModifierOptionNotFound ||
      (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025")
    ) {
      return NextResponse.json(
        { error: "Modifier option not found", errorCode: "modifier_option_not_found" },
        { status: 404 },
      );
    }
    return NextResponse.json(
      {
        error: "Modifier option delete failed",
        errorCode: "modifier_option_delete_failed",
      },
      { status: 500 },
    );
  }
}
