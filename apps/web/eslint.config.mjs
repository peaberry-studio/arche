import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    ignores: ["src/lib/harness/adapters/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@opencode-ai/*", "@opencode/*"],
              message: "Use the Arche harness runtime contract instead of a harness SDK or adapter internal.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    ignores: ["src/lib/harness/adapters/**", "src/lib/harness/registry.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@opencode-ai/*", "@opencode/*", "@/lib/harness/adapters/**"],
              message: "Use the Arche harness runtime contract instead of a harness SDK or adapter internal.",
            },
          ],
        },
      ],
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-desktop/**",
    ".next-desktop*/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    "src/generated/prisma-desktop/**",
  ]),
]);

export default eslintConfig;
