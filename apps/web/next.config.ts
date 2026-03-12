import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["arche.lvh.me"],
  serverExternalPackages: ["dockerode"],
};

export default nextConfig;
