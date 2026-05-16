/* eslint-disable no-console */
import "dotenv/config";
import { createRequire } from "module";
import { PrismaClient } from "@prisma/client";

// Thin CLI wrapper around `runActiveOperatorPreflight` in
// `src/lib/active-operator-preflight.ts`. Tests exercise the same logic
// by importing the function directly.
//
// Exit codes:
//   0 — PASS (no failures; warnings allowed)
//   1 — at least one outlet/surface has no fully usable operator
//   2 — DB connection or query error
//
// Usage:
//   npm run preflight:active-operator

const require = createRequire(import.meta.url);

// `server-only` shim — the preflight library uses it; this script runs
// from Node, so we register the shim before importing any server module.
const serverOnlyPath = require.resolve("server-only");
require.cache[serverOnlyPath] = {
  id: serverOnlyPath,
  filename: serverOnlyPath,
  loaded: true,
  exports: {},
  children: [],
  paths: [],
} as unknown as NodeJS.Module;

function pad(str: string, width: number): string {
  return str.length > width ? str.slice(0, width - 1) + "…" : str.padEnd(width);
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const { runActiveOperatorPreflight } = await import(
      "@/lib/active-operator-preflight"
    );
    const result = await runActiveOperatorPreflight(prisma);

    if (result.kind === "no_devices") {
      console.log("ℹ No active counter/kitchen devices found.");
      console.log(
        "  Phase 3 enforcement has nothing to gate. Pre-flight passes by default."
      );
      process.exit(0);
    }

    if (result.kind === "fail") {
      console.log(
        `✗ Pre-flight FAILED — ${result.gaps.length} outlet/surface pair${result.gaps.length === 1 ? " has" : "s have"} no fully usable operator.`
      );
      console.log("");
      console.log(`  ${pad("OUTLET", 24)}  ${pad("SURFACE", 10)}`);
      for (const gap of result.gaps) {
        console.log(`  ${pad(gap.outletName, 24)}  ${pad(gap.surface, 10)}`);
      }
      console.log("");
      console.log(
        "Provision at least one STAFF or ADMIN user per outlet/surface above with:"
      );
      console.log("  • MANAGER or OPERATOR outlet role at the outlet");
      console.log("  • The matching COUNTER/KITCHEN surface grant");
      console.log("  • An operational PIN");
      console.log(
        "Use /admin/users (Owner-only) and re-run this pre-flight."
      );
    }

    if (result.incomplete.length > 0) {
      console.log("");
      console.log(
        `⚠ Warning — ${result.incomplete.length} incomplete operator candidate${result.incomplete.length === 1 ? "" : "s"} (informational, not blocking):`
      );
      console.log("");
      console.log(
        `  ${pad("EMAIL", 30)}  ${pad("OUTLET", 20)}  ${pad("ROLE", 10)}  MISSING`
      );
      for (const row of result.incomplete) {
        const missingParts: string[] = [];
        if (row.missingSurfaces.length > 0) {
          missingParts.push(row.missingSurfaces.join("+"));
        }
        if (row.missingPin) missingParts.push("PIN");
        console.log(
          `  ${pad(row.email, 30)}  ${pad(row.outletName, 20)}  ${pad(row.outletRole, 10)}  ${missingParts.join(" + ")}`
        );
      }
      console.log("");
      console.log(
        "These users have an operator outlet role but are not yet fully provisioned."
      );
      console.log(
        "They cannot sign in to a counter/kitchen station today — runtime stays safe."
      );
      console.log(
        "Complete their setup at your own pace; this does NOT block deployment."
      );
    }

    if (result.kind === "fail") {
      process.exit(1);
    }

    console.log("");
    if (result.incomplete.length === 0) {
      console.log("✓ Pre-flight passed.");
    } else {
      console.log("✓ Pre-flight passed (with warnings).");
    }
    console.log(
      "  Every counter/kitchen outlet/surface has at least one fully usable operator."
    );
    console.log("  Phase 3 enforcement is safe to enable.");
    process.exit(0);
  } catch (err) {
    console.error("Pre-flight error:", err);
    process.exit(2);
  } finally {
    await prisma.$disconnect();
  }
}

main();
