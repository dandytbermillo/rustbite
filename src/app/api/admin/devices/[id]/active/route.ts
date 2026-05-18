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
  parseDeviceRole,
  validateDeviceAssignment,
} from "@/lib/device-management";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function actorFromRequest(req: NextRequest): Promise<AuthAuditActor> {
  return authAuditActorFromSession(await getAdminSessionFromRequest(req));
}

export async function POST(
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
  // Covers disable too, which otherwise skips validation entirely.
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
  if (typeof raw.isActive !== "boolean") {
    return NextResponse.json(
      { error: "Active state is required" },
      { status: 400 }
    );
  }
  const isActive = raw.isActive;

  const existingRole = parseDeviceRole(existing.role);
  if (!existingRole) {
    return NextResponse.json(
      { error: "Stored device role is invalid" },
      { status: 500 }
    );
  }

  if (raw.isActive) {
    const assignment = await validateDeviceAssignment({
      role: existingRole,
      isSharedAcrossOutlets: existing.isSharedAcrossOutlets,
      outletId: existing.outletId,
      sharedOutletIds: existing.outletAccess.map((row) => row.outletId),
    });
    if (!assignment.ok) {
      return NextResponse.json(
        {
          error:
            "Fix this device's outlet assignment before enabling it again.",
        },
        { status: 400 }
      );
    }
  }

  if (existing.isActive === isActive) {
    return NextResponse.json({ ok: true });
  }

  const stepUpError = await requireFreshAdminStepUp(req);
  if (stepUpError) return stepUpError;

  const actor = await actorFromRequest(req);
  await prisma.$transaction(async (tx) => {
    await tx.device.update({
      where: { id },
      data: { isActive },
    });

    const revoked = await tx.deviceSession.updateMany({
      where: {
        deviceId: id,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    await writeAuthAudit(tx, {
      eventType: "DEVICE_UPDATED",
      actor,
      targetType: "DEVICE",
      targetId: id,
      targetLabel: existing.name,
      outletId: existing.outletId,
      metadata: {
        isActive,
        revokedSessions: revoked.count,
      },
    });
  });

  return NextResponse.json({ ok: true });
}
