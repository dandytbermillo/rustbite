import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApiPermissionContext } from "@/lib/admin-sessions";
import {
  SHARED_MODIFIER_GROUP_INCLUDE,
  modifierGroupSnapshotFromRecord,
  serializeSharedModifierGroup,
  validateCreateModifierGroupInput,
  writeSharedModifierAudit,
} from "@/lib/admin/shared-modifier-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const auth = await requireAdminApiPermissionContext(req, "admin.menu.read");
  if (!auth.ok) return auth.response;

  const groups = await prisma.sharedModifierGroup.findMany({
    where: { outletId: auth.context.outletId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: SHARED_MODIFIER_GROUP_INCLUDE,
  });

  return NextResponse.json({ groups: groups.map(serializeSharedModifierGroup) });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminApiPermissionContext(req, "admin.menu.write");
  if (!auth.ok) return auth.response;

  const validation = validateCreateModifierGroupInput(
    await req.json().catch(() => null)
  );
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.error, errorCode: "invalid_payload" },
      { status: 400 }
    );
  }

  try {
    const duplicate = await prisma.sharedModifierGroup.findFirst({
      where: {
        outletId: auth.context.outletId,
        isActive: true,
        name: { equals: validation.value.name, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (duplicate) {
      return NextResponse.json(
        {
          error: "An active modifier group with that name already exists",
          errorCode: "duplicate_modifier_group",
        },
        { status: 409 }
      );
    }

    const created = await prisma.$transaction(async (tx) => {
      const group = await tx.sharedModifierGroup.create({
        data: {
          outletId: auth.context.outletId,
          name: validation.value.name,
          description: validation.value.description,
          selectionMode: validation.value.selectionMode,
          minSelect: validation.value.minSelect,
          maxSelect: validation.value.maxSelect,
          sortOrder: validation.value.sortOrder,
          isActive: validation.value.isActive,
        },
        include: SHARED_MODIFIER_GROUP_INCLUDE,
      });

      await writeSharedModifierAudit(tx, {
        actionType: "MODIFIER_GROUP_CREATED",
        targetType: "MODIFIER_GROUP",
        outletId: group.outletId,
        targetId: group.id,
        targetLabel: group.name,
        afterPayload: modifierGroupSnapshotFromRecord(group),
        affectsAttachedMenu: false,
      });

      return group;
    });

    return NextResponse.json(
      { group: serializeSharedModifierGroup(created) },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        {
          error: "An active modifier group with that name already exists",
          errorCode: "duplicate_modifier_group",
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "Modifier group create failed", errorCode: "modifier_group_create_failed" },
      { status: 500 }
    );
  }
}
