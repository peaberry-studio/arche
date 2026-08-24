/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
})

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}))

import NewFlowPage from '../page'

function renderPage(slug = 'alice') {
  return NewFlowPage({ params: Promise.resolve({ slug }) })
}

describe('NewFlowPage', () => {
  it('redirects to the flows overlay new view', async () => {
    await expect(renderPage()).rejects.toThrow('REDIRECT:/w/alice?flows=new')
  })
})
