import { expect, test, type Page } from '@playwright/test'

import { adminEmail, adminPassword, adminSlug, uniqueName } from './support/test-data'

test.use({ storageState: { cookies: [], origins: [] } })

async function signIn(page: Page, email: string, password: string, slug: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(new RegExp(`/u/${slug}$`))
  await expect(page.getByRole('heading', { name: 'What do you want to work on today?' })).toBeVisible()
}

test('logs out from settings', async ({ page }) => {
  const response = await page.request.post('/auth/login', {
    data: { email: adminEmail, password: adminPassword },
  })
  expect(response.ok()).toBeTruthy()

  await page.goto(`/u/${adminSlug}/settings`)
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await page.getByRole('button', { name: 'Log out' }).click()

  await expect(page).toHaveURL(/\/login$/)

  await page.goto(`/u/${adminSlug}`)
  await expect(page).toHaveURL(/\/login$/)
})

test('admin resets a team member password and revokes existing sessions', async ({ browser, page }) => {
  const userSlug = uniqueName('reset-user')
  const userEmail = `${userSlug}@example.test`
  const oldPassword = 'old-temporary-password'
  const newPassword = 'new-temporary-password'

  await signIn(page, adminEmail, adminPassword, adminSlug)
  await page.goto(`/u/${adminSlug}/team`)
  await page.getByRole('button', { name: 'Add user' }).click()
  await page.getByLabel('Email').fill(userEmail)
  await page.getByLabel('Slug').fill(userSlug)
  await page.getByLabel('Password').fill(oldPassword)
  await page.getByRole('dialog').getByRole('button', { name: 'Add user' }).click()
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

  await loginPage.goto('/login')
  await loginPage.getByLabel('Email').fill(userEmail)
  await loginPage.getByLabel('Password').fill(oldPassword)
  await loginPage.getByRole('button', { name: 'Sign in' }).click()
  await expect(loginPage.getByText('Incorrect email or password.')).toBeVisible()

  await signIn(loginPage, userEmail, newPassword, userSlug)
  await loginContext.close()
})

test('login still works for the seeded admin after password reset coverage', async ({ page }) => {
  await signIn(page, adminEmail, adminPassword, adminSlug)
})
