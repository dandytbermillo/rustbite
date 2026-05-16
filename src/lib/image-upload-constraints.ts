// Client-safe upload constraints. Kept out of `storage.ts` (which carries
// `import "server-only"`) so client components like `MenuEditor` can mirror
// server-side type/size gates without importing the S3 driver or Node APIs.
// `storage.ts` re-exports these so server callers keep their existing imports.

export const ACCEPTED_IMAGE_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type AcceptedImageContentType =
  (typeof ACCEPTED_IMAGE_CONTENT_TYPES)[number];

export const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;
