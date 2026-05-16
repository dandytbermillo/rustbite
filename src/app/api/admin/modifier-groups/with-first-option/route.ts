import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApiPermissionContext } from "@/lib/admin-sessions";
import {
  SHARED_MODIFIER_GROUP_INCLUDE,
  modifierGroupSnapshotFromRecord,
  modifierOptionSnapshotFromRecord,
  serializeSharedModifierGroup,
  validateCreateModifierGroupWithFirstOptionInput,
  writeSharedModifierAudit,
} from "@/lib/admin/shared-modifier-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

class ModifierGroupDuplicate extends Error {}

export async function POST(req: NextRequest) {
  const auth = await requireAdminApiPermissionContext(req, "admin.menu.write");
  if (!auth.ok) return auth.response;

  const validation = validateCreateModifierGroupWithFirstOptionInput(
    await req.json().catch(() => null),
  );
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.error, errorCode: "invalid_payload" },
      { status: 400 },
    );
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const duplicate = await tx.sharedModifierGroup.findFirst({
        where: {
          outletId: auth.context.outletId,
          isActive: true,
          name: { equals: validation.value.group.name, mode: "insensitive" },
        },
        select: { id: true },
      });
      if (duplicate) throw new ModifierGroupDuplicate();

      const group = await tx.sharedModifierGroup.create({
        data: {
          outletId: auth.context.outletId,
          name: validation.value.group.name,
          description: validation.value.group.description,
          selectionMode: validation.value.group.selectionMode,
          minSelect: validation.value.group.minSelect,
          maxSelect: validation.value.group.maxSelect,
          sortOrder: validation.value.group.sortOrder,
          isActive: validation.value.group.isActive,
          options: {
            create: {
              name: validation.value.firstOption.name,
              priceDelta: new Prisma.Decimal(
                validation.value.firstOption.priceDelta,
              ),
              sortOrder: validation.value.firstOption.sortOrder,
              isActive: validation.value.firstOption.isActive,
              stockMode: validation.value.firstOption.stockMode,
              isOutOfStock: validation.value.firstOption.isOutOfStock,
              stockQty: validation.value.firstOption.stockQty,
              lowStockThreshold: validation.value.firstOption.lowStockThreshold,
            },
          },
        },
        include: SHARED_MODIFIER_GROUP_INCLUDE,
      });

      const firstOption = group.options[0];

      await writeSharedModifierAudit(tx, {
        actionType: "MODIFIER_GROUP_CREATED",
        targetType: "MODIFIER_GROUP",
        outletId: group.outletId,
        targetId: group.id,
        targetLabel: group.name,
        afterPayload: modifierGroupSnapshotFromRecord(group),
        affectsAttachedMenu: false,
      });

      if (firstOption) {
        await writeSharedModifierAudit(tx, {
          actionType: "MODIFIER_OPTION_CREATED",
          targetType: "MODIFIER_OPTION",
          outletId: group.outletId,
          targetId: firstOption.id,
          targetLabel: firstOption.name,
          afterPayload: modifierOptionSnapshotFromRecord(firstOption),
          affectsAttachedMenu: false,
        });
      }

      return group;
    });

    return NextResponse.json(
      { group: serializeSharedModifierGroup(created) },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof ModifierGroupDuplicate) {
      return NextResponse.json(
        {
          error: "An active modifier group with that name already exists",
          errorCode: "duplicate_modifier_group",
        },
        { status: 409 },
      );
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        {
          error: "An active modifier group with that name already exists",
          errorCode: "duplicate_modifier_group",
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        error: "Modifier group create failed",
        errorCode: "modifier_group_create_failed",
      },
      { status: 500 },
    );
  }
}
