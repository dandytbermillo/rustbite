"use client";

// Tiny client-only mount that wires the browser-level error handlers
// (`error`, `unhandledrejection`) into our `captureClientException`
// pipeline. Rendered from the root layout so it runs on every page.
//
// The actual installation is idempotent (sentinel on `globalThis`), so
// React StrictMode double-invocation and Fast Refresh do not register
// handlers twice.

import { useEffect } from "react";
import { installClientErrorHandlers } from "@/lib/observability/client";

export default function ObservabilityBootstrap() {
  useEffect(() => {
    installClientErrorHandlers();
  }, []);
  return null;
}
