import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { _electron as electron, expect, test as base } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'

const execFileAsync = promisify(execFile)
const desktopAppRoot = path.resolve(__dirname, '../..')
const repoRoot = path.resolve(desktopAppRoot, '..', '..')
const e2eScriptsRoot = path.join(repoRoot, 'scripts', 'e2e')
const runtimeBaseUrl = process.env.ARCHE_E2E_RUNTIME_BASE_URL ?? 'http://127.0.0.1:4210'
const runtimePassword = process.env.ARCHE_E2E_RUNTIME_PASSWORD ?? 'arche-e2e-runtime'
const samplePdfPath = path.join(e2eScriptsRoot, 'fixtures', 'sample.pdf')
const isSmokeFake = (process.env.ARCHE_E2E_PROFILE?.trim() || 'smoke-fake') === 'smoke-fake'
const debugDesktopE2E = process.env.ARCHE_E2E_DEBUG === '1'
const fakeProviderUrl = process.env.ARCHE_E2E_FAKE_PROVIDER_URL
const fakeProviderApiKey = process.env.ARCHE_E2E_FAKE_PROVIDER_API_KEY ?? 'sk-e2e-fake-provider'
const DEFAULT_E2E_ENCRYPTION_KEY = 'ZGV2LWluc2VjdXJlLWtleS0zMi1ieXRlcy1sb25nISE='
const WORKSPACE_READY_TIMEOUT_MS = 120_000

async function hasRequestHeaderTooLargeError(page: Page): Promise<boolean> {
  const content = await page.content().catch(() => '')
  return /Request Header Fields Too Large|\b431\b/i.test(content)
}

type DesktopFixtures = {
  app: ElectronApplication
  page: Page
  samplePdfPath: string
  vaultPath: string
  ensureFakeOpenAiProvider: () => Promise<void>
}

async function createDesktopVault(): Promise<{ parentDir: string; vaultPath: string }> {
  const parentDir = await mkdtemp(path.join(tmpdir(), 'arche-e2e-desktop-'))
  const scriptPath = path.join(e2eScriptsRoot, 'bootstrap-desktop-vault.mjs')
  const { stdout } = await execFileAsync('node', [scriptPath], {
    env: {
      ...process.env,
      ARCHE_E2E_DESKTOP_VAULT_NAME: 'vault',
      ARCHE_E2E_DESKTOP_VAULT_PARENT: parentDir,
    },
  })

  const result = JSON.parse(stdout.trim()) as { ok: boolean; vaultPath: string }
  if (!result.ok) {
    throw new Error('Failed to bootstrap desktop vault fixture.')
  }

  return { parentDir, vaultPath: result.vaultPath }
}

export async function waitForWorkspaceReady(page: Page) {
  // Wait for the stable UI signal instead of an early strict navigation.
  // If the page has already fallen into a 431 error state, clear the cookies
  // once and retry. Re-throw other failures so the fixture does not hide them.
  try {
    await expect(page.getByPlaceholder('Type a message...')).toBeVisible({ timeout: WORKSPACE_READY_TIMEOUT_MS })
  } catch (error) {
    if (!(await hasRequestHeaderTooLargeError(page))) {
      throw error
    }

    await page.context().clearCookies()
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByPlaceholder('Type a message...')).toBeVisible({ timeout: WORKSPACE_READY_TIMEOUT_MS })
  }
  expect(page.url()).toContain('/w/local')
}

export const test = base.extend<DesktopFixtures>({
  samplePdfPath: async ({}, use) => {
    await use(samplePdfPath)
  },

  vaultPath: async ({}, use) => {
    const { parentDir, vaultPath } = await createDesktopVault()

    try {
      await use(vaultPath)
    } finally {
      await rm(parentDir, { recursive: true, force: true })
    }
  },

  app: async ({ vaultPath }, use) => {
    const app = await electron.launch({
      args: ['dist/main.js', `--vault-path=${vaultPath}`],
      cwd: desktopAppRoot,
      env: {
        ...process.env,
        ARCHE_ENABLE_E2E_HOOKS: isSmokeFake || Boolean(fakeProviderUrl) ? '1' : '',
        ARCHE_ENCRYPTION_KEY: process.env.ARCHE_ENCRYPTION_KEY ?? DEFAULT_E2E_ENCRYPTION_KEY,
        ARCHE_E2E_RUNTIME_BASE_URL: isSmokeFake ? runtimeBaseUrl : '',
        ARCHE_E2E_RUNTIME_PASSWORD: isSmokeFake ? runtimePassword : '',
      },
    })

    if (debugDesktopE2E) {
      const mainProcess = app.process()
      mainProcess.stdout?.on('data', (data) => {
        process.stdout.write(`[electron-stdout] ${data}`)
      })
      mainProcess.stderr?.on('data', (data) => {
        process.stderr.write(`[electron-stderr] ${data}`)
      })
    }

    try {
      await use(app)
    } finally {
      await app.close()
    }
  },

  page: async ({ app }, use) => {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await use(page)
  },

  ensureFakeOpenAiProvider: async ({ page }, use) => {
    await use(async () => {
      if (isSmokeFake || !fakeProviderUrl) {
        return
      }

      const response = await page.evaluate(async (apiKey) => {
        const res = await fetch('/api/u/local/providers/openai', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ apiKey }),
        })
        return { ok: res.ok, status: res.status, text: await res.text() }
      }, fakeProviderApiKey)

      if (!response.ok) {
        throw new Error(
          `Failed to seed fake OpenAI provider: ${response.status} ${response.text}`,
        )
      }
    })
  },
})

export { expect }
