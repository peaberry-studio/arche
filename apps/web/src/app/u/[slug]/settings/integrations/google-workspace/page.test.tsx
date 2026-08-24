/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
})

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}))

import GoogleWorkspaceIntegrationSettingsPage from './page'

function renderPage(slug = 'alice') {
  return GoogleWorkspaceIntegrationSettingsPage({
    params: Promise.resolve({ slug }),
  })
}

describe('GoogleWorkspaceIntegrationSettingsPage', () => {
  it('redirects to the workspace settings integrations modal', async () => {
    await expect(renderPage()).rejects.toThrow(
      'REDIRECT:/w/alice?settings=integrations&integration=google-workspace'
    )
  })
})
