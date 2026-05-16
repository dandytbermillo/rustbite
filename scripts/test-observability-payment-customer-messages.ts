// Static regression audit for customer-facing payment-route messages.
//
// Background: Slice 1c-server's first iteration fixed the inner Stripe
// catch blocks in `/api/payments/sessions/route.ts` and
// `/api/payments/sessions/[id]/route.ts` but missed two other leaky paths
// the reviewer flagged in find.md round 7:
//   1. The Stripe-not-configured early return embedded env var names
//      ("STRIPE_SECRET_KEY", "STRIPE_TERMINAL_READER_ID") in both the
//      stored `failureMessage` and the returned response body.
//   2. The outer broad catch returned raw `err.message` as a 400 with
//      no `captureException` wire, letting Prisma errors, snapshot
//      build errors, etc. flow to the kiosk customer.
//
// Why this test is content-based: exercising these branches at runtime
// requires DB + Stripe SDK mocking. To keep the slice scope bounded, we
// instead assert structural properties of the route source so future
// edits that re-introduce the leak fail this check loudly. The strings
// asserted here are the same ones the reviewer caught.
//
// Run: npm run test:observability-payment-customer-messages

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SESSIONS_PATH = join(ROOT, "src/app/api/payments/sessions/route.ts");
const SESSION_BY_ID_PATH = join(ROOT, "src/app/api/payments/sessions/[id]/route.ts");
const ORDERS_PATH = join(ROOT, "src/app/api/orders/route.ts");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function countMatches(haystack: string, needle: string): number {
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

function main(): void {
  const sessions = read(SESSIONS_PATH);
  const sessionById = read(SESSION_BY_ID_PATH);
  const orders = read(ORDERS_PATH);

  // -- 1. The exact leaky string MUST NOT appear inside any
  //       `paymentSessionError(...)` call (= customer-returned body). --
  // Match `paymentSessionError(` followed by a string literal that
  // contains "STRIPE_SECRET_KEY" anywhere before the closing paren.
  // A simple presence check on the customer-returning call site:
  {
    const customerFacingLeakRegex =
      /paymentSessionError\(\s*"[^"]*STRIPE_SECRET_KEY[^"]*"/;
    assert.ok(
      !customerFacingLeakRegex.test(sessions),
      "1: sessions/route.ts must not return STRIPE_SECRET_KEY-bearing string to customer",
    );
    const customerFacingReaderLeak =
      /paymentSessionError\(\s*"[^"]*STRIPE_TERMINAL_READER_ID[^"]*"/;
    assert.ok(
      !customerFacingReaderLeak.test(sessions),
      "1: sessions/route.ts must not return STRIPE_TERMINAL_READER_ID-bearing string to customer",
    );
  }

  // -- 2. The exact leaky string MUST NOT appear as a stored
  //       `failureMessage` value (= what serializePaymentSession returns). --
  {
    const dbLeakRegex =
      /failureMessage:\s*\n?\s*"[^"]*STRIPE_SECRET_KEY[^"]*"/;
    assert.ok(
      !dbLeakRegex.test(sessions),
      "2: sessions/route.ts must not store STRIPE_SECRET_KEY-bearing failureMessage",
    );
    // Slightly looser: also forbid any literal in `failureMessage:` that
    // contains "is not configured" — the original leak shape.
    const notConfiguredLeak = /failureMessage:\s*\n?\s*"[^"]*is not configured/;
    assert.ok(
      !notConfiguredLeak.test(sessions),
      "2: sessions/route.ts must not store 'is not configured' as failureMessage",
    );
  }

  // -- 3. captureException is invoked in EACH of the four catch sites
  //       that should now report 500-class failures:
  //         a. Stripe-not-configured config check.
  //         b. Inner Stripe terminal try/catch.
  //         c. Outer broad catch (non-CheckoutContractError branch).
  //         d. payments/sessions/[id] inner Stripe sync catch.
  // The simplest portable assertion is "captureException(" appears
  // at least N times; precise location is verified by the test logic
  // that follows (regex around catch + capture).
  {
    const sessionsCaptureCount = countMatches(sessions, "captureException(");
    assert.ok(
      sessionsCaptureCount >= 3,
      `3a: sessions/route.ts must call captureException >=3 times (config, inner, outer); saw ${sessionsCaptureCount}`,
    );
    const sessionByIdCaptureCount = countMatches(sessionById, "captureException(");
    assert.ok(
      sessionByIdCaptureCount >= 1,
      `3b: sessions/[id]/route.ts must call captureException >=1 time; saw ${sessionByIdCaptureCount}`,
    );
    const ordersCaptureCount = countMatches(orders, "captureException(");
    assert.ok(
      ordersCaptureCount >= 1,
      `3c: orders/route.ts must call captureException >=1 time; saw ${ordersCaptureCount}`,
    );
  }

  // -- 4. The OUTER broad catch (the one that handles CheckoutContractError
  //       AND any other escapee from the long try block) must NOT return
  //       raw `err.message` in its non-CheckoutContractError branch. We
  //       isolate the outer-catch body by indexing on `instanceof
  //       CheckoutContractError` and taking the surrounding region. (The
  //       narrow validation catch on `validateCheckoutRequest(await
  //       req.json())` higher in the file intentionally returns the
  //       validator's message — those are designed for client display,
  //       same pattern as `orders/route.ts:127` which the reviewer did
  //       not flag.) --
  {
    const marker = "instanceof CheckoutContractError";
    const markerIdx = sessions.indexOf(marker);
    assert.ok(markerIdx > 0, "4: outer catch's CheckoutContractError marker must exist");
    // Window: from the marker forward ~1500 chars covers the rest of the
    // outer catch's body (both branches) plus the explanatory comments.
    const outerCatchWindow = sessions.slice(markerIdx, markerIdx + 1500);
    const leakyInOuter =
      /paymentSessionError\(\s*\(err as Error\)\.message/;
    assert.ok(
      !leakyInOuter.test(outerCatchWindow),
      "4: outer catch's non-CheckoutContractError branch must not return raw err.message",
    );
    assert.ok(
      outerCatchWindow.includes("captureException(err)"),
      "4: outer catch must call captureException(err) on the non-known-error branch",
    );
    assert.ok(
      outerCatchWindow.includes("PAYMENT_PROCESSING_FAILED_MESSAGE"),
      "4: outer catch must return PAYMENT_PROCESSING_FAILED_MESSAGE",
    );
  }

  // -- 5. The generic constant PAYMENT_PROCESSING_FAILED_MESSAGE is used
  //       wherever a customer-facing 5xx is returned from the catch paths.
  //       Precise usage count: defined once + referenced for config-not-set,
  //       inner-catch DB-update, inner-catch return, outer-catch return.
  //       At minimum the constant should appear >= 4 times in sessions/route. --
  {
    const refs = countMatches(sessions, "PAYMENT_PROCESSING_FAILED_MESSAGE");
    assert.ok(
      refs >= 4,
      `5: sessions/route.ts must reference PAYMENT_PROCESSING_FAILED_MESSAGE >=4 times; saw ${refs}`,
    );
  }

  // -- 6. Each catch block that fires captureException must immediately
  //       follow with a SANITIZED response, not a raw rethrow or raw
  //       err.message return. We assert this structurally: the substring
  //       `captureException(err)` followed within ~300 chars by either
  //       `PAYMENT_PROCESSING_FAILED_MESSAGE` or another sanitized const. --
  {
    // Find every captureException(...) and inspect the surrounding ~300 chars.
    const fileContents = [
      { path: SESSIONS_PATH, content: sessions },
      { path: SESSION_BY_ID_PATH, content: sessionById },
      { path: ORDERS_PATH, content: orders },
    ];
    for (const { path, content } of fileContents) {
      let idx = 0;
      while ((idx = content.indexOf("captureException(", idx)) !== -1) {
        // Window of source AFTER this captureException call.
        const after = content.slice(idx, idx + 600);
        const isSanitized =
          after.includes("PAYMENT_PROCESSING_FAILED_MESSAGE") ||
          // orders/route.ts uses its own hardcoded generic string:
          after.includes("could not create the order");
        assert.ok(
          isSanitized,
          `6: in ${path}, captureException at offset ${idx} must be followed by a sanitized response (no raw err leak)`,
        );
        idx += "captureException(".length;
      }
    }
  }

  console.log("OK: payment customer-message audit passed (6 checks)");
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
