import { expect, test } from '@playwright/test'

import { adminEmail, adminPassword, adminSlug } from './support/test-data'

test.use({ storageState: { cookies: [], origins: [] } })

test('signs in from the login page', async ({ page }) => {
  await page.goto('/login')

  await expect(page).toHaveURL(/\/login$/)

  await page.getByLabel('Email').fill(adminEmail)
  await page.getByLabel('Password').fill(adminPassword)
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page).toHaveURL(new RegExp(`/u/${adminSlug}$`))
  await expect(page.getByRole('heading', { name: 'What do you want to work on today?' })).toBeVisible()
})
