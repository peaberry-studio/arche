import { expect, test } from '@playwright/test'

import { adminSlug } from './support/test-data'

// Covers the "unify dashboard and workspace" PRD: /w/{slug} is the only
// product surface. The shared sidebar survives chat ↔ explore navigation
// without the fullscreen connecting gates, management surfaces open as
// overlays/catalog views on /w, and /u routes redirect into the workspace.
// The connecting-vs-ready transitions are covered by the unit/component
// tests (workspace-app-chrome, workspace-shell, explore-shell); these specs
// assert the stable end states of the main user stories.

async function waitForWorkspaceReady(page: import('@playwright/test').Page) {
  // The empty composer only renders once the instance is started and connected.
  await expect(page.getByTestId('empty-composer-heading')).toBeVisible({ timeout: 120_000 })
}

test('lands on the workspace from the root route', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveURL(new RegExp(`/w/${adminSlug}$`))
  await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toBeVisible({ timeout: 120_000 })
})

test('keeps the shared sidebar across chat and explore without a fullscreen connecting gate', async ({ page }) => {
  await page.goto(`/w/${adminSlug}`)
  await waitForWorkspaceReady(page)

  const nav = page.getByRole('navigation', { name: 'Workspace navigation' })
  await expect(nav).toBeVisible()

  // Chat → Explorer keeps the sidebar mounted and marks Knowledge Base active.
  await nav.getByRole('button', { name: 'Knowledge Base' }).click()
  await expect(page).toHaveURL(new RegExp(`/w/${adminSlug}/explore$`))
  await expect(nav).toBeVisible()
  await expect(nav.getByRole('button', { name: 'Knowledge Base' })).toHaveAttribute('aria-pressed', 'true')

  // Explorer → chat via New chat returns without reconnecting.
  await page.getByRole('button', { name: 'New chat' }).first().click()
  await expect(page).toHaveURL(new RegExp(`/w/${adminSlug}$`))
  await waitForWorkspaceReady(page)
  await expect(nav).toBeVisible()

  // Once connected, neither fullscreen gate may reappear.
  await expect(page.getByRole('heading', { name: 'Connecting...' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Connecting to OpenCode' })).toHaveCount(0)
})

test('opens settings as a modal over the workspace and closes back to chat', async ({ page }) => {
  await page.goto(`/w/${adminSlug}?settings=general`)

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible({ timeout: 120_000 })
  // While the modal is open Radix marks the background aria-hidden, so the
  // sidebar is asserted through the DOM instead of the accessibility tree.
  await expect(page.locator('nav[aria-label="Workspace navigation"]')).toBeVisible()

  await page.getByRole('button', { name: 'Close settings' }).click()

  await expect(page).toHaveURL(new RegExp(`/w/${adminSlug}$`), { timeout: 120_000 })
  await expect(dialog).toHaveCount(0)
})

test('redirects dashboard management routes into the workspace', async ({ page }) => {
  await page.goto(`/u/${adminSlug}/agents`)

  await expect(page).toHaveURL(new RegExp(`/w/${adminSlug}\\?catalog=agents$`))
  await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toBeVisible({ timeout: 120_000 })
})
