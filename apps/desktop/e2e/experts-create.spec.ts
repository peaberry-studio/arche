import { expect, test, waitForWorkspaceReady } from './fixtures/desktop'

function uniqueExpertName(): string {
  return `Expert ${Date.now()} ${Math.random().toString(36).slice(2, 8)}`
}

test('creates an expert from desktop settings', async ({ page }) => {
  const displayName = uniqueExpertName()

  await waitForWorkspaceReady(page)

  const settingsUrl = new URL('/w/local?settings=agents', page.url()).toString()

  await page.goto(settingsUrl)

  await expect(page.getByRole('button', { name: 'Create expert' })).toBeVisible({ timeout: 120_000 })
  await page.getByRole('button', { name: 'Create expert' }).click()
  await page.getByLabel('Display name').fill(displayName)
  await page.getByRole('button', { name: 'Create agent' }).click()

  await expect(page.getByRole('heading', { name: displayName })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Create expert' })).toBeVisible({ timeout: 30_000 })
})
