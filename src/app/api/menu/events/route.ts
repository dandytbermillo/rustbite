import { NextRequest } from "next/server";
import { resolveAuthorizedMenuVersion } from "@/lib/menu-version-auth";
import type { OutletMenuVersionDTO } from "@/lib/outlet-menu-sync";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const HEARTBEAT_MS = 20_000;
const VERSION_CHECK_MS = 1_000;
const MAX_STREAM_AGE_MS = 45 * 60_000;

function encodeSse(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  );
}

async function resolveAuthorizedVersion(
  req: NextRequest,
  expectedOutletId?: string
): Promise<OutletMenuVersionDTO | null> {
  const result = await resolveAuthorizedMenuVersion(req, expectedOutletId);
  return result.ok ? result.version : null;
}

export async function GET(req: NextRequest) {
  const requestedOutletId = req.nextUrl.searchParams.get("outletId") ?? undefined;
  const initialResult = await resolveAuthorizedMenuVersion(req, requestedOutletId);
  if (!initialResult.ok) {
    return initialResult.response;
  }
  const initialVersion = initialResult.version;

  let closed = false;
  const startedAt = Date.now();
  let cleanup: () => void = () => {
    closed = true;
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let lastRevision = initialVersion.revision;
      let versionInterval: ReturnType<typeof setInterval> | null = null;
      let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

      const close = () => {
        if (closed) return;
        closed = true;
        if (versionInterval) clearInterval(versionInterval);
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        req.signal.removeEventListener("abort", close);
        try {
          controller.close();
        } catch {
          // The browser may already have closed the connection.
        }
      };
      cleanup = close;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encodeSse(event, data));
        } catch {
          close();
        }
      };

      versionInterval = setInterval(async () => {
        if (closed) return;
        if (Date.now() - startedAt >= MAX_STREAM_AGE_MS) {
          send("reconnect", { reason: "max_age" });
          close();
          return;
        }

        try {
          const version = await resolveAuthorizedVersion(
            req,
            initialVersion.outletId
          );
          if (!version) {
            send("auth_expired", { reason: "device_session_expired" });
            close();
            return;
          }

          if (version.revision > lastRevision) {
            lastRevision = version.revision;
            send("menu_revision", version);
          }
        } catch {
          send("error", { errorCode: "version_check_failed" });
        }
      }, VERSION_CHECK_MS);

      heartbeatInterval = setInterval(() => {
        send("heartbeat", {
          outletId: initialVersion.outletId,
          revision: lastRevision,
          now: new Date().toISOString(),
        });
      }, HEARTBEAT_MS);

      req.signal.addEventListener("abort", close);
      send("menu_revision", initialVersion);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
