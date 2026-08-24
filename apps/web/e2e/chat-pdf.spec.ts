import { expect, test } from '@playwright/test'

import { adminSlug, pdfToken, samplePdfPath } from './support/test-data'

test.setTimeout(90_000)

test('uploads a PDF and gets the extracted token back', async ({ page }) => {
  await page.goto(`/w/${adminSlug}`)

  // The empty composer only renders once the instance is started and connected.
  await expect(page.getByTestId('empty-composer-heading')).toBeVisible({ timeout: 120_000 })

  // Start a session from the empty composer so the chat composer (which owns
  // the attachment input) becomes available.
  await page.getByLabel('Describe what you want to work on').fill('Upload a PDF')
  await page.getByRole('button', { name: 'Start working' }).click()

  await expect(page.getByPlaceholder('Type a message...')).toBeVisible({ timeout: 30_000 })

  await page.locator('input[type="file"]').setInputFiles(samplePdfPath)
  await expect(page.getByText(/sample(?: \(\d+\))?\.pdf/)).toBeVisible({ timeout: 30_000 })

  await page.getByPlaceholder('Type a message...').fill('What token is in this PDF?')
  await page.getByLabel('Send message').click()

  await expect(page.getByText(`PDF_OK: ${pdfToken}`, { exact: true })).toBeVisible({ timeout: 30_000 })
})
