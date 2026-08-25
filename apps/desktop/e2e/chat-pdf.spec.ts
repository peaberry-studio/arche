import { expect, test, waitForWorkspaceReady } from './fixtures/desktop'

const PDF_TOKEN = 'ARCHE_E2E_PDF_TOKEN'

// Uploads land in a runtime shared across retries, so a re-run of this test
// finds "sample.pdf" already stored and the upload endpoint deduplicates the
// filename ("sample (1).pdf"). Accept any deduplicated suffix.
const SAMPLE_PDF_CHIP = /sample( \(\d+\))?\.pdf/

test('uploads a PDF in desktop and gets the extracted token back', async ({ page, samplePdfPath, ensureFakeOpenAiProvider }) => {
  await waitForWorkspaceReady(page)

  await ensureFakeOpenAiProvider()

  // Start a session from the empty composer so the chat composer (which owns
  // the attachment input) becomes available.
  await page.getByLabel('Describe what you want to work on').fill('Upload a PDF')
  await page.getByRole('button', { name: 'Start working' }).click()

  await expect(page.getByPlaceholder('Type a message...')).toBeVisible({ timeout: 60_000 })

  await page.locator('input[type="file"]').setInputFiles(samplePdfPath)
  await expect(page.getByText(SAMPLE_PDF_CHIP)).toBeVisible({ timeout: 60_000 })

  await page.getByPlaceholder('Type a message...').fill('What token is in this PDF?')
  await page.getByLabel('Send message').click()

  // Fail here, not at the token wait, when the sent message never renders:
  // an empty conversation surfaces as a missing user bubble instead of a
  // blind PDF_OK timeout.
  await expect(page.getByText('What token is in this PDF?', { exact: true })).toBeVisible({ timeout: 60_000 })

  await expect(page.getByText(`PDF_OK: ${PDF_TOKEN}`, { exact: true })).toBeVisible({ timeout: 60_000 })
})
