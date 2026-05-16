import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApiPermissionContext } from "@/lib/admin-sessions";
import {
  optionStockFieldsChanged,
  optionStockPersistenceFields,
  validateOptionStockPatchInput,
  type OptionStockPatchInput,
} from "@/lib/admin/option-stock-routes";
import { recordAdminStockMovement } from "@/lib/menu-stock-movements";
import {
  SHARED_MODIFIER_GROUP_INCLUDE,
  hasModifierGroupChanges,
  hasModifierOptionChanges,
  isModifierGroupAttachedToActiveItem,
  modifierGroupDataFromFields,
  modifierGroupSnapshotFromRecord,
  modifierOptionSnapshotFromRecord,
  serializeSharedModifierGroup,
  validateNextModifierGroupRule,
  validatePatchModifierGroupInput,
  validatePatchModifierOptionInput,
  writeSharedModifierAudit,
  type ModifierGroupPatchInput,
  type ModifierOptionPatchInput,
} from "@/lib/admin/shared-modifier-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const GROUP_CONFLICT_ERROR =
  "Modifier group changed since you opened it. Reload and try again.";

const SAVE_KEYS = new Set(["lockVersion", "group", "options"]);
const OPTION_SAVE_KEYS = new Set([
  "id",
  "name",
  "priceDelta",
  "sortOrder",
  "isActive",
  "stockMode",
  "isOutOfStock",
  "stockQty",
  "lowStockThreshold",
]);

type SaveOptionInput = {
  id: string;
  fields: ModifierOptionPatchInput["fields"];
  stock: Omit<OptionStockPatchInput, "lockVersion">;
};

type SaveGroupInput = {
  lockVersion: number;
  groupFields: ModifierGroupPatchInput["fields"];
  options: SaveOptionInput[];
};

class ModifierGroupNotFound extends Error {}
class ModifierGroupConflict extends Error {}
class ModifierGroupBadRequest extends Error {}
class ModifierOptionNotFound extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function rejectUnknownKeys(raw: Record<string, unknown>, allowed: Set<string>) {
  const unknown = Object.keys(raw).find((key) => !allowed.has(key));
  return unknown ? `${unknown} is not allowed` : null;
}

function optionPatchPayload(raw: Record<string, unknown>, lockVersion: number) {
  const payload: Record<string, unknown> = { lockVersion };
  for (const key of ["name", "priceDelta", "sortOrder", "isActive"]) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) payload[key] = raw[key];
  }
  return payload;
}

function optionStockPayload(raw: Record<string, unknown>, lockVersion: number) {
  return {
    lockVersion,
    stockMode: raw.stockMode,
    isOutOfStock: raw.isOutOfStock,
    stockQty: raw.stockQty,
    lowStockThreshold: raw.lowStockThreshold,
  };
}

