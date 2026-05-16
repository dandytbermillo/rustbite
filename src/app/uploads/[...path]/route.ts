import { NextRequest, NextResponse } from "next/server";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { LOCAL_IMAGE_PATH_SEGMENTS_RE } from "@/lib/image-urls";
import { ensureLocalStorageReadable } from "@/lib/storage-local";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const GENERIC_UNAVAILABLE = { error: "Image storage unavailable." };

function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params;

  if (!Array.isArray(segments) || segments.length === 0) {
    return badRequest("Missing path");
  }

  // Shape pin — reject anything that doesn't map 1:1 to an uploaded variant.
  // Uses the shared strict-UUID fragment from image-urls.ts.
  const joined = segments.join("/");
  if (!LOCAL_IMAGE_PATH_SEGMENTS_RE.test(joined)) {
    return badRequest("Invalid image path");
  }

  // Read-path readiness probe. Generic body so an unauthenticated kiosk
  // client never sees absolute filesystem paths or detailed permissions
  // info. Detailed operator copy lives on /admin/menu.
  const ready = await ensureLocalStorageReadable();
  if (!ready.ok) {
    return NextResponse.json(GENERIC_UNAVAILABLE, { status: 503 });
  }

  let rootReal: string;
  try {
    rootReal = await realpath(ready.root);
  } catch {
    return NextResponse.json(GENERIC_UNAVAILABLE, { status: 503 });
  }

  const candidate = path.join(rootReal, ...segments);
  // Lexical containment after shape check — defense-in-depth against any
  // weird path.join behavior on non-POSIX separators.
  if (
    candidate !== rootReal &&
    !candidate.startsWith(rootReal + path.sep)
  ) {
    return badRequest("Invalid image path");
  }

  let info;
  try {
    info = await stat(candidate);
  } catch {
    return notFound();
  }
  if (!info.isFile()) {
    return notFound();
  }

  // Mandatory symlink-escape re-check. /uploads is public-facing, so we pay
  // the extra realpath to close the only meaningful filesystem-escape edge
  // that remains after the regex + lexical checks.
  let fileReal: string;
  try {
    fileReal = await realpath(candidate);
  } catch {
    return notFound();
  }
  if (
    fileReal !== rootReal &&
    !fileReal.startsWith(rootReal + path.sep)
  ) {
    return notFound();
  }

  const bytes = await readFile(fileReal);
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Length": String(bytes.byteLength),
    },
  });
}
