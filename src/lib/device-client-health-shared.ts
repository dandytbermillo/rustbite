export const DEVICE_CLIENT_HEALTH_EVENTS = [
  "app_loaded",
  "heartbeat",
  "menu_loaded",
  "menu_failed",
  "uncaught_error",
  "unhandled_rejection",
  "checkout_started",
  "checkout_completed",
] as const;

export type DeviceClientHealthEvent =
  (typeof DEVICE_CLIENT_HEALTH_EVENTS)[number];

export const DEVICE_CLIENT_HEALTH_ERROR_BUCKETS = [
  "uncaught_error",
  "unhandled_rejection",
  "repeated_error",
] as const;

export type DeviceClientHealthErrorBucket =
  (typeof DEVICE_CLIENT_HEALTH_ERROR_BUCKETS)[number];

export const DEVICE_CLIENT_HEALTH_DURATION_BUCKETS = [
  "0-2s",
  "2-5s",
  "5-10s",
  "10-30s",
  "30s+",
] as const;

export type DeviceClientHealthDurationBucket =
  (typeof DEVICE_CLIENT_HEALTH_DURATION_BUCKETS)[number];

export const DEVICE_CLIENT_HEALTH_CHECKOUT_OUTCOMES = [
  "completed",
  "failed",
] as const;

export type DeviceClientHealthCheckoutOutcome =
  (typeof DEVICE_CLIENT_HEALTH_CHECKOUT_OUTCOMES)[number];

export type DeviceClientHealthPayload = {
  event: DeviceClientHealthEvent;
  sequence: number;
  errorBucket?: DeviceClientHealthErrorBucket;
  durationBucket?: DeviceClientHealthDurationBucket;
  checkoutOutcome?: DeviceClientHealthCheckoutOutcome;
};

export type LocalDeviceClientHealthSummary = {
  source: "local-memory";
  windowMinutes: number;
  totalCount: number;
  latestAt: string | null;
  latestDeviceId: string | null;
  latestDeviceName: string | null;
  latestEvent: DeviceClientHealthEvent | null;
  appLoadedCount: number;
  heartbeatCount: number;
  menuLoadedCount: number;
  menuFailedCount: number;
  errorCount: number;
  unhandledRejectionCount: number;
  checkoutStartedCount: number;
  checkoutCompletedCount: number;
  checkoutSlowCount: number;
};

function oneOf<T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

export function isDeviceClientHealthEvent(
  value: unknown,
): value is DeviceClientHealthEvent {
  return oneOf(DEVICE_CLIENT_HEALTH_EVENTS, value);
}

export function isDeviceClientHealthErrorBucket(
  value: unknown,
): value is DeviceClientHealthErrorBucket {
  return oneOf(DEVICE_CLIENT_HEALTH_ERROR_BUCKETS, value);
}

export function isDeviceClientHealthDurationBucket(
  value: unknown,
): value is DeviceClientHealthDurationBucket {
  return oneOf(DEVICE_CLIENT_HEALTH_DURATION_BUCKETS, value);
}

export function isDeviceClientHealthCheckoutOutcome(
  value: unknown,
): value is DeviceClientHealthCheckoutOutcome {
  return oneOf(DEVICE_CLIENT_HEALTH_CHECKOUT_OUTCOMES, value);
}
