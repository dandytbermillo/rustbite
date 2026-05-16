import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  cookieMaxAgeSeconds,
  createSessionToken,
  hashSessionToken,
} from "@/lib/production-auth";
import { getLoginIpHash } from "@/lib/login-rate-limit";

export const ADMIN_MFA_LOGIN_COOKIE = "rb_admin_mfa_login";
export const ADMIN_MFA_LOGIN_CHALLENGE_MS = 10 * 60 * 1000;
export const ADMIN_MFA_LOGIN_MAX_ATTEMPTS = 5;

export async function createAdminMfaLoginChallenge(
  userId: string,
  req: NextRequest
): Promise<{ token: string; expiresAt: Date }> {
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + ADMIN_MFA_LOGIN_CHALLENGE_MS);

  await prisma.adminMfaLoginChallenge.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt,
      userAgent: req.headers.get("user-agent") ?? null,
      ipHash: getLoginIpHash(req),
    },
  });

  return { token, expiresAt };
}

export function setAdminMfaLoginCookie(
  response: NextResponse,
  token: string,
  expiresAt: Date
) {
  response.cookies.set({
    name: ADMIN_MFA_LOGIN_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: cookieMaxAgeSeconds(expiresAt),
  });
}

export function clearAdminMfaLoginCookie(response: NextResponse) {
  response.cookies.set({
    name: ADMIN_MFA_LOGIN_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}

export async function getAdminMfaLoginChallenge(req: NextRequest) {
  const token = req.cookies.get(ADMIN_MFA_LOGIN_COOKIE)?.value;
  if (!token) return null;

  return prisma.adminMfaLoginChallenge.findUnique({
    where: { tokenHash: hashSessionToken(token) },
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
          mfaSecretCiphertext: true,
        },
      },
    },
  });
}
