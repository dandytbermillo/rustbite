"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { buildThumbUrl, isManagedImageUrl } from "@/lib/image-urls";
import type { ImageFit } from "@/lib/types";

type VisualItem = {
  name: string;
  emoji: string;
  bgColor: string;
  imageUrl: string | null;
  imageAlt: string | null;
  cardImageUrl?: string | null;
  cardImageAlt?: string | null;
  imageFit?: ImageFit | null;
};

type Size = "card" | "hero" | "cart" | "sidebar";

const CDN_BASE = process.env.NEXT_PUBLIC_IMAGE_CDN_BASE ?? null;

// Per-size emoji + sizing defaults that match the previous inline tiles.
// The wrapping call sites still own the frame (height / width / rounding),
// so ItemVisual only controls what fills the frame.
const EMOJI_CLASS: Record<Size, string> = {
  card: "text-[8rem] food-shadow transition-transform group-hover:scale-110 group-hover:rotate-6",
  hero: "text-[14rem] md:text-[22rem] food-shadow fade-up",
  cart: "text-5xl",
  sidebar: "text-3xl",
};

const IMAGE_SIZES: Record<Size, string> = {
  card: "(min-width: 768px) 25vw, 50vw",
  hero: "(min-width: 768px) 60vw, 100vw",
  cart: "80px",
  sidebar: "56px",
};

const FIT_CLASS: Record<ImageFit, Record<Size, string>> = {
  COVER: {
    card: "object-cover",
    hero: "object-cover",
    cart: "object-cover",
    sidebar: "object-cover",
  },
  CONTAIN: {
    card: "object-contain p-3",
    hero: "object-contain p-4 md:p-6",
    cart: "object-contain p-1",
    sidebar: "object-contain p-1",
  },
};

export default function ItemVisual({
  item,
  size,
  className,
}: {
  item: VisualItem;
  size: Size;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  // Reset the error state when the URL changes, so a newly-assigned image on
  // the same item (e.g. after admin edit + kiosk menu refresh) gets a fresh
  // load attempt instead of permanently falling back to emoji.
  useEffect(() => {
    setFailed(false);
  }, [item.imageUrl]);

  // Hero-only rendering: every size reads `imageUrl` + `imageFit`. Legacy
  // `cardImageUrl` / `cardImageAlt` are ignored — the admin editor no longer
  // exposes card-image editing and the SQL cleanup nulls any stale values.
  const heroFit = item.imageFit === "CONTAIN" ? "CONTAIN" : "COVER";
  const heroAlt = (item.imageAlt ?? "").trim();
  const heroUrl = item.imageUrl ?? null;

  const baseUrl: string | null = heroUrl;
  const alt = heroUrl ? heroAlt || item.name || "" : item.name || "";
  const imageFit: ImageFit = heroFit;

  const useImage = !!baseUrl && !failed;
  const displayUrl =
    useImage && baseUrl ? (size === "hero" ? baseUrl : buildThumbUrl(baseUrl)) : null;
  // Unconditional: the helper handles `cdnBase=null` cleanly and returns
  // true for strict local paths. Gating on CDN_BASE would silently lose
  // next/image optimization for every kiosk surface in local Pi mode.
  const managed = isManagedImageUrl(displayUrl, CDN_BASE);
  const mediaClass = `${FIT_CLASS[imageFit][size]} ${className ?? ""}`.trim();
  const imageFrameStyle = { background: item.bgColor };

  if (displayUrl && managed) {
    return (
      <div className="relative w-full h-full" style={imageFrameStyle}>
        <Image
          src={displayUrl}
          alt={alt}
          fill
          sizes={IMAGE_SIZES[size]}
          className={mediaClass}
          onError={() => setFailed(true)}
        />
      </div>
    );
  }

  if (displayUrl && !managed) {
    return (
      <div className="w-full h-full" style={imageFrameStyle}>
        {/* Paste-URL host may not be in next.config.ts remotePatterns, so we
            route through a plain <img>. Optimization is skipped for this branch. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={displayUrl}
          alt={alt}
          loading="lazy"
          className={`w-full h-full ${mediaClass}`}
          onError={() => setFailed(true)}
        />
      </div>
    );
  }

  // Emoji fallback — preserves the previous look exactly.
  return (
    <div
      className={`w-full h-full flex items-center justify-center ${className ?? ""}`}
      style={{ background: item.bgColor }}
    >
      <span className={EMOJI_CLASS[size]}>{item.emoji}</span>
    </div>
  );
}
