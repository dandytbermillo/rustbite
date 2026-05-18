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
  generateDeviceAccessCode,
  hashDeviceAccessCode,
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
    select: {
      id: true,
      name: true,
      outletId: true,
      isSynthetic: true,
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Device not found" }, { status: 404 });
  }
  const syntheticBlocked = syntheticByIdNotFound(existing);
  if (syntheticBlocked) return syntheticBlocked;

  const stepUpError = await requireFreshAdminStepUp(req);
  if (stepUpError) return stepUpError;

  const accessCode = generateDeviceAccessCode();
  const secretHash = await hashDeviceAccessCode(accessCode);
  const actor = await actorFromRequest(req);

  await prisma.$transaction(async (tx) => {
    const now = new Date();
    const revoked = await tx.deviceSession.updateMany({
      where: {
        deviceId: id,
        revokedAt: null,
      },
      data: { revokedAt: now },
    });

    await tx.device.update({
      where: { id },
      data: {
        secretHash,
        rotatedAt: now,
      },
    });

    await writeAuthAudit(tx, {
      eventType: "DEVICE_SECRET_ROTATED",
      actor,
      targetType: "DEVICE",
      targetId: id,
      targetLabel: existing.name,
      outletId: existing.outletId,
      metadata: {
        revokedSessions: revoked.count,
      },
    });
  });

  return NextResponse.json({ ok: true, accessCode });
}
