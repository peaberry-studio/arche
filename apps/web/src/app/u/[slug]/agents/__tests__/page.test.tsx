/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
})

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}))

import AgentsPage from '../page'

function renderPage(slug = 'alice') {
  return AgentsPage({ params: Promise.resolve({ slug }) })
}

describe('AgentsPage', () => {
  it('redirects to the agents catalog view', async () => {
    await expect(renderPage()).rejects.toThrow('REDIRECT:/w/alice?catalog=agents')
  })
})
