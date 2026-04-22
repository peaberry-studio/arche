import path from 'node:path'

import { defineConfig } from '@playwright/test'

// E2E profile selection: 'smoke-fake' (default) or 'real-runtime'
const e2eProfile = process.env.ARCHE_E2E_PROFILE?.trim() || 'smoke-fake'
const isSmokeFake = e2eProfile === 'smoke-fake'
const DEFAULT_E2E_ENCRYPTION_KEY = 'ZGV2LWluc2VjdXJlLWtleS0zMi1ieXRlcy1sb25nISE='

const e2eRoot = path.join(__dirname, '.e2e')
const runtimeBaseUrl = process.env.ARCHE_E2E_RUNTIME_BASE_URL ?? `http://127.0.0.1:${process.env.ARCHE_E2E_RUNTIME_PORT ?? '4210'}`
const runtimePassword = process.env.ARCHE_E2E_RUNTIME_PASSWORD ?? 'arche-e2e-runtime'
const sharedE2eEnv = {
  ARCHE_ENCRYPTION_KEY: process.env.ARCHE_ENCRYPTION_KEY ?? DEFAULT_E2E_ENCRYPTION_KEY,
}
const fakeRuntimeEnv = {
  ...sharedE2eEnv,
  ARCHE_ENABLE_E2E_HOOKS: '1',
  ARCHE_E2E_RUNTIME_BASE_URL: runtimeBaseUrl,
  ARCHE_E2E_RUNTIME_PASSWORD: runtimePassword,
}
const fakeProviderUrl = process.env.ARCHE_E2E_FAKE_PROVIDER_URL
const fakeProviderPort = process.env.ARCHE_E2E_FAKE_PROVIDER_PORT ?? '4211'
const fakeProviderEnv = fakeProviderUrl
  ? {
      ...sharedE2eEnv,
      ARCHE_ENABLE_E2E_HOOKS: '1',
      ARCHE_E2E_FAKE_PROVIDER_URL: fakeProviderUrl,
      ARCHE_E2E_FAKE_PROVIDER_PORT: fakeProviderPort,
      ARCHE_E2E_FAKE_PROVIDER_API_KEY: process.env.ARCHE_E2E_FAKE_PROVIDER_API_KEY ?? 'sk-e2e-fake-provider',
    }
  : null

export default defineConfig({
  testDir: './e2e',
  outputDir: 'test-results',
  timeout: 120_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: {
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: isSmokeFake
    ? {
        command: 'node ../../scripts/e2e/fake-runtime-server.mjs',
        cwd: __dirname,
        env: {
          ...process.env,
          ...fakeRuntimeEnv,
          KB_CONFIG_HOST_PATH: process.env.KB_CONFIG_HOST_PATH ?? path.join(e2eRoot, 'kb-config'),
          KB_CONTENT_HOST_PATH: process.env.KB_CONTENT_HOST_PATH ?? path.join(e2eRoot, 'kb-content'),
        },
        url: `${runtimeBaseUrl}/__e2e/health`,
        reuseExistingServer: !process.env.CI,
      }
    : fakeProviderEnv
      ? {
          command: 'node ../../scripts/e2e/fake-provider-server.mjs',
          cwd: __dirname,
          env: {
            ...process.env,
            ...fakeProviderEnv,
          },
          url: `http://127.0.0.1:${fakeProviderPort}/__e2e/health`,
          reuseExistingServer: !process.env.CI,
        }
      : undefined,
})
