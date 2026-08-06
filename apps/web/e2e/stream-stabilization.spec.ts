import { expect, test } from '@playwright/test'

import { adminSlug } from './support/test-data'

// Covers the PRD "Estabilización de streams": verifies that a normal
// text-only chat message flows through the stabilized SSE pipeline
// (connect timeout, heartbeats, watchdog grace windows) without being
// prematurely terminated. The fake runtime echoes `E2E_OK: <prompt>`,
// so we assert on that deterministic reply.

test.setTimeout(90_000)

test('streams a text chat response through the stabilized SSE pipeline', async ({ page }) => {
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
})
