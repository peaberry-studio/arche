import type { NextConfig } from "next";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const configDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(configDir, "..", "..");

const nextConfig: NextConfig = {
  allowedDevOrigins: ["arche.lvh.me", "127.0.0.1", "localhost"],
  ...(process.env.ARCHE_DESKTOP_NEXT_DIST_DIR && { distDir: process.env.ARCHE_DESKTOP_NEXT_DIST_DIR }),
  serverExternalPackages: ["dockerode", "better-sqlite3", "@prisma/adapter-better-sqlite3"],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : []),
        {
          "child_process": "commonjs child_process",
          "crypto": "commonjs crypto",
          "fs": "commonjs fs",
          "fs/promises": "commonjs fs/promises",
          "node:child_process": "commonjs node:child_process",
          "node:crypto": "commonjs node:crypto",
          "node:fs": "commonjs node:fs",
          "node:fs/promises": "commonjs node:fs/promises",
          "node:os": "commonjs node:os",
          "node:path": "commonjs node:path",
          "node:util": "commonjs node:util",
          "os": "commonjs os",
          "path": "commonjs path",
          "util": "commonjs util",
        },
      ]
    }

    return config
  },
  turbopack: {
    root: repoRoot,
  },
  watchOptions: {
    pollIntervalMs: 1000,
  },
  ...(process.env.ARCHE_RUNTIME_MODE === "desktop" && { output: "standalone" }),
};

export default nextConfig;
