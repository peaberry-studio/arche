/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
})

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}))

import TeamPage from '../page'

function renderPage(slug = 'alice') {
  return TeamPage({ params: Promise.resolve({ slug }) })
}

describe('TeamPage', () => {
  it('redirects to the workspace team settings modal', async () => {
    await expect(renderPage()).rejects.toThrow('REDIRECT:/w/alice?settings=team')
  })
})
