/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
})

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}))

import NewAgentPage from '../page'

function renderPage(slug = 'alice') {
  return NewAgentPage({ params: Promise.resolve({ slug }) })
}

describe('NewAgentPage', () => {
  it('redirects to the agent create catalog view', async () => {
    await expect(renderPage()).rejects.toThrow('REDIRECT:/w/alice?catalog=agents&agent=new')
  })
})
