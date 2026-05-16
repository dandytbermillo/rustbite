import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApiPermissionContext } from "@/lib/admin-sessions";
import {
  SHARED_MODIFIER_GROUP_INCLUDE,
  isModifierGroupAttachedToActiveItem,
  modifierGroupSnapshotFromRecord,
  modifierOptionSnapshotFromRecord,
  serializeSharedModifierOption,
  validateCreateModifierOptionInput,
  writeSharedModifierAudit,
} from "@/lib/admin/shared-modifier-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const GROUP_CONFLICT_ERROR =
  "Modifier group changed since you opened it. Reload and try again.";

class ModifierGroupNotFound extends Error {}
class ModifierGroupConflict extends Error {}
class ModifierOptionDuplicate extends Error {}

async function getScope(id: string) {
  return prisma.sharedModifierGroup.findUnique({
    where: { id },
    select: { id: true, outletId: true },
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const scope = await getScope(id);
  if (!scope) {
    return NextResponse.json(
      { error: "Modifier group not found", errorCode: "modifier_group_not_found" },
      { status: 404 }
    );
  }

  const auth = await requireAdminApiPermissionContext(
    req,
    "admin.menu.write",
    scope.outletId
  );
  if (!auth.ok) return auth.response;

  const validation = validateCreateModifierOptionInput(
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
      const beforeGroup = await tx.sharedModifierGroup.findUnique({
        where: { id },
        include: SHARED_MODIFIER_GROUP_INCLUDE,
      });
      if (!beforeGroup) throw new ModifierGroupNotFound();
      if (beforeGroup.lockVersion !== validation.value.lockVersion) {
        throw new ModifierGroupConflict();
      }

      const duplicate = await tx.sharedModifierOption.findFirst({
        where: {
          groupId: id,
          isActive: true,
          name: { equals: validation.value.name, mode: "insensitive" },
        },
        select: { id: true },
      });
      if (duplicate) throw new ModifierOptionDuplicate();

      const option = await tx.sharedModifierOption.create({
        data: {
          groupId: id,
          name: validation.value.name,
          priceDelta: new Prisma.Decimal(validation.value.priceDelta),
          sortOrder: validation.value.sortOrder,
          isActive: validation.value.isActive,
          stockMode: validation.value.stockMode,
          isOutOfStock: validation.value.isOutOfStock,
          stockQty: validation.value.stockQty,
          lowStockThreshold: validation.value.lowStockThreshold,
        },
      });
      const touched = await tx.sharedModifierGroup.updateMany({
        where: { id, lockVersion: validation.value.lockVersion },
        data: {
          lockVersion: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (touched.count !== 1) throw new ModifierGroupConflict();

      const refreshedGroup = await tx.sharedModifierGroup.findUniqueOrThrow({
        where: { id },
        include: SHARED_MODIFIER_GROUP_INCLUDE,
      });
      const affectsAttachedMenu = await isModifierGroupAttachedToActiveItem(tx, id);

      await writeSharedModifierAudit(tx, {
        actionType: "MODIFIER_OPTION_CREATED",
        targetType: "MODIFIER_OPTION",
        outletId: refreshedGroup.outletId,
        targetId: option.id,
        targetLabel: option.name,
        beforePayload: modifierGroupSnapshotFromRecord(beforeGroup),
        afterPayload: modifierOptionSnapshotFromRecord(option),
        affectsAttachedMenu,
      });

      return { option, groupLockVersion: refreshedGroup.lockVersion };
    });

    return NextResponse.json(
      {
        option: serializeSharedModifierOption(result.option),
        groupLockVersion: result.groupLockVersion,
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof ModifierOptionDuplicate) {
      return NextResponse.json(
        {
          error: "An active modifier option with that name already exists",
          errorCode: "duplicate_modifier_option",
        },
        { status: 409 }
      );
    }
    if (err instanceof ModifierGroupConflict) {
      return NextResponse.json(
        { error: GROUP_CONFLICT_ERROR, errorCode: "stale_modifier_group" },
        { status: 409 }
      );
    }
    if (
      err instanceof ModifierGroupNotFound ||
      (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025")
    ) {
      return NextResponse.json(
        { error: "Modifier group not found", errorCode: "modifier_group_not_found" },
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
        error: "Modifier option create failed",
        errorCode: "modifier_option_create_failed",
      },
      { status: 500 }
    );
  }
}
