import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiPermissionContext } from "@/lib/admin-sessions";
import {
  SHARED_MODIFIER_GROUP_INCLUDE,
  modifierGroupSnapshotFromRecord,
  validateLockVersionInput,
  writeSharedModifierAudit,
} from "@/lib/admin/shared-modifier-routes";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const GROUP_CONFLICT_ERROR =
  "Modifier group changed since you opened it. Reload and try again.";

class ModifierGroupNotFound extends Error {}
class ModifierGroupConflict extends Error {}
class ModifierGroupAttached extends Error {}
class ModifierGroupOverrideExists extends Error {}

function isDeleteRaceError(err: unknown) {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    (err.code === "P2003" || err.code === "P2014")
  );
}

async function getScope(id: string) {
  return prisma.sharedModifierGroup.findUnique({
    where: { id },
    select: { id: true, outletId: true },
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const scope = await getScope(id);
  if (!scope) {
    return NextResponse.json(
      { error: "Modifier group not found", errorCode: "modifier_group_not_found" },
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
      const before = await tx.sharedModifierGroup.findUnique({
        where: { id },
        include: SHARED_MODIFIER_GROUP_INCLUDE,
      });
      if (!before) throw new ModifierGroupNotFound();
      if (before.lockVersion !== validation.value.lockVersion) {
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
        where: { itemModifierGroup: { modifierGroupId: id } },
      });
      if (optionOverrideCount > 0) throw new ModifierGroupOverrideExists();

      const snapshot = modifierGroupSnapshotFromRecord(before);
      await tx.sharedModifierGroup.delete({ where: { id } });

      await writeSharedModifierAudit(tx, {
        actionType: "MODIFIER_GROUP_HARD_DELETED",
        targetType: "MODIFIER_GROUP",
        outletId: before.outletId,
        targetId: before.id,
        targetLabel: before.name,
        beforePayload: snapshot,
        afterPayload: { deleted: true },
        affectsAttachedMenu: false,
      });

      return { id: before.id, name: before.name };
    });

    return NextResponse.json({
      deleted: true,
      groupId: result.id,
      groupName: result.name,
    });
  } catch (err) {
    if (err instanceof ModifierGroupConflict) {
      return NextResponse.json(
        { error: GROUP_CONFLICT_ERROR, errorCode: "stale_modifier_group" },
        { status: 409 },
      );
    }
    if (err instanceof ModifierGroupAttached || isDeleteRaceError(err)) {
      return NextResponse.json(
        {
          error:
            "This add-on set has been attached to menu items. Hide it instead of deleting it.",
          errorCode: "modifier_group_attached",
        },
        { status: 409 },
      );
    }
    if (err instanceof ModifierGroupOverrideExists) {
      return NextResponse.json(
        {
          error:
            "This add-on set has item-specific option changes. Hide it instead of deleting it.",
          errorCode: "modifier_option_override_exists",
        },
        { status: 409 },
      );
    }
    if (
      err instanceof ModifierGroupNotFound ||
      (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025")
    ) {
      return NextResponse.json(
        { error: "Modifier group not found", errorCode: "modifier_group_not_found" },
        { status: 404 },
      );
    }
    return NextResponse.json(
      {
        error: "Modifier group delete failed",
        errorCode: "modifier_group_delete_failed",
      },
      { status: 500 },
    );
  }
}
