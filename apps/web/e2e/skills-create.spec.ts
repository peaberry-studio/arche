import { expect, test } from '@playwright/test'

import { adminSlug, uniqueName } from './support/test-data'

test.setTimeout(90_000)

test('creates a skill with the minimum required fields', async ({ page }) => {
  const skillName = uniqueName('skill')

  // Skills live in the workspace catalog; /u/{slug}/skills/new redirects into it.
  await page.goto(`/u/${adminSlug}/skills/new`)

  await expect(page).toHaveURL(new RegExp(`/w/${adminSlug}\\?catalog=skills&skill=new$`))

  await page.getByLabel('Skill name').fill(skillName)
  await page.getByLabel('Description').fill('Smoke test skill')
  await page.getByRole('button', { name: 'Create skill' }).click()

  await page.waitForURL(`**/w/${adminSlug}?catalog=skills`, { timeout: 60_000 })
  await expect(page.getByRole('heading', { name: 'Skills' })).toBeVisible()
  await expect(page.getByRole('heading', { name: skillName })).toBeVisible()
})
