import { NextRequest, NextResponse } from "next/server";
import { hasValidAdminAuth } from "@/lib/admin-auth";
import {
  hasDeviceSessionCookie,
  hasAuthorizedDeviceSession,
  inferDeviceRoleFromPath,
} from "@/lib/device-auth";
import {
  CLIENT_REQUEST_ID_HEADER,
  INTERNAL_REQUEST_ID_HEADER,
  buildInternalRequestIdHeader,
  generateRequestId,
  readHmacSecretFromEnv,
} from "@/lib/observability/request-id";

const ADMIN_SESSION_COOKIE = "rb_admin_session";

export const config = {
  matcher: [
    "/admin/:path*",
    "/api/admin/:path*",
    "/kiosk",
    "/kitchen",
    "/board",
    "/counter",
    "/api/orders",
    "/api/orders/:path*",
    "/api/payments/:path*",
  ],
};

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Observability handshake — runs BEFORE any auth so that even
  // middleware-blocked responses (auth 401s, redirects) carry a server-
  // generated request id. The handler-side wrapper
  // (`withObservability` in `src/lib/observability/route-context.ts`) reads
  // and HMAC-verifies the same `x-internal-request-id` header on the
  // forwarded request and uses the unwrapped reqId as the canonical
  // server id.
  //
  // Strip ANY client-supplied `x-internal-*` headers from the forwarded
  // request before we set our own, even though we sign-and-verify. This
  // is defense in depth: a route uncovered by the middleware matcher
  // (e.g., `/api/menu`) would otherwise see whatever the client sent.
  const requestHeaders = new Headers(req.headers);
  for (const key of Array.from(requestHeaders.keys())) {
    if (key.toLowerCase().startsWith("x-internal-")) {
      requestHeaders.delete(key);
    }
  }
  const reqId = generateRequestId();
  // `readHmacSecretFromEnv` THROWS in production when the env var is
  // missing or shorter than 16 chars, and returns `null` in non-production
  // when the env var is unset. We deliberately do NOT catch the production
  // throw: a missing secret is a deploy-blocker and the request must 500
  // loudly so the misconfig surfaces in deploy logs immediately. Catching
  // it here would silently degrade to fresh-id generation, which is the
  // exact failure mode the production-throw exists to prevent.
  const secret = readHmacSecretFromEnv();
  if (secret) {
    try {
      const signed = await buildInternalRequestIdHeader(reqId, secret);
      requestHeaders.set(INTERNAL_REQUEST_ID_HEADER, signed);
    } catch {
      // Sign failure is non-fatal — the route handler will fall back to
      // generating its own reqId. Keep the request flowing.
    }
  }
  // The forwarded request that the handler sees has the trusted internal
  // header. Used by `NextResponse.next({ request: { headers } })`.
  const forwarded = { request: { headers: requestHeaders } };

  // Helper: every NextResponse this middleware returns gets `x-request-id`
  // attached so middleware-blocked responses participate in correlation.
  const tag = <T extends NextResponse>(res: T): T => {
    res.headers.set(CLIENT_REQUEST_ID_HEADER, reqId);
    return res;
  };

  if (
    pathname === "/admin/login" ||
    pathname === "/admin/login/mfa" ||
    pathname === "/admin/forgot-password" ||
    pathname === "/admin/reset-password" ||
    pathname === "/api/admin/auth/login" ||
    pathname === "/api/admin/auth/login/mfa" ||
    pathname === "/api/admin/auth/forgot-password" ||
    pathname === "/api/admin/auth/reset-password"
  ) {
    return tag(NextResponse.next(forwarded));
  }

  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    if (await hasValidAdminAuth(req)) return tag(NextResponse.next(forwarded));
    if (req.cookies.get(ADMIN_SESSION_COOKIE)?.value)
      return tag(NextResponse.next(forwarded));

    if (pathname.startsWith("/api/admin")) {
      return tag(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    }

    const loginUrl = new URL("/admin/login", req.url);
    return tag(NextResponse.redirect(loginUrl));
  }

  if (pathname.startsWith("/api/orders") || pathname.startsWith("/api/payments")) {
    if (hasDeviceSessionCookie(req)) {
      return tag(NextResponse.next(forwarded));
    }

    return tag(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }

  const requiredRole = inferDeviceRoleFromPath(pathname);
  if (requiredRole && hasAuthorizedDeviceSession(req, [requiredRole])) {
    return tag(NextResponse.next(forwarded));
  }

  const loginUrl = new URL("/device-login", req.url);
  loginUrl.searchParams.set("next", pathname);
  return tag(NextResponse.redirect(loginUrl));
}

