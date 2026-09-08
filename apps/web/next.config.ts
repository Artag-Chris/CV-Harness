import type { NextConfig } from "next";

// API_PROXY_TARGET / NEXT_PUBLIC_API_URL deben incluir el prefijo /api
// (ej: http://cvharness-api:3100/api). El rewrite conserva :path*.
const API_PROXY_TARGET =
  process.env.API_PROXY_TARGET ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:3100/api";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_PROXY_TARGET}/:path*`,
      },
    ];
  },
};

export default nextConfig;
