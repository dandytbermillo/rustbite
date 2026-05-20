"use client";

import { useEffect, useRef } from "react";
import type {
  DevicePresenceCloseReason,
  DevicePresenceEvent,
  DevicePresencePayload,
  DevicePresenceVisibilityState,
} from "@/lib/device-presence-shared";

type DeviceSurface = "kiosk" | "counter" | "kitchen" | "board";

type PresenceMarker = {
  clientSessionId: string;
  openedAt: string;
  lastHeartbeatAt: string | null;
  cleanClosedAt: string | null;
  pendingRecovery: boolean;
};

const HEARTBEAT_MS = 25_000;
const MARKER_PREFIX = "rb-device-presence:";
const CLIENT_SESSION_STORAGE_KEY = "rb-device-presence-client-session";

function safeReadStorage(
  storage: Storage | null,
  key: string,
): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeWriteStorage(
  storage: Storage | null,
  key: string,
  value: string,
) {
  try {
    storage?.setItem(key, value);
  } catch {
    // Device presence must never break the device surface.
  }
}

function readMarker(key: string): PresenceMarker | null {
  const raw = safeReadStorage(window.localStorage, key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PresenceMarker>;
    if (typeof parsed.clientSessionId !== "string") return null;
    return {
      clientSessionId: parsed.clientSessionId,
      openedAt:
        typeof parsed.openedAt === "string"
          ? parsed.openedAt
          : new Date().toISOString(),
      lastHeartbeatAt:
        typeof parsed.lastHeartbeatAt === "string"
          ? parsed.lastHeartbeatAt
          : null,
      cleanClosedAt:
        typeof parsed.cleanClosedAt === "string" ? parsed.cleanClosedAt : null,
      pendingRecovery: parsed.pendingRecovery === true,
    };
  } catch {
    return null;
  }
}

function writeMarker(key: string, marker: PresenceMarker) {
  safeWriteStorage(window.localStorage, key, JSON.stringify(marker));
}

function randomClientSessionId(): string | null {
  const cryptoApi = window.crypto;
  if (!cryptoApi?.getRandomValues) return null;
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window
    .btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function getClientSessionId(): string | null {
  const existing = safeReadStorage(
    window.sessionStorage,
    CLIENT_SESSION_STORAGE_KEY,
  );
  if (existing) return existing;
  const next = randomClientSessionId();
  if (!next) return null;
  safeWriteStorage(window.sessionStorage, CLIENT_SESSION_STORAGE_KEY, next);
  return next;
}

function visibilityState(): DevicePresenceVisibilityState {
  if (
    document.visibilityState === "visible" ||
    document.visibilityState === "hidden" ||
    document.visibilityState === "prerender"
  ) {
    return document.visibilityState;
  }
  return "unknown";
}

function uptimeBucket(startedAt: number): DevicePresencePayload["uptimeMsBucket"] {
  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs < 10_000) return "0-10s";
  if (elapsedMs < 60_000) return "10-60s";
  if (elapsedMs < 5 * 60_000) return "1-5m";
  if (elapsedMs < 30 * 60_000) return "5-30m";
  return "30m+";
}

