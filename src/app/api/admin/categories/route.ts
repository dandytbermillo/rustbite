import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApiPermissionContext } from "@/lib/admin-sessions";
import {
  categorySnapshotFromRecord,
  writeMenuAuditAndRevision,
} from "@/lib/menu-history";
import { validateCategoryInput } from "@/lib/menu-admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const auth = await requireAdminApiPermissionContext(req, "admin.menu.read");
  if (!auth.ok) return auth.response;

  const categories = await prisma.category.findMany({
    where: { outletId: auth.context.outletId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { items: true } } },
  });
  return NextResponse.json({ categories });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminApiPermissionContext(req, "admin.menu.write");
  if (!auth.ok) return auth.response;

  const validation = validateCategoryInput(await req.json().catch(() => null));
  if (!validation.value) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const categoryInput = validation.value;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const category = await tx.category.create({
        data: { ...categoryInput, outletId: auth.context.outletId },
      });

      await writeMenuAuditAndRevision(tx, {
        actionType: "CATEGORY_CREATED",
        targetType: "CATEGORY",
        outletId: auth.context.outletId,
        targetId: category.id,
        targetLabel: category.name,
        afterPayload: categorySnapshotFromRecord(category),
      });

      return category;
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: "A category with that slug already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Category create failed" }, { status: 500 });
  }
}
