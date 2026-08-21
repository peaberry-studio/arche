import { expect, test } from '@playwright/test'

import { adminSlug } from './support/test-data'

// Covers the chat event bus (PRD "Chat como bus de eventos de OpenCode"):
// verifies that a normal text-only chat message flows through the persistent
// /events pipe + prompt_async without hanging the composer. The fake runtime
// echoes `E2E_OK: <prompt>`, so we assert on that deterministic reply.

test.setTimeout(90_000)

test('streams a text chat response through the stabilized SSE pipeline', async ({ page }) => {
  // V10 cutover: the web chat must never touch the legacy per-message stream.
  const forbiddenRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/chat/stream')) {
      forbiddenRequests.push(request.url())
    }
  })

  await page.goto(`/w/${adminSlug}`)

  // The chat composer only renders once the instance is started and connected.
  await expect(page.getByPlaceholder('Type a message...')).toBeVisible({ timeout: 120_000 })

  await page.getByPlaceholder('Type a message...').fill('Hello stream')
  await page.getByLabel('Send message').click()

  // The fake runtime replies with `E2E_OK: <prompt>`.
  await expect(page.getByText('E2E_OK: Hello stream', { exact: true })).toBeVisible({ timeout: 30_000 })

  // After the stream completes, the composer must be available again
  // (no lingering "Reconnecting..." or error state from a healthy flow).
  await expect(page.getByPlaceholder('Type a message...')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Reconnecting...')).toHaveCount(0)
  expect(forbiddenRequests).toEqual([])
})
