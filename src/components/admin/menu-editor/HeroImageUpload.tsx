"use client";

import { useEffect, useRef, useState } from "react";
import { Upload, Trash2 } from "lucide-react";
import { BRAND } from "@/lib/brand";
import type { HeroPending } from "./types";

type Props = {
  // The currently-saved server URL (or null).
  imageUrl: string | null;
  imageAlt: string | null;
  // Display fit for the menu card. Mirrors the existing select.
  imageFit: "COVER" | "CONTAIN";
  // Pending hero state managed by the parent.
  hero: HeroPending;
  onHeroChange: (next: HeroPending) => void;
  onAltChange: (next: string) => void;
  onFitChange: (next: "COVER" | "CONTAIN") => void;
  // Server-side max upload bytes (mirrors MAX_IMAGE_UPLOAD_BYTES).
  maxBytes: number;
  acceptedTypes: readonly string[];
  // Card-preview fields. When provided, the "Menu card" slot renders the
  // real kiosk card (emoji on bgColor with badge/combo overlays + name/desc/
  // price strip below) instead of an empty image placeholder. This matches
  // the kiosk's behavior of falling back to emoji+bgColor when no hero
  // image is uploaded — so what the operator sees here is what customers
  // see on the menu list.
  cardPreview?: {
    emoji: string;
    bgColor: string;
    name: string;
    description?: string | null;
    price: number;
    badge?: string | null;
    comboNum?: number | null;
  };
};

