import { expect, test, waitForWorkspaceReady } from './fixtures/desktop'

const PDF_TOKEN = 'ARCHE_E2E_PDF_TOKEN'

test('uploads a PDF in desktop and gets the extracted token back', async ({ page, samplePdfPath, ensureFakeOpenAiProvider }) => {
  await waitForWorkspaceReady(page)

  await ensureFakeOpenAiProvider()

  await page.locator('input[type="file"]').setInputFiles(samplePdfPath)
  await expect(page.getByText('sample.pdf')).toBeVisible({ timeout: 60_000 })

  await page.getByPlaceholder('Type a message...').fill('What token is in this PDF?')
  await page.getByLabel('Send message').click()

  await expect(page.getByText(`PDF_OK: ${PDF_TOKEN}`, { exact: true })).toBeVisible({ timeout: 60_000 })
})
