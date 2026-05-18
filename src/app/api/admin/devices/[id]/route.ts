import { NextRequest, NextResponse } from "next/server";
import { syntheticByIdNotFound } from "@/lib/observability/synthetic-route-guard";
import {
  getAdminSessionFromRequest,
  requireAdminApiPermission,
} from "@/lib/admin-sessions";
import { requireFreshAdminStepUp } from "@/lib/admin-step-up";
import {
  authAuditActorFromSession,
  writeAuthAudit,
  type AuthAuditActor,
} from "@/lib/admin-user-management";
import { prisma } from "@/lib/db";
import {
  parseDeviceName,
  parseDevicePhysicalLocation,
  parseDeviceRole,
  parseOutletId,
  parseSharedAcrossOutlets,
  parseSharedOutletIds,
  validateDeviceAssignment,
} from "@/lib/device-management";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function actorFromRequest(req: NextRequest): Promise<AuthAuditActor> {
  return authAuditActorFromSession(await getAdminSessionFromRequest(req));
}

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const aSorted = [...a].sort();
  const bSorted = [...b].sort();
  return aSorted.every((value, index) => value === bSorted[index]);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAdminApiPermission(
    req,
    "admin.auth.devices.manage"
  );
  if (authError) return authError;

  const { id } = await params;
  const existing = await prisma.device.findUnique({
    where: { id },
    include: {
      outletAccess: {
        select: { outletId: true },
      },
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Device not found" }, { status: 404 });
  }
  const syntheticBlocked = syntheticByIdNotFound(existing);
  if (syntheticBlocked) return syntheticBlocked;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const raw = body as Record<string, unknown>;

  const name = parseDeviceName(raw.name);
  if (!name.ok) return NextResponse.json({ error: name.error }, { status: 400 });

  const physicalLocation = parseDevicePhysicalLocation(raw.physicalLocation);
  if (!physicalLocation.ok) {
    return NextResponse.json({ error: physicalLocation.error }, { status: 400 });
  }

  if (typeof raw.isActive !== "boolean") {
    return NextResponse.json({ error: "Active state is required" }, { status: 400 });
  }
  const isActive = raw.isActive;
  const existingRole = parseDeviceRole(existing.role);
  if (!existingRole) {
    return NextResponse.json({ error: "Stored device role is invalid" }, { status: 500 });
  }

  const assignment = await validateDeviceAssignment({
    role: existingRole,
    isSharedAcrossOutlets: parseSharedAcrossOutlets(raw.isSharedAcrossOutlets),
    outletId: parseOutletId(raw.outletId),
    sharedOutletIds: parseSharedOutletIds(raw.sharedOutletIds) ?? [],
  });
  if (!assignment.ok) {
    return NextResponse.json({ error: assignment.error }, { status: 400 });
  }

  const previousSharedOutletIds = existing.outletAccess.map((row) => row.outletId);
  const accessChanged =
    existing.isActive !== isActive ||
    existing.outletId !== assignment.value.outletId ||
    existing.isSharedAcrossOutlets !== assignment.value.isSharedAcrossOutlets ||
    !sameIds(previousSharedOutletIds, assignment.value.sharedOutletIds);

  if (accessChanged) {
    const stepUpError = await requireFreshAdminStepUp(req);
    if (stepUpError) return stepUpError;
  }

  const actor = await actorFromRequest(req);

  await prisma.$transaction(async (tx) => {
    await tx.device.update({
      where: { id },
      data: {
        name: name.value,
        physicalLocation: physicalLocation.value,
        isActive,
        isSharedAcrossOutlets: assignment.value.isSharedAcrossOutlets,
        outletId: assignment.value.outletId,
      },
    });

    await tx.deviceOutletAccess.deleteMany({
      where: { deviceId: id },
    });
    if (assignment.value.sharedOutletIds.length > 0) {
      await tx.deviceOutletAccess.createMany({
        data: assignment.value.sharedOutletIds.map((outletId) => ({
          deviceId: id,
          outletId,
        })),
      });
    }

    let revokedCount = 0;
    if (accessChanged) {
      const revoked = await tx.deviceSession.updateMany({
        where: {
          deviceId: id,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
      revokedCount = revoked.count;
    }

    await writeAuthAudit(tx, {
      eventType: "DEVICE_UPDATED",
      actor,
      targetType: "DEVICE",
      targetId: id,
      targetLabel: existing.name,
      outletId: assignment.value.outletId,
      metadata: {
        isActive,
        physicalLocation: physicalLocation.value,
        isSharedAcrossOutlets: assignment.value.isSharedAcrossOutlets,
        outletId: assignment.value.outletId,
        sharedOutletIds: assignment.value.sharedOutletIds,
        revokedSessions: revokedCount,
      },
    });
  });

  return NextResponse.json({ ok: true });
}
