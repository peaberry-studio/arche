import { expect, test } from '@playwright/test'

import { adminSlug } from './support/test-data'

test('launches the workspace and waits for the shell', async ({ page }) => {
  await page.goto(`/w/${adminSlug}`)

  await expect(page).toHaveURL(new RegExp(`/w/${adminSlug}$`))

  // Wait for the chat composer to appear (instance started + connected)
  await expect(page.getByPlaceholder('Type a message...')).toBeVisible({ timeout: 120_000 })
})
