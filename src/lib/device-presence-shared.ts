export const DEVICE_PRESENCE_EVENTS = [
  "opened",
  "heartbeat",
  "visible",
  "hidden",
  "freeze",
  "resume",
  "bfcache_pagehide",
  "bfcache_pageshow",
  "clean_close",
  "client_error",
  "unhandled_rejection",
  "recovered_unclean_previous_session",
] as const;

export type DevicePresenceEvent = (typeof DEVICE_PRESENCE_EVENTS)[number];

export const DEVICE_PRESENCE_VISIBILITY_STATES = [
  "visible",
  "hidden",
  "prerender",
  "unknown",
] as const;

export type DevicePresenceVisibilityState =
  (typeof DEVICE_PRESENCE_VISIBILITY_STATES)[number];

export const DEVICE_PRESENCE_CLOSE_REASONS = [
  "pagehide",
  "visibility_hidden_unload",
  "beforeunload_fallback",
  "app_unmount",
  "unknown",
] as const;

export type DevicePresenceCloseReason =
  (typeof DEVICE_PRESENCE_CLOSE_REASONS)[number];

export const DEVICE_PRESENCE_UPTIME_BUCKETS = [
  "0-10s",
  "10-60s",
  "1-5m",
  "5-30m",
  "30m+",
] as const;

export type DevicePresenceUptimeBucket =
  (typeof DEVICE_PRESENCE_UPTIME_BUCKETS)[number];

export const DEVICE_PRESENCE_ERROR_BUCKETS = [
  "window_error",
  "unhandled_rejection",
  "repeated_error",
] as const;

export type DevicePresenceErrorBucket =
  (typeof DEVICE_PRESENCE_ERROR_BUCKETS)[number];

export type DevicePresencePayload = {
  event: DevicePresenceEvent;
  clientSessionId: string;
  sequence: number;
  visibilityState?: DevicePresenceVisibilityState;
  closeReason?: DevicePresenceCloseReason;
  uptimeMsBucket?: DevicePresenceUptimeBucket;
  errorBucket?: DevicePresenceErrorBucket;
};

function oneOf<T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

export function isDevicePresenceEvent(
  value: unknown,
): value is DevicePresenceEvent {
  return oneOf(DEVICE_PRESENCE_EVENTS, value);
}

export function isDevicePresenceVisibilityState(
  value: unknown,
): value is DevicePresenceVisibilityState {
  return oneOf(DEVICE_PRESENCE_VISIBILITY_STATES, value);
}

export function isDevicePresenceCloseReason(
  value: unknown,
): value is DevicePresenceCloseReason {
  return oneOf(DEVICE_PRESENCE_CLOSE_REASONS, value);
}

export function isDevicePresenceUptimeBucket(
  value: unknown,
): value is DevicePresenceUptimeBucket {
  return oneOf(DEVICE_PRESENCE_UPTIME_BUCKETS, value);
}

export function isDevicePresenceErrorBucket(
  value: unknown,
): value is DevicePresenceErrorBucket {
  return oneOf(DEVICE_PRESENCE_ERROR_BUCKETS, value);
}
