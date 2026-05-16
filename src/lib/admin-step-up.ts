import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  ADMIN_SESSION_COOKIE,
  createSessionToken,
  hashSessionToken,
} from "@/lib/production-auth";
import {
  getAdminSessionFromRequest,
  setAdminSessionCookie,
} from "@/lib/admin-sessions";
import { effectiveAdminAccountType } from "@/lib/admin-user-management";
import { isOwnerOrAdminAccount } from "@/lib/admin-mfa";

export const ADMIN_STEP_UP_WINDOW_MS = 10 * 60 * 1000;

export function stepUpRequiredResponse(errorCode: string, error: string) {
  return NextResponse.json({ error, errorCode }, { status: 428 });
}

export async function requireFreshAdminStepUp(
  req: NextRequest
): Promise<NextResponse | null> {
  const session = await getAdminSessionFromRequest(req);
  if (!session) {
    return NextResponse.json(
      {
        error: "Sign in with an admin account to perform this sensitive action.",
        errorCode: "admin_session_required",
      },
      { status: 401 }
    );
  }

  const accountType = effectiveAdminAccountType(session.accountType, session.siteRole);
  if (!isOwnerOrAdminAccount(accountType)) return null;

  const current = await prisma.adminSession.findUnique({
    where: { id: session.sessionId },
    select: {
      stepUpExpiresAt: true,
      user: {
        select: {
          accountType: true,
          siteRole: true,
          mfaEnabledAt: true,
          mfaSecretCiphertext: true,
        },
      },
    },
  });

  if (!current) {
    return NextResponse.json(
      { error: "Admin session not found", errorCode: "unauthorized" },
      { status: 401 }
    );
  }

  const liveAccountType = effectiveAdminAccountType(
    current.user.accountType,
    current.user.siteRole
  );
  if (!isOwnerOrAdminAccount(liveAccountType)) return null;

  if (!current.user.mfaEnabledAt || !current.user.mfaSecretCiphertext) {
    return stepUpRequiredResponse(
      "mfa_enrollment_required",
      "MFA enrollment is required before this sensitive action."
    );
  }

  if (current.stepUpExpiresAt && current.stepUpExpiresAt > new Date()) {
    return null;
  }

  return stepUpRequiredResponse(
    "step_up_required",
    "Enter your MFA code before this sensitive action."
  );
}

export async function markAdminSessionStepUpVerified(
  req: NextRequest,
  response: NextResponse
): Promise<void> {
  const session = await getAdminSessionFromRequest(req);
  const currentToken = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (!session || !currentToken) return;

  const nextToken = createSessionToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ADMIN_STEP_UP_WINDOW_MS);

  const updated = await prisma.adminSession.update({
    where: { id: session.sessionId },
    data: {
      tokenHash: hashSessionToken(nextToken),
      stepUpVerifiedAt: now,
      stepUpExpiresAt: expiresAt,
      lastSeenAt: now,
    },
    select: { expiresAt: true },
  });

  setAdminSessionCookie(response, nextToken, updated.expiresAt);
}
