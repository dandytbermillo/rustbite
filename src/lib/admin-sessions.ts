import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { hasValidAdminAuth, isValidAdminAuthorizationHeader } from "@/lib/admin-auth";
import { DEFAULT_OUTLET_ID } from "@/lib/outlets";
import {
  resolveAdminActiveOutlet,
  type AdminActiveOutletResolution,
} from "@/lib/admin-active-outlet";
import {
  ADMIN_SESSION_COOKIE,
  type AdminPermission,
  adminHasPermission,
  cookieMaxAgeSeconds,
  computeAdminMfaEnrollmentSessionExpiry,
  computeAdminSessionExpiry,
  createSessionToken,
  hashSessionToken,
  ownerHasPermission,
  requireSameOriginMutation,
  roleHasPermission,
  shouldTouchLastSeen,
} from "@/lib/production-auth";

export type AdminSessionActor = {
  sessionId: string;
  userId: string;
  email: string;
  displayName: string;
  accountType: string;
  siteRole: string | null;
  mfaEnrollmentRequired: boolean;
};

type CookieReader = {
  get(name: string): { value: string } | undefined;
};

type HeaderReader = {
  get(name: string): string | null;
};

export type AdminPermissionContext = {
  actor: AdminSessionActor;
  outletId: string;
  activeOutlet: Extract<AdminActiveOutletResolution, { status: "active" }>;
};

export function hasAdminSessionCookie(req: NextRequest): boolean {
  return Boolean(req.cookies.get(ADMIN_SESSION_COOKIE)?.value);
}

export async function createAdminSession(
  userId: string,
  req: NextRequest,
  options: { mfaEnrollmentOnly?: boolean } = {}
): Promise<{ token: string; expiresAt: Date }> {
  const token = createSessionToken();
  const expiresAt = options.mfaEnrollmentOnly
    ? computeAdminMfaEnrollmentSessionExpiry()
    : computeAdminSessionExpiry();

  await prisma.adminSession.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt,
      userAgent: req.headers.get("user-agent") ?? null,
      ipHash: null,
    },
  });

  return { token, expiresAt };
}

export function setAdminSessionCookie(
  response: NextResponse,
  token: string,
  expiresAt: Date
) {
  response.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: cookieMaxAgeSeconds(expiresAt),
  });
}

export function clearAdminSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}

export async function revokeAdminSessionToken(token: string | null | undefined) {
  if (!token) return;
  await prisma.adminSession.updateMany({
    where: {
      tokenHash: hashSessionToken(token),
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
}

export async function getAdminSessionFromCookieReader(
  cookieReader: CookieReader
): Promise<AdminSessionActor | null> {
  const token = cookieReader.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token) return null;

  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const session = await prisma.adminSession.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          displayName: true,
          accountType: true,
          siteRole: true,
          isActive: true,
          mfaEnabledAt: true,
        },
      },
    },
  });

  if (
    !session ||
    session.revokedAt ||
    session.expiresAt <= now ||
    !session.user.isActive
  ) {
    return null;
  }

  if (shouldTouchLastSeen(session.lastSeenAt, now)) {
    await prisma.adminSession.update({
      where: { id: session.id },
      data: { lastSeenAt: now },
    });
  }

  const accountType =
    session.user.accountType === "OWNER" ||
    session.user.accountType === "ADMIN" ||
    session.user.accountType === "STAFF"
      ? session.user.accountType
      : session.user.siteRole === "OWNER" || session.user.siteRole === "ADMIN"
        ? session.user.siteRole
      : "STAFF";
  const mfaEnrollmentRequired =
    (accountType === "OWNER" || accountType === "ADMIN") &&
    !session.user.mfaEnabledAt;

  return {
    sessionId: session.id,
    userId: session.user.id,
    email: session.user.email,
    displayName: session.user.displayName,
    accountType,
    siteRole: accountType === "STAFF" ? null : accountType,
    mfaEnrollmentRequired,
  };
}

function mfaEnrollmentRequiredResponse() {
  return NextResponse.json(
    {
      error: "MFA enrollment is required before using admin tools.",
      errorCode: "mfa_enrollment_required",
    },
    { status: 428 }
  );
}

export async function getAdminSessionFromRequest(
  req: NextRequest
): Promise<AdminSessionActor | null> {
  return getAdminSessionFromCookieReader(req.cookies);
}

export async function getServerAdminSession(): Promise<AdminSessionActor | null> {
  return getAdminSessionFromCookieReader(await cookies());
}

export async function hasLegacyAdminHeader(
  headerReader: HeaderReader
): Promise<boolean> {
  return isValidAdminAuthorizationHeader(headerReader.get("authorization"));
}

export async function requireAdminPageAuth() {
  if (await hasLegacyAdminHeader(await headers())) return;
  if (await getServerAdminSession()) return;
  redirect("/admin/login");
}

export async function requireAdminPagePermission(
  permission: AdminPermission,
  outletId?: string
): Promise<AdminPermissionContext | null> {
  if (await hasLegacyAdminHeader(await headers())) return null;

  const session = await getServerAdminSession();
  if (!session) redirect("/admin/login");
  if (session.mfaEnrollmentRequired) redirect("/admin/security/mfa");
  const activeOutlet = await resolveAdminActiveOutlet(
    session,
    await cookies(),
    outletId
  );
  if (activeOutlet.status === "no_access") redirect("/admin/no-access");
  if (activeOutlet.status === "needs_picker") redirect("/admin/select-outlet");

  if (await adminActorHasPermission(session, permission, activeOutlet.outletId)) {
    return { actor: session, outletId: activeOutlet.outletId, activeOutlet };
  }

  redirect("/admin/forbidden");
}

