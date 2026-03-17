import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["arche.lvh.me", "127.0.0.1", "localhost"],
  ...(process.env.ARCHE_DESKTOP_NEXT_DIST_DIR && { distDir: process.env.ARCHE_DESKTOP_NEXT_DIST_DIR }),
  serverExternalPackages: ["dockerode"],
  watchOptions: {
    pollIntervalMs: 1000,
  },
  ...(process.env.ARCHE_RUNTIME_MODE === "desktop" && { output: "standalone" }),
};

export default nextConfig;
