import { expect, test, type Page } from '@playwright/test'

import { adminEmail, adminPassword, adminSlug, uniqueName } from './support/test-data'

test.use({ storageState: { cookies: [], origins: [] } })

async function signIn(page: Page, email: string, password: string, slug: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(new RegExp(`/w/${slug}$`))
  await expect(page.getByTestId('empty-composer-heading')).toBeVisible({ timeout: 120_000 })
}

test('logs out from settings', async ({ page }) => {
  const response = await page.request.post('/auth/login', {
    data: { email: adminEmail, password: adminPassword },
  })
  expect(response.ok()).toBeTruthy()

  await page.goto(`/w/${adminSlug}?settings=general`)
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  await page.getByRole('button', { name: 'Log out' }).click()

  await expect(page).toHaveURL(/\/login$/, { timeout: 120_000 })

  await page.goto(`/w/${adminSlug}`)
  await expect(page).toHaveURL(/\/login$/, { timeout: 120_000 })
})

test('admin resets a team member password and revokes existing sessions', async ({ browser, page }, testInfo) => {
  testInfo.setTimeout(120_000)

  const userSlug = uniqueName('reset-user')
  const userEmail = `${userSlug}@example.test`
  const oldPassword = 'old-temporary-password'
  const newPassword = 'new-temporary-password'

  await signIn(page, adminEmail, adminPassword, adminSlug)
  // Team management lives in the workspace settings dialog; /u/{slug}/team
  // redirects into it.
  await page.goto(`/u/${adminSlug}/team`)
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  await page.getByRole('button', { name: 'Add user' }).click()
  await page.getByLabel('Email').fill(userEmail)
  await page.getByLabel('Slug').fill(userSlug)
  await page.getByLabel('Password').fill(oldPassword)
  await page.getByRole('dialog', { name: 'Add user' }).getByRole('button', { name: 'Add user' }).click()
  await expect(page.getByText(userEmail)).toBeVisible()

  const memberContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const memberPage = await memberContext.newPage()

  await signIn(memberPage, userEmail, oldPassword, userSlug)

  await page.getByLabel(`Edit ${userEmail}`).click()
  await page.getByLabel('New password').fill(newPassword)
  await page.getByRole('button', { name: 'Reset password' }).click()
  await expect(page.getByText('Password reset. Share the new password securely.')).toBeVisible()

  await memberPage.goto(`/u/${userSlug}`)
  await expect(memberPage).toHaveURL(/\/login$/)
  await memberContext.close()

  const loginContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const loginPage = await loginContext.newPage()

  const oldPasswordResponse = await loginPage.request.post('/auth/login', {
    data: { email: userEmail, password: oldPassword },
  })
  expect(oldPasswordResponse.status()).toBe(401)

  await signIn(loginPage, userEmail, newPassword, userSlug)
  await loginContext.close()
})

test('login still works for the seeded admin after password reset coverage', async ({ page }) => {
  await signIn(page, adminEmail, adminPassword, adminSlug)
})
