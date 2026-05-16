import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApiPermissionContext } from "@/lib/admin-sessions";
import {
  SHARED_MODIFIER_GROUP_INCLUDE,
  hasModifierOptionChanges,
  isModifierGroupAttachedToActiveItem,
  modifierOptionDataFromFields,
  modifierOptionSnapshotFromRecord,
  serializeSharedModifierOption,
  validateLockVersionInput,
  validatePatchModifierOptionInput,
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

  const validation = validatePatchModifierOptionInput(
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
      if (!hasModifierOptionChanges(beforeOption, validation.value.fields)) {
        return {
          option: beforeOption,
          groupLockVersion: group.lockVersion,
          changed: false as const,
        };
      }

      const deactivating =
        beforeOption.isActive && validation.value.fields.isActive === false;
      const touched = await tx.sharedModifierOption.updateMany({
        where: { id: optionId },
        data: {
          ...modifierOptionDataFromFields(validation.value.fields),
          updatedAt: new Date(),
        },
      });
      if (touched.count !== 1) throw new ModifierOptionNotFound();

      const groupTouched = await tx.sharedModifierGroup.updateMany({
        where: { id, lockVersion: validation.value.lockVersion },
        data: {
          lockVersion: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (groupTouched.count !== 1) throw new ModifierGroupConflict();

      const [refreshedGroup, refreshedOption] = await Promise.all([
        tx.sharedModifierGroup.findUniqueOrThrow({
          where: { id },
          select: { outletId: true, lockVersion: true },
        }),
        tx.sharedModifierOption.findUniqueOrThrow({ where: { id: optionId } }),
      ]);
      const affectsAttachedMenu = await isModifierGroupAttachedToActiveItem(tx, id);

      await writeSharedModifierAudit(tx, {
        actionType: deactivating
          ? "MODIFIER_OPTION_DEACTIVATED"
          : "MODIFIER_OPTION_UPDATED",
        targetType: "MODIFIER_OPTION",
        outletId: refreshedGroup.outletId,
        targetId: refreshedOption.id,
        targetLabel: refreshedOption.name,
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
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        {
          error: "An active modifier option with that name already exists",
          errorCode: "duplicate_modifier_option",
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      {
        error: "Modifier option update failed",
        errorCode: "modifier_option_update_failed",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
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

  const validation = validateLockVersionInput(await req.json().catch(() => null));
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.error, errorCode: "invalid_payload" },
      { status: 400 }
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const [group, beforeOption] = await Promise.all([
        tx.sharedModifierGroup.findUnique({
          where: { id },
          select: { id: true, outletId: true, lockVersion: true },
        }),
        tx.sharedModifierOption.findUnique({ where: { id: optionId } }),
      ]);
      if (!group || !beforeOption || beforeOption.groupId !== id) {
        throw new ModifierOptionNotFound();
      }
      if (group.lockVersion !== validation.value.lockVersion) {
        throw new ModifierGroupConflict();
      }
      if (!beforeOption.isActive) {
        return {
          option: beforeOption,
          groupLockVersion: group.lockVersion,
          changed: false as const,
        };
      }

      const touched = await tx.sharedModifierOption.updateMany({
        where: { id: optionId },
        data: { isActive: false, updatedAt: new Date() },
      });
      if (touched.count !== 1) throw new ModifierOptionNotFound();

      const groupTouched = await tx.sharedModifierGroup.updateMany({
        where: { id, lockVersion: validation.value.lockVersion },
        data: {
          lockVersion: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (groupTouched.count !== 1) throw new ModifierGroupConflict();

      const [refreshedGroup, refreshedOption] = await Promise.all([
        tx.sharedModifierGroup.findUniqueOrThrow({
          where: { id },
          select: { outletId: true, lockVersion: true },
        }),
        tx.sharedModifierOption.findUniqueOrThrow({ where: { id: optionId } }),
      ]);
      const affectsAttachedMenu = await isModifierGroupAttachedToActiveItem(tx, id);

      await writeSharedModifierAudit(tx, {
        actionType: "MODIFIER_OPTION_DEACTIVATED",
        targetType: "MODIFIER_OPTION",
        outletId: refreshedGroup.outletId,
        targetId: refreshedOption.id,
        targetLabel: refreshedOption.name,
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
        error: "Modifier option deactivate failed",
        errorCode: "modifier_option_deactivate_failed",
      },
      { status: 500 }
    );
  }
}
