import type { NextConfig } from "next";
import { createRequire } from "node:module";

const requireCjs = createRequire(import.meta.url);
const withPWA = requireCjs("next-pwa")({
  dest: "public",
  register: true,
  skipWaiting: false,
  disable: process.env.NODE_ENV === "development",
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
  // fallbacks disabled — causes build errors with next-pwa 5.6.0 + Next 15
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
  serverExternalPackages: ["@lancedb/lancedb", "sharp", "react-markdown", "mdast-util-to-hast", "unified", "remark-parse", "remark-math", "rehype-katex", "rehype-raw"],
};

export default withPWA(nextConfig);
