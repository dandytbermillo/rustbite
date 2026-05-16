const textEncoder = new TextEncoder();

function toBinaryBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index);
  }
  return bytes;
}

async function digestBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("Web Crypto is not available");
  }
  const digestInput = Uint8Array.from(bytes);
  const digest = await subtle.digest("SHA-256", digestInput);
  return new Uint8Array(digest);
}

function constantTimeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const maxLength = Math.max(a.length, b.length);

  for (let index = 0; index < maxLength; index += 1) {
    diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }

  return diff === 0;
}

export function decodeBasicAuthPasswordBytes(
  header: string | null | undefined
): Uint8Array | null {
  const value = header ?? "";
  if (!value.startsWith("Basic ")) return null;

  try {
    const raw = atob(value.slice(6));
    const separator = raw.indexOf(":");
    if (separator < 0) return null;
    return toBinaryBytes(raw.slice(separator + 1));
  } catch {
    return null;
  }
}

export async function compareSecretBytes(
  providedBytes: Uint8Array,
  expectedSecret: string
): Promise<boolean> {
  const [providedHash, expectedHash] = await Promise.all([
    digestBytes(providedBytes),
    digestBytes(textEncoder.encode(expectedSecret)),
  ]);

  return constantTimeEqualBytes(providedHash, expectedHash);
}

export async function compareSecretText(
  providedSecret: string,
  expectedSecret: string
): Promise<boolean> {
  const [providedHash, expectedHash] = await Promise.all([
    digestBytes(textEncoder.encode(providedSecret)),
    digestBytes(textEncoder.encode(expectedSecret)),
  ]);

  return constantTimeEqualBytes(providedHash, expectedHash);
}
