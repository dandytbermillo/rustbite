// POST /api/admin/categories/[id]/reorder
//
// Dedicated drag-to-reorder endpoint for menu items within a single category.
// Built deliberately as a sort-only operation so it does NOT pay the costs of
// the general item PATCH (modifier resync, deal visibility refresh, per-item
// audit rows). Reorder writes ONE MENU_REORDERED audit/revision per request.
//
// Concurrency model — three layers of defense, in fire-frequency order:
//   1. `expectedCurrentOrder` (pre/in-tx compare)  — catches the case where
//      another reorder COMMITTED before this request started.
//   2. Postgres Serializable Snapshot Isolation     — catches truly concurrent
//      in-flight reorders. Loser surfaces Prisma `P2034`, mapped to 409.
//   3. Per-row `oldSortOrder` predicate on update   — final row-level guard
//      against any race that slipped through the first two.
//
// Note on `MenuItem.updatedAt`: Prisma's `@updatedAt` auto-bumps on every
// `updateMany` (schema.prisma:137). This is intentional — an open edit modal
// on a reordered item that includes `sortOrder` in its full-payload save
// would otherwise silently overwrite the new order. Bumping forces 409 on
// the modal save instead, which is the correct safety outcome.

import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApiPermission } from "@/lib/admin-sessions";
import { writeMenuAuditAndRevision } from "@/lib/menu-history";
import { parseOptimisticUpdatedAt } from "@/lib/menu-admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const CATEGORY_CHANGED_ERROR =
  "Category changed since you opened it. Reload and try again.";
const ORDER_CHANGED_ERROR =
  "Menu order changed in another session. Reload and try again.";
const SET_MISMATCH_ERROR =
  "Category items changed since you opened it. Reload and try again.";

