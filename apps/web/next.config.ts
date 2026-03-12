import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["arche.lvh.me"],
  serverExternalPackages: ["dockerode"],
  ...(process.env.ARCHE_RUNTIME_MODE === "desktop" && { output: "standalone" }),
};

export default nextConfig;
