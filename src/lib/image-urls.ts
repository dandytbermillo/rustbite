// Pure image-URL helpers. Safe to import from both client and server code.
// Never reads process.env (except NEXT_PUBLIC_* via the build-time inline, but
// this module avoids even that — callers hand env values in explicitly).

const HERO_SUFFIX = "/800.webp";
const THUMB_SUFFIX = "/400.webp";

// Canonical pattern sources. Shared with `storage.ts` (server-only UUID
// assertion) and `menu-admin.ts` (cross-cutting validator), so every layer
// enforces the exact same shape.
export const UUID_REGEX_SOURCE =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
export const ITEM_ID_REGEX_SOURCE = "[A-Za-z0-9_-]+";

// Local storage URL regex set:
// - HERO_RE: only `/uploads/items/.../800.webp` (DB-valid form).
// - ANY_RE: matches both `/400.webp` and `/800.webp` (post-buildThumbUrl).
// - PATH_SEGMENTS_RE: matches the `items/.../{size}.webp` fragment without
//   the `/uploads/` prefix, for the route handler's catch-all segments.
export const LOCAL_IMAGE_URL_HERO_RE = new RegExp(
  `^/uploads/items/${ITEM_ID_REGEX_SOURCE}/${UUID_REGEX_SOURCE}/800\\.webp$`,
  "i"
);
export const LOCAL_IMAGE_URL_ANY_RE = new RegExp(
  `^/uploads/items/${ITEM_ID_REGEX_SOURCE}/${UUID_REGEX_SOURCE}/(400|800)\\.webp$`,
  "i"
);
export const LOCAL_IMAGE_PATH_SEGMENTS_RE = new RegExp(
  `^items/${ITEM_ID_REGEX_SOURCE}/${UUID_REGEX_SOURCE}/(400|800)\\.webp$`,
  "i"
);

function normalizeUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseUrlHost(value: string | null | undefined): string | null {
  const normalized = normalizeUrl(value);
  if (!normalized) return null;
  try {
    return new URL(normalized).host.toLowerCase();
  } catch {
    return null;
  }
}

export function resolveAllowedImageHosts(
  cdnBase: string | null | undefined,
  pasteAllowlist: string | null | undefined
): string[] {
  const hosts: string[] = [];
  const cdnHost = parseUrlHost(cdnBase);
  if (cdnHost) hosts.push(cdnHost);

  if (typeof pasteAllowlist === "string") {
    for (const token of pasteAllowlist.split(",")) {
      const normalized = token.trim().toLowerCase();
      if (!normalized) continue;
      // Accept either bare hosts or full URLs for operator convenience.
      const hostFromUrl = parseUrlHost(normalized);
      if (hostFromUrl) {
        hosts.push(hostFromUrl);
      } else if (!normalized.includes("/")) {
        hosts.push(normalized);
      }
    }
  }

  return Array.from(new Set(hosts));
}

export function buildPublicImageUrl(
  cdnBase: string,
  itemId: string,
  uploadId: string,
  size: 800 | 400
): string {
  const base = cdnBase.replace(/\/$/, "");
  return `${base}/items/${itemId}/${uploadId}/${size}.webp`;
}

export function buildThumbUrl(imageUrl: string): string {
  if (imageUrl.endsWith(HERO_SUFFIX)) {
    return imageUrl.slice(0, -HERO_SUFFIX.length) + THUMB_SUFFIX;
  }
  return imageUrl;
}

// Returns true when `next/image` can optimize the URL without violating
// remotePatterns. Two cases:
//   1. Local-served relative path matching the strict managed shape —
//      independent of `cdnBase` (local deployments may not set a CDN base).
//   2. Absolute URL whose origin+path matches the managed CDN base
//      produced by buildPublicImageUrl().
export function isManagedImageUrl(
  imageUrl: string | null | undefined,
  cdnBase: string | null | undefined
): boolean {
  const imageNorm = normalizeUrl(imageUrl);
  if (!imageNorm) return false;

  // Local relative path branch — managed regardless of cdnBase.
  if (LOCAL_IMAGE_URL_ANY_RE.test(imageNorm)) return true;

  // Absolute CDN URL branch requires cdnBase.
  const cdnNorm = normalizeUrl(cdnBase);
  if (!cdnNorm) return false;
  let image: URL;
  let cdn: URL;
  try {
    image = new URL(imageNorm);
    cdn = new URL(cdnNorm);
  } catch {
    return false;
  }
  if (image.origin !== cdn.origin) return false;
  // Strictly mirror the `${base}/**` remotePattern next.config.ts emits:
  // require at least one path segment after the CDN base prefix.
  const cdnPath = cdn.pathname.replace(/\/$/, "");
  if (!cdnPath) return true;
  return image.pathname.startsWith(cdnPath + "/");
}
