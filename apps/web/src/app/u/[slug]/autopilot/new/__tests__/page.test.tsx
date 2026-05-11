import { describe, expect, it, vi } from 'vitest'

const redirectMock = vi.hoisted(() => vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
}))

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}))

describe('LegacyNewFlowRedirectPage', () => {
  it('redirects to the new flow page', async () => {
    const Page = (await import('../page')).default

    await expect(Page({ params: Promise.resolve({ slug: 'alice' }) })).rejects.toThrow('REDIRECT:/u/alice/flows/new')
  })
})