export default function DevicePresenceReporter({
  surface,
}: {
  surface: DeviceSurface;
}) {
  const stoppedRef = useRef(false);
  const retryUntilRef = useRef(0);
  const sequenceRef = useRef(0);
  const markerRef = useRef<PresenceMarker | null>(null);
  const markerKeyRef = useRef(`${MARKER_PREFIX}${surface}`);
  const clientSessionIdRef = useRef<string | null>(null);
  const startedAtRef = useRef(0);

  useEffect(() => {
    startedAtRef.current = Date.now();
    markerKeyRef.current = `${MARKER_PREFIX}${surface}`;
    const clientSessionId = getClientSessionId();
    clientSessionIdRef.current = clientSessionId;
    if (!clientSessionId) return;
    const activeClientSessionId: string = clientSessionId;

    const markerKey = markerKeyRef.current;
    const previousMarker = readMarker(markerKey);
    const nextMarker: PresenceMarker = {
      clientSessionId,
      openedAt: new Date().toISOString(),
      lastHeartbeatAt: null,
      cleanClosedAt: null,
      pendingRecovery: previousMarker?.pendingRecovery === true,
    };
    markerRef.current = nextMarker;
    writeMarker(markerKey, nextMarker);

    function updateMarker(updater: (current: PresenceMarker) => PresenceMarker) {
      const current = markerRef.current;
      if (!current) return;
      const next = updater(current);
      markerRef.current = next;
      writeMarker(markerKey, next);
    }

    async function send(
      event: DevicePresenceEvent,
      options: {
        closeReason?: DevicePresenceCloseReason;
        errorBucket?: DevicePresencePayload["errorBucket"];
        ignoreRetryWindow?: boolean;
      } = {},
    ): Promise<boolean> {
      if (stoppedRef.current) return false;
      if (!options.ignoreRetryWindow && Date.now() < retryUntilRef.current) {
        return false;
      }
      const sequence = sequenceRef.current + 1;
      sequenceRef.current = sequence;
      const payload: DevicePresencePayload = {
        event,
        clientSessionId: activeClientSessionId,
        sequence,
        visibilityState: visibilityState(),
        uptimeMsBucket: uptimeBucket(startedAtRef.current),
        closeReason: options.closeReason,
        errorBucket: options.errorBucket,
      };

      try {
        const response = await fetch("/api/device-session/presence", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify(payload),
        });
        if (response.status === 401) stoppedRef.current = true;
        if (response.status === 429) {
          const retryAfterSeconds = Number(
            response.headers.get("Retry-After") ?? "10",
          );
          retryUntilRef.current =
            Date.now() +
            Math.max(1, Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 10) *
              1000;
        }
        return response.ok;
      } catch {
        return false;
      }
    }

    function sendKeepalive(
      event: DevicePresenceEvent,
      options: { closeReason?: DevicePresenceCloseReason } = {},
    ) {
      if (stoppedRef.current) return;
      const sequence = sequenceRef.current + 1;
      sequenceRef.current = sequence;
      const payload: DevicePresencePayload = {
        event,
        clientSessionId: activeClientSessionId,
        sequence,
        visibilityState: visibilityState(),
        uptimeMsBucket: uptimeBucket(startedAtRef.current),
        closeReason: options.closeReason,
      };
      const body = JSON.stringify(payload);
      try {
        void fetch("/api/device-session/presence", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          keepalive: true,
          body,
        });
      } catch {
        const beacon = window.navigator.sendBeacon;
        if (!beacon) return;
        try {
          beacon(
            "/api/device-session/presence",
            new Blob([body], { type: "application/json" }),
          );
        } catch {
          // Best effort only.
        }
      }
    }

    void (async () => {
      if (
        previousMarker &&
        (previousMarker.pendingRecovery || !previousMarker.cleanClosedAt)
      ) {
        const recovered = await send("recovered_unclean_previous_session");
        updateMarker((current) => ({ ...current, pendingRecovery: !recovered }));
      }
      await send("opened", { ignoreRetryWindow: true });
    })();

    const heartbeat = () => {
      void send("heartbeat").then((ok) => {
        if (!ok) return;
        updateMarker((current) => ({
          ...current,
          lastHeartbeatAt: new Date().toISOString(),
        }));
      });
    };
    const heartbeatInterval = window.setInterval(heartbeat, HEARTBEAT_MS);

    function handleVisibilityChange() {
      const event: DevicePresenceEvent =
        document.visibilityState === "hidden" ? "hidden" : "visible";
      void send(event);
    }

    function handlePageHide(event: PageTransitionEvent) {
      if (event.persisted) {
        sendKeepalive("bfcache_pagehide");
        return;
      }
      updateMarker((current) => ({
        ...current,
        cleanClosedAt: new Date().toISOString(),
      }));
      sendKeepalive("clean_close", { closeReason: "pagehide" });
    }

    function handlePageShow(event: PageTransitionEvent) {
      if (!event.persisted) return;
      void send("bfcache_pageshow", { ignoreRetryWindow: true });
      void send("visible", { ignoreRetryWindow: true });
    }

    function handleFreeze() {
      sendKeepalive("freeze");
    }

    function handleResume() {
      void send("resume", { ignoreRetryWindow: true });
      void send("visible", { ignoreRetryWindow: true });
    }

    function handleWindowError() {
      void send("client_error", { errorBucket: "window_error" });
    }

    function handleUnhandledRejection() {
      void send("unhandled_rejection", {
        errorBucket: "unhandled_rejection",
      });
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("freeze", handleFreeze);
    document.addEventListener("resume", handleResume);
    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      window.clearInterval(heartbeatInterval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("freeze", handleFreeze);
      document.removeEventListener("resume", handleResume);
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener(
        "unhandledrejection",
        handleUnhandledRejection,
      );
      updateMarker((current) => ({
        ...current,
        cleanClosedAt: new Date().toISOString(),
      }));
      sendKeepalive("clean_close", { closeReason: "app_unmount" });
    };
  }, [surface]);

  return null;
}
