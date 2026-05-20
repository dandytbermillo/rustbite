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
  const [
    { executeDuePendingOwnerChanges },
    { prisma },
    { runWithJobContext },
  ] = await Promise.all([
    import("@/lib/admin-owner-changes"),
    import("@/lib/db"),
    import("@/lib/observability/job-context"),
  ]);

  try {
    await runWithJobContext("owner-changes.execute-due", async () => {
      const result = await executeDuePendingOwnerChanges();
      console.log(
        `Pending owner changes processed. Executed: ${result.executed}. Failed: ${result.failed}.`
      );
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Pending owner change execution failed.");
  console.error(error);
  process.exitCode = 1;
});
