/* eslint-disable no-console */
// Deterministic, no-DB tests for the synthetic-monitor token + classifier.
// No server-only shim needed (monitor-token.ts / redaction.ts import none).
//
// Run: npm run test:observability-synthetic-monitor-token
import "dotenv/config";
import {
  SYNTHETIC_MONITOR_SECRET_ENV,
  buildSyntheticMonitorToken,
  classifySyntheticRequest,
  readSyntheticMonitorSecretStrict,
  verifySyntheticMonitorToken,
} from "@/lib/observability/monitor-token";
import { isSensitiveKey } from "@/lib/observability/redaction";

const SECRET = "test-monitor-secret-0123456789AB"; // >= 16 chars
const OTHER = "another-monitor-secret-ABCDEFGHIJ";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function reqWith(headers: Record<string, string>) {
  return {
    headers: { get: (n: string): string | null => headers[n] ?? null },
  };
}

async function main() {
  const token = await buildSyntheticMonitorToken(SECRET);
  assert(token.startsWith("synthetic-monitor."), "token has exact label prefix");

  // round trip
  assert(await verifySyntheticMonitorToken(token, SECRET), "round-trip verifies");

  // tampered signature
  const tampered =
    token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
  assert(!(await verifySyntheticMonitorToken(tampered, SECRET)), "tampered sig rejected");

  // wrong secret
  assert(!(await verifySyntheticMonitorToken(token, OTHER)), "wrong secret rejected");

  // wrong label
  const sig = token.slice("synthetic-monitor.".length);
  assert(!(await verifySyntheticMonitorToken(`wrong-label.${sig}`, SECRET)), "wrong label rejected");

  // malformed dots
  assert(!(await verifySyntheticMonitorToken("synthetic-monitorNODOT", SECRET)), "no dot rejected");
  assert(!(await verifySyntheticMonitorToken(`synthetic-monitor.${sig}.x`, SECRET)), ">=2 dots rejected");
  assert(!(await verifySyntheticMonitorToken(".", SECRET)), "lone dot rejected");

  // oversized
  assert(
    !(await verifySyntheticMonitorToken(`synthetic-monitor.${"a".repeat(200)}`, SECRET)),
    "oversized token rejected"
  );

  // non-base64url signature
  assert(
    !(await verifySyntheticMonitorToken("synthetic-monitor.bad sig!", SECRET)),
    "non-base64url sig rejected"
  );

  // missing / empty
  assert(!(await verifySyntheticMonitorToken(null, SECRET)), "null rejected");
  assert(!(await verifySyntheticMonitorToken("", SECRET)), "empty rejected");

  // short secret on verify path also fails closed (no throw)
  assert(!(await verifySyntheticMonitorToken(token, "short")), "short secret => false");

  // --- classifier (env-driven) ---
  const savedSecret = process.env[SYNTHETIC_MONITOR_SECRET_ENV];
  try {
    process.env[SYNTHETIC_MONITOR_SECRET_ENV] = SECRET;

    assert(
      await classifySyntheticRequest(reqWith({ "x-monitor": "true", "x-monitor-token": token })),
      "tag + valid token => synthetic"
    );
    assert(
      !(await classifySyntheticRequest(reqWith({ "x-monitor-token": token }))),
      "missing tag => not synthetic"
    );
    assert(
      !(await classifySyntheticRequest(reqWith({ "x-monitor": "false", "x-monitor-token": token }))),
      "x-monitor != 'true' => not synthetic"
    );
    assert(
      !(await classifySyntheticRequest(reqWith({ "x-monitor": "true" }))),
      "tag without token => not synthetic"
    );
    assert(
      !(await classifySyntheticRequest(reqWith({ "x-monitor": "true", "x-monitor-token": "synthetic-monitor.bogus" }))),
      "tag + bad token => not synthetic"
    );

    // load-bearing safety: secret missing => classifier returns false, NO throw
    delete process.env[SYNTHETIC_MONITOR_SECRET_ENV];
    let threw = false;
    let result = true;
    try {
      result = await classifySyntheticRequest(
        reqWith({ "x-monitor": "true", "x-monitor-token": token })
      );
    } catch {
      threw = true;
    }
    assert(!threw, "classifier must NOT throw when secret is missing");
    assert(result === false, "classifier fails closed to false when secret missing");

    // strict reader DOES throw off the request path
    let strictThrew = false;
    try {
      readSyntheticMonitorSecretStrict();
    } catch {
      strictThrew = true;
    }
    assert(strictThrew, "strict reader throws when secret missing");
  } finally {
    if (savedSecret === undefined) delete process.env[SYNTHETIC_MONITOR_SECRET_ENV];
    else process.env[SYNTHETIC_MONITOR_SECRET_ENV] = savedSecret;
  }

  // --- redaction regression (token must never be logged) ---
  assert(isSensitiveKey("x-monitor-token"), "x-monitor-token must be treated as sensitive");
  assert(!isSensitiveKey("x-monitor"), "x-monitor tag is not itself sensitive");

  console.log("Synthetic-monitor token tests passed.");
}

main().catch((error) => {
  console.error("Synthetic-monitor token tests failed.");
  console.error(error);
  process.exitCode = 1;
});
