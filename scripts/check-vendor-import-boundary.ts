// Vendor SDK import-boundary guard.
//
// Plan requirement: "add a CI or script guard that forbids direct provider
// SDK imports outside the observability wrapper and required instrumentation
// files" (docs/production-observability-plan-2026-05-14.md lines 310-311,
// 380, 1096).
//
// Today the project is provider-neutral (stub adapter only), so this guard
// currently passes with zero matches. It is a FORWARD guard: the moment a
// vendor SDK is added, any import of it outside the allow-listed files
// fails CI, keeping vendor coupling isolated to `src/lib/observability/*`
// and the Next instrumentation entrypoints.
//
// Detection is a deterministic line scan (no code execution, no AST): we
// match `from "<pkg>"`, `import("<pkg>")`, and `require("<pkg>")` against a
// maintained forbidden-package list. Bounded regex, no nested quantifiers.
//
// To extend when a vendor is chosen: add the vendor's package name(s) to
// FORBIDDEN_PACKAGES below. Do NOT widen ALLOWED_PREFIXES — the whole point
// is that vendor imports stay inside the wrapper.
//
// Run: npm run check:vendor-import-boundary

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();

// Files/dirs where a direct vendor SDK import is permitted. Paths are
// repo-relative, POSIX-normalized before comparison.
const ALLOWED_PREFIXES = [
  "src/lib/observability/",
  "src/instrumentation.ts",
  "src/instrumentation.node.ts",
];

// Known error/observability/RUM/telemetry SDK package roots. A match is
// either the exact name or a scoped/sub-path under it (e.g. `@sentry/node`,
// `@opentelemetry/api`). Keep this list maintained; it is the plan's
// "direct provider SDK" definition for this codebase.
const FORBIDDEN_PACKAGES = [
  "@sentry/",
  "@sentry/nextjs",
  "@sentry/node",
  "@sentry/browser",
  "@sentry/react",
  "@datadog/",
  "dd-trace",
  "datadog-",
  "@opentelemetry/",
  "newrelic",
  "@newrelic/",
  "rollbar",
  "bugsnag",
  "@bugsnag/",
  "elastic-apm-node",
  "@elastic/apm",
  "@grafana/faro-",
  "@honeycombio/",
  "honeycomb-",
  "logrocket",
  "@logrocket/",
];

// Match the module specifier in: from "x" | from 'x' | import("x") |
// require("x"). One capture group = the specifier. Bounded, no nested
// quantifiers (ReDoS-safe).
const SPECIFIER_RE =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([^"']{1,200})["']/g;

type Violation = { file: string; line: number; specifier: string };

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

function isAllowed(relPosix: string): boolean {
  return ALLOWED_PREFIXES.some(
    (prefix) => relPosix === prefix || relPosix.startsWith(prefix),
  );
}

function isForbiddenSpecifier(spec: string): boolean {
  return FORBIDDEN_PACKAGES.some(
    (pkg) => spec === pkg || spec.startsWith(pkg),
  );
}

function* walk(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
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
      if (entry === "node_modules" || entry === ".next") continue;
      yield* walk(full);
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry)) {
      // Skip backup artifacts (not compiled, not shipped).
      if (entry.includes(".backup-")) continue;
      yield full;
    }
  }
}

function scanFile(absPath: string): Violation[] {
  const relPosix = toPosix(relative(ROOT, absPath));
  if (isAllowed(relPosix)) return [];

  let content: string;
  try {
    content = readFileSync(absPath, "utf8");
  } catch {
    return [];
  }
  if (!content.includes("import") && !content.includes("require")) return [];

  const violations: Violation[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    SPECIFIER_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SPECIFIER_RE.exec(line)) !== null) {
      const spec = m[1];
      if (isForbiddenSpecifier(spec)) {
        violations.push({ file: relPosix, line: i + 1, specifier: spec });
      }
    }
  }
  return violations;
}

function main(): void {
  const roots = ["src", "scripts"];
  const allViolations: Violation[] = [];

  for (const root of roots) {
    for (const file of walk(join(ROOT, root))) {
      allViolations.push(...scanFile(file));
    }
  }

  if (allViolations.length > 0) {
    console.error(
      `check-vendor-import-boundary: ${allViolations.length} forbidden vendor SDK import(s) outside the observability wrapper:`,
    );
    for (const v of allViolations) {
      console.error(`  - ${v.file}:${v.line}  imports "${v.specifier}"`);
    }
    console.error("");
    console.error(
      "Vendor SDK imports must live only in src/lib/observability/* or the " +
        "Next instrumentation entrypoints. Move the integration behind the " +
        "Adapter wrapper. If this is a new legitimate boundary file, update " +
        "ALLOWED_PREFIXES in scripts/check-vendor-import-boundary.ts with a " +
        "reviewed justification.",
    );
    process.exit(1);
  }

  console.log(
    "OK: no direct vendor SDK imports outside src/lib/observability/* + instrumentation entrypoints",
  );
}

main();
