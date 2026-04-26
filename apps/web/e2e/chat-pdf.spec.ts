import { expect, test } from '@playwright/test'

import { adminSlug, pdfToken, samplePdfPath } from './support/test-data'

test('uploads a PDF and gets the extracted token back', async ({ page }) => {
  await page.goto(`/w/${adminSlug}`)

  await expect(page.getByPlaceholder('Type a message...')).toBeVisible({ timeout: 120_000 })

  await page.locator('input[type="file"]').setInputFiles(samplePdfPath)
  await expect(page.getByText('sample.pdf')).toBeVisible({ timeout: 30_000 })

  await page.getByPlaceholder('Type a message...').fill('What token is in this PDF?')
  await page.getByLabel('Send message').click()

  await expect(page.getByText(`PDF_OK: ${pdfToken}`, { exact: true })).toBeVisible({ timeout: 30_000 })
})