class CategoryVersionConflict extends Error {
  constructor() {
    super(CATEGORY_CHANGED_ERROR);
    this.name = "CategoryVersionConflict";
  }
}
class OrderConflict extends Error {
  constructor() {
    super(ORDER_CHANGED_ERROR);
    this.name = "OrderConflict";
  }
}
class SetMismatch extends Error {
  constructor() {
    super(SET_MISMATCH_ERROR);
    this.name = "SetMismatch";
  }
}
class CategoryNotFound extends Error {
  constructor() {
    super("Category not found");
    this.name = "CategoryNotFound";
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function hasUniqueValues(arr: string[]): boolean {
  return new Set(arr).size === arr.length;
}

export async function POST(
  req: NextRequest,
  // Param slug must match the existing `categories/[id]/route.ts` segment —
  // Next.js rejects mixed slug names at the same dynamic path level.
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: categoryId } = await params;

  const existingCategory = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { id: true, outletId: true },
  });
  if (!existingCategory) {
    return NextResponse.json({ error: "Category not found" }, { status: 404 });
  }

  const authError = await requireAdminApiPermission(
    req,
    "admin.menu.write",
    existingCategory.outletId
  );
  if (authError) return authError;

  const raw = await req.json().catch(() => null);
  if (raw == null || typeof raw !== "object") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const version = parseOptimisticUpdatedAt(raw);
  if (!version.value) {
    return NextResponse.json({ error: version.error }, { status: 400 });
  }

  const body = raw as Record<string, unknown>;

  if (!isStringArray(body.orderedItemIds)) {
    return NextResponse.json(
      { error: "orderedItemIds must be an array of strings" },
      { status: 400 }
    );
  }
  const orderedItemIds = body.orderedItemIds;
  if (orderedItemIds.length === 0) {
    return NextResponse.json(
      { error: "orderedItemIds must not be empty" },
      { status: 400 }
    );
  }
  if (!hasUniqueValues(orderedItemIds)) {
    return NextResponse.json(
      { error: "orderedItemIds must not contain duplicates" },
      { status: 400 }
    );
  }

  if (!isStringArray(body.expectedCurrentOrder)) {
    return NextResponse.json(
      { error: "expectedCurrentOrder must be an array of strings" },
      { status: 400 }
    );
  }
  const expectedCurrentOrder = body.expectedCurrentOrder;
  if (expectedCurrentOrder.length === 0) {
    return NextResponse.json(
      { error: "expectedCurrentOrder must not be empty" },
      { status: 400 }
    );
  }
  if (!hasUniqueValues(expectedCurrentOrder)) {
    return NextResponse.json(
      { error: "expectedCurrentOrder must not contain duplicates" },
      { status: 400 }
    );
  }
  if (expectedCurrentOrder.length !== orderedItemIds.length) {
    return NextResponse.json(
      {
        error:
          "expectedCurrentOrder and orderedItemIds must have the same length",
      },
      { status: 400 }
    );
  }

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        // 1. Re-load category INSIDE tx; 409 if updatedAt drifted.
        const category = await tx.category.findUnique({
          where: { id: categoryId },
          select: {
            id: true,
            updatedAt: true,
            outletId: true,
            name: true,
          },
        });
        if (!category) throw new CategoryNotFound();
        if (category.updatedAt.toISOString() !== version.value!.iso) {
          throw new CategoryVersionConflict();
        }

        // 2. Re-read the exhaustive item set INSIDE the tx with the SAME
        //    three-level ordering as the UI's compareItemsByOrder helper.
        const items = await tx.menuItem.findMany({
          where: { categoryId },
          select: { id: true, sortOrder: true, name: true },
          orderBy: [
            { sortOrder: "asc" },
            { name: "asc" },
            { id: "asc" },
          ],
        });
        const beforeOrder = items.map((i) => i.id);

        // 3. expectedCurrentOrder guard (catches admin-loads-then-saves-after
        //    someone-else-already-reordered).
        if (beforeOrder.length !== expectedCurrentOrder.length) {
          throw new OrderConflict();
        }
        for (let i = 0; i < beforeOrder.length; i++) {
          if (beforeOrder[i] !== expectedCurrentOrder[i]) {
            throw new OrderConflict();
          }
        }

        // 4. Set comparison — catches mid-flight insert/delete vs. the new order.
        const currentIdSet = new Set(beforeOrder);
        if (currentIdSet.size !== orderedItemIds.length) {
          throw new SetMismatch();
        }
        for (const id of orderedItemIds) {
          if (!currentIdSet.has(id)) throw new SetMismatch();
        }

        // 5. No-op detection (after all safety checks). Skip audit + DB writes
        //    when the new order equals the current order.
        let changed = false;
        for (let i = 0; i < beforeOrder.length; i++) {
          if (beforeOrder[i] !== orderedItemIds[i]) {
            changed = true;
            break;
          }
        }
        if (!changed) {
          return {
            changed: false as const,
            items: items.map((i) => ({ id: i.id, sortOrder: i.sortOrder })),
          };
        }

        // 6. Per-row updateMany with old-sortOrder predicate (third concurrency
        //    defense — catches the residual case where SSI didn't fire).
        for (const [index, id] of orderedItemIds.entries()) {
          const current = items.find((i) => i.id === id);
          // current must exist — set check above guarantees it.
          if (!current) throw new SetMismatch();
          if (current.sortOrder === index) continue;
          const updated = await tx.menuItem.updateMany({
            where: { id, categoryId, sortOrder: current.sortOrder },
            data: { sortOrder: index, lockVersion: { increment: 1 } },
          });
          if (updated.count !== 1) throw new OrderConflict();
        }

        // 7. Single audit + revision for the whole reorder.
        await writeMenuAuditAndRevision(tx, {
          actionType: "MENU_REORDERED",
          targetType: "CATEGORY",
          outletId: category.outletId,
          targetId: category.id,
          targetLabel: category.name,
          beforePayload: { orderedItemIds: beforeOrder },
          afterPayload: { orderedItemIds },
        });

        const refreshed = await tx.menuItem.findMany({
          where: { categoryId },
          orderBy: [
            { sortOrder: "asc" },
            { name: "asc" },
            { id: "asc" },
          ],
          select: { id: true, sortOrder: true },
        });
        return { changed: true as const, items: refreshed };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof CategoryNotFound) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof CategoryVersionConflict) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof OrderConflict) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof SetMismatch) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    // Postgres serialization failure (SSI) → mapped to OrderConflict's 409
    // so the client's "another reorder won the race" handling fires.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2034"
    ) {
      return NextResponse.json({ error: ORDER_CHANGED_ERROR }, { status: 409 });
    }
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2025"
    ) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Reorder failed" }, { status: 500 });
  }
}
