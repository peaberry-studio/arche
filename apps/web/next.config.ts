import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["arche.lvh.me"],
  serverExternalPackages: ["dockerode"],
  watchOptions: {
    pollIntervalMs: 1000,
  },
};

export default nextConfig;
