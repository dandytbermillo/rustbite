// Tests for src/lib/observability/context.ts.
//
// Three properties under test:
//
//   1. CONCURRENCY ISOLATION — N concurrent `runWithRequestContext` invocations
//      with distinct sentinel `requestId`s never see each other's values.
//
//   2. ALS PROPAGATION — bare microtasks / setImmediate / setTimeout DO inherit
//      the active context. (This is the documented behavior of AsyncLocalStorage
//      and the rest of the wrapper design depends on it.)
//
//   3. EXPLICIT DETACHMENT — `runDetached(fn)` and `runWithExactContext(other)`
//      both replace the active context with a fresh one for the lifetime of
//      `fn`. A microtask inside `fn` sees the inner context, not the outer.

import assert from "node:assert/strict";
import {
  __runWithExactContext,
  getRequestContext,
  runDetached,
  runWithRequestContext,
  snapshotContext,
} from "../src/lib/observability/context";
import type { CaptureContext } from "../src/lib/observability/types";

function ctx(id: string): CaptureContext {
  return { surface: "api", requestId: id };
}

async function main() {

// --- 1. Concurrency isolation ---------------------------------------------
{
  // Run 10 concurrent contexts, each doing several async hops. Each must
  // observe its own requestId at every hop. If ALS ever leaked, one of the
  // promises would resolve with the wrong id.
  const N = 10;
  const results = await Promise.all(
    Array.from({ length: N }, (_, i) => {
      const expected = `req-${i}`;
      return runWithRequestContext(ctx(expected), async () => {
        // Hop 1: await microtask
        await Promise.resolve();
        const after1 = getRequestContext()?.requestId;
        // Hop 2: setImmediate
        await new Promise((resolve) => setImmediate(resolve));
        const after2 = getRequestContext()?.requestId;
        // Hop 3: setTimeout 0
        await new Promise((resolve) => setTimeout(resolve, 0));
        const after3 = getRequestContext()?.requestId;
        return { expected, after1, after2, after3 };
      });
    }),
  );
  for (const r of results) {
    assert.equal(r.after1, r.expected, `microtask leak: ${r.expected}`);
    assert.equal(r.after2, r.expected, `setImmediate leak: ${r.expected}`);
    assert.equal(r.after3, r.expected, `setTimeout leak: ${r.expected}`);
  }
}

// --- 2. ALS propagation sanity --------------------------------------------
{
  // queueMicrotask, setImmediate, setTimeout all propagate. This is the
  // ALS contract; the wrapper design depends on it. If this ever breaks,
  // requestId in captured exceptions would silently go missing.
  await runWithRequestContext(ctx("prop-test"), async () => {
    let microId: string | undefined;
    let immediateId: string | undefined;
    let timeoutId: string | undefined;

    await new Promise<void>((resolve) => {
      queueMicrotask(() => {
        microId = getRequestContext()?.requestId;
        setImmediate(() => {
          immediateId = getRequestContext()?.requestId;
          setTimeout(() => {
            timeoutId = getRequestContext()?.requestId;
            resolve();
          }, 0);
        });
      });
    });

    assert.equal(microId, "prop-test");
    assert.equal(immediateId, "prop-test");
    assert.equal(timeoutId, "prop-test");
  });
}

// --- 3a. runDetached clears the context -----------------------------------
{
  await runWithRequestContext(ctx("outer"), async () => {
    assert.equal(getRequestContext()?.requestId, "outer");
    await runDetached(async () => {
      assert.equal(
        getRequestContext(),
        null,
        "runDetached should produce a null context",
      );
      // Even after async hops the inner context stays null.
      await Promise.resolve();
      await new Promise((r) => setImmediate(r));
      assert.equal(getRequestContext(), null);
    });
    // Outer context restored after runDetached resolves.
    assert.equal(getRequestContext()?.requestId, "outer");
  });
}

// --- 3b. __runWithExactContext overwrites the active context --------------
{
  await runWithRequestContext(ctx("outer-2"), async () => {
    assert.equal(getRequestContext()?.requestId, "outer-2");
    await __runWithExactContext(ctx("job-fresh"), async () => {
      assert.equal(getRequestContext()?.requestId, "job-fresh");
      // Async hops keep the inner context.
      await new Promise((r) => setImmediate(r));
      assert.equal(getRequestContext()?.requestId, "job-fresh");
    });
    // Outer context restored after the inner call resolves.
    assert.equal(getRequestContext()?.requestId, "outer-2");
  });
}

// --- 4. snapshotContext returns a defensive copy --------------------------
{
  await runWithRequestContext(ctx("snap"), async () => {
    const snap = snapshotContext();
    assert.ok(snap, "snapshotContext should return a value inside a frame");
    assert.equal(snap?.requestId, "snap");
    // Mutating the snapshot must not affect the active context.
    if (snap) (snap as { requestId?: string }).requestId = "mutated";
    assert.equal(getRequestContext()?.requestId, "snap");
  });

  // Outside any frame returns null.
  assert.equal(snapshotContext(), null);
}

}

main().then(
  () => console.log("✓ test-observability-context passed"),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
