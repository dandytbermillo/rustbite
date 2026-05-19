import "server-only";
import type { PrismaClient } from "@prisma/client";
import { syntheticExcludeWhere } from "@/lib/observability/synthetic-fixtures";

// Phase 3 deployment pre-flight — pure logic.
//
// The CLI in `scripts/preflight-active-operator.ts` is a thin formatter +
// process.exit() wrapper around `runActiveOperatorPreflight()`. Tests
// import this function directly so they can exercise the FAIL/WARN/PASS
// classification on controlled fixture data.
//
// Semantics (2026-04-30 product clarification):
//
//   FAIL: an outlet that has at least one active counter or kitchen
//         device has ZERO fully usable operators for one of its required
//         surfaces. The station is unusable; deployment is unsafe.
//
//   WARN: active STAFF/ADMIN with MANAGER/OPERATOR outlet role but
//         missing surface grant(s) or PIN. Informational only.
//
//   PASS: every (outlet, required-surface) pair has ≥1 fully usable
//         operator. Phase 3 enforcement is safe to enable.
//
// VIEWER outlet roles are not operators; they are ignored entirely.

export type Surface = "COUNTER" | "KITCHEN";

export type IncompleteOperator = {
  email: string;
  displayName: string;
  outletId: string;
  outletName: string;
  outletRole: string;
  missingSurfaces: Surface[];
  missingPin: boolean;
};

export type OutletSurfaceGap = {
  outletId: string;
  outletName: string;
  surface: Surface;
};

export type ActiveOperatorPreflightResult =
  | { kind: "no_devices" }
  | {
      kind: "pass";
      incomplete: IncompleteOperator[];
    }
  | {
      kind: "fail";
      gaps: OutletSurfaceGap[];
      incomplete: IncompleteOperator[];
    };

const OPERATOR_ROLES: ReadonlySet<string> = new Set(["MANAGER", "OPERATOR"]);

export async function runActiveOperatorPreflight(
  prisma: PrismaClient
): Promise<ActiveOperatorPreflightResult> {
  // 1. Gather (outletId → required surfaces) from active counter/kitchen devices.
  const devices = await prisma.device.findMany({
    where: {
      isActive: true,
      role: { in: ["counter", "kitchen"] },
      ...syntheticExcludeWhere(),
    },
    include: {
      outlet: { select: { id: true, name: true } },
      outletAccess: {
        include: { outlet: { select: { id: true, name: true } } },
      },
    },
  });

  const outletRequiredSurfaces = new Map<
    string,
    { outletName: string; surfaces: Set<Surface> }
  >();
  for (const device of devices) {
    const surface: Surface = device.role === "counter" ? "COUNTER" : "KITCHEN";
    const outlets =
      device.isSharedAcrossOutlets && device.outletAccess.length > 0
        ? device.outletAccess.map((row) => row.outlet)
        : device.outlet
          ? [device.outlet]
          : [];
    for (const outlet of outlets) {
      const existing = outletRequiredSurfaces.get(outlet.id);
      if (existing) {
        existing.surfaces.add(surface);
      } else {
        outletRequiredSurfaces.set(outlet.id, {
          outletName: outlet.name,
          surfaces: new Set([surface]),
        });
      }
    }
  }

  if (outletRequiredSurfaces.size === 0) {
    return { kind: "no_devices" };
  }

  // 2. Pull active STAFF/ADMIN with MANAGER/OPERATOR at any relevant outlet.
  //    VIEWER is intentionally excluded by the role filter.
  const users = await prisma.adminUser.findMany({
    where: {
      isActive: true,
      accountType: { in: ["STAFF", "ADMIN"] },
      outletRoles: {
        some: {
          outletId: { in: [...outletRequiredSurfaces.keys()] },
          role: { in: ["MANAGER", "OPERATOR"] },
        },
      },
    },
    select: {
      id: true,
      email: true,
      displayName: true,
      accountType: true,
      operationalPinHash: true,
      outletRoles: { select: { outletId: true, role: true } },
      surfaceAccess: { select: { surface: true } },
    },
  });

  // 3. Classify each user contribution per (outlet, surface).
  const fullyUsable = new Map<string, number>();
  const incomplete: IncompleteOperator[] = [];

  for (const user of users) {
    const grantedSurfaces = new Set<string>(
      user.surfaceAccess.map((row) => row.surface)
    );
    const hasPin = user.operationalPinHash !== null;

    for (const role of user.outletRoles) {
      if (!OPERATOR_ROLES.has(role.role)) continue;
      const required = outletRequiredSurfaces.get(role.outletId);
      if (!required) continue;

      const missingSurfaces: Surface[] = [];
      for (const surface of required.surfaces) {
        if (!grantedSurfaces.has(surface)) missingSurfaces.push(surface);
      }

      if (hasPin) {
        for (const surface of required.surfaces) {
          if (grantedSurfaces.has(surface)) {
            const key = `${role.outletId}:${surface}`;
            fullyUsable.set(key, (fullyUsable.get(key) ?? 0) + 1);
          }
        }
      }

      if (missingSurfaces.length > 0 || !hasPin) {
        incomplete.push({
          email: user.email,
          displayName: user.displayName,
          outletId: role.outletId,
          outletName: required.outletName,
          outletRole: role.role,
          missingSurfaces,
          missingPin: !hasPin,
        });
      }
    }
  }

  // 4. Detect (outlet, surface) gaps with no fully usable operator.
  const gaps: OutletSurfaceGap[] = [];
  for (const [outletId, info] of outletRequiredSurfaces) {
    for (const surface of info.surfaces) {
      const key = `${outletId}:${surface}`;
      if ((fullyUsable.get(key) ?? 0) === 0) {
        gaps.push({ outletId, outletName: info.outletName, surface });
      }
    }
  }

  if (gaps.length > 0) {
    return { kind: "fail", gaps, incomplete };
  }
  return { kind: "pass", incomplete };
}
