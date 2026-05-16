import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { hashAdminPassword } from "@/lib/admin-passwords";
import {
  getAdminSessionFromRequest,
  requireAdminApiPermission,
} from "@/lib/admin-sessions";
import { requireFreshAdminStepUp } from "@/lib/admin-step-up";
import {
  assertKnownOutletRoles,
  authAuditActorFromSession,
  accountTypeToSiteRole,
  canManageSiteAdminAccounts,
  isSiteAdminAccountRole,
  listAdminOutlets,
  listAdminUsers,
  parseAdminAccountType,
  parseDisplayName,
  parseEmail,
  parseOutletRoles,
  parsePassword,
  writeAuthAudit,
  type AuthAuditActor,
} from "@/lib/admin-user-management";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function actorFromRequest(req: NextRequest): Promise<AuthAuditActor> {
  return authAuditActorFromSession(await getAdminSessionFromRequest(req));
}

export async function GET(req: NextRequest) {
  const authError = await requireAdminApiPermission(
    req,
    "admin.auth.users.manage"
  );
  if (authError) return authError;

  const [users, outlets] = await Promise.all([listAdminUsers(), listAdminOutlets()]);
  return NextResponse.json({ users, outlets });
}

export async function POST(req: NextRequest) {
  const authError = await requireAdminApiPermission(
    req,
    "admin.auth.users.manage"
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

  const email = parseEmail(raw.email);
  if (!email.ok) return NextResponse.json({ error: email.error }, { status: 400 });

  const displayName = parseDisplayName(raw.displayName);
  if (!displayName.ok) {
    return NextResponse.json({ error: displayName.error }, { status: 400 });
  }

  const password = parsePassword(raw.password);
  if (!password.ok) {
    return NextResponse.json({ error: password.error }, { status: 400 });
  }

  const accountType = parseAdminAccountType(raw.accountType ?? raw.siteRole);
  if (accountType === undefined) {
    return NextResponse.json({ error: "Account type is invalid" }, { status: 400 });
  }
  const siteRole = accountTypeToSiteRole(accountType);

  const outletRoles = parseOutletRoles(raw.outletRoles);
  if (!outletRoles.ok) {
    return NextResponse.json({ error: outletRoles.error }, { status: 400 });
  }

  const roleCheck = await assertKnownOutletRoles(outletRoles.value);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: roleCheck.error }, { status: 400 });
  }

  const session = await getAdminSessionFromRequest(req);
  if (!canManageSiteAdminAccounts(session) && isSiteAdminAccountRole(accountType)) {
    return NextResponse.json(
      { error: "Only owners can create owner or admin accounts" },
      { status: 403 }
    );
  }

  if (accountType === "STAFF" && outletRoles.value.length === 0) {
    return NextResponse.json(
      { error: "Staff users need at least one outlet role" },
      { status: 400 }
    );
  }

  const stepUpError = await requireFreshAdminStepUp(req);
  if (stepUpError) return stepUpError;

  const passwordHash = await hashAdminPassword(password.value);
  const actor = await actorFromRequest(req);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.adminUser.create({
        data: {
          email: email.value,
          displayName: displayName.value,
          passwordHash,
          accountType,
          siteRole,
          isActive: true,
          passwordChangedAt: new Date(),
          outletRoles:
            outletRoles.value.length > 0
              ? {
                  create: outletRoles.value.map((role) => ({
                    outletId: role.outletId,
                    role: role.role,
                  })),
                }
              : undefined,
        },
        select: { id: true, email: true },
      });

      await writeAuthAudit(tx, {
        eventType: "ADMIN_USER_CREATED",
        actor,
        targetId: user.id,
        targetLabel: user.email,
        metadata: {
          siteRole,
          accountType,
          outletRoles: outletRoles.value,
        },
      });

      return user;
    });

    return NextResponse.json({ ok: true, user: created }, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: "An admin user with that email already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Admin user create failed" }, { status: 500 });
  }
}
