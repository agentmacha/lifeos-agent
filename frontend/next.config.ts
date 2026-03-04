import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Allow the standalone server to bind correctly on Render
  experimental: {},
};

export default nextConfig;
