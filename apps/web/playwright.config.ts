import { tmpdir } from 'node:os'
import path from 'node:path'

import { defineConfig } from '@playwright/test'

import { getE2eProfile } from './src/lib/e2e/profile'

const profile = getE2eProfile()
const isSmokeFake = profile === 'smoke-fake'
const DEFAULT_E2E_ENCRYPTION_KEY = 'ZGV2LWluc2VjdXJlLWtleS0zMi1ieXRlcy1sb25nISE='

// Keep mutable E2E data outside apps/web so Next dev HMR does not rebuild during tests.
const e2eRoot = process.env.ARCHE_E2E_ROOT?.trim() || path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'arche-web-e2e')
const runtimePassword = process.env.ARCHE_E2E_RUNTIME_PASSWORD ?? 'arche-e2e-runtime'
const runtimeBaseUrl = process.env.ARCHE_E2E_RUNTIME_BASE_URL ?? `http://127.0.0.1:${process.env.ARCHE_E2E_RUNTIME_PORT ?? '4210'}`

const commonEnv = {
  ARCHE_E2E_ROOT: e2eRoot,
  ARCHE_ENCRYPTION_KEY: process.env.ARCHE_ENCRYPTION_KEY ?? DEFAULT_E2E_ENCRYPTION_KEY,
  ARCHE_SEED_ADMIN_EMAIL: process.env.ARCHE_SEED_ADMIN_EMAIL ?? 'admin-e2e@arche.local',
  ARCHE_SEED_ADMIN_PASSWORD: process.env.ARCHE_SEED_ADMIN_PASSWORD ?? 'arche-e2e-admin',
  ARCHE_SEED_ADMIN_SLUG: process.env.ARCHE_SEED_ADMIN_SLUG ?? 'admin',
  ARCHE_USERS_PATH: process.env.ARCHE_USERS_PATH ?? path.join(e2eRoot, 'users'),
  KB_CONFIG_HOST_PATH: process.env.KB_CONFIG_HOST_PATH ?? path.join(e2eRoot, 'kb-config'),
  KB_CONTENT_HOST_PATH: process.env.KB_CONTENT_HOST_PATH ?? path.join(e2eRoot, 'kb-content'),
}

const fakeRuntimeEnv = {
  ARCHE_ENABLE_E2E_HOOKS: '1',
  ARCHE_E2E_RUNTIME_BASE_URL: runtimeBaseUrl,
  ARCHE_E2E_RUNTIME_PASSWORD: runtimePassword,
}

const disabledFakeRuntimeEnv = {
  ARCHE_E2E_RUNTIME_BASE_URL: '',
  ARCHE_E2E_RUNTIME_PASSWORD: '',
}

const fakeProviderUrl = process.env.ARCHE_E2E_FAKE_PROVIDER_URL
const fakeProviderPort = process.env.ARCHE_E2E_FAKE_PROVIDER_PORT ?? '4211'
const fakeProviderEnv = fakeProviderUrl
  ? {
      ARCHE_ENABLE_E2E_HOOKS: '1',
      ARCHE_E2E_FAKE_PROVIDER_URL: fakeProviderUrl,
      ARCHE_E2E_FAKE_PROVIDER_PORT: fakeProviderPort,
      ARCHE_E2E_FAKE_PROVIDER_API_KEY: process.env.ARCHE_E2E_FAKE_PROVIDER_API_KEY ?? 'sk-e2e-fake-provider',
    }
  : null

const fakeOAuthPort = process.env.ARCHE_E2E_FAKE_OAUTH_PORT ?? '4212'
const fakeOAuthEnv = {
  ARCHE_CONNECTOR_LINEAR_MCP_URL: `http://127.0.0.1:${fakeOAuthPort}/mcp`,
  ARCHE_CONNECTOR_NOTION_MCP_URL: `http://127.0.0.1:${fakeOAuthPort}/mcp`,
  ARCHE_CONNECTOR_NOTION_CLIENT_ID: process.env.ARCHE_CONNECTOR_NOTION_CLIENT_ID ?? 'fake-notion-client-id',
  ARCHE_CONNECTOR_NOTION_CLIENT_SECRET: process.env.ARCHE_CONNECTOR_NOTION_CLIENT_SECRET ?? 'fake-notion-client-secret',
}

export default defineConfig({
  testDir: './e2e',
  outputDir: 'test-results',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  globalSetup: './e2e/global-setup.ts',
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      dependencies: ['setup'],
      testIgnore: /auth\.setup\.ts/,
      use: {
        browserName: 'chromium',
        storageState: 'playwright/.auth/admin.json',
      },
    },
  ],
  webServer: isSmokeFake
    ? [
        {
          command: 'node ../../scripts/e2e/fake-runtime-server.mjs',
          cwd: __dirname,
          env: {
            ...process.env,
            ...commonEnv,
            ...fakeRuntimeEnv,
          },
          url: `${runtimeBaseUrl}/__e2e/health`,
          reuseExistingServer: !process.env.CI,
        },
        {
          command: 'node ../../scripts/e2e/fake-oauth-server.mjs',
          cwd: __dirname,
          env: {
            ...process.env,
            ARCHE_E2E_FAKE_OAUTH_PORT: fakeOAuthPort,
          },
          url: `http://127.0.0.1:${fakeOAuthPort}/__e2e/health`,
          reuseExistingServer: !process.env.CI,
        },
        {
          command: 'pnpm dev',
          cwd: __dirname,
          env: {
            ...process.env,
            ...commonEnv,
            ...fakeRuntimeEnv,
            ...fakeOAuthEnv,
          },
          url: 'http://127.0.0.1:3000',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      ]
    : [
        // real-runtime: assumes an external runtime is already available.
        // Start only the Next.js dev server; do NOT inject fake-runtime envs.
        ...(fakeProviderEnv
          ? [
              {
                command: 'node ../../scripts/e2e/fake-provider-server.mjs',
                cwd: __dirname,
                env: {
                  ...process.env,
                  ...commonEnv,
                  ...fakeProviderEnv,
                } as Record<string, string>,
                url: `http://127.0.0.1:${fakeProviderPort}/__e2e/health`,
                reuseExistingServer: !process.env.CI,
              },
            ]
          : []),
        {
          command: 'pnpm dev',
          cwd: __dirname,
          env: {
            ...process.env,
            ...commonEnv,
            ...disabledFakeRuntimeEnv,
            ...(fakeProviderEnv ?? {}),
            ...(fakeProviderEnv ? {} : { ARCHE_ENABLE_E2E_HOOKS: '' }),
          },
          url: 'http://127.0.0.1:3000',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      ],
})
