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

// Fase 5-B — Content-Security-Policy + security headers.
//
// The Tauri window loads http://localhost:1422 (content served by Next over
// HTTP), NOT Tauri's asset protocol, so `tauri.conf.json`'s `csp` field does
// not govern this content — the CSP must arrive as HTTP RESPONSE HEADERS from
// Next. The app was shipping with NO policy (`csp: null`), so any injected
// markup could load/exfiltrate freely. This adds a real policy.
//
// Notes on the directives:
//  - script-src allows 'unsafe-inline' because Next injects inline bootstrap
//    scripts and this app has no nonce middleware; 'unsafe-eval' is dev-only
//    (React Refresh). Still a large improvement over no policy.
//  - connect-src 'self' is sufficient for the BROWSER: OpenRouter / docling
//    calls are made server-side (Node → external), not from the browser, so
//    they are not subject to this directive. Dev adds ws: for HMR.
//  - frame-ancestors 'none' + object-src 'none' + base-uri 'self' close the
//    common injection/clickjacking vectors.
const isDev = process.env.NODE_ENV === "development";

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  `connect-src 'self'${isDev ? " ws: http://localhost:*" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  devIndicators: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async redirects() {
    return [{ source: "/dashboard", destination: "/", permanent: true }];
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "250mb",
    },
    optimizePackageImports: ["lucide-react"],
  },
    serverExternalPackages: ["@lancedb/lancedb", "sharp", "@hyzyla/pdfium", "pngjs", "react-markdown", "mdast-util-to-hast", "unified", "remark-parse", "remark-math", "rehype-katex", "rehype-raw"],
};

export default withPWA(nextConfig);
