import type { NextConfig } from "next";
import { builtinModules } from "module";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const configDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(configDir, "..", "..");
const nodeBuiltins = Object.fromEntries(
  builtinModules.flatMap((name) => {
    const bare = name.startsWith("node:") ? name.slice(5) : name

    return [
      [bare, `commonjs ${bare}`],
      [`node:${bare}`, `commonjs node:${bare}`],
    ]
  }),
);
const watchpackIgnored = [
  "**/.e2e/**",
  "**/.next/**",
  "**/__tests__/**",
  "**/coverage/**",
  "**/coverage-out/**",
  "**/e2e/**",
  "**/node-compile-cache/**",
  "**/node_modules/**",
  "**/playwright-report/**",
  "**/src/generated/**",
  "**/test-results/**",
  "**/*.spec.*",
  "**/*.test.*",
]

const nextConfig: NextConfig = {
  allowedDevOrigins: ["arche.lvh.me", "127.0.0.1", "localhost"],
  ...(process.env.ARCHE_DESKTOP_NEXT_DIST_DIR && { distDir: process.env.ARCHE_DESKTOP_NEXT_DIST_DIR }),
  serverExternalPackages: ["dockerode", "better-sqlite3", "@prisma/adapter-better-sqlite3", "argon2", "@slack/bolt"],
  experimental: {
    proxyClientMaxBodySize: "110mb",
  },
  webpack: (config, { isServer }) => {
    const existingIgnored = config.watchOptions?.ignored
    const existingIgnoredGlobs = Array.isArray(existingIgnored)
      ? existingIgnored.filter((ignored) => typeof ignored === "string")
      : typeof existingIgnored === "string"
        ? [existingIgnored]
        : []

    config.watchOptions = {
      ...config.watchOptions,
      ignored: [
        ...existingIgnoredGlobs,
        ...watchpackIgnored,
      ],
    }

    if (isServer) {
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : []),
        {
          ...nodeBuiltins,
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
