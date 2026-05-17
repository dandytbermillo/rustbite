import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSessionPermissionContext } from "@/lib/admin-sessions";
import { withObservability } from "@/lib/observability/route-context";
import {
  disableInvestigationMode,
  enableInvestigationMode,
  getInvestigationModeStatus,
} from "@/lib/observability/investigation-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const PERMISSION = "admin.observability.investigationMode.manage" as const;

function jsonNoStore(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

// Explicit no-store 405 for unsupported verbs. Next's automatic 405 would omit
// Cache-Control: no-store, violating the plan's all-responses rule.
function methodNotAllowed() {
  return jsonNoStore(
    { error: "Method Not Allowed" },
    { status: 405, headers: { allow: "GET, POST" } }
  );
}

export async function GET(req: NextRequest) {
  return withObservability(req, async (req, _obsCtx) => {
    const auth = await requireAdminApiSessionPermissionContext(req, PERMISSION);
    if (!auth.ok) {
      auth.response.headers.set("cache-control", "no-store");
      return auth.response;
    }
    return jsonNoStore(await getInvestigationModeStatus());
  });
}

export async function POST(req: NextRequest) {
  return withObservability(req, async (req, _obsCtx) => {
    const auth = await requireAdminApiSessionPermissionContext(req, PERMISSION);
    if (!auth.ok) {
      auth.response.headers.set("cache-control", "no-store");
      return auth.response;
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonNoStore({ error: "Invalid JSON body" }, { status: 400 });
    }

    const action =
      body && typeof body === "object"
        ? (body as { action?: unknown }).action
        : undefined;

    if (action === "enable") {
      const rawDuration =
        body && typeof body === "object"
          ? (body as { durationMinutes?: unknown }).durationMinutes
          : undefined;
      const durationMinutes =
        typeof rawDuration === "number" ? rawDuration : undefined;
      const { until } = await enableInvestigationMode(
        auth.context.actor,
        durationMinutes
      );
      return jsonNoStore({ active: true, until: until.toISOString() });
    }

    if (action === "disable") {
      await disableInvestigationMode(auth.context.actor);
      // Safe outcome already committed; never re-read (a status-read failure
      // must not mask a successful disable with a 500).
      return jsonNoStore({ active: false, until: null });
    }

    return jsonNoStore(
      { error: 'Body must be { action: "enable" | "disable" }' },
      { status: 400 }
    );
  });
}

export async function PUT() {
  return methodNotAllowed();
}

export async function PATCH() {
  return methodNotAllowed();
}

export async function DELETE() {
  return methodNotAllowed();
}

export async function HEAD() {
  return methodNotAllowed();
}

export async function OPTIONS() {
  return methodNotAllowed();
}
