// Tests for src/lib/observability/redaction.ts.
//
// Pattern: standalone tsx script + node:assert. Matches the rest of the
// `test:*` scripts in package.json (no test runner framework).

import assert from "node:assert/strict";
import {
  describeDroppedField,
  isSensitiveKey,
  scrub,
  scrubFields,
  scrubHeaders,
  scrubUrl,
} from "../src/lib/observability/redaction";

const REDACTED = "[REDACTED]";

// --- isSensitiveKey: case + punctuation variants --------------------------
{
  assert.equal(isSensitiveKey("password"), true);
  assert.equal(isSensitiveKey("Password"), true);
  assert.equal(isSensitiveKey("PASSWORD"), true);
  assert.equal(isSensitiveKey("user-password"), true);
  assert.equal(isSensitiveKey("user_Password"), true);
  assert.equal(isSensitiveKey("user.PASSWORD"), true);
  assert.equal(isSensitiveKey("authorization"), true);
  assert.equal(isSensitiveKey("X-CSRF-Token"), true);
  assert.equal(isSensitiveKey("setCookie"), true);
  assert.equal(isSensitiveKey("mfaSecret"), true);
  assert.equal(isSensitiveKey("recovery-code"), true);
  assert.equal(isSensitiveKey("displayName"), true);
  assert.equal(isSensitiveKey("ip"), true);
  assert.equal(isSensitiveKey("ipAddress"), true);
  assert.equal(isSensitiveKey("userAgent"), true);
  assert.equal(isSensitiveKey("cardNumber"), true);
  assert.equal(isSensitiveKey("refreshToken"), true);

  // Negative cases — operational metadata is not sensitive by key.
  assert.equal(isSensitiveKey("outletId"), false);
  assert.equal(isSensitiveKey("deviceId"), false);
  assert.equal(isSensitiveKey("orderId"), false);
  assert.equal(isSensitiveKey("status"), false);
  assert.equal(isSensitiveKey("requestId"), false);
}

// --- scrub: nested objects + arrays ---------------------------------------
{
  const input = {
    outletId: "outlet_1",
    user: {
      adminUserId: "u_abc",
      password: "hunter2",
      profile: {
        email: "foo@bar.com",
        displayName: "Alice",
      },
    },
    orders: [
      { id: "o1", total: 100 },
      { id: "o2", session: "sess_secret", total: 200 },
    ],
  };
  const out = scrub(input) as Record<string, unknown>;
  assert.equal(out.outletId, "outlet_1");
  const user = out.user as Record<string, unknown>;
  assert.equal(user.adminUserId, "u_abc");
  assert.equal(user.password, REDACTED);
  const profile = user.profile as Record<string, unknown>;
  assert.equal(profile.email, REDACTED);
  assert.equal(profile.displayName, REDACTED);
  const orders = out.orders as Array<Record<string, unknown>>;
  assert.equal(orders[0].id, "o1");
  assert.equal(orders[1].session, REDACTED);
}

// --- scrub: Maps + Sets ---------------------------------------------------
{
  const m = new Map<string, unknown>();
  m.set("ok", "value");
  m.set("password", "secret");
  const s = new Set<unknown>(["plain", { token: "abc" }]);
  const out = scrub({ m, s }) as Record<string, unknown>;
  assert.deepEqual(out.m, { ok: "value", password: REDACTED });
  const sOut = out.s as unknown[];
  assert.equal(sOut[0], "plain");
  assert.equal((sOut[1] as Record<string, unknown>).token, REDACTED);
}

// --- scrub: Error + Error.cause (recursive) -------------------------------
{
  const inner = new Error("inner failure with email user@example.com");
  const outer = new Error("outer secret=abc123xyz789def012ghi345jkl678mno90");
  (outer as Error & { cause?: unknown }).cause = inner;
  const out = scrub(outer) as {
    name: string;
    message: string;
    stack: string | null;
    cause: { name: string; message: string };
  };
  assert.equal(out.name, "Error");
  // Token-shaped value triggers value scrub
  assert.equal(out.message, REDACTED);
  // Email in cause.message triggers value scrub
  assert.equal(out.cause.message, REDACTED);
}

