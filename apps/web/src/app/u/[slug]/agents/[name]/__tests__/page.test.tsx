/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
})

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}))

import EditAgentPage from '../page'

function renderPage(slug = 'alice', name = 'helper') {
  return EditAgentPage({ params: Promise.resolve({ slug, name }) })
}

describe('EditAgentPage', () => {
  it('redirects to the agent edit catalog view', async () => {
    await expect(renderPage()).rejects.toThrow('REDIRECT:/w/alice?catalog=agents&agent=helper')
  })
})
