/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
})

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}))

import SlackIntegrationSettingsPage from './page'

function renderPage(slug = 'alice') {
  return SlackIntegrationSettingsPage({
    params: Promise.resolve({ slug }),
  })
}

describe('SlackIntegrationSettingsPage', () => {
  it('redirects to the workspace settings integrations modal', async () => {
    await expect(renderPage()).rejects.toThrow(
      'REDIRECT:/w/alice?settings=integrations&integration=slack'
    )
  })
})
