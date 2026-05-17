/* eslint-disable no-console */
// Prints the static synthetic-monitor token to paste into the managed SaaS
// uptime monitor's custom-header config:  x-monitor-token: <printed value>
// (the monitor must also send  x-monitor: true).
//
// Rotation: rotate SYNTHETIC_MONITOR_HMAC_SECRET, re-run this, update the
// provider config. Revocation: rotate the secret (old token stops verifying).
//
// Run: npm run observability:print-synthetic-monitor-token
import "dotenv/config";
import {
  buildSyntheticMonitorToken,
  readSyntheticMonitorSecretStrict,
} from "@/lib/observability/monitor-token";

async function main() {
  // Strict reader: throws loudly off the request path if misconfigured.
  const secret = readSyntheticMonitorSecretStrict();
  console.log(await buildSyntheticMonitorToken(secret));
}

main().catch((error) => {
  console.error("Failed to generate synthetic-monitor token.");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
