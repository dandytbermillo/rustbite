import { NextRequest, NextResponse } from "next/server";
import {
  getAdminSessionFromRequest,
  requireAdminApiPermission,
} from "@/lib/admin-sessions";
import { requireFreshAdminStepUp } from "@/lib/admin-step-up";
import {
  authAuditActorFromSession,
  canManageSiteAdminAccounts,
  effectiveAdminAccountType,
  writeAuthAudit,
  type AuthAuditActor,
} from "@/lib/admin-user-management";
import {
  EDITABLE_SURFACES,
  parseEditableSurface,
  type EditableSurface,
} from "@/lib/admin-user-surface-access";
import { cascadeClearActiveOperator } from "@/lib/active-operator-cascade";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function actorFromRequest(req: NextRequest): Promise<AuthAuditActor> {
  return authAuditActorFromSession(await getAdminSessionFromRequest(req));
}

type SurfaceAccessBody = {
  surfaces?: unknown;
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAdminApiPermission(
    req,
    "admin.auth.users.manage"
  );
  if (authError) return authError;

  const { id } = await params;

  const existing = await prisma.adminUser.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      accountType: true,
      siteRole: true,
      surfaceAccess: { select: { surface: true } },
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Admin user not found" }, { status: 404 });
  }

  const session = await getAdminSessionFromRequest(req);

  // V1: Owner-only for surface management. Plan §391-393.
  if (!canManageSiteAdminAccounts(session)) {
    return NextResponse.json(
      { error: "Only owners can edit surface access" },
      { status: 403 }
    );
  }

  // Surface access is editable for STAFF and ADMIN only. Owners are not
  // eligible operator picks in v1 (Plan §408-411).
  const effectiveType = effectiveAdminAccountType(
    existing.accountType,
    existing.siteRole
  );
  if (effectiveType !== "STAFF" && effectiveType !== "ADMIN") {
    return NextResponse.json(
      {
        error: "Surface access is only available for staff or admin users",
        errorCode: "ineligible_account_type",
      },
      { status: 400 }
    );
  }

  const body = (await req.json().catch(() => null)) as SurfaceAccessBody | null;
  if (!body || !Array.isArray(body.surfaces)) {
    return NextResponse.json(
      { error: "surfaces must be an array", errorCode: "bad_request" },
      { status: 400 }
    );
  }

  // Parse + de-duplicate. parseEditableSurface rejects ADMIN/BOARD/KIOSK
  // and any unknown value, satisfying Plan §152-157.
  const requested = new Set<EditableSurface>();
  for (const raw of body.surfaces) {
    const parsed = parseEditableSurface(raw);
    if (!parsed) {
      return NextResponse.json(
        {
          error: `Surface not allowed in v1: ${String(raw)}`,
          errorCode: "surface_not_allowed",
        },
        { status: 400 }
      );
    }
    requested.add(parsed);
  }

  const previous = new Set<EditableSurface>(
    existing.surfaceAccess
      .map((row) => row.surface)
      .filter(
        (surface): surface is EditableSurface =>
          surface === "COUNTER" || surface === "KITCHEN"
      )
  );

  const toAdd = [...requested].filter((surface) => !previous.has(surface));
  const toRemove = [...previous].filter((surface) => !requested.has(surface));

  if (toAdd.length === 0 && toRemove.length === 0) {
    return NextResponse.json({
      ok: true,
      surfaces: [...requested],
      changed: false,
      cascadeClearedSessionCount: 0,
    });
  }

  const stepUpError = await requireFreshAdminStepUp(req);
  if (stepUpError) return stepUpError;

  const actor = await actorFromRequest(req);

  const result = await prisma.$transaction(async (tx) => {
    if (toRemove.length > 0) {
      await tx.adminUserSurfaceAccess.deleteMany({
        where: { userId: id, surface: { in: toRemove } },
      });
    }
    if (toAdd.length > 0) {
      await tx.adminUserSurfaceAccess.createMany({
        data: toAdd.map((surface) => ({ userId: id, surface })),
      });
    }

    // Cascade: revoking COUNTER (or KITCHEN) clears any active-operator
    // state on devices of that surface where this user is currently
    // signed in. Plan §419-420.
    let totalCleared = 0;
    for (const surface of toRemove) {
      const cascade = await cascadeClearActiveOperator(tx, {
        filter: { kind: "user-surface", userId: id, surface },
        reason: "SURFACE_ACCESS_REMOVED",
        actor,
        extraMetadata: { removedSurface: surface },
      });
      totalCleared += cascade.clearedSessionIds.length;
    }

    await writeAuthAudit(tx, {
      eventType: "USER_SURFACE_ACCESS_UPDATED",
      actor,
      targetId: id,
      targetLabel: existing.email,
      metadata: {
        previousSurfaces: [...previous].sort(),
        nextSurfaces: [...requested].sort(),
        added: toAdd,
        removed: toRemove,
        cascadeClearedSessionCount: totalCleared,
      },
    });

    return { totalCleared };
  });

  return NextResponse.json({
    ok: true,
    surfaces: [...requested].sort(),
    changed: true,
    added: toAdd,
    removed: toRemove,
    editableSurfaces: [...EDITABLE_SURFACES],
    cascadeClearedSessionCount: result.totalCleared,
  });
}
