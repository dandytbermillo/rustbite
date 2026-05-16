import type { NextConfig } from "next";

type RemotePattern = {
  protocol: "https";
  hostname: string;
  port?: string;
  pathname?: string;
};

function resolveManagedCdnPattern(raw: string | undefined): RemotePattern | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") return null;
    const pattern: RemotePattern = {
      protocol: "https",
      hostname: url.hostname,
    };
    if (url.port) pattern.port = url.port;
    if (url.pathname && url.pathname !== "/") {
      const base = url.pathname.replace(/\/$/, "");
      pattern.pathname = `${base}/**`;
    }
    return pattern;
  } catch {
    return null;
  }
}

const managedCdnPattern = resolveManagedCdnPattern(
  process.env.NEXT_PUBLIC_IMAGE_CDN_BASE
);

const nextConfig: NextConfig = {
  experimental: {
    cpus: 1,
    webpackBuildWorker: false,
  },
  images: managedCdnPattern
    ? { remotePatterns: [managedCdnPattern] }
    : undefined,
  // Production browser source maps are explicitly OFF. Per the
  // observability plan, `.js.map` files must not ship to production
  // because they expose original source paths, comments, and internal
  // identifiers that aid attackers and operationally provide no benefit
  // (we capture sanitized server-side stacks via captureException). The
  // build-time guard `scripts/check-no-source-maps.ts` enforces this
  // after `next build` and exits non-zero if any maps are found.
  productionBrowserSourceMaps: false,
};

export default nextConfig;
