/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
})

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}))

import EditFlowPage from '../page'

function renderPage(slug = 'alice', id = 'flow-1') {
  return EditFlowPage({ params: Promise.resolve({ slug, id }) })
}

describe('EditFlowPage', () => {
  it('redirects to the flows overlay edit view', async () => {
    await expect(renderPage()).rejects.toThrow('REDIRECT:/w/alice?flows=edit&flowId=flow-1')
  })
})