// --- scrub: Date, URL, Headers, Request, Response --------------------------
{
  const d = new Date("2026-05-14T10:00:00.000Z");
  assert.equal(scrub(d), "2026-05-14T10:00:00.000Z");

  const u = new URL("https://api.example.com/users/abc123def456ghi789?token=secret");
  const scrubbed = scrub(u);
  // Host kept; long opaque path segment templated; query dropped.
  assert.equal(scrubbed, "api.example.com/users/[id]");

  const h = new Headers();
  h.set("authorization", "Bearer abc");
  h.set("x-request-id", "req_safe");
  const hOut = scrub(h) as Record<string, string>;
  assert.equal(hOut.authorization, REDACTED);
  assert.equal(hOut["x-request-id"], "req_safe");

  const req = new Request("https://api.example.com/api/orders/abc123def456ghi789", {
    method: "POST",
    headers: { authorization: "Bearer xyz" },
  });
  const reqOut = scrub(req) as {
    method: string;
    url: string;
    headers: Record<string, string>;
    bodyReadStatus: string;
  };
  assert.equal(reqOut.method, "POST");
  assert.equal(reqOut.url, "api.example.com/api/orders/[id]");
  assert.equal(reqOut.headers.authorization, REDACTED);
  assert.equal(reqOut.bodyReadStatus, "not-inspected");

  const res = new Response("body should never be read", { status: 200 });
  const resOut = scrub(res) as { bodyReadStatus: string; status: number };
  assert.equal(resOut.status, 200);
  assert.equal(resOut.bodyReadStatus, "not-inspected");
}

// --- scrub: circular objects ----------------------------------------------
{
  type Node = { name: string; child?: Node };
  const a: Node = { name: "a" };
  const b: Node = { name: "b" };
  a.child = b;
  b.child = a;
  const out = scrub(a) as Node;
  // First level fine
  assert.equal(out.name, "a");
  // Second level fine
  assert.equal((out.child as Node).name, "b");
  // Third level — back to a — replaced with circular marker
  assert.equal(((out.child as Node).child as unknown) as string, "[Circular]");
}

// --- scrub: MFA enrollment state ------------------------------------------
{
  const enrollment = {
    userId: "u_123",
    mfaSecret: "JBSWY3DPEHPK3PXP",
    recoveryCode: "abc-def-ghi",
    qrUrl: "otpauth://totp/RushBite:alice?secret=JBSWY3DPEHPK3PXP&issuer=RushBite",
  };
  const out = scrub(enrollment) as Record<string, string>;
  assert.equal(out.userId, "u_123");
  assert.equal(out.mfaSecret, REDACTED);
  assert.equal(out.recoveryCode, REDACTED);
  // qrUrl is not a sensitive *key* but the URL is scrubbed via scrubString —
  // it contains a long token-shaped substring, so the whole value is REDACTED.
  assert.equal(out.qrUrl, REDACTED);
}

// --- scrub: PII patterns under benign keys ---------------------------------
{
  const out = scrub({
    note: "contact alice at alice@example.com or 555-123-4567",
    log: "request from 198.51.100.42 with token abcdef1234567890abcdef1234567890",
    benign: "all clear",
  }) as Record<string, string>;
  assert.equal(out.note, REDACTED);
  assert.equal(out.log, REDACTED);
  assert.equal(out.benign, "all clear");
}

// --- scrub: card-shaped numbers --------------------------------------------
{
  const out = scrub({ memo: "card 4111 1111 1111 1111 expires 12/30" }) as Record<
    string,
    string
  >;
  assert.equal(out.memo, REDACTED);
}

// --- scrub: URL-shaped strings (`://`, `www.`, protocol-relative) ---------
//
// URLs can carry tokens / session ids in query strings; per the production
// plan they must be scrubbed under benign keys too. Three forms covered:
// scheme `http(s)://`, `www.`-prefixed, and protocol-relative `//host.tld`.
{
  const out = scrub({
    note1: "see https://example.com/users/abc?token=secret for details",
    note2: "ftp://files.example.com/payload.bin failed",
    note3: "go to www.example.com first",
    note4: "no url here, just plain text",
    note5: "fetch //example.com/path?token=secret first",        // protocol-relative
    note6: "// TODO: short comment here",                          // false-positive risk
    note7: "leading-space // example.com hint",                    // space after // → not URL
    note8: "triple ///root means file-ish noise",                  // // followed by / → not URL
  }) as Record<string, string>;
  assert.equal(out.note1, REDACTED, "https:// URL must be REDACTED");
  assert.equal(out.note2, REDACTED, "ftp:// URL must be REDACTED");
  assert.equal(out.note3, REDACTED, "www.-prefixed URL must be REDACTED");
  assert.equal(out.note4, "no url here, just plain text");
  assert.equal(out.note5, REDACTED, "protocol-relative URL must be REDACTED");
  // // TODO has whitespace immediately after // → not detected as URL.
  assert.equal(out.note6, "// TODO: short comment here");
  // Whitespace after // disqualifies → not URL.
  assert.equal(out.note7, "leading-space // example.com hint");
  // Triple slash → next char is /, not alphanumeric → not URL.
  assert.equal(out.note8, "triple ///root means file-ish noise");
}

// --- scrubUrl: explicit URL helper -----------------------------------------
{
  assert.equal(
    scrubUrl("https://example.com/users/12345/orders?secret=x"),
    "example.com/users/[id]/orders",
  );
  // UUID-shape
  assert.equal(
    scrubUrl("/api/orders/550e8400-e29b-41d4-a716-446655440000"),
    "/api/orders/[id]",
  );
  // Long mixed-case opaque
  assert.equal(
    scrubUrl("/items/Bacon_Cheddar_Limited_Edition_2026"),
    "/items/[id]",
  );
  // Short stable segments — kept
  assert.equal(scrubUrl("/api/menu"), "/api/menu");
  assert.equal(scrubUrl("not-a-url"), REDACTED);
}

