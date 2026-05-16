import "server-only";

import sharp from "sharp";

const HERO_SIZE = 800;
const THUMB_SIZE = 400;
const CARD_PRIMARY_WIDTH = 800;
const CARD_PRIMARY_HEIGHT = 480;
const CARD_THUMB_WIDTH = 400;
const CARD_THUMB_HEIGHT = 240;
const WEBP_QUALITY = 82;
const MAX_INPUT_PIXELS = 25_000_000; // 25 megapixels — guards against decompression-bomb inputs

export class ImageProcessingError extends Error {
  constructor(
    public readonly code:
      | "INVALID_IMAGE"
      | "UNSUPPORTED_FORMAT"
      | "DIMENSIONS_TOO_LARGE",
    message: string
  ) {
    super(message);
    this.name = "ImageProcessingError";
  }
}

export type ProcessedVariants = {
  hero: Buffer;
  thumb: Buffer;
  metadata: {
    width: number;
    height: number;
    format: string;
  };
};

const ACCEPTED_FORMATS = new Set(["jpeg", "png", "webp"]);
type ImageTarget = "hero" | "card";

/**
 * Re-encodes an uploaded image into the kiosk-ready WebP variants.
 *
 * - Hero target: aspect-preserving, max 800×800 primary + max 400×400 thumb.
 *   Output dimensions mirror the source aspect ratio — nothing is cropped or
 *   padded. `imageFit` is purely a render-time concern (CSS `object-cover` /
 *   `object-contain` in `ItemVisual`), so dropdown changes at SAVE never drift
 *   from the stored bytes.
 * - Card target: 800×480 primary + 400×240 thumb, cover-cropped with
 *   attention-focused positioning (unchanged).
 *
 * Uses sharp's `limitInputPixels` option so a tiny-file but huge-dimension
 * image (classic decompression-bomb attack) cannot exhaust process memory.
 *
 * Throws `ImageProcessingError` for:
 * - Unsupported format (not jpeg/png/webp).
 * - Decode failure (corrupt bytes, zero dimensions).
 * - Decoded dimensions > 25 megapixels.
 */
export async function processUploadedImage(
  originalBytes: Buffer,
  options?: { target?: ImageTarget }
): Promise<ProcessedVariants> {
  const target = options?.target === "card" ? "card" : "hero";
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(originalBytes, {
      limitInputPixels: MAX_INPUT_PIXELS,
    }).metadata();
  } catch (err) {
    throw new ImageProcessingError(
      "INVALID_IMAGE",
      `Could not decode image: ${(err as Error).message}`
    );
  }

  const format = metadata.format ?? "";
  if (!ACCEPTED_FORMATS.has(format)) {
    throw new ImageProcessingError(
      "UNSUPPORTED_FORMAT",
      `Unsupported image format: ${format || "unknown"}`
    );
  }

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width <= 0 || height <= 0) {
    throw new ImageProcessingError(
      "INVALID_IMAGE",
      "Image has zero or invalid dimensions"
    );
  }
  if (width * height > MAX_INPUT_PIXELS) {
    throw new ImageProcessingError(
      "DIMENSIONS_TOO_LARGE",
      `Image dimensions (${width}×${height}) exceed the ${MAX_INPUT_PIXELS}-pixel limit`
    );
  }

  const toVariant = (widthPx: number, heightPx: number) =>
    sharp(originalBytes, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate() // apply EXIF orientation so the output is visually correct
      .resize(
        widthPx,
        heightPx,
        target === "card"
          ? { fit: "cover", position: "attention" }
          : { fit: "inside", withoutEnlargement: false }
      )
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();

  const [primaryWidth, primaryHeight, thumbWidth, thumbHeight] =
    target === "card"
      ? [
          CARD_PRIMARY_WIDTH,
          CARD_PRIMARY_HEIGHT,
          CARD_THUMB_WIDTH,
          CARD_THUMB_HEIGHT,
        ]
      : [HERO_SIZE, HERO_SIZE, THUMB_SIZE, THUMB_SIZE];

  const [hero, thumb] = await Promise.all([
    toVariant(primaryWidth, primaryHeight),
    toVariant(thumbWidth, thumbHeight),
  ]);

  return {
    hero,
    thumb,
    metadata: { width, height, format },
  };
}

// Detects whether an image contains actually-transparent pixels (not just an
// alpha channel with every pixel opaque). Used by the upload route to pick a
// sensible fit-mode default on first upload. Cheap path: if the header has
// no alpha channel at all, skip the pixel scan.
export async function probeImageAlpha(
  originalBytes: Buffer
): Promise<{ hasTransparency: boolean }> {
  let meta: sharp.Metadata;
  try {
    meta = await sharp(originalBytes, {
      limitInputPixels: MAX_INPUT_PIXELS,
    }).metadata();
  } catch {
    return { hasTransparency: false };
  }
  if (!meta.hasAlpha) return { hasTransparency: false };
  try {
    const stats = await sharp(originalBytes, {
      limitInputPixels: MAX_INPUT_PIXELS,
    }).stats();
    const alpha = stats.channels[3];
    return { hasTransparency: !!alpha && alpha.min < 255 };
  } catch {
    return { hasTransparency: false };
  }
}
