// Tests for src/lib/observability/job-context.ts.

import assert from "node:assert/strict";
import { getRequestContext, runWithRequestContext } from "../src/lib/observability/context";
import { runWithJobContext } from "../src/lib/observability/job-context";
import {
  __configureForTests,
  __resetForTests,
} from "../src/lib/observability/server";
import type {
  Adapter,
  CaptureContext,
  SanitizedExceptionEvent,
} from "../src/lib/observability/types";

function createRecordingAdapter(): {
  adapter: Adapter;
  exceptions: SanitizedExceptionEvent[];
  flushCount: { n: number };
  flushFail: { yes: boolean };
} {
  const exceptions: SanitizedExceptionEvent[] = [];
  const flushCount = { n: 0 };
  const flushFail = { yes: false };
  const adapter: Adapter = {
    captureException(event) {
      exceptions.push(event);
    },
    captureMessage() {},
    async flush() {
      flushCount.n += 1;
      if (flushFail.yes) throw new Error("flush boom");
    },
  };
  return { adapter, exceptions, flushCount, flushFail };
}

async function main() {

// --- 1. Fresh ALS context — no inheritance from request --------------------
{
  __resetForTests();
  const { adapter, exceptions } = createRecordingAdapter();
  __configureForTests({ adapter });

  const requestCtx: CaptureContext = {
    surface: "kiosk",
    requestId: "REQ_SENTINEL",
    outletId: "outlet_request_only",
  };

  let seenInsideJob: CaptureContext | null = null;
  await runWithRequestContext(requestCtx, async () => {
    await runWithJobContext("test-job", async () => {
      seenInsideJob = getRequestContext();
    });
  });

  assert.ok(seenInsideJob, "job should see a context");
  // requestId/outletId from the outer request must NOT leak in.
  assert.equal(
    (seenInsideJob as CaptureContext).requestId,
    undefined,
    "requestId must not leak from outer request",
  );
  assert.equal(
    (seenInsideJob as CaptureContext).outletId,
    undefined,
    "outletId must not leak from outer request",
  );
  // Job context fields populated.
  assert.equal((seenInsideJob as CaptureContext).jobName, "test-job");
  assert.ok((seenInsideJob as CaptureContext).jobId);
  assert.equal((seenInsideJob as CaptureContext).surface, "api");
  // startedAt is owned by runWithJobContext and must be a valid ISO ts.
  const startedAt = (seenInsideJob as CaptureContext).startedAt;
  assert.ok(startedAt, "startedAt must be set on the job context");
  assert.ok(
    typeof startedAt === "string" && !Number.isNaN(Date.parse(startedAt)),
    `startedAt must be a parseable ISO timestamp, got ${String(startedAt)}`,
  );
}

// --- 1b. Captured exception event carries the job's startedAt ----------------
{
  __resetForTests();
  const { adapter, exceptions } = createRecordingAdapter();
  __configureForTests({ adapter });

  try {
    await runWithJobContext("startedAt-job", async () => {
      throw new Error("propagate startedAt");
    });
  } catch {
    // expected
  }

  assert.equal(exceptions.length, 1);
  const ctx = exceptions[0].context;
  assert.equal(ctx.jobName, "startedAt-job");
  assert.ok(
    ctx.startedAt && !Number.isNaN(Date.parse(ctx.startedAt)),
    "startedAt should appear on the captured event context",
  );
}

// --- 2. Uncaught throw is captured AND rethrown ---------------------------
{
  __resetForTests();
  const { adapter, exceptions } = createRecordingAdapter();
  __configureForTests({ adapter });

  let thrown: unknown = null;
  try {
    await runWithJobContext("throwing-job", async () => {
      throw new Error("job blew up");
    });
  } catch (err) {
    thrown = err;
  }

  // The original error must propagate.
  assert.ok(thrown instanceof Error);
  assert.equal((thrown as Error).message, "job blew up");
  // And it must have been captured exactly once.
  assert.equal(exceptions.length, 1);
  assert.equal(exceptions[0].message, "job blew up");
  // The captured context shows the job's jobId/jobName, not the outer request.
  assert.equal(exceptions[0].context.jobName, "throwing-job");
  assert.ok(exceptions[0].context.jobId);
}

// --- 3. Watcher pattern — N work items get N distinct jobIds --------------
{
  __resetForTests();
  const { adapter, exceptions } = createRecordingAdapter();
  __configureForTests({ adapter });

  const jobIds: string[] = [];
  // The "watcher" is the for loop; each iteration is a unit of work that
  // calls runWithJobContext on its own.
  for (let i = 0; i < 3; i++) {
    await runWithJobContext(`work-${i}`, async () => {
      const ctx = getRequestContext();
      assert.ok(ctx);
      jobIds.push(ctx!.jobId as string);
    });
  }

  // All three jobIds are unique.
  assert.equal(new Set(jobIds).size, 3, "each iteration must get a distinct jobId");
}

// --- 4. flushAll runs in finally, on both success and failure paths -------
{
  __resetForTests();
  const { adapter, flushCount } = createRecordingAdapter();
  __configureForTests({ adapter });

  // Success path
  await runWithJobContext("ok-job", async () => {
    // no throw
  });
  const flushesAfterOk = flushCount.n;
  assert.ok(flushesAfterOk >= 1, "flush must run on success path");

  // Failure path
  try {
    await runWithJobContext("bad-job", async () => {
      throw new Error("controlled failure");
    });
  } catch {
    // expected
  }
  assert.equal(
    flushCount.n,
    flushesAfterOk + 1,
    "flush must also run on failure path",
  );
}

// --- 5. flushAll failure in finally does NOT change job outcome -----------
{
  __resetForTests();
  const { adapter, flushFail } = createRecordingAdapter();
  __configureForTests({ adapter });

  flushFail.yes = true;

  // Success path: even though flush throws, runWithJobContext resolves with
  // the original return value.
  const result = await runWithJobContext("ok-but-flush-fails", async () => "ok");
  assert.equal(result, "ok");

  // Failure path: even though flush also throws, the ORIGINAL error from
  // the job propagates — not the flush error.
  let thrown: unknown = null;
  try {
    await runWithJobContext("bad-and-flush-fails", async () => {
      throw new Error("ORIGINAL");
    });
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown instanceof Error);
  assert.equal((thrown as Error).message, "ORIGINAL");
}

}

main().then(
  () => console.log("✓ test-observability-job-context passed"),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
