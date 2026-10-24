import type { NextConfig } from "next";

const isStaticExport = process.env.LETHA_STATIC === "1";
// La demostración de letha-docs sirve la interfaz desde una subcarpeta de su sitio
const demoBasePath = process.env.LETHA_DEMO_BASE_PATH;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: isStaticExport ? "export" : undefined,
  basePath: demoBasePath,
  trailingSlash: Boolean(demoBasePath),
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
