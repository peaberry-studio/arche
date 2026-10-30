import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/lib/connectors/**/*.{ts,tsx}", "src/lib/providers/**/*.{ts,tsx}"],
    ignores: [
      "**/__tests__/**", "**/*.test.ts", "**/*.test.tsx",
      "src/lib/connectors/ahrefs-client.ts",
      "src/lib/connectors/meta-ads-client.ts",
      "src/lib/connectors/zendesk-client.ts",
      "src/lib/providers/gateway-fetch.ts",
      "src/lib/providers/ollama.ts",
      "src/lib/providers/zen-catalog.ts",
    ],
    rules: {
      "no-restricted-globals": ["error", { name: "fetch", message: "Use publicFetch for connector/provider destinations. Raw transport requires an explicitly reviewed exception." }],
      "no-restricted-syntax": ["error", {
        selector: "MemberExpression[object.name=/^(globalThis|global|window)$/][property.name='fetch']",
        message: "Use publicFetch for connector/provider destinations.",
      }],
    },
  },
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
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
    "src/generated/prisma-desktop/**",
  ]),
]);

export default eslintConfig;
