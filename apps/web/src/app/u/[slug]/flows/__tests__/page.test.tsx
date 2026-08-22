/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
})

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}))

import FlowsPage from '../page'

function renderPage(slug = 'alice') {
  return FlowsPage({ params: Promise.resolve({ slug }) })
}

describe('FlowsPage', () => {
  it('redirects to the flows overlay list view', async () => {
    await expect(renderPage()).rejects.toThrow('REDIRECT:/w/alice?flows=list')
  })
})
