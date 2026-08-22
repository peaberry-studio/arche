/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
})

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}))

import ConnectorsPage from '../page'

function renderPage(slug = 'alice') {
  return ConnectorsPage({ params: Promise.resolve({ slug }) })
}

describe('ConnectorsPage', () => {
  it('redirects to the workspace connectors settings modal', async () => {
    await expect(renderPage()).rejects.toThrow('REDIRECT:/w/alice?settings=connectors')
  })
})
