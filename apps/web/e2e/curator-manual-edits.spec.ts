import { expect, test } from '@playwright/test'

import { adminSlug } from './support/test-data'

// Covers the "Curator: apply-and-publish + Manual edits" PRD UI stories that
// are reachable without workspace diffs: the tab selector lives centered in
// the dialog header, the second tab is named "Manual edits", and its empty
// state no longer references "Pending publish". The publish flows (per file
// and Publish all) need dirty workspace files, which the fake runtime does
// not produce; they are covered by the Vitest component suites.

async function waitForWorkspaceReady(page: import('@playwright/test').Page) {
  // The chat composer only renders once the instance is started and connected.
  await expect(page.getByPlaceholder('Type a message...')).toBeVisible({ timeout: 120_000 })
}

test('opens the curator with the tab selector centered in the dialog header', async ({ page }) => {
  await page.goto(`/w/${adminSlug}`)
  await waitForWorkspaceReady(page)

  const nav = page.getByRole('navigation', { name: 'Workspace navigation' })
  await nav.getByRole('button', { name: 'Curator' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  // The Proposals | Manual edits selector sits in the dialog header.
  const header = dialog.getByTestId('curator-dialog-header')
  await expect(header.getByRole('button', { name: /Proposals/ })).toBeVisible()
  await expect(header.getByRole('button', { name: /Manual edits/ })).toBeVisible()

  await page.getByRole('button', { name: 'Close curator' }).click()
  await expect(dialog).toHaveCount(0)
})

test('shows the manual edits empty state without a publish action', async ({ page }) => {
  await page.goto(`/w/${adminSlug}`)
  await waitForWorkspaceReady(page)

  const nav = page.getByRole('navigation', { name: 'Workspace navigation' })
  await nav.getByRole('button', { name: 'Curator' }).click()

  const dialog = page.getByRole('dialog')
  await dialog.getByTestId('curator-dialog-header').getByRole('button', { name: /Manual edits/ }).click()

  await expect(dialog.getByText('No manual edits to publish')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Publish all' })).toHaveCount(0)
})
