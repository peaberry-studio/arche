import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.ARCHE_RUNTIME_MODE === "desktop" && { output: "standalone" }),
};

export default nextConfig;
