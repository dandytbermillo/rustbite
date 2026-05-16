import "server-only";

import { access, constants as FS_CONSTANTS, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  StorageDriver,
  StorageDriverUploadInput,
  StorageDriverUploadResult,
} from "./storage-driver";
import { StorageNotConfiguredError, assertItemId, assertUuid } from "./storage";

export function resolveLocalUploadRoot(): string {
  const raw = process.env.IMAGE_LOCAL_UPLOAD_DIR?.trim();
  if (raw && raw.length > 0) {
    if (!path.isAbsolute(raw)) {
      throw new StorageNotConfiguredError(
        "IMAGE_LOCAL_UPLOAD_DIR must be an absolute path"
      );
    }
    return raw;
  }
  return path.resolve(process.cwd(), "var/uploads");
}

export type LocalReadinessResult =
  | { ok: true; root: string }
  | { ok: false; reason: string };

const NOT_WRITABLE_REASON =
  "Local image storage is not writable — check IMAGE_LOCAL_UPLOAD_DIR permissions.";

const NOT_READABLE_REASON =
  "Local image storage root is not readable — check IMAGE_LOCAL_UPLOAD_DIR.";

function toReason(err: unknown, fallback: string): string {
  return err instanceof StorageNotConfiguredError ? err.message : fallback;
}

// Write-path readiness: mkdir -p + W_OK. Used by the admin page gate and
// the upload route.
export async function ensureLocalStorageReady(): Promise<LocalReadinessResult> {
  let root: string;
  try {
    root = resolveLocalUploadRoot();
  } catch (err) {
    return { ok: false, reason: toReason(err, NOT_WRITABLE_REASON) };
  }
  try {
    await mkdir(root, { recursive: true });
    await access(root, FS_CONSTANTS.W_OK);
    return { ok: true, root };
  } catch {
    return { ok: false, reason: NOT_WRITABLE_REASON };
  }
}

// Read-path readiness: R_OK only. Used by the public /uploads GET handler
// so a read-only FS can still serve existing images.
export async function ensureLocalStorageReadable(): Promise<LocalReadinessResult> {
  let root: string;
  try {
    root = resolveLocalUploadRoot();
  } catch (err) {
    return { ok: false, reason: toReason(err, NOT_READABLE_REASON) };
  }
  try {
    const info = await stat(root);
    if (!info.isDirectory()) {
      return { ok: false, reason: NOT_READABLE_REASON };
    }
    await access(root, FS_CONSTANTS.R_OK);
    return { ok: true, root };
  } catch {
    return { ok: false, reason: NOT_READABLE_REASON };
  }
}

export const localDriver: StorageDriver = {
  async uploadImage(
    input: StorageDriverUploadInput
  ): Promise<StorageDriverUploadResult> {
    const ready = await ensureLocalStorageReady();
    if (!ready.ok) {
      throw new StorageNotConfiguredError(ready.reason);
    }
    const itemId = assertItemId(input.itemId);
    const uploadId = assertUuid(input.uploadId, "uploadId");
    const dir = path.join(ready.root, "items", itemId, uploadId);
    await mkdir(dir, { recursive: true });
    await Promise.all([
      writeFile(path.join(dir, "800.webp"), input.hero),
      writeFile(path.join(dir, "400.webp"), input.thumb),
    ]);
    return {
      imageUrl: `/uploads/items/${itemId}/${uploadId}/800.webp`,
    };
  },
};
