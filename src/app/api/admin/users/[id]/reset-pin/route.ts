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
  generateOperationalPin,
  hashOperationalPin,
  parseOperationalPin,
} from "@/lib/operational-pin";
import { cascadeClearActiveOperator } from "@/lib/active-operator-cascade";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function actorFromRequest(req: NextRequest): Promise<AuthAuditActor> {
  return authAuditActorFromSession(await getAdminSessionFromRequest(req));
}

type ResetPinBody = {
  pin?: unknown;
  generate?: unknown;
};

export async function POST(
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
      isActive: true,
      operationalPinHash: true,
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Admin user not found" }, { status: 404 });
  }

  const session = await getAdminSessionFromRequest(req);

  // V1: Owner-only for operational PIN management. Plan §392-395.
  if (!canManageSiteAdminAccounts(session)) {
    return NextResponse.json(
      { error: "Only owners can reset operational PINs" },
      { status: 403 }
    );
  }

  // PIN management is only available for STAFF and ADMIN users (the two
  // account types that can be operators). Plan §400-401.
  const effectiveType = effectiveAdminAccountType(
    existing.accountType,
    existing.siteRole
  );
  if (effectiveType !== "STAFF" && effectiveType !== "ADMIN") {
    return NextResponse.json(
      {
        error: "Operational PIN is only available for staff or admin users",
        errorCode: "ineligible_account_type",
      },
      { status: 400 }
    );
  }

  const stepUpError = await requireFreshAdminStepUp(req);
  if (stepUpError) return stepUpError;

  const body = (await req.json().catch(() => null)) as ResetPinBody | null;
  const wantsAutoGenerate =
    body?.generate === true ||
    (body?.pin === undefined && body?.pin !== "");

  let resolvedPin: string;
  let pinSource: "manual" | "auto";

  try {
    if (typeof body?.pin === "string" && body.pin.length > 0) {
      const parsed = parseOperationalPin(body.pin);
      if (!parsed.ok) {
        return NextResponse.json(
          {
            error: `PIN rejected: ${parsed.reason}`,
            errorCode: "weak_pin",
            reason: parsed.reason,
          },
          { status: 400 }
        );
      }
      resolvedPin = parsed.pin;
      pinSource = "manual";
    } else if (wantsAutoGenerate) {
      resolvedPin = generateOperationalPin();
      pinSource = "auto";
    } else {
      return NextResponse.json(
        { error: "Provide a pin or set generate=true", errorCode: "bad_request" },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error("Could not resolve operational PIN", error);
    return NextResponse.json(
      {
        error: "Operational PIN service is not configured correctly.",
        errorCode: "operational_pin_unavailable",
      },
      { status: 500 }
    );
  }

  let pinHash: string;
  try {
    pinHash = await hashOperationalPin(resolvedPin);
  } catch (error) {
    console.error("Could not hash operational PIN", error);
    return NextResponse.json(
      {
        error: "Operational PIN service is not configured correctly.",
        errorCode: "operational_pin_unavailable",
      },
      { status: 500 }
    );
  }

  const actor = await actorFromRequest(req);
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    await tx.adminUser.update({
      where: { id },
      data: {
        operationalPinHash: pinHash,
        operationalPinChangedAt: now,
      },
    });

    // Cascade: any device session where this user is the active operator
    // must be invalidated immediately. Plan §400-405 / §572-575.
    const cascade = await cascadeClearActiveOperator(tx, {
      filter: { kind: "user", userId: id },
      reason: "PIN_RESET",
      actor,
    });

    await writeAuthAudit(tx, {
      eventType: "OPERATIONAL_PIN_RESET",
      actor,
      targetId: id,
      targetLabel: existing.email,
      metadata: {
        pinSource,
        previouslySet: existing.operationalPinHash !== null,
        cascadeClearedSessionCount: cascade.clearedSessionIds.length,
      },
    });

    return { cascade };
  });

  return NextResponse.json({
    ok: true,
    pinSource,
    // Only include the PIN if it was auto-generated. Manual PINs were
    // supplied by the Owner and are never echoed back. Plan §327-329.
    pin: pinSource === "auto" ? resolvedPin : undefined,
    cascadeClearedSessionCount: result.cascade.clearedSessionIds.length,
  });
}
