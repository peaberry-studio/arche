import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { adminSlug } from './support/test-data'

// Covers the "Curator: apply-and-publish + Manual edits" PRD UI stories that
// are reachable without workspace diffs: the tab selector lives centered in
// the dialog header, the second tab is named "Manual edits", and its empty
// state no longer references "Pending publish". The publish flows (per file
// and Publish all) need dirty workspace files, which the fake runtime does
// not produce; they are covered by the Vitest component suites.

async function waitForWorkspaceReady(page: import('@playwright/test').Page) {
  // The empty composer only renders once the instance is started and connected.
  await expect(page.getByTestId('empty-composer-heading')).toBeVisible({ timeout: 120_000 })
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
  await expect(page.getByRole('button', { name: 'Submit all' })).toHaveCount(0)
})

test('reviews and approves an exact Git proposal before shared publication', async ({ page }) => {
  const e2eRoot = process.env.ARCHE_E2E_ROOT || join(process.env.RUNNER_TEMP ?? tmpdir(), 'arche-web-e2e')
  const repository = process.env.KB_CONTENT_HOST_PATH || join(e2eRoot, 'kb-content')
  const checkout = mkdtempSync(join(tmpdir(), 'arche-publication-e2e-'))
  const git = (args: string[], cwd = checkout) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  const base = git(['--git-dir', repository, 'rev-parse', 'main'])
  const ref = `refs/heads/proposals/${adminSlug}/pending`
  let commit = ''
  try {
    git(['clone', '--no-local', repository, checkout])
    writeFileSync(join(checkout, 'Publication-regression.md'), 'Reviewed publication regression.\n')
    git(['add', 'Publication-regression.md'])
    git(['-c', 'user.name=E2E', '-c', 'user.email=e2e@arche.local', 'commit', '-m', 'Propose publication regression'])
    commit = git(['rev-parse', 'HEAD'])
    git(['push', 'origin', `HEAD:${ref}`])
    expect(git(['--git-dir', repository, 'rev-parse', 'main'])).toBe(base)
    await page.goto(`/w/${adminSlug}`)
    await waitForWorkspaceReady(page)
    await page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('button', { name: 'Curator' }).click()
    await page.getByRole('button', { name: 'Review publication', exact: true }).click()
    await expect(page.getByText(`Commit ${commit}`, { exact: true })).toBeVisible()
    await expect(page.getByText('+Reviewed publication regression.', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Approve and publish', exact: true }).click()
    await expect(page.getByText('Published to the shared Knowledge Base.', { exact: true })).toBeVisible()
    expect(git(['--git-dir', repository, 'rev-parse', 'main'])).toBe(commit)
  } finally {
    if (commit) {
      const current = git(['--git-dir', repository, 'rev-parse', 'main'])
      if (current === commit) git(['--git-dir', repository, 'update-ref', 'refs/heads/main', base, commit])
      git(['--git-dir', repository, 'update-ref', '-d', ref, commit])
    }
    rmSync(checkout, { recursive: true, force: true })
  }
})
