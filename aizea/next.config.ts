import type { NextConfig } from "next";

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
  serverExternalPackages: ["@lancedb/lancedb"],
};

export default nextConfig;
