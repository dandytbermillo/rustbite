import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApiPermission } from "@/lib/admin-sessions";
import {
  categorySnapshotFromRecord,
  writeMenuAuditAndRevision,
} from "@/lib/menu-history";
import { parseOptimisticUpdatedAt, validateCategoryInput } from "@/lib/menu-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const CATEGORY_CONFLICT_ERROR =
  "Category changed since you opened it. Reload and try again.";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const existingCategory = await prisma.category.findUnique({
    where: { id },
    select: { id: true, updatedAt: true, outletId: true },
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
  const version = parseOptimisticUpdatedAt(raw);
  if (!version.value) {
    return NextResponse.json({ error: version.error }, { status: 400 });
  }
  if (existingCategory.updatedAt.toISOString() !== version.value.iso) {
    return NextResponse.json({ error: CATEGORY_CONFLICT_ERROR }, { status: 409 });
  }

  const validation = validateCategoryInput(raw);
  if (!validation.value) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const beforeCategory = await tx.category.findUniqueOrThrow({
        where: { id },
      });

      const updated = await tx.category.updateMany({
        where: { id, updatedAt: existingCategory.updatedAt },
        data: { ...validation.value, updatedAt: new Date() },
      });
      if (updated.count !== 1) {
        const current = await tx.category.findUnique({
          where: { id },
          select: { id: true },
        });
        return { ok: false as const, exists: !!current };
      }

      const refreshed = await tx.category.findUniqueOrThrow({
        where: { id },
      });

      await writeMenuAuditAndRevision(tx, {
        actionType: "CATEGORY_UPDATED",
        targetType: "CATEGORY",
        outletId: existingCategory.outletId,
        targetId: refreshed.id,
        targetLabel: refreshed.name,
        beforePayload: categorySnapshotFromRecord(beforeCategory),
        afterPayload: categorySnapshotFromRecord(refreshed),
      });

      return { ok: true as const, category: refreshed };
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.exists ? CATEGORY_CONFLICT_ERROR : "Category not found" },
        { status: result.exists ? 409 : 404 }
      );
    }
    return NextResponse.json(result.category);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: "A category with that slug already exists" },
        { status: 409 }
      );
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Category update failed" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const existingCategory = await prisma.category.findUnique({
    where: { id },
    select: { id: true, updatedAt: true, outletId: true },
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
  const version = parseOptimisticUpdatedAt(raw);
  if (!version.value) {
    return NextResponse.json({ error: version.error }, { status: 400 });
  }
  if (existingCategory.updatedAt.toISOString() !== version.value.iso) {
    return NextResponse.json({ error: CATEGORY_CONFLICT_ERROR }, { status: 409 });
  }

  const itemCount = await prisma.menuItem.count({ where: { categoryId: id } });
  if (itemCount > 0) {
    return NextResponse.json(
      { error: `Category has ${itemCount} items. Move them first.` },
      { status: 400 }
    );
  }
  try {
    const result = await prisma.$transaction(async (tx) => {
      const beforeCategory = await tx.category.findUniqueOrThrow({
        where: { id },
      });

      const deleted = await tx.category.deleteMany({
        where: { id, updatedAt: existingCategory.updatedAt },
      });
      if (deleted.count !== 1) {
        const current = await tx.category.findUnique({
          where: { id },
          select: { id: true },
        });
        return { ok: false as const, exists: !!current };
      }

      await writeMenuAuditAndRevision(tx, {
        actionType: "CATEGORY_DELETED",
        targetType: "CATEGORY",
        outletId: existingCategory.outletId,
        targetId: beforeCategory.id,
        targetLabel: beforeCategory.name,
        beforePayload: categorySnapshotFromRecord(beforeCategory),
      });

      return { ok: true as const };
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.exists ? CATEGORY_CONFLICT_ERROR : "Category not found" },
        { status: result.exists ? 409 : 404 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      return NextResponse.json(
        { error: "Category has items. Move them first." },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "Category delete failed" }, { status: 500 });
  }
}
