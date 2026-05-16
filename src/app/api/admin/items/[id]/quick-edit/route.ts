import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdminApiPermissionContext } from "@/lib/admin-sessions";
import {
  itemSnapshotFromRecord,
  writeMenuAuditAndRevision,
} from "@/lib/menu-history";
import { validateItemQuickEditInput } from "@/lib/menu-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const ITEM_CONFLICT_ERROR =
  "Item changed since you opened it. Reload and try again.";

// Keep this include shape aligned with the full item edit route. Quick-edit
// writes full before/after snapshots so restore history does not lose sizes,
// add-ons, or deal-link state while changing only price/badge.
const ITEM_AUDIT_INCLUDE = {
  category: { select: { id: true, name: true, slug: true } },
  sizes: { orderBy: { sortOrder: "asc" } },
  addons: { orderBy: { sortOrder: "asc" } },
  upgradeOptions: {
    orderBy: { sortOrder: "asc" },
    include: {
      linkedItems: {
        orderBy: { sortOrder: "asc" },
        include: {
          linkedMenuItem: {
            select: {
              id: true,
              name: true,
              emoji: true,
              bgColor: true,
              isActive: true,
              isOutOfStock: true,
              stockMode: true,
              stockQty: true,
              price: true,
              sizes: { select: { id: true } },
            },
          },
          linkedSize: { select: { id: true, name: true, priceDelta: true } },
        },
      },
    },
  },
} satisfies Prisma.MenuItemInclude;

class ItemVersionConflict extends Error {
  constructor() {
    super(ITEM_CONFLICT_ERROR);
  }
}

class ItemNotFound extends Error {}

class ItemQuickEditBadRequest extends Error {}

function quickEditResponse(
  item: Prisma.MenuItemGetPayload<{ include: typeof ITEM_AUDIT_INCLUDE }>
) {
  return {
    id: item.id,
    price: Number(item.price),
    badge: item.badge,
    lockVersion: item.lockVersion,
    updatedAt: item.updatedAt.toISOString(),
  };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const existingScope = await prisma.menuItem.findUnique({
    where: { id },
    select: { id: true, outletId: true },
  });
  if (!existingScope) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  const auth = await requireAdminApiPermissionContext(
    req,
    "admin.menu.write",
    existingScope.outletId
  );
  if (!auth.ok) return auth.response;

  const raw = await req.json().catch(() => null);
  const validation = validateItemQuickEditInput(raw);
  if (!validation.value) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const input = validation.value;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const beforeItem = await tx.menuItem.findUnique({
        where: { id },
        include: ITEM_AUDIT_INCLUDE,
      });
      if (!beforeItem) {
        throw new ItemNotFound();
      }
      if (beforeItem.outletId !== existingScope.outletId) {
        throw new ItemVersionConflict();
      }
      const isDeal = beforeItem.category.slug === "deals";
      if (isDeal && input.fields.price) {
        throw new ItemQuickEditBadRequest("Deal price cannot be quick-edited");
      }
      if (beforeItem.lockVersion !== input.lockVersion) {
        throw new ItemVersionConflict();
      }

      const data: Prisma.MenuItemUncheckedUpdateInput = {};
      if (
        input.fields.price &&
        Number(beforeItem.price) !== Number(input.price)
      ) {
        data.price = new Prisma.Decimal(input.price as number);
      }
      if (
        input.fields.badge &&
        (beforeItem.badge ?? null) !== (input.badge ?? null)
      ) {
        data.badge = input.badge ?? null;
      }

      if (Object.keys(data).length === 0) {
        return { item: beforeItem, changed: false } as const;
      }

      const touched = await tx.menuItem.updateMany({
        where: { id, lockVersion: input.lockVersion },
        data: {
          ...data,
          lockVersion: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (touched.count !== 1) {
        throw new ItemVersionConflict();
      }

      const refreshed = await tx.menuItem.findUniqueOrThrow({
        where: { id },
        include: ITEM_AUDIT_INCLUDE,
      });

      await writeMenuAuditAndRevision(tx, {
        actionType: "ITEM_UPDATED",
        targetType: "ITEM",
        outletId: existingScope.outletId,
        targetId: refreshed.id,
        targetLabel: refreshed.name,
        beforePayload: itemSnapshotFromRecord(beforeItem),
        afterPayload: itemSnapshotFromRecord(refreshed),
      });

      return { item: refreshed, changed: true } as const;
    });

    return NextResponse.json(quickEditResponse(updated.item));
  } catch (err) {
    if (err instanceof ItemQuickEditBadRequest) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof ItemVersionConflict) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof ItemNotFound) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Item quick edit failed" }, { status: 500 });
  }
}
