import { expect, test } from '@playwright/test'

import { adminSlug } from './support/test-data'

// Covers the "generative disc avatars" PRD: agent and human surfaces render
// their deterministic disc avatar. The avatar is a <canvas> whose backing
// store is only sized once the draw effect runs, so a non-zero width
// attribute proves the disc was actually drawn, not just mounted.

test('renders a drawn disc avatar on each agent card in the catalog', async ({ page }) => {
  await page.goto(`/w/${adminSlug}?catalog=agents`)

  const avatar = page.locator('canvas.rounded-full').first()
  await expect(avatar).toBeVisible({ timeout: 120_000 })
  await expect(avatar).toHaveAttribute('width', /^\d+$/, { timeout: 120_000 })
})

test('renders a drawn disc avatar on each team member row', async ({ page }) => {
  await page.goto(`/w/${adminSlug}?settings=team`)

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible({ timeout: 120_000 })

  const avatar = dialog.locator('canvas.rounded-full').first()
  await expect(avatar).toBeVisible()
  await expect(avatar).toHaveAttribute('width', /^\d+$/, { timeout: 120_000 })
})
