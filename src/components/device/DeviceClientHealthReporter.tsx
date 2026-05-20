"use client";

import { useEffect, useRef } from "react";
import { reportDeviceClientHealth } from "@/lib/device-client-health-client";

type DeviceClientHealthSurface = "kiosk";
type MenuHealthState = "loading" | "loaded" | "failed";

const CLIENT_HEALTH_HEARTBEAT_MS = 60_000;

export default function DeviceClientHealthReporter({
  surface,
  menuState,
}: {
  surface: DeviceClientHealthSurface;
  menuState: MenuHealthState;
}) {
  const reportedMenuStateRef = useRef<MenuHealthState | null>(null);

  useEffect(() => {
    if (surface !== "kiosk") return;

    reportDeviceClientHealth("app_loaded");
    const interval = window.setInterval(() => {
      reportDeviceClientHealth("heartbeat", { keepalive: true });
    }, CLIENT_HEALTH_HEARTBEAT_MS);

    function handleWindowError() {
      reportDeviceClientHealth("uncaught_error", {
        errorBucket: "uncaught_error",
        keepalive: true,
      });
    }

    function handleUnhandledRejection() {
      reportDeviceClientHealth("unhandled_rejection", {
        errorBucket: "unhandled_rejection",
        keepalive: true,
      });
    }

    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener(
        "unhandledrejection",
        handleUnhandledRejection,
      );
    };
  }, [surface]);

  useEffect(() => {
    if (surface !== "kiosk") return;
    if (reportedMenuStateRef.current === menuState) return;
    reportedMenuStateRef.current = menuState;

    if (menuState === "loaded") {
      reportDeviceClientHealth("menu_loaded");
    } else if (menuState === "failed") {
      reportDeviceClientHealth("menu_failed");
    }
  }, [menuState, surface]);

  return null;
}
