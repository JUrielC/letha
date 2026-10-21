import type { NextConfig } from "next";

const isStaticExport = process.env.LETHA_STATIC === "1";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: isStaticExport ? "export" : undefined,
  images: { unoptimized: true },
  async rewrites() {
    if (isStaticExport) return [];
    return [
      {
        source: "/api/:path*",
        destination: "http://127.0.0.1:47830/api/:path*",
      },
    ];
  },
};

export default nextConfig;
