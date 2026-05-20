// Provider-neutral types for the observability wrapper. The wrapper module
// (server.ts) normalizes caller inputs into the fully-typed `CaptureContext`
// and `SanitizedExceptionEvent` / `SanitizedMessageEvent` before invoking the
// adapter. The adapter's type signature accepts ONLY sanitized event objects,
// so there is no path that lets a raw Error or raw user message reach the
// adapter without passing through the wrapper's redaction pipeline.

export type SourceState =
  | "fresh"
  | "stale"
  | "unavailable"
  | "unconfigured"
  | "disabled"
  | "forbidden";

export type MetricValue<T> = {
  value: T | null;
  source: SourceState;
  ageMs: number | null;
  asOf: string | null;
};

export type Surface =
  | "kiosk"
  | "admin"
  | "workspace"
  | "counter"
  | "kitchen"
  | "board"
  | "api";

// Validation set, exported so the wrapper can defend against arbitrary
// string casts that would create high-cardinality / injected metric labels.
export const VALID_SURFACES: ReadonlySet<Surface> = new Set<Surface>([
  "kiosk",
  "admin",
  "workspace",
  "counter",
  "kitchen",
  "board",
  "api",
]);

// The adapter receives this fully-normalized shape. `surface` is required at
// this seam; callers supply `CaptureContextInput` (Partial) and the wrapper
// fills `surface` from ALS or defaults it to `"api"`.
export type CaptureContext = {
  surface: Surface;
  outletId?: string;
  deviceId?: string;
  adminUserId?: string;
  requestId?: string;
  clientRequestId?: string;
  routePattern?: string;
  jobId?: string;
  jobName?: string;
  // Set by runWithJobContext when a unit of work begins. Safe to log
  // (timestamp only). Optional for non-job surfaces.
  startedAt?: string;
};

// Caller seam: any subset of CaptureContext is allowed.
export type CaptureContextInput = Partial<CaptureContext>;

// The adapter receives only sanitized event objects. Every string field below
// has been processed by `redaction.scrub` before construction.
export type SanitizedExceptionEvent = {
  name: string;
  message: string;
  stack: string | null;
  cause?: SanitizedExceptionEvent;
  context: CaptureContext;
  asOf: string; // ISO timestamp
};

export type SanitizedMessageEvent = {
  message: string;
  context: CaptureContext;
  asOf: string;
};

export interface Adapter {
  captureException(event: SanitizedExceptionEvent): void;
  captureMessage(event: SanitizedMessageEvent): void;
  flush(timeoutMs: number): Promise<void>;
}
