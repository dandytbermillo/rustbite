import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApiPermissionContext } from "@/lib/admin-sessions";
import {
  SHARED_MODIFIER_GROUP_INCLUDE,
  hasModifierGroupChanges,
  isModifierGroupAttachedToActiveItem,
  modifierGroupDataFromFields,
  modifierGroupSnapshotFromRecord,
  serializeSharedModifierGroup,
  validateLockVersionInput,
  validateNextModifierGroupRule,
  validatePatchModifierGroupInput,
  writeSharedModifierAudit,
} from "@/lib/admin/shared-modifier-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const GROUP_CONFLICT_ERROR =
  "Modifier group changed since you opened it. Reload and try again.";

class ModifierGroupNotFound extends Error {}
class ModifierGroupConflict extends Error {}
class ModifierGroupBadRequest extends Error {}

async function getScope(id: string) {
  return prisma.sharedModifierGroup.findUnique({
    where: { id },
    select: { id: true, outletId: true },
  });
}

export async function GET(
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
    "admin.menu.read",
    scope.outletId
  );
  if (!auth.ok) return auth.response;

  const group = await prisma.sharedModifierGroup.findUnique({
    where: { id },
    include: SHARED_MODIFIER_GROUP_INCLUDE,
  });
  if (!group) {
    return NextResponse.json(
      { error: "Modifier group not found", errorCode: "modifier_group_not_found" },
      { status: 404 }
    );
  }

  return NextResponse.json({ group: serializeSharedModifierGroup(group) });
}

export async function PATCH(
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

  const validation = validatePatchModifierGroupInput(
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
      const before = await tx.sharedModifierGroup.findUnique({
        where: { id },
        include: SHARED_MODIFIER_GROUP_INCLUDE,
      });
      if (!before) throw new ModifierGroupNotFound();
      if (before.lockVersion !== validation.value.lockVersion) {
        throw new ModifierGroupConflict();
      }

      const rule = validateNextModifierGroupRule(before, validation.value.fields);
      if (!rule.ok) throw new ModifierGroupBadRequest(rule.error);

      if (!hasModifierGroupChanges(before, validation.value.fields)) {
        return { group: before, changed: false as const };
      }

      const deactivating =
        before.isActive && validation.value.fields.isActive === false;
      const data = modifierGroupDataFromFields(validation.value.fields);
      const touched = await tx.sharedModifierGroup.updateMany({
        where: { id, lockVersion: validation.value.lockVersion },
        data: {
          ...data,
          lockVersion: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (touched.count !== 1) throw new ModifierGroupConflict();

      const refreshed = await tx.sharedModifierGroup.findUniqueOrThrow({
        where: { id },
        include: SHARED_MODIFIER_GROUP_INCLUDE,
      });
      const affectsAttachedMenu = await isModifierGroupAttachedToActiveItem(tx, id);

      await writeSharedModifierAudit(tx, {
        actionType: deactivating
          ? "MODIFIER_GROUP_DEACTIVATED"
          : "MODIFIER_GROUP_UPDATED",
        targetType: "MODIFIER_GROUP",
        outletId: refreshed.outletId,
        targetId: refreshed.id,
        targetLabel: refreshed.name,
        beforePayload: modifierGroupSnapshotFromRecord(before),
        afterPayload: modifierGroupSnapshotFromRecord(refreshed),
        affectsAttachedMenu,
      });

      return { group: refreshed, changed: true as const };
    });

    return NextResponse.json({
      group: serializeSharedModifierGroup(result.group),
      changed: result.changed,
    });
  } catch (err) {
    if (err instanceof ModifierGroupBadRequest) {
      return NextResponse.json(
        { error: err.message, errorCode: "invalid_payload" },
        { status: 400 }
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
          error: "An active modifier group with that name already exists",
          errorCode: "duplicate_modifier_group",
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "Modifier group update failed", errorCode: "modifier_group_update_failed" },
      { status: 500 }
    );
  }
}

export async function DELETE(
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

  const validation = validateLockVersionInput(await req.json().catch(() => null));
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.error, errorCode: "invalid_payload" },
      { status: 400 }
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const before = await tx.sharedModifierGroup.findUnique({
        where: { id },
        include: SHARED_MODIFIER_GROUP_INCLUDE,
      });
      if (!before) throw new ModifierGroupNotFound();
      if (before.lockVersion !== validation.value.lockVersion) {
        throw new ModifierGroupConflict();
      }
      if (!before.isActive) {
        return { group: before, changed: false as const };
      }

      const touched = await tx.sharedModifierGroup.updateMany({
        where: { id, lockVersion: validation.value.lockVersion },
        data: {
          isActive: false,
          lockVersion: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (touched.count !== 1) throw new ModifierGroupConflict();

      const refreshed = await tx.sharedModifierGroup.findUniqueOrThrow({
        where: { id },
        include: SHARED_MODIFIER_GROUP_INCLUDE,
      });
      const affectsAttachedMenu = await isModifierGroupAttachedToActiveItem(tx, id);

      await writeSharedModifierAudit(tx, {
        actionType: "MODIFIER_GROUP_DEACTIVATED",
        targetType: "MODIFIER_GROUP",
        outletId: refreshed.outletId,
        targetId: refreshed.id,
        targetLabel: refreshed.name,
        beforePayload: modifierGroupSnapshotFromRecord(before),
        afterPayload: modifierGroupSnapshotFromRecord(refreshed),
        affectsAttachedMenu,
      });

      return { group: refreshed, changed: true as const };
    });

    return NextResponse.json({
      group: serializeSharedModifierGroup(result.group),
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
      err instanceof ModifierGroupNotFound ||
      (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025")
    ) {
      return NextResponse.json(
        { error: "Modifier group not found", errorCode: "modifier_group_not_found" },
        { status: 404 }
      );
    }
    return NextResponse.json(
      {
        error: "Modifier group deactivate failed",
        errorCode: "modifier_group_deactivate_failed",
      },
      { status: 500 }
    );
  }
}
