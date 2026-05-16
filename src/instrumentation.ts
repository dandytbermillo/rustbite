// Next.js instrumentation entry point.
//
// Next evaluates this file for both Node and Edge instrumentation. Keep it
// Edge-safe: no static imports of Node-only modules and no direct `process.on`
// / `process.exit` references here. Node-only startup work lives behind the
// runtime-gated dynamic import below.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { registerNodeObservabilitySignalHooks } = await import(
    "./instrumentation.node"
  );
  registerNodeObservabilitySignalHooks();
}
