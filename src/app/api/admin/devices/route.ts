import { NextRequest, NextResponse } from "next/server";
import {
  getAdminSessionFromRequest,
  requireAdminApiPermission,
} from "@/lib/admin-sessions";
import { requireFreshAdminStepUp } from "@/lib/admin-step-up";
import {
  authAuditActorFromSession,
  listAdminOutlets,
  writeAuthAudit,
  type AuthAuditActor,
} from "@/lib/admin-user-management";
import { prisma } from "@/lib/db";
import {
  generateDeviceAccessCode,
  hashDeviceAccessCode,
  listDevices,
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

export async function GET(req: NextRequest) {
  const authError = await requireAdminApiPermission(
    req,
    "admin.auth.devices.manage"
  );
  if (authError) return authError;

  const [devices, outlets] = await Promise.all([listDevices(), listAdminOutlets()]);
  return NextResponse.json({ devices, outlets });
}

export async function POST(req: NextRequest) {
  const authError = await requireAdminApiPermission(
    req,
    "admin.auth.devices.manage"
  );
  if (authError) return authError;

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

  const role = parseDeviceRole(raw.role);
  if (!role) {
    return NextResponse.json({ error: "Device role is invalid" }, { status: 400 });
  }

  const assignment = await validateDeviceAssignment({
    role,
    isSharedAcrossOutlets: parseSharedAcrossOutlets(raw.isSharedAcrossOutlets),
    outletId: parseOutletId(raw.outletId),
    sharedOutletIds: parseSharedOutletIds(raw.sharedOutletIds) ?? [],
  });
  if (!assignment.ok) {
    return NextResponse.json({ error: assignment.error }, { status: 400 });
  }

  const stepUpError = await requireFreshAdminStepUp(req);
  if (stepUpError) return stepUpError;

  const accessCode = generateDeviceAccessCode();
  const secretHash = await hashDeviceAccessCode(accessCode);
  const actor = await actorFromRequest(req);

  const created = await prisma.$transaction(async (tx) => {
    const device = await tx.device.create({
      data: {
        name: name.value,
        physicalLocation: physicalLocation.value,
        role,
        isActive: true,
        isSharedAcrossOutlets: assignment.value.isSharedAcrossOutlets,
        outletId: assignment.value.outletId,
        secretHash,
        outletAccess:
          assignment.value.sharedOutletIds.length > 0
            ? {
                create: assignment.value.sharedOutletIds.map((outletId) => ({
                  outletId,
                })),
              }
            : undefined,
      },
    });

    await writeAuthAudit(tx, {
      eventType: "DEVICE_ENROLLED",
      actor,
      targetType: "DEVICE",
      targetId: device.id,
      targetLabel: device.name,
      outletId: device.outletId,
      metadata: {
        role,
        physicalLocation: physicalLocation.value,
        isSharedAcrossOutlets: assignment.value.isSharedAcrossOutlets,
        sharedOutletIds: assignment.value.sharedOutletIds,
      },
    });

    return device;
  });

  const devices = await listDevices();
  const device = devices.find((row) => row.id === created.id);
  if (!device) {
    return NextResponse.json({ error: "Device create failed" }, { status: 500 });
  }

  return NextResponse.json({ device, accessCode }, { status: 201 });
}
