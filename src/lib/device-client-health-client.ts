"use client";

import type {
  DeviceClientHealthDurationBucket,
  DeviceClientHealthEvent,
  DeviceClientHealthPayload,
} from "@/lib/device-client-health-shared";

let sequence = 0;

function nextSequence(): number {
  sequence += 1;
  return sequence;
}

export function deviceClientHealthDurationBucket(
  durationMs: number,
): DeviceClientHealthDurationBucket {
  if (durationMs < 2_000) return "0-2s";
  if (durationMs < 5_000) return "2-5s";
  if (durationMs < 10_000) return "5-10s";
  if (durationMs < 30_000) return "10-30s";
  return "30s+";
}

export function reportDeviceClientHealth(
  event: DeviceClientHealthEvent,
  options: Omit<DeviceClientHealthPayload, "event" | "sequence"> & {
    keepalive?: boolean;
  } = {},
): void {
  const payload: DeviceClientHealthPayload = {
    event,
    sequence: nextSequence(),
    errorBucket: options.errorBucket,
    durationBucket: options.durationBucket,
    checkoutOutcome: options.checkoutOutcome,
  };
  const body = JSON.stringify(payload);

  try {
    void fetch("/api/device-session/client-health", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      keepalive: options.keepalive === true,
      body,
    });
  } catch {
    // Client-health reporting must never break kiosk operation.
  }
}
