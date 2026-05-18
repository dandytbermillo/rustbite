"use client";

import { useEffect, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";

const FULLSCREEN_PREFERENCE_STORAGE_KEY =
  "rushbite:admin-fullscreen-preference:v1";

type FullscreenOrientationPreference = "landscape" | "portrait";

type FullscreenPreference = {
  version: 1;
  desiredFullscreen: boolean;
  orientation: FullscreenOrientationPreference;
  orientationType: string | null;
  updatedAt: string;
};

type ScreenOrientationWithLock = ScreenOrientation & {
  lock?: (orientation: FullscreenOrientationPreference) => Promise<void>;
  unlock?: () => void;
};

function currentOrientationPreference(): Pick<
  FullscreenPreference,
  "orientation" | "orientationType"
> {
  const orientationType = window.screen.orientation?.type ?? null;
  const orientation =
    orientationType?.startsWith("portrait") ||
    window.matchMedia("(orientation: portrait)").matches
      ? "portrait"
      : "landscape";
  return { orientation, orientationType };
}

function readFullscreenPreference(): FullscreenPreference | null {
  try {
    const raw = window.localStorage.getItem(FULLSCREEN_PREFERENCE_STORAGE_KEY);
    if (!raw) return null;
    const candidate = JSON.parse(raw) as Partial<FullscreenPreference>;
    if (candidate.version !== 1) return null;
    if (typeof candidate.desiredFullscreen !== "boolean") return null;
    return {
      version: 1,
      desiredFullscreen: candidate.desiredFullscreen,
      orientation:
        candidate.orientation === "portrait" ? "portrait" : "landscape",
      orientationType:
        typeof candidate.orientationType === "string"
          ? candidate.orientationType
          : null,
      updatedAt:
        typeof candidate.updatedAt === "string"
          ? candidate.updatedAt
          : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function writeFullscreenPreference(desiredFullscreen: boolean) {
  try {
    const orientation = currentOrientationPreference();
    const preference: FullscreenPreference = {
      version: 1,
      desiredFullscreen,
      ...orientation,
      updatedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(
      FULLSCREEN_PREFERENCE_STORAGE_KEY,
      JSON.stringify(preference),
    );
    return preference;
  } catch {
    return null;
  }
}

async function lockPreferredOrientation(
  preference: FullscreenPreference | null,
) {
  if (!preference) return;
  try {
    await (window.screen.orientation as ScreenOrientationWithLock | undefined)
      ?.lock?.(preference.orientation);
  } catch {
    // Orientation lock is best-effort and commonly requires fullscreen/mobile.
  }
}

function unlockPreferredOrientation() {
  try {
    (window.screen.orientation as ScreenOrientationWithLock | undefined)
      ?.unlock?.();
  } catch {
    // Some browsers expose lock() without unlock(), or reject outside mobile.
  }
}

/**
 * Toggles browser fullscreen via the Fullscreen API. Hides the address bar,
 * tabs, and bookmarks bar so the admin app gets the entire viewport. ESC
 * exits (browser default).
 *
 * Why a separate client component: AdminShell is an async server component
 * and cannot use useState/useEffect directly.
 *
 * Why feature-detect: older browsers and some embedded webviews don't
 * implement requestFullscreen on documentElement; rendering the button when
 * it can't work is just user-hostile noise.
 */
export default function AdminFullscreenButton() {
  const [supported, setSupported] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [wantsFullscreen, setWantsFullscreen] = useState(false);

  useEffect(() => {
    const el = document.documentElement;
    setSupported(typeof el.requestFullscreen === "function");
    setWantsFullscreen(
      readFullscreenPreference()?.desiredFullscreen === true,
    );

    const onChange = () => {
      const nextFullscreen = Boolean(document.fullscreenElement);
      setIsFullscreen(nextFullscreen);
      if (nextFullscreen) {
        const storedPreference = readFullscreenPreference();
        const preference = storedPreference?.desiredFullscreen
          ? storedPreference
          : writeFullscreenPreference(true);
        setWantsFullscreen(true);
        void lockPreferredOrientation(preference);
      } else if (document.visibilityState === "visible") {
        writeFullscreenPreference(false);
        setWantsFullscreen(false);
        unlockPreferredOrientation();
      }
    };
    const onPageHide = () => {
      if (document.fullscreenElement) {
        writeFullscreenPreference(true);
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    window.addEventListener("pagehide", onPageHide);
    setIsFullscreen(Boolean(document.fullscreenElement));
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);

  if (!supported) return null;

  const toggle = async () => {
    if (document.fullscreenElement) {
      writeFullscreenPreference(false);
      setWantsFullscreen(false);
      unlockPreferredOrientation();
      try {
        await document.exitFullscreen();
      } catch {
        // The saved preference is already cleared; avoid noisy rejections.
      }
    } else {
      const storedPreference = readFullscreenPreference();
      const preference = storedPreference?.desiredFullscreen
        ? storedPreference
        : writeFullscreenPreference(true);
      setWantsFullscreen(true);
      try {
        await document.documentElement.requestFullscreen();
        await lockPreferredOrientation(preference);
      } catch {
        writeFullscreenPreference(false);
        setWantsFullscreen(false);
      }
    }
  };

  const label = isFullscreen
    ? "Exit"
    : wantsFullscreen
      ? "Resume fullscreen"
      : "Fullscreen";
  const ariaLabel = isFullscreen
    ? "Exit fullscreen"
    : wantsFullscreen
      ? "Resume fullscreen"
      : "Enter fullscreen";

  return (
    <button
      type="button"
      onClick={toggle}
      data-testid="admin-fullscreen-toggle"
      aria-label={ariaLabel}
      aria-pressed={isFullscreen}
      title={
        isFullscreen
          ? "Exit fullscreen (Esc)"
          : wantsFullscreen
            ? "Resume fullscreen"
            : "Enter fullscreen"
      }
      className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/10 px-3 py-2 text-[12px] font-black text-white/88 hover:bg-white/15"
    >
      {isFullscreen ? (
        <Minimize2 size={14} strokeWidth={2.5} aria-hidden />
      ) : (
        <Maximize2 size={14} strokeWidth={2.5} aria-hidden />
      )}
      <span>{label}</span>
    </button>
  );
}
