import { expect, test } from '@playwright/test'

import { adminSlug, uniqueName } from './support/test-data'

test('creates a skill with the minimum required fields', async ({ page }) => {
  const skillName = uniqueName('skill')

  await page.goto(`/u/${adminSlug}/skills/new`)

  await page.getByLabel('Skill name').fill(skillName)
  await page.getByLabel('Description').fill('Smoke test skill')
  await page.getByRole('button', { name: 'Create skill' }).click()

  await page.waitForURL(`**/u/${adminSlug}/skills`)
  await expect(page.getByRole('heading', { name: 'Skills' })).toBeVisible()
  await expect(page.getByRole('heading', { name: skillName })).toBeVisible()
})
