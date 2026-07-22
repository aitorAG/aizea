import type { NextConfig } from "next";
import { createRequire } from "node:module";

const requireCjs = createRequire(import.meta.url);
const withPWA = requireCjs("next-pwa")({
  dest: "public",
  register: true,
  // No auto-update: the user must refresh manually to pick up a new SW.
  skipWaiting: false,
  // Avoid generating/loading the SW during `next dev` so we don't
  // interfere with the normal dev server experience. Service workers
  // are only produced during `next build` (production).
  disable: process.env.NODE_ENV === "development",
  // Stale-while-revalidate semantics for HTTP(S) responses keeps the
  // app snappy when the network is flaky and lets cached courses /
  // slides be served instantly while a fresh copy is fetched.
  runtimeCaching: [
    {
      urlPattern: /^\/_next\/static\//,
      handler: "CacheFirst",
      options: {
        cacheName: "next-static",
        expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
      },
    },
    {
      urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/,
      handler: "StaleWhileRevalidate",
      options: { cacheName: "images" },
    },
    {
      urlPattern: /\.(?:js|css)$/,
      handler: "StaleWhileRevalidate",
      options: { cacheName: "assets" },
    },
    {
      urlPattern: /\/api\/.*/,
      handler: "NetworkOnly",
    },
    {
      urlPattern: /^https?:\/\/.*/,
      handler: "NetworkFirst",
      options: {
        cacheName: "offline-cache",
        networkTimeoutSeconds: 5,
        expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 },
      },
    },
  ],
  // Custom offline fallback served by the SW when both cache and
  // network fail for a navigation request.
  fallbacks: {
    document: "/offline.html",
  },
});

const nextConfig: NextConfig = {
  output: "standalone",
  devIndicators: false,
  async redirects() {
    return [{ source: "/dashboard", destination: "/", permanent: true }];
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "250mb",
    },
    optimizePackageImports: ["lucide-react"],
  },
  serverExternalPackages: ["@lancedb/lancedb", "playwright", "playwright-core", "react-markdown", "mdast-util-to-hast", "unified", "remark-parse", "remark-math", "rehype-katex", "rehype-raw"],
};

export default withPWA(nextConfig);
