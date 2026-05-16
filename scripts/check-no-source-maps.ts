// Build-time guard: assert no `.js.map` files were emitted into the
// production browser bundle. Run AFTER `next build`.
//
// Why this is its own check (not just a config flag): even with
// `productionBrowserSourceMaps: false`, a misconfigured plugin or a
// transitive dependency that ships its own webpack rule could re-enable
// source maps. CI must verify the actual artifacts.
//
// Run: npm run check:no-source-maps
//      (Intended to run as a post-build step in CI.)

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const STATIC_DIR = ".next/static";

function findSourceMaps(dir: string): string[] {
  const found: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    // Directory doesn't exist — likely no build yet. We do NOT treat this
    // as success; the check should be wired AFTER `next build` and
    // missing artifacts means the build never ran.
    return ["__BUILD_OUTPUT_MISSING__"];
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let info;
    try {
      info = statSync(full);
    } catch {
      continue;
    }
    if (info.isDirectory()) {
      found.push(...findSourceMaps(full));
    } else if (entry.endsWith(".js.map")) {
      found.push(full);
    }
  }
  return found;
}

function main(): void {
  const result = findSourceMaps(STATIC_DIR);

  if (result.length === 1 && result[0] === "__BUILD_OUTPUT_MISSING__") {
    console.error(
      `check-no-source-maps: build output ${STATIC_DIR} is missing. ` +
        `Run \`next build\` first.`,
    );
    process.exit(2);
  }

  if (result.length > 0) {
    console.error(
      `check-no-source-maps: found ${result.length} .js.map file(s) in ${STATIC_DIR}:`,
    );
    for (const path of result) {
      console.error(`  - ${path}`);
    }
    console.error("");
    console.error(
      "Source maps must NOT ship to production. They expose original " +
        "source paths, comments, and internal identifiers. Check " +
        "`productionBrowserSourceMaps` in next.config.ts and any custom " +
        "webpack config in your build pipeline.",
    );
    process.exit(1);
  }

  console.log(`OK: no .js.map files in ${STATIC_DIR}`);
}

main();
