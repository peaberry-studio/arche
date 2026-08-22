/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
})

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}))

import SettingsPage from '../page'

function renderPage(slug = 'alice', section?: string) {
  return SettingsPage({
    params: Promise.resolve({ slug }),
    searchParams: Promise.resolve(section ? { section } : {}),
  })
}

describe('SettingsPage', () => {
  it('redirects to the workspace settings general section', async () => {
    await expect(renderPage()).rejects.toThrow('REDIRECT:/w/alice?settings=general')
  })

  it('redirects to the resolved settings section', async () => {
    await expect(renderPage('alice', 'security')).rejects.toThrow('REDIRECT:/w/alice?settings=security')
  })

  it('maps legacy settings sections to the unified allowlist', async () => {
    await expect(renderPage('alice', 'connectors')).rejects.toThrow('REDIRECT:/w/alice?settings=connectors')
  })
})
