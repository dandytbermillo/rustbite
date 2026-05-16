// Tests for src/lib/observability/request-id.ts.

import assert from "node:assert/strict";
import {
  CLIENT_REQUEST_ID_HEADER,
  HMAC_SECRET_ENV,
  INTERNAL_REQUEST_ID_HEADER,
  buildInternalRequestIdHeader,
  generateRequestId,
  inferSurfaceFromPath,
  readHmacSecretFromEnv,
  validateClientRequestId,
  verifyInternalRequestIdHeader,
} from "../src/lib/observability/request-id";

const TEST_SECRET = "test-secret-must-be-at-least-16-chars-long";
const OTHER_SECRET = "different-secret-with-enough-entropy-here";

async function main() {

// --- generateRequestId: unique + URL-safe -----------------------------------
{
  const ids = new Set<string>();
  for (let i = 0; i < 1000; i++) ids.add(generateRequestId());
  assert.equal(ids.size, 1000, "1000 generations must all be unique");
  for (const id of ids) {
    assert.match(
      id,
      /^[A-Za-z0-9_-]{22}$/,
      `id "${id}" must be 22 base64url chars`,
    );
  }
}

// --- validateClientRequestId: accept good, reject bad ----------------------
{
  // Valid
  assert.equal(validateClientRequestId("req-abc123"), "req-abc123");
  assert.equal(validateClientRequestId("550e8400-e29b-41d4-a716-446655440000"), "550e8400-e29b-41d4-a716-446655440000");
  assert.equal(validateClientRequestId("req:scope.subscope_v2"), "req:scope.subscope_v2");
  assert.equal(validateClientRequestId("a"), "a");

  // Invalid: missing / empty / wrong type
  assert.equal(validateClientRequestId(null), null);
  assert.equal(validateClientRequestId(undefined), null);
  assert.equal(validateClientRequestId(""), null);
  // @ts-expect-error testing runtime type guard
  assert.equal(validateClientRequestId(12345), null);

  // Invalid: control chars / whitespace / log injection
  assert.equal(validateClientRequestId("req\nid"), null, "newline rejected");
  assert.equal(validateClientRequestId("req id"), null, "space rejected");
  assert.equal(validateClientRequestId("req\tid"), null, "tab rejected");
  assert.equal(validateClientRequestId("req\x00id"), null, "null byte rejected");

  // Invalid: forbidden chars
  assert.equal(validateClientRequestId("req<id>"), null);
  assert.equal(validateClientRequestId("req'id"), null);
  assert.equal(validateClientRequestId("req/id"), null);

  // Invalid: too long (65 chars)
  assert.equal(validateClientRequestId("a".repeat(65)), null);
  // Valid at the boundary (64 chars)
  assert.equal(validateClientRequestId("a".repeat(64)), "a".repeat(64));
}

// --- HMAC sign/verify round-trip ------------------------------------------
{
  const reqId = generateRequestId();
  const header = await buildInternalRequestIdHeader(reqId, TEST_SECRET);
  // Format check
  assert.match(header, /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/);
  const verified = await verifyInternalRequestIdHeader(header, TEST_SECRET);
  assert.equal(verified, reqId, "HMAC verify should return the original reqId");
}

// --- HMAC verify rejects forged signature ----------------------------------
{
  const reqId = generateRequestId();
  const header = await buildInternalRequestIdHeader(reqId, TEST_SECRET);

  // Tamper with the signature. Flip the FIRST base64url char, not the
  // last: the final char of a 32-byte (256-bit) HMAC encodes only 4 data
  // bits + 2 zero padding bits, so e.g. 'A'↔'B' there can decode to the
  // SAME bytes and verify would still (correctly) pass — that made the
  // old last-char tamper intermittently fail. The first char is 6 full
  // data bits, so A↔B there always changes the decoded signature and
  // verify must reject it deterministically.
  const [, sig] = header.split(".");
  const tamperedSig = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
  const forged = `${reqId}.${tamperedSig}`;
  const result = await verifyInternalRequestIdHeader(forged, TEST_SECRET);
  assert.equal(result, null, "tampered signature must fail verify");

  // Different secret → rejected
  const wrongKey = await verifyInternalRequestIdHeader(header, OTHER_SECRET);
  assert.equal(wrongKey, null, "wrong secret must fail verify");

  // Different reqId, original sig → rejected
  const otherId = generateRequestId();
  const swapped = `${otherId}.${sig}`;
  const swap = await verifyInternalRequestIdHeader(swapped, TEST_SECRET);
  assert.equal(swap, null, "swapped reqId must fail verify");
}

// --- HMAC verify rejects malformed inputs ----------------------------------
{
  assert.equal(await verifyInternalRequestIdHeader(null, TEST_SECRET), null);
  assert.equal(await verifyInternalRequestIdHeader(undefined, TEST_SECRET), null);
  assert.equal(await verifyInternalRequestIdHeader("", TEST_SECRET), null);
  // No dot
  assert.equal(await verifyInternalRequestIdHeader("nodothere", TEST_SECRET), null);
  // Empty halves
  assert.equal(await verifyInternalRequestIdHeader(".sig", TEST_SECRET), null);
  assert.equal(await verifyInternalRequestIdHeader("id.", TEST_SECRET), null);
  // Forbidden charset in reqId
  assert.equal(
    await verifyInternalRequestIdHeader("inva lid.sig", TEST_SECRET),
    null,
    "spaces in reqId rejected before HMAC work",
  );
  // Oversized halves (avoid CPU on attacker-supplied giant strings)
  const huge = "a".repeat(200);
  assert.equal(await verifyInternalRequestIdHeader(`${huge}.sig`, TEST_SECRET), null);
  assert.equal(await verifyInternalRequestIdHeader(`id.${huge}`, TEST_SECRET), null);
}

// --- buildInternalRequestIdHeader: rejects reqId containing '.' -----------
{
  await assert.rejects(
    buildInternalRequestIdHeader("has.dot", TEST_SECRET),
    /must not contain/,
    "reqId containing '.' would break parsing",
  );
}

// --- readHmacSecretFromEnv: returns null in dev when missing ---------------
{
  const env = process.env as Record<string, string | undefined>;
  const origSecret = env[HMAC_SECRET_ENV];
  const origNodeEnv = env.NODE_ENV;
  try {
    // Clear secret + non-production → null (dev fallback).
    delete env[HMAC_SECRET_ENV];
    env.NODE_ENV = "development";
    assert.equal(readHmacSecretFromEnv(), null);

    // Set secret → return it.
    env[HMAC_SECRET_ENV] = "x".repeat(20);
    assert.equal(readHmacSecretFromEnv(), "x".repeat(20));

    // Too-short secret → reject (treated as missing).
    env[HMAC_SECRET_ENV] = "tooshort";
    assert.equal(readHmacSecretFromEnv(), null);

    // Production + missing → throw.
    delete env[HMAC_SECRET_ENV];
    env.NODE_ENV = "production";
    assert.throws(() => readHmacSecretFromEnv(), /must be set/);
  } finally {
    if (origSecret === undefined) delete env[HMAC_SECRET_ENV];
    else env[HMAC_SECRET_ENV] = origSecret;
    env.NODE_ENV = origNodeEnv;
  }
}

// --- inferSurfaceFromPath: maps known prefixes ----------------------------
{
  assert.equal(inferSurfaceFromPath("/api/menu"), "api");
  assert.equal(inferSurfaceFromPath("/api/orders"), "api");
  assert.equal(inferSurfaceFromPath("/api/admin/users"), "admin");
  assert.equal(inferSurfaceFromPath("/api/admin/workspace/dashboard/summary"), "workspace");
  assert.equal(inferSurfaceFromPath("/admin/login"), "admin");
  assert.equal(inferSurfaceFromPath("/admin/workspace"), "workspace");
  assert.equal(inferSurfaceFromPath("/kiosk"), "kiosk");
  assert.equal(inferSurfaceFromPath("/counter"), "counter");
  assert.equal(inferSurfaceFromPath("/kitchen"), "kitchen");
  assert.equal(inferSurfaceFromPath("/board"), "board");
  // Unknown → "api" default.
  assert.equal(inferSurfaceFromPath("/somewhere/else"), "api");
}

// --- Header constant export sanity ----------------------------------------
{
  assert.equal(INTERNAL_REQUEST_ID_HEADER, "x-internal-request-id");
  assert.equal(CLIENT_REQUEST_ID_HEADER, "x-request-id");
  assert.equal(HMAC_SECRET_ENV, "INTERNAL_REQUEST_ID_HMAC_SECRET");
}

}

main().then(
  () => console.log("✓ test-observability-request-id passed"),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
