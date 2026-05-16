import "server-only";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  ITEM_ID_REGEX_SOURCE,
  UUID_REGEX_SOURCE,
  buildPublicImageUrl,
} from "./image-urls";
import type {
  StorageDriver,
  StorageDriverUploadInput,
  StorageDriverUploadResult,
} from "./storage-driver";

export class StorageNotConfiguredError extends Error {
  constructor(
    message = "Storage not configured. Set IMAGE_BUCKET_* and NEXT_PUBLIC_IMAGE_CDN_BASE in env."
  ) {
    super(message);
    this.name = "StorageNotConfiguredError";
  }
}

// Re-export client-safe upload constraints so existing server imports from
// `@/lib/storage` keep working. The source of truth is
// `./image-upload-constraints`, which has no `server-only` guard and can be
// consumed from client components.
export {
  ACCEPTED_IMAGE_CONTENT_TYPES,
  MAX_IMAGE_UPLOAD_BYTES,
} from "./image-upload-constraints";
export type { AcceptedImageContentType } from "./image-upload-constraints";

// Multipart body cap = image cap + headroom for boundaries + small fields.
// Keep distinct from MAX_IMAGE_UPLOAD_BYTES; a valid 5 MB image can encode
// past exactly 5 MB once boundaries and the imageAlt / updatedAt fields are
// included. Server-only — not exposed to client components.
export const MAX_MULTIPART_BODY_BYTES = 6 * 1024 * 1024;

// Pattern sources live in `./image-urls` so client-safe validators and the
// `/uploads/[...path]` route handler all reuse the exact same shape.
export const UUID_REGEX = new RegExp(`^${UUID_REGEX_SOURCE}$`, "i");
export const ITEM_ID_REGEX = new RegExp(`^${ITEM_ID_REGEX_SOURCE}$`, "i");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new StorageNotConfiguredError(
      `Storage not configured. Missing env ${name}.`
    );
  }
  return value.trim();
}

const REQUIRED_S3_ENVS = [
  "IMAGE_BUCKET_REGION",
  "IMAGE_BUCKET_NAME",
  "IMAGE_BUCKET_ACCESS_KEY_ID",
  "IMAGE_BUCKET_SECRET_ACCESS_KEY",
  "NEXT_PUBLIC_IMAGE_CDN_BASE",
] as const;

export function isS3StorageConfigured(): boolean {
  for (const name of REQUIRED_S3_ENVS) {
    const value = process.env[name];
    if (typeof value !== "string" || value.trim().length === 0) {
      return false;
    }
  }
  return true;
}

let cachedClient: S3Client | null = null;
function getClient(): { client: S3Client; bucket: string; cdnBase: string } {
  const region = requireEnv("IMAGE_BUCKET_REGION");
  const bucket = requireEnv("IMAGE_BUCKET_NAME");
  const accessKeyId = requireEnv("IMAGE_BUCKET_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv("IMAGE_BUCKET_SECRET_ACCESS_KEY");
  const cdnBase = requireEnv("NEXT_PUBLIC_IMAGE_CDN_BASE");
  const endpoint = process.env.IMAGE_BUCKET_ENDPOINT?.trim() || undefined;

  if (!cachedClient) {
    cachedClient = new S3Client({
      region,
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: !!endpoint, // R2 + MinIO prefer path-style
    });
  }

  return { client: cachedClient, bucket, cdnBase };
}

export function assertUuid(value: string, label: string): string {
  if (!UUID_REGEX.test(value)) {
    throw new Error(`${label} is not a valid UUID`);
  }
  return value;
}

export function assertItemId(value: string): string {
  if (!ITEM_ID_REGEX.test(value) || value.length > 128) {
    throw new Error("Item ID is not a valid key segment");
  }
  return value;
}

async function putVariant(
  client: S3Client,
  bucket: string,
  key: string,
  body: Buffer
): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "image/webp",
      CacheControl: "public, max-age=31536000, immutable",
    })
  );
}

export const s3Driver: StorageDriver = {
  async uploadImage(
    input: StorageDriverUploadInput
  ): Promise<StorageDriverUploadResult> {
    const { client, bucket, cdnBase } = getClient();
    const itemId = assertItemId(input.itemId);
    const uploadId = assertUuid(input.uploadId, "uploadId");

    await Promise.all([
      putVariant(
        client,
        bucket,
        `items/${itemId}/${uploadId}/800.webp`,
        input.hero
      ),
      putVariant(
        client,
        bucket,
        `items/${itemId}/${uploadId}/400.webp`,
        input.thumb
      ),
    ]);

    return {
      imageUrl: buildPublicImageUrl(cdnBase, itemId, uploadId, 800),
    };
  },
};
