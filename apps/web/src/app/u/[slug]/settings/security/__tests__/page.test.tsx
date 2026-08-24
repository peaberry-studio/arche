/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
})

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}))

import LegacySecuritySettingsPage from '../page'

function renderPage(slug = 'alice') {
  return LegacySecuritySettingsPage({ params: Promise.resolve({ slug }) })
}

describe('LegacySecuritySettingsPage', () => {
  it('redirects to the workspace security settings modal', async () => {
    await expect(renderPage()).rejects.toThrow('REDIRECT:/w/alice?settings=security')
  })
})
