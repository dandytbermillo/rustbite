/* eslint-disable no-console */
process.env.INTERNAL_REQUEST_ID_HMAC_SECRET = "test-secret-32-chars-long-AAAA";

import assert from "node:assert/strict";
import { runWithJobContext } from "../src/lib/observability/job-context";
import {
  CLIENT_REQUEST_ID_HEADER,
  INTERNAL_REQUEST_ID_HEADER,
  buildInternalRequestIdHeader,
  generateRequestId,
  readHmacSecretFromEnv,
} from "../src/lib/observability/request-id";
import { withObservability } from "../src/lib/observability/route-context";
import {
  __configureStructuredLogsForTests,
  __resetStructuredLogsForTests,
  logPaymentCorrelation,
  routePatternFromUrl,
  type StructuredLogEvent,
  type StructuredLogLevel,
} from "../src/lib/observability/structured-logs";

type RecordedLog = {
  level: StructuredLogLevel;
  line: string;
  event: StructuredLogEvent;
};

function configureLogs(overrides: Parameters<typeof __configureStructuredLogsForTests>[0] = {}) {
  const logs: RecordedLog[] = [];
  __resetStructuredLogsForTests();
  __configureStructuredLogsForTests({
    writer(level, line, event) {
      logs.push({ level, line, event });
    },
    now: () => "2026-05-19T20:00:00.000Z",
    requestSampleRate: 1,
    slowSampleRate: 1,
    slowThresholdMs: 1_000,
    random: () => 0,
    enabled: true,
    ...overrides,
  });
  return logs;
}

function requestEvents(logs: RecordedLog[]) {
  return logs.map((log) => log.event).filter((event) =>
    event.event === "request.completed" || event.event === "request.slow"
  );
}

async function main() {
  const secret = readHmacSecretFromEnv();
  assert(secret, "test HMAC secret should be configured");

  assert.equal(
    routePatternFromUrl("http://localhost/api/payments/sessions/pay_123_secret"),
    "/api/payments/sessions/[id]",
  );
  assert.equal(
    routePatternFromUrl("http://localhost/api/orders/order_123_secret"),
    "/api/orders/[id]",
  );
  assert.equal(
    routePatternFromUrl("http://localhost/api/unmapped/customer_123"),
    "/api/[unknown]",
  );

  {
    const logs = configureLogs({ requestSampleRate: 1, slowThresholdMs: 10_000 });
    const reqId = generateRequestId();
    const signed = await buildInternalRequestIdHeader(reqId, secret);
    const req = new Request(
      "http://localhost/api/payments/sessions/payment_should_not_log",
      {
        method: "GET",
        headers: {
          [INTERNAL_REQUEST_ID_HEADER]: signed,
          [CLIENT_REQUEST_ID_HEADER]: "client-safe-123",
        },
      },
    );
    await withObservability(req, async (_, ctx) => {
      ctx.outletId = "outlet-A";
      ctx.deviceId = "device-K1";
      return new Response("ok", { status: 200 });
    });
    const completed = requestEvents(logs).find(
      (event) => event.event === "request.completed",
    );
    assert(completed, "request completion log should be emitted");
    assert.equal(completed.routePattern, "/api/payments/sessions/[id]");
    assert.equal(completed.method, "GET");
    assert.equal(completed.status, 200);
    assert.equal(completed.context.requestId, reqId);
    assert.equal(completed.context.clientRequestId, "client-safe-123");
    assert.equal(completed.context.outletId, "outlet-A");
    assert.equal(completed.context.deviceId, "device-K1");
    assert(
      !logs[0].line.includes("payment_should_not_log"),
      "route log line must not contain raw dynamic path ids",
    );
  }

  {
    const logs = configureLogs({ requestSampleRate: 0, slowThresholdMs: 10_000 });
    await withObservability(
      new Request("http://localhost/api/orders", { method: "POST" }),
      async () => new Response("bad", { status: 503 }),
    );
    const completed = requestEvents(logs).find(
      (event) => event.event === "request.completed",
    );
    assert(completed, "500-class completion logs must bypass success sampling");
    assert.equal(completed.status, 503);
    assert.equal(completed.level, "error");
  }

  {
    const logs = configureLogs({ requestSampleRate: 0, slowThresholdMs: 1 });
    await withObservability(
      new Request("http://localhost/api/orders", { method: "GET" }),
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 3));
        return new Response("ok", { status: 200 });
      },
    );
    const slow = requestEvents(logs).filter(
      (event) => event.event === "request.slow",
    );
    assert.equal(slow.length, 1, "slow request should emit one slow log");
    assert.equal(slow[0].routePattern, "/api/orders");
    assert(slow[0].durationMs >= 1);
  }

  {
    const logs = configureLogs();
    await runWithJobContext("email\noutbox", async () => "ok");
    const events = logs.map((log) => log.event);
    assert.equal(events[0].event, "job.started");
    assert.equal(events[1].event, "job.completed");
    assert.equal(events[0].jobName, "email outbox");
    assert(events[0].jobId, "job log should include jobId");
    assert.notEqual(
      events[0].jobId,
      "[REDACTED]",
      "job log should retain the operational jobId",
    );
    assert.equal(events[0].context.jobId, events[0].jobId);
  }

  {
    const logs = configureLogs();
    logPaymentCorrelation({
      action: "stripe_terminal_poll_synced\nbad",
      transactionId: "pay_txn_123",
      status: "CAPTURED",
      provider: "STRIPE_TERMINAL",
      providerPaymentIntentId: "pi_1234567890\nsecret",
      providerReaderId: "tmr_reader_123",
    });
    const event = logs[0].event;
    assert.equal(event.event, "payment.correlation");
    assert.equal(event.correlationId, "pay_txn_123");
    assert.equal(event.action, "stripe_terminal_poll_synced bad");
    assert(
      !logs[0].line.includes("\nsecret"),
      "payment correlation log should sanitize control characters",
    );
  }

  __resetStructuredLogsForTests();
  console.log("✓ test-observability-structured-logs passed");
}

main().catch((error) => {
  __resetStructuredLogsForTests();
  console.error(error);
  process.exit(1);
});