// --- scrubHeaders: plain-object form ---------------------------------------
{
  const headers = {
    "x-request-id": "req_safe",
    cookie: "session=abc",
    "user-agent": "Mozilla/5.0 ...",
    "x-custom-array": ["one", "two"],
  };
  const out = scrubHeaders(headers);
  assert.equal(out["x-request-id"], "req_safe");
  assert.equal(out.cookie, REDACTED);
  // user-agent IS a sensitive key per the deny-list.
  assert.equal(out["user-agent"], REDACTED);
  assert.equal(out["x-custom-array"], "one, two");
}

// --- scrubFields: allow-list filter ----------------------------------------
{
  const input = {
    outletId: "outlet_1",
    deviceId: "dev_1",
    password: "should-be-dropped",
    secret: "also-dropped",
    randomNoise: "also-dropped-because-not-allowed",
    requestId: "req_1",
  };
  const out = scrubFields(input, ["outletId", "deviceId", "requestId"]);
  assert.deepEqual(out, {
    outletId: "outlet_1",
    deviceId: "dev_1",
    requestId: "req_1",
  });
  // Unknown keys dropped silently.
  assert.equal((out as Record<string, unknown>).password, undefined);
  assert.equal((out as Record<string, unknown>).randomNoise, undefined);
}

// --- scrubFields: defends against sensitive key in allow-list (paranoia) ---
{
  // If an operator accidentally allow-lists a sensitive key, the value is
  // still redacted by the second-tier defense.
  const out = scrubFields(
    { password: "leak", outletId: "outlet_1" },
    ["password", "outletId"] as const,
  ) as Record<string, unknown>;
  assert.equal(out.password, REDACTED);
  assert.equal(out.outletId, "outlet_1");
}

// --- Adversarial input resistance ------------------------------------------
{
  // Build a 100 KB string that interleaves spaces (resetting digit/token runs)
  // so it does not match any of our patterns. The point is to prove the
  // scrubber's runtime is bounded by length, not exponential — even on inputs
  // designed to defeat a naive regex like /(a+)+$/.
  const adversarial = ("a ".repeat(50_000)) + "X";
  const start = process.hrtime.bigint();
  const out = scrub({ adversarial }) as Record<string, string>;
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(
    elapsedMs < 500,
    `scrub took ${elapsedMs.toFixed(1)} ms — too slow, possible ReDoS`,
  );
  // Strings over MAX_SCAN_LEN (8 KB) get TRUNCATED on output, with a
  // truncation suffix. Returning the full original would leak any sensitive
  // content placed past the scan window.
  const expectedPrefix = adversarial.slice(0, 8 * 1024);
  assert.ok(
    out.adversarial.startsWith(expectedPrefix),
    "truncated output should preserve the scanned prefix",
  );
  assert.ok(
    out.adversarial.includes("[truncated"),
    "long-string output should carry a truncation suffix",
  );
  assert.ok(
    out.adversarial.length < adversarial.length,
    "long-string output should be shorter than the original",
  );

  // Long alphanumeric run separately confirmed to redact (token heuristic):
  const tokenLike = "a".repeat(100_000);
  const start2 = process.hrtime.bigint();
  const out2 = scrub({ tokenLike }) as Record<string, string>;
  const elapsedMs2 = Number(process.hrtime.bigint() - start2) / 1e6;
  assert.ok(
    elapsedMs2 < 500,
    `scrub took ${elapsedMs2.toFixed(1)} ms on token-like input`,
  );
  assert.equal(out2.tokenLike, REDACTED);

  // Secret placed PAST the scan window — must not leak via the returned
  // (now truncated) string.
  const padding = "x".repeat(20_000);
  const sneaky = `${padding} secret_after_window=hunter2`;
  const out3 = scrub({ sneaky }) as Record<string, string>;
  // Either it was redacted (sensible) or truncated before the secret.
  if (out3.sneaky !== REDACTED) {
    assert.ok(
      !out3.sneaky.includes("secret_after_window"),
      "secret past scan window must not leak through truncated output",
    );
    assert.ok(
      !out3.sneaky.includes("hunter2"),
      "secret value past scan window must not leak",
    );
  }
}

// --- describeDroppedField: never leaks values ------------------------------
{
  const msg = describeDroppedField("user.password", "deny-list-key");
  assert.equal(msg, "[redaction] dropped field=user.password reason=deny-list-key");
  // The function takes no value parameter, so by construction it cannot leak.
  assert.equal(msg.includes("hunter2"), false);
}

console.log("✓ test-observability-redaction passed");