// TODO(wiring):
//  - Reproduce the blob-URL preview + cleanup pattern from MenuEditor.tsx
//    (`heroPreviewUrl` + URL.revokeObjectURL on unmount or replacement).
//  - Validate content-type and byte count before staging.
//  - Surface storage 503 (StorageNotConfiguredError) and image processing
//    errors back into the form via the parent's error state.
export default function HeroImageUpload({
  imageUrl,
  imageAlt,
  imageFit,
  hero,
  onHeroChange,
  onAltChange,
  onFitChange,
  maxBytes,
  acceptedTypes,
  cardPreview,
}: Props) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Mirror MenuEditor.tsx's blob URL lifecycle.
  useEffect(() => {
    if (!hero.heroFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(hero.heroFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [hero.heroFile]);

  function handleFile(file: File | null) {
    if (!file) return;
    setError(null);
    if (!(acceptedTypes as readonly string[]).includes(file.type.toLowerCase())) {
      setError(`Type must be one of: ${acceptedTypes.join(", ")}`);
      return;
    }
    if (file.size > maxBytes) {
      setError(`File exceeds ${Math.round(maxBytes / 1024 / 1024)} MB`);
      return;
    }
    onHeroChange({ heroFile: file, removeHero: false });
  }

  const displayedUrl = hero.removeHero ? null : previewUrl ?? imageUrl;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 p-4 bg-stone-50 border border-stone-150 rounded-2xl">
      <div>
        <div className="text-[10px] font-black tracking-widest uppercase text-stone-500 mb-2">
          Menu card
        </div>
        {/* Mirrors the existing modal's MENU CARD preview (see backup at
            docs/backups/.../MenuEditor.tsx:2245). When no hero image is
            uploaded, kiosk customers see emoji on bgColor — so we render
            that same fallback here instead of an empty image slot. */}
        <div className="relative overflow-hidden rounded-2xl border border-stone-200 bg-white">
          {cardPreview?.badge && (
            <div className="absolute top-3 left-3 z-10">
              <span
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black tracking-widest uppercase"
                style={
                  cardPreview.badge === "HOT"
                    ? { background: BRAND.red, color: "white" }
                    : { background: BRAND.yellow, color: BRAND.black }
                }
              >
                {cardPreview.badge}
              </span>
            </div>
          )}
          {cardPreview?.comboNum != null && (
            <div
              className="absolute top-3 right-3 z-10 px-2.5 py-1 rounded-lg"
              style={{
                background: BRAND.black,
                color: BRAND.yellow,
                fontFamily: "Archivo Black",
                fontSize: "16px",
                lineHeight: 1,
              }}
            >
              #{cardPreview.comboNum}
            </div>
          )}
          <div
            className="relative h-40 overflow-hidden flex items-center justify-center"
            style={{ background: cardPreview?.bgColor ?? "#f5f5f4" }}
          >
            {displayedUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={displayedUrl}
                alt={imageAlt ?? cardPreview?.name ?? "Menu card preview"}
                className={
                  imageFit === "CONTAIN"
                    ? "max-w-[80%] max-h-[80%] object-contain"
                    : "w-full h-full object-cover"
                }
              />
            ) : cardPreview?.emoji ? (
              <span
                className="text-[80px] leading-none"
                style={{ filter: "drop-shadow(0 12px 18px rgba(0,0,0,0.18))" }}
              >
                {cardPreview.emoji}
              </span>
            ) : (
              <span className="text-stone-400 text-xs uppercase tracking-widest font-bold">
                No hero image
              </span>
            )}
          </div>
          {cardPreview && (
            <div className="p-4">
              <div
                className="text-xl mb-1 leading-tight"
                style={{ fontFamily: "Archivo Black", letterSpacing: "-0.02em" }}
              >
                {cardPreview.name || "Unnamed item"}
              </div>
              <div className="text-xs text-stone-500 mb-3 line-clamp-2 min-h-[32px]">
                {cardPreview.description ||
                  "Description will appear on the kiosk here."}
              </div>
              <div
                className="text-2xl"
                style={{
                  fontFamily: "Archivo Black",
                  color: BRAND.red,
                  letterSpacing: "-0.02em",
                }}
              >
                ${cardPreview.price.toFixed(2)}
              </div>
            </div>
          )}
        </div>
      </div>

      <div>
        <div className="text-[10px] font-black tracking-widest uppercase text-stone-500 mb-2">
          Customize hero image
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-3 rounded-xl text-[11px] font-black tracking-widest uppercase text-white"
            style={{ background: BRAND.black }}
          >
            <Upload size={14} strokeWidth={2.5} />
            Upload hero image
          </button>
          {(imageUrl || hero.heroFile) && (
            <button
              type="button"
              onClick={() =>
                onHeroChange({ heroFile: null, removeHero: !!imageUrl })
              }
              className="inline-flex items-center gap-2 px-4 py-3 rounded-xl text-[11px] font-black tracking-widest uppercase text-stone-700 border border-stone-300 hover:bg-stone-50"
            >
              <Trash2 size={14} strokeWidth={2.5} />
              Remove
            </button>
          )}
          <input
            ref={inputRef}
            type="file"
            accept={acceptedTypes.join(",")}
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />
        </div>

        {error && <p className="mt-2 text-xs font-bold text-red-600">{error}</p>}

        <div className="mt-4">
          <label className="text-[11px] font-black tracking-widest uppercase text-stone-700 block mb-1.5">
            Menu card display
          </label>
          <select
            value={imageFit}
            onChange={(e) => onFitChange(e.target.value as "COVER" | "CONTAIN")}
            className="w-full px-3 py-2.5 rounded-lg border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:border-stone-900"
            style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
          >
            <option value="COVER">The menu card · fill frame</option>
            <option value="CONTAIN">The menu card · fit inside frame</option>
          </select>
          <p className="mt-1.5 text-xs text-stone-500">
            Choose &quot;fit inside frame&quot; for PNG illustrations or sticker-style art.
            Keep &quot;fill frame&quot; for real food photos.
          </p>
        </div>

        <div className="mt-4">
          <label className="text-[11px] font-black tracking-widest uppercase text-stone-700 block mb-1.5">
            Hero image alt <span className="text-stone-400 font-medium normal-case">optional</span>
          </label>
          <input
            type="text"
            value={imageAlt ?? ""}
            onChange={(e) => onAltChange(e.target.value)}
            placeholder="Shown to screen-readers. Defaults to item name if empty."
            className="w-full px-3 py-2.5 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:border-stone-900"
            style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
          />
        </div>
      </div>
    </div>
  );
}
