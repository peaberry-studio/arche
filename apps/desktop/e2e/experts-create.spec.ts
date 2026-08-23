import { expect, test, waitForWorkspaceReady } from './fixtures/desktop'

function uniqueExpertName(): string {
  return `Expert ${Date.now()} ${Math.random().toString(36).slice(2, 8)}`
}

test('creates an expert from the desktop agents catalog', async ({ page }) => {
  const displayName = uniqueExpertName()

  await waitForWorkspaceReady(page)

  // Agents management lives in the workspace catalog view.
  const catalogUrl = new URL('/w/local?catalog=agents', page.url()).toString()

  await page.goto(catalogUrl)

  await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible({ timeout: 120_000 })
  await page.getByRole('link', { name: 'Create agent' }).click()

  await expect(page.getByRole('heading', { name: 'Create agent' })).toBeVisible({ timeout: 120_000 })
  await page.getByLabel('Display name').fill(displayName)
  await page.getByRole('button', { name: 'Create agent' }).click()

  await expect(page.getByRole('heading', { name: displayName })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible({ timeout: 30_000 })
})
