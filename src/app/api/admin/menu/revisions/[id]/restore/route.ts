import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApiPermission } from "@/lib/admin-sessions";
import {
  captureMenuSnapshot,
  parseMenuSnapshot,
  restoreMenuSnapshot,
  setCurrentMenuRevision,
  summarizeMenuSnapshot,
  writeMenuAuditLog,
} from "@/lib/menu-history";
import { bumpOutletMenuVersion } from "@/lib/outlet-menu-sync";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const revision = await prisma.menuRevision.findUnique({
    where: { id },
  });
  if (!revision) {
    return NextResponse.json({ error: "Revision not found" }, { status: 404 });
  }

  const authError = await requireAdminApiPermission(
    req,
    "admin.menu.restore",
    revision.outletId
  );
  if (authError) return authError;

  let snapshot;
  try {
    snapshot = parseMenuSnapshot(revision.snapshot);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Revision snapshot is invalid" },
      { status: 500 }
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const beforeSnapshot = await captureMenuSnapshot(tx, revision.outletId);
      if (JSON.stringify(beforeSnapshot) === JSON.stringify(snapshot)) {
        await setCurrentMenuRevision(tx, revision.id, revision.outletId);
        return {
          unchanged: true as const,
          summary: summarizeMenuSnapshot(beforeSnapshot),
        };
      }

      const afterSnapshot = await restoreMenuSnapshot(tx, snapshot, revision.outletId);

      await writeMenuAuditLog(tx, {
        actionType: "MENU_RESTORED",
        targetType: "MENU_REVISION",
        outletId: revision.outletId,
        targetId: revision.id,
        targetLabel: `Revision ${revision.id.slice(-6)}`,
        beforePayload: {
          summary: summarizeMenuSnapshot(beforeSnapshot),
        },
        afterPayload: {
          sourceRevisionId: revision.id,
          summary: summarizeMenuSnapshot(afterSnapshot),
        },
        sourceRevisionId: revision.id,
      });
      await setCurrentMenuRevision(tx, revision.id, revision.outletId);
      await bumpOutletMenuVersion(tx, revision.outletId);

      return {
        unchanged: false as const,
        summary: summarizeMenuSnapshot(afterSnapshot),
      };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch {
    return NextResponse.json({ error: "Revision restore failed" }, { status: 500 });
  }
}
