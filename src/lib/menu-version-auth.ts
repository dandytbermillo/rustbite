import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiPermissionContext } from "@/lib/admin-sessions";
import { getDeviceMenuOutletId } from "@/lib/device-menu-outlet";
import { getDeviceSessionFromRequest } from "@/lib/device-sessions";
import { prisma } from "@/lib/db";
import { isKioskSurfaceRequest } from "@/lib/kiosk-surface-request";
import {
  getOutletMenuVersion,
  type OutletMenuVersionDTO,
} from "@/lib/outlet-menu-sync";

export type AuthorizedMenuVersionResult =
  | { ok: true; version: OutletMenuVersionDTO }
  | { ok: false; response: NextResponse };

function unauthorizedResponse(): NextResponse {
  return NextResponse.json(
    { error: "Unauthorized", errorCode: "unauthorized" },
    { status: 401 }
  );
}

async function resolveKioskDeviceMenuVersion(
  req: NextRequest,
  expectedOutletId?: string
): Promise<AuthorizedMenuVersionResult> {
  const deviceActor = await getDeviceSessionFromRequest(req);
  const deviceOutletId = deviceActor ? getDeviceMenuOutletId(deviceActor) : null;

  if (!deviceActor || deviceActor.role !== "kiosk" || !deviceOutletId) {
    return { ok: false, response: unauthorizedResponse() };
  }
  if (expectedOutletId && deviceOutletId !== expectedOutletId) {
    return { ok: false, response: unauthorizedResponse() };
  }

  return {
    ok: true,
    version: await getOutletMenuVersion(prisma, deviceOutletId),
  };
}

export async function resolveAuthorizedMenuVersion(
  req: NextRequest,
  expectedOutletId?: string
): Promise<AuthorizedMenuVersionResult> {
  if (isKioskSurfaceRequest(req.nextUrl.searchParams)) {
    return resolveKioskDeviceMenuVersion(req, expectedOutletId);
  }

  // Admin pages and device pages are same-origin, so a browser can carry both
  // cookies. Prefer a valid admin session for admin freshness requests; only
  // fall back to kiosk-device auth when admin auth is plainly absent/expired.
  const adminContext = await requireAdminApiPermissionContext(
    req,
    "admin.menu.read",
    expectedOutletId
  );
  if (adminContext.ok) {
    return {
      ok: true,
      version: await getOutletMenuVersion(prisma, adminContext.context.outletId),
    };
  }
  if (adminContext.response.status !== 401) {
    return { ok: false, response: adminContext.response };
  }

  const deviceActor = await getDeviceSessionFromRequest(req);
  const deviceOutletId = deviceActor ? getDeviceMenuOutletId(deviceActor) : null;

  if (deviceActor) {
    if (deviceActor.role !== "kiosk" || !deviceOutletId) {
      return { ok: false, response: unauthorizedResponse() };
    }
    if (expectedOutletId && deviceOutletId !== expectedOutletId) {
      return { ok: false, response: unauthorizedResponse() };
    }
    return {
      ok: true,
      version: await getOutletMenuVersion(prisma, deviceOutletId),
    };
  }

  return { ok: false, response: adminContext.response };
}
