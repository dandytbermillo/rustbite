/* eslint-disable no-console */
import { createRequire } from "module";
import "dotenv/config";

const require = createRequire(import.meta.url);

function stubServerOnly() {
  const serverOnlyPath = require.resolve("server-only");
  require.cache[serverOnlyPath] = {
    id: serverOnlyPath,
    filename: serverOnlyPath,
    loaded: true,
    exports: {},
    children: [],
    paths: [],
  } as unknown as NodeJS.Module;
}

function boolEnv(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function emailDryRunEnabled(): boolean {
  const configured = process.env.AUTH_EMAIL_DRY_RUN?.trim().toLowerCase();
  if (configured === "true") return true;
  if (configured === "false") return false;
  return process.env.NODE_ENV !== "production" && !process.env.RESEND_API_KEY;
}

function intervalMs(): number {
  const raw = Number(process.env.AUTH_EMAIL_WORKER_INTERVAL_MS ?? "10000");
  if (!Number.isFinite(raw)) return 10_000;
  return Math.max(2_000, Math.min(Math.trunc(raw), 300_000));
}

async function main() {
  stubServerOnly();

  const dryRun = emailDryRunEnabled();
  if (dryRun && !boolEnv("AUTH_EMAIL_WORKER_ALLOW_DRY_RUN")) {
    console.error(
      [
        "Auth email worker refused to start because email dry-run is enabled.",
        "This protects development from marking reset emails SENT without delivering them.",
        "",
        "To send real email, set RESEND_API_KEY, EMAIL_FROM, and AUTH_EMAIL_DRY_RUN=false.",
        "To intentionally test dry-run processing, set AUTH_EMAIL_WORKER_ALLOW_DRY_RUN=true.",
      ].join("\n")
    );
    process.exitCode = 1;
    return;
  }

  const [{ sendPendingAuthEmails }, { prisma }, { runWithJobContext }] =
    await Promise.all([
    import("@/lib/auth-email-outbox"),
    import("@/lib/db"),
    import("@/lib/observability/job-context"),
  ]);

  const pollMs = intervalMs();
  let stopping = false;

  async function stop() {
    if (stopping) return;
    stopping = true;
    await prisma.$disconnect();
    process.exit(0);
  }

  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());

  console.log(
    `Auth email worker started. Polling every ${pollMs}ms. Mode: ${dryRun ? "dry-run" : "provider"}.`
  );

  while (!stopping) {
    try {
      await runWithJobContext("auth-email-outbox.worker-iteration", async () => {
        const result = await sendPendingAuthEmails();
        if (result.sent || result.retried || result.failed || result.skipped) {
          console.log(
            `Auth email outbox processed. Sent: ${result.sent}. Retried: ${result.retried}. Failed: ${result.failed}. Skipped: ${result.skipped}.`
          );
        }
      });
    } catch (error) {
      console.error("Auth email worker iteration failed.");
      console.error(error);
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

main().catch((error) => {
  console.error("Auth email worker failed to start.");
  console.error(error);
  process.exitCode = 1;
});
