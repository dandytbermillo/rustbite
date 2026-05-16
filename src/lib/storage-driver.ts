import "server-only";

// Server-side storage abstraction. Concrete drivers live in:
//   - `./storage-local` (default — writes under IMAGE_LOCAL_UPLOAD_DIR)
//   - `./storage` (opt-in S3/R2 — writes under the configured bucket)
// The upload route picks at request time via getStorageDriver().

export type StorageDriverUploadInput = {
  itemId: string;
  uploadId: string; // crypto.randomUUID() at the call site
  hero: Buffer; // primary variant bytes (800-suffixed key)
  thumb: Buffer; // smaller variant bytes (400-suffixed key)
};

export type StorageDriverUploadResult = {
  imageUrl: string; // relative (`/uploads/...`) for local; absolute CDN URL for S3
};

export interface StorageDriver {
  uploadImage(
    input: StorageDriverUploadInput
  ): Promise<StorageDriverUploadResult>;
}

export type StorageMode = "local" | "s3";

export function getStorageMode(): StorageMode {
  const raw = process.env.IMAGE_STORAGE_DRIVER?.trim().toLowerCase();
  return raw === "s3" ? "s3" : "local";
}

// Lazy-resolve via dynamic import so the unused driver's module (and its
// aws-sdk tree in the local case) never initializes.
let cachedDriver: StorageDriver | null = null;
let cachedMode: StorageMode | null = null;

export async function getStorageDriver(): Promise<StorageDriver> {
  const mode = getStorageMode();
  if (cachedDriver && cachedMode === mode) return cachedDriver;
  cachedMode = mode;
  if (mode === "s3") {
    const mod = await import("./storage");
    cachedDriver = mod.s3Driver;
  } else {
    const mod = await import("./storage-local");
    cachedDriver = mod.localDriver;
  }
  return cachedDriver;
}
