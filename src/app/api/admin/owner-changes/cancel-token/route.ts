import { NextRequest, NextResponse } from "next/server";
import { getAdminSessionFromRequest } from "@/lib/admin-sessions";
import {
  authAuditActorFromSession,
  effectiveAdminAccountType,
} from "@/lib/admin-user-management";
import { cancelPendingOwnerChangeWithToken } from "@/lib/admin-owner-changes";
import { prisma } from "@/lib/db";
import { requireSameOriginMutation } from "@/lib/production-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: NextRequest) {
  const originError = requireSameOriginMutation(req);
  if (originError) return originError;

  const session = await getAdminSessionFromRequest(req);
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized", errorCode: "unauthorized" },
      { status: 401 }
    );
  }

  const actor = await prisma.adminUser.findUnique({
    where: { id: session.userId },
    select: { accountType: true, siteRole: true, isActive: true },
  });
  if (
    !actor?.isActive ||
    effectiveAdminAccountType(actor.accountType, actor.siteRole) !== "OWNER"
  ) {
    return NextResponse.json(
      { error: "Only active owners can cancel pending owner changes." },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => null);
  const token =
    body && typeof body === "object" && typeof (body as Record<string, unknown>).token === "string"
      ? (body as Record<string, string>).token
      : "";
  if (!token.trim()) {
    return NextResponse.json({ error: "Cancel token is required" }, { status: 400 });
  }

  const result = await cancelPendingOwnerChangeWithToken({
    token,
    actor: authAuditActorFromSession(session),
    actorId: session.userId,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, pendingOwnerChange: result.pending });
}