function validateSaveInput(
  raw: unknown
): { ok: true; value: SaveGroupInput } | { ok: false; error: string } {
  if (!isRecord(raw)) return { ok: false, error: "Body must be a JSON object" };

  const unknown = rejectUnknownKeys(raw, SAVE_KEYS);
  if (unknown) return { ok: false, error: unknown };

  if (!isRecord(raw.group)) {
    return { ok: false, error: "group must be a JSON object" };
  }
  if (!Array.isArray(raw.options)) {
    return { ok: false, error: "options must be an array" };
  }

  const groupValidation = validatePatchModifierGroupInput({
    lockVersion: raw.lockVersion,
    ...raw.group,
  });
  if (!groupValidation.ok) {
    return { ok: false, error: groupValidation.error };
  }

  const seenOptionIds = new Set<string>();
  const options: SaveOptionInput[] = [];
  for (const entry of raw.options) {
    if (!isRecord(entry)) {
      return { ok: false, error: "options must contain JSON objects" };
    }
    const optionUnknown = rejectUnknownKeys(entry, OPTION_SAVE_KEYS);
    if (optionUnknown) return { ok: false, error: optionUnknown };

    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    if (!id) return { ok: false, error: "option id is required" };
    if (seenOptionIds.has(id)) {
      return { ok: false, error: "options contain duplicate ids" };
    }
    seenOptionIds.add(id);

    const optionValidation = validatePatchModifierOptionInput(
      optionPatchPayload(entry, groupValidation.value.lockVersion)
    );
    if (!optionValidation.ok) {
      return { ok: false, error: optionValidation.error };
    }

    const stockValidation = validateOptionStockPatchInput(
      optionStockPayload(entry, groupValidation.value.lockVersion)
    );
    if (!stockValidation.ok) {
      return { ok: false, error: stockValidation.error };
    }

    options.push({
      id,
      fields: optionValidation.value.fields,
      stock: {
        stockMode: stockValidation.value.stockMode,
        isOutOfStock: stockValidation.value.isOutOfStock,
        stockQty: stockValidation.value.stockQty,
        lowStockThreshold: stockValidation.value.lowStockThreshold,
      },
    });
  }

  return {
    ok: true,
    value: {
      lockVersion: groupValidation.value.lockVersion,
      groupFields: groupValidation.value.fields,
      options,
    },
  };
}

