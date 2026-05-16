"use client";

// App Router top-level error boundary. Mounts when the root layout
// throws during render. Per Next.js convention, this boundary owns the
// `<html>`/`<body>` because the failing layout no longer renders them.
//
// What it does:
//   - Routes the thrown render error through `captureClientException`
//     so observability sees the failure with browser context.
//   - Displays a generic recovery screen with a "Try again" button that
//     invokes Next's `reset()`.
//   - Surfaces `error.digest` (Next's per-error correlation token) when
//     available. Does NOT surface the server reqId — by design for this
//     slice (see find.md round 7 decision; cross-tier propagation is a
//     separate slice if operators decide they need it).

import { useEffect } from "react";
import { captureClientException } from "@/lib/observability/client";

/**
 * Map the current pathname to a surface tag. global-error catches errors
 * across every page (kiosk, admin, kitchen, etc.), so a hardcoded
 * `surface: "kiosk"` would mislabel admin-side crashes. Inlined here to
 * keep the client wrapper free of routing knowledge.
 */
function inferSurface(pathname: string): string {
  if (pathname.startsWith("/admin/workspace")) return "workspace";
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/kitchen")) return "kitchen";
  if (pathname.startsWith("/counter")) return "counter";
  if (pathname.startsWith("/board")) return "board";
  if (pathname.startsWith("/kiosk")) return "kiosk";
  return "kiosk";
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    const pagePath =
      typeof window !== "undefined" ? window.location.pathname : "/";
    captureClientException(error, {
      surface: inferSurface(pagePath),
      pagePath,
    });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <main
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "2rem",
            textAlign: "center",
            backgroundColor: "#f7f7f8",
            color: "#222",
          }}
        >
          <h1 style={{ fontSize: "1.75rem", marginBottom: "0.75rem" }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: "1.05rem", marginBottom: "1.5rem", maxWidth: "32rem" }}>
            Please try again. If the problem persists, ask staff for help.
          </p>
          {error.digest ? (
            <p
              style={{
                fontSize: "0.85rem",
                color: "#666",
                marginBottom: "1.5rem",
              }}
            >
              Ref: {error.digest}
            </p>
          ) : null}
          <button
            onClick={() => reset()}
            style={{
              padding: "0.85rem 2rem",
              fontSize: "1.05rem",
              border: "none",
              borderRadius: "0.5rem",
              backgroundColor: "#111",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
