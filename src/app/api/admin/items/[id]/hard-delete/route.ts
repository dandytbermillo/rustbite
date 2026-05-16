import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdminApiPermission } from "@/lib/admin-sessions";
import {
  itemSnapshotFromRecord,
  writeMenuAuditAndRevision,
} from "@/lib/menu-history";
import { parseMenuItemLockVersion } from "@/lib/menu-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const ITEM_CONFLICT_ERROR = "Item changed since you opened it. Reload and try again.";

const ITEM_INCLUDE = {
  sizes: { orderBy: { sortOrder: "asc" } },
  addons: { orderBy: { sortOrder: "asc" } },
  upgradeOptions: {
    orderBy: { sortOrder: "asc" },
    include: {
      linkedItems: { orderBy: { sortOrder: "asc" } },
    },
  },
} satisfies Prisma.MenuItemInclude;

type HardDeleteResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

function isKnownPrismaError(err: unknown, code: string) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;
}

export async function DELETE(
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

  const authError = await requireAdminApiPermission(
    req,
    "admin.menu.write",
    existingScope.outletId
  );
  if (authError) return authError;

  const raw = await req.json().catch(() => null);
  const version = parseMenuItemLockVersion(raw);
  if (version.error) {
    return NextResponse.json({ error: version.error }, { status: 400 });
  }
  const expectedLockVersion = version.value as number;

  try {
    const result = await prisma.$transaction(async (tx): Promise<HardDeleteResult> => {
      const locked = await tx.$queryRaw<
        Array<{
          id: string;
          lockVersion: number;
          updatedAt: Date;
          isActive: boolean;
          categorySlug: string;
        }>
      >`
        SELECT i.id, i."lockVersion", i."updatedAt", i."isActive", c.slug AS "categorySlug"
        FROM "MenuItem" i
        INNER JOIN "Category" c ON c.id = i."categoryId"
        WHERE i.id = ${id}
        FOR UPDATE
      `;

      const current = locked[0];
      if (!current) {
        return { ok: false, status: 404, error: "Item not found" };
      }
      if (current.lockVersion !== expectedLockVersion) {
        return { ok: false, status: 409, error: ITEM_CONFLICT_ERROR };
      }
      const isDeal = current.categorySlug === "deals";
      if (current.isActive && !isDeal) {
        return {
          ok: false,
          status: 400,
          error: "Active items cannot be deleted. Hide the item first.",
        };
      }

      const [orderItemCount, upgradeLinkCount, derivedDealCount] = await Promise.all([
        tx.orderItem.count({ where: { menuItemId: id } }),
        tx.upgradeItemLink.count({ where: { linkedMenuItemId: id } }),
        tx.menuItem.count({ where: { dealBaseMenuItemId: id } }),
      ]);

      if (orderItemCount > 0) {
        return {
          ok: false,
          status: 400,
          error: "This item has past orders and cannot be deleted. Hide it instead.",
        };
      }
      if (upgradeLinkCount > 0 && !isDeal) {
        return {
          ok: false,
          status: 400,
          error:
            "This item is still used by upgrade options. Remove or replace it there first.",
        };
      }
      if (derivedDealCount > 0) {
        return {
          ok: false,
          status: 400,
          error:
            "This item is the base item for one or more deals. Change those deal bases first.",
        };
      }

      const beforeItem = await tx.menuItem.findUniqueOrThrow({
        where: { id },
        include: ITEM_INCLUDE,
      });
      const beforeSnapshot = itemSnapshotFromRecord(beforeItem);

      if (isDeal && upgradeLinkCount > 0) {
        const referencingLinks = await tx.upgradeItemLink.findMany({
          where: { linkedMenuItemId: id },
          include: { linkedSize: true },
        });

        await Promise.all(
          referencingLinks.map((link) =>
            tx.upgradeItemLink.update({
              where: { id: link.id },
              data: {
                itemNameSnapshot: link.itemNameSnapshot ?? beforeItem.name,
                sizeNameSnapshot:
                  link.sizeNameSnapshot ?? link.linkedSize?.name ?? null,
              },
            })
          )
        );
      }

      await tx.menuItem.delete({ where: { id } });

      await writeMenuAuditAndRevision(tx, {
        actionType: "ITEM_DELETED",
        targetType: "ITEM",
        outletId: existingScope.outletId,
        targetId: beforeItem.id,
        targetLabel: beforeItem.name,
        beforePayload: beforeSnapshot,
      });

      return { ok: true };
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    if (isKnownPrismaError(err, "P2025")) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }
    if (isKnownPrismaError(err, "P2003")) {
      return NextResponse.json(
        {
          error: "This item has past orders and cannot be deleted. Hide it instead.",
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "Item delete failed" }, { status: 500 });
  }
}
