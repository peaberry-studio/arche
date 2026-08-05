import { expect, test } from '@playwright/test'

import { adminSlug } from './support/test-data'

// Covers the PRD "fix workspace loading empty state": once the workspace shell
// becomes ready, the initial session loading indicators must have resolved (no
// lingering "Loading session..." / "Loading chats..." strings). This is a
// stable end-state assertion — it waits for the ready state first, then
// verifies the transient loaders are gone. The loading-vs-empty-vs-error
// transitions themselves are covered exhaustively by the unit/component tests
// (sessions-panel, chat-panel, use-workspace-sessions).

test('resolves the initial session loading state once the shell is ready', async ({ page }) => {
  await page.goto(`/w/${adminSlug}`)

  await expect(page).toHaveURL(new RegExp(`/w/${adminSlug}$`))

  // The chat composer only renders once the instance is started and connected.
  await expect(page.getByPlaceholder('Type a message...')).toBeVisible({ timeout: 120_000 })

  // After the shell is ready, the initial session loaders must no longer be
  // visible — the loading state has resolved to either empty or populated.
  await expect(page.getByText('Loading session...')).toHaveCount(0)
  await expect(page.getByText('Loading chats...')).toHaveCount(0)
})
