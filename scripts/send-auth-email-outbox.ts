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

async function main() {
  stubServerOnly();
  const [{ sendPendingAuthEmails }, { prisma }] = await Promise.all([
    import("@/lib/auth-email-outbox"),
    import("@/lib/db"),
  ]);

  const result = await sendPendingAuthEmails();
  console.log(
    `Auth email outbox processed. Sent: ${result.sent}. Retried: ${result.retried}. Failed: ${result.failed}. Skipped: ${result.skipped}.`
  );
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("Auth email outbox processing failed.");
  console.error(error);
  process.exitCode = 1;
});