export async function requireAdminApiAuth(
  req: NextRequest
): Promise<NextResponse | null> {
  if (await hasValidAdminAuth(req)) {
    return requireSameOriginMutation(req);
  }

  const session = await getAdminSessionFromRequest(req);
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized", errorCode: "unauthorized" },
      { status: 401 }
    );
  }
  if (session.mfaEnrollmentRequired) return mfaEnrollmentRequiredResponse();

  return requireSameOriginMutation(req);
}

export async function requireAdminApiPermission(
  req: NextRequest,
  permission: AdminPermission,
  outletId?: string
): Promise<NextResponse | null> {
  if (await hasValidAdminAuth(req)) {
    return requireSameOriginMutation(req);
  }

  const session = await getAdminSessionFromRequest(req);
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized", errorCode: "unauthorized" },
      { status: 401 }
    );
  }
  if (session.mfaEnrollmentRequired) return mfaEnrollmentRequiredResponse();

  const activeOutlet = await resolveAdminActiveOutlet(session, req.cookies, outletId);
  if (activeOutlet.status === "no_access") {
    return NextResponse.json(
      { error: "No outlet access", errorCode: "no_outlet_access" },
      { status: 403 }
    );
  }
  if (activeOutlet.status === "needs_picker") {
    return NextResponse.json(
      { error: "Choose an outlet first", errorCode: "active_outlet_required" },
      { status: 409 }
    );
  }

  if (!(await adminActorHasPermission(session, permission, activeOutlet.outletId))) {
    return NextResponse.json(
      { error: "Forbidden", errorCode: "forbidden" },
      { status: 403 }
    );
  }

  return requireSameOriginMutation(req);
}

export async function requireAdminApiPermissionContext(
  req: NextRequest,
  permission: AdminPermission,
  outletId?: string
): Promise<
  | { ok: true; context: AdminPermissionContext }
  | { ok: false; response: NextResponse }
> {
  if (await hasValidAdminAuth(req)) {
    const originError = requireSameOriginMutation(req);
    if (originError) return { ok: false, response: originError };
    return {
      ok: true,
      context: {
        actor: {
          sessionId: "legacy",
        userId: "legacy",
        email: "legacy-admin",
        displayName: "Legacy admin",
        accountType: "OWNER",
        siteRole: "OWNER",
        mfaEnrollmentRequired: false,
      },
        outletId: outletId ?? DEFAULT_OUTLET_ID,
        activeOutlet: {
          status: "active",
          outletId: outletId ?? DEFAULT_OUTLET_ID,
          outletName: "Cafeteria",
          role: "OWNER",
        },
      },
    };
  }

  const session = await getAdminSessionFromRequest(req);
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Unauthorized", errorCode: "unauthorized" },
        { status: 401 }
      ),
    };
  }
  if (session.mfaEnrollmentRequired) {
    return { ok: false, response: mfaEnrollmentRequiredResponse() };
  }

  const activeOutlet = await resolveAdminActiveOutlet(session, req.cookies, outletId);
  if (activeOutlet.status === "no_access") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "No outlet access", errorCode: "no_outlet_access" },
        { status: 403 }
      ),
    };
  }
  if (activeOutlet.status === "needs_picker") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Choose an outlet first", errorCode: "active_outlet_required" },
        { status: 409 }
      ),
    };
  }

  if (!(await adminActorHasPermission(session, permission, activeOutlet.outletId))) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Forbidden", errorCode: "forbidden" },
        { status: 403 }
      ),
    };
  }

  const originError = requireSameOriginMutation(req);
  if (originError) return { ok: false, response: originError };

  return {
    ok: true,
    context: {
      actor: session,
      outletId: activeOutlet.outletId,
      activeOutlet,
    },
  };
}

export async function requireAdminApiSessionPermissionContext(
  req: NextRequest,
  permission: AdminPermission,
  outletId?: string
): Promise<
  | { ok: true; context: AdminPermissionContext }
  | { ok: false; response: NextResponse }
> {
  if (await hasValidAdminAuth(req)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Admin session required", errorCode: "admin_session_required" },
        { status: 401 }
      ),
    };
  }

  const session = await getAdminSessionFromRequest(req);
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Unauthorized", errorCode: "unauthorized" },
        { status: 401 }
      ),
    };
  }
  if (session.mfaEnrollmentRequired) {
    return { ok: false, response: mfaEnrollmentRequiredResponse() };
  }

  const activeOutlet = await resolveAdminActiveOutlet(session, req.cookies, outletId);
  if (activeOutlet.status === "no_access") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "No outlet access", errorCode: "no_outlet_access" },
        { status: 403 }
      ),
    };
  }
  if (activeOutlet.status === "needs_picker") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Choose an outlet first", errorCode: "active_outlet_required" },
        { status: 409 }
      ),
    };
  }

  if (!(await adminActorHasPermission(session, permission, activeOutlet.outletId))) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Forbidden", errorCode: "forbidden" },
        { status: 403 }
      ),
    };
  }

  const originError = requireSameOriginMutation(req);
  if (originError) return { ok: false, response: originError };

  return {
    ok: true,
    context: {
      actor: session,
      outletId: activeOutlet.outletId,
      activeOutlet,
    },
  };
}

export async function adminActorHasPermission(
  actor: AdminSessionActor,
  permission: AdminPermission,
  outletId: string
): Promise<boolean> {
  if (ownerHasPermission(permission) && actor.siteRole === "OWNER") {
    return true;
  }
  if (adminHasPermission(permission) && actor.siteRole === "ADMIN") {
    return true;
  }

  const outletRole = await prisma.adminUserOutletRole.findUnique({
    where: {
      userId_outletId: {
        userId: actor.userId,
        outletId,
      },
    },
    select: { role: true },
  });

  return roleHasPermission(outletRole?.role, permission);
}