async function getScope(id: string) {
  return prisma.sharedModifierGroup.findUnique({
    where: { id },
    select: { id: true, outletId: true },
  });
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

  const validation = validateSaveInput(await req.json().catch(() => null));
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.error, errorCode: "invalid_payload" },
      { status: 400 }
    );
  }

  const actorUserId = auth.context.actor.userId;

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

      const rule = validateNextModifierGroupRule(
        before,
        validation.value.groupFields
      );
      if (!rule.ok) throw new ModifierGroupBadRequest(rule.error);

      const beforeOptions = new Map(
        before.options.map((option) => [option.id, option])
      );
      for (const option of validation.value.options) {
        if (!beforeOptions.has(option.id)) throw new ModifierOptionNotFound();
      }

      const now = new Date();
      const affectsAttachedMenu = await isModifierGroupAttachedToActiveItem(tx, id);
      const groupChanged = hasModifierGroupChanges(
        before,
        validation.value.groupFields
      );
      const changedOptionIds: string[] = [];
      const stockChangedOptionIds: string[] = [];

      for (const option of validation.value.options) {
        const beforeOption = beforeOptions.get(option.id);
        if (!beforeOption) throw new ModifierOptionNotFound();

        const optionChanged = hasModifierOptionChanges(
          beforeOption,
          option.fields
        );
        const stockChanged = optionStockFieldsChanged(
          {
            stockMode: beforeOption.stockMode,
            isOutOfStock: beforeOption.isOutOfStock,
            stockQty: beforeOption.stockQty,
            lowStockThreshold: beforeOption.lowStockThreshold,
          },
          { lockVersion: validation.value.lockVersion, ...option.stock }
        );
        if (!optionChanged && !stockChanged) continue;

        const data: Prisma.SharedModifierOptionUncheckedUpdateManyInput = {
          updatedAt: now,
        };
        if (option.fields.name != null) data.name = option.fields.name;
        if (option.fields.priceDelta != null) {
          data.priceDelta = new Prisma.Decimal(option.fields.priceDelta);
        }
        if (option.fields.sortOrder != null) data.sortOrder = option.fields.sortOrder;
        if (option.fields.isActive != null) data.isActive = option.fields.isActive;
        if (stockChanged) {
          const persistedStock = optionStockPersistenceFields(
            {
              stockMode: beforeOption.stockMode,
              isOutOfStock: beforeOption.isOutOfStock,
              stockQty: beforeOption.stockQty,
              lowStockThreshold: beforeOption.lowStockThreshold,
            },
            { lockVersion: validation.value.lockVersion, ...option.stock }
          );
          data.stockMode = persistedStock.stockMode;
          data.isOutOfStock = persistedStock.isOutOfStock;
          data.stockQty = persistedStock.stockQty;
          data.lowStockThreshold = persistedStock.lowStockThreshold;
          data.stockUpdatedAt = now;
          data.stockUpdatedById = actorUserId === "legacy" ? null : actorUserId;
        }

        const touched = await tx.sharedModifierOption.updateMany({
          where: { id: option.id, groupId: id },
          data,
        });
        if (touched.count !== 1) throw new ModifierOptionNotFound();

        changedOptionIds.push(option.id);
        if (stockChanged) stockChangedOptionIds.push(option.id);
      }

      const changed = groupChanged || changedOptionIds.length > 0;
      if (!changed) return { group: before, changed: false as const };

      const groupTouched = await tx.sharedModifierGroup.updateMany({
        where: { id, lockVersion: validation.value.lockVersion },
        data: {
          ...modifierGroupDataFromFields(validation.value.groupFields),
          lockVersion: { increment: 1 },
          updatedAt: now,
        },
      });
      if (groupTouched.count !== 1) throw new ModifierGroupConflict();

      const refreshed = await tx.sharedModifierGroup.findUniqueOrThrow({
        where: { id },
        include: SHARED_MODIFIER_GROUP_INCLUDE,
      });
      const refreshedOptions = new Map(
        refreshed.options.map((option) => [option.id, option])
      );

      if (groupChanged) {
        await writeSharedModifierAudit(tx, {
          actionType: "MODIFIER_GROUP_UPDATED",
          targetType: "MODIFIER_GROUP",
          outletId: refreshed.outletId,
          targetId: refreshed.id,
          targetLabel: refreshed.name,
          beforePayload: modifierGroupSnapshotFromRecord(before),
          afterPayload: modifierGroupSnapshotFromRecord(refreshed),
          affectsAttachedMenu,
        });
      }

      for (const optionId of changedOptionIds) {
        const beforeOption = beforeOptions.get(optionId);
        const refreshedOption = refreshedOptions.get(optionId);
        if (!beforeOption || !refreshedOption) continue;
        const deactivating = beforeOption.isActive && !refreshedOption.isActive;

        if (stockChangedOptionIds.includes(optionId)) {
          await recordAdminStockMovement(tx, {
            outletId: refreshed.outletId,
            sharedModifierOptionId: refreshedOption.id,
            targetType: "SHARED_MODIFIER_OPTION",
            targetId: refreshedOption.id,
            targetNameSnapshot: refreshedOption.name,
            itemNameSnapshot: refreshed.name,
            before: {
              stockMode: beforeOption.stockMode,
              stockQty: beforeOption.stockQty,
            },
            after: {
              stockMode: refreshedOption.stockMode,
              stockQty: refreshedOption.stockQty,
            },
            actor: {
              actorType: actorUserId === "legacy" ? "ADMIN_BASIC" : "ADMIN_USER",
              actorId: actorUserId === "legacy" ? null : actorUserId,
            },
          });
        }

        await writeSharedModifierAudit(tx, {
          actionType: deactivating
            ? "MODIFIER_OPTION_DEACTIVATED"
            : "MODIFIER_OPTION_UPDATED",
          targetType: "MODIFIER_OPTION",
          outletId: refreshed.outletId,
          targetId: refreshedOption.id,
          targetLabel: refreshedOption.name,
          beforePayload: modifierOptionSnapshotFromRecord(beforeOption),
          afterPayload: modifierOptionSnapshotFromRecord(refreshedOption),
          affectsAttachedMenu,
        });
      }

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
      err instanceof ModifierOptionNotFound ||
      (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025")
    ) {
      return NextResponse.json(
        { error: "Modifier group or option not found", errorCode: "modifier_not_found" },
        { status: 404 }
      );
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        {
          error: "An active add-on set or option with that name already exists",
          errorCode: "duplicate_modifier",
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "Modifier group save failed", errorCode: "modifier_group_save_failed" },
      { status: 500 }
    );
  }
}
