import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentDesktopVault: vi.fn(),
  getRuntimeCapabilities: vi.fn(),
  isDesktop: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`)
  }),
}))

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/components/flows/flow-editor', () => ({ FlowEditor: ({ flowId, slug }: { flowId?: string; slug: string }) => <div data-flow-id={flowId} data-slug={slug} /> }))
vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mocks.getRuntimeCapabilities }))
vi.mock('@/lib/runtime/desktop/current-vault', () => ({ getCurrentDesktopVault: mocks.getCurrentDesktopVault }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mocks.isDesktop }))

describe('EditFlowPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the flow editor', async () => {
    mocks.isDesktop.mockReturnValue(false)
    mocks.getRuntimeCapabilities.mockReturnValue({ flows: true })
    const Page = (await import('../page')).default

    const result = await Page({ params: Promise.resolve({ id: 'flow-1', slug: 'alice' }) })

    expect(result.type).toBe('main')
  })

  it('redirects when flows are unavailable', async () => {
    mocks.isDesktop.mockReturnValue(false)
    mocks.getRuntimeCapabilities.mockReturnValue({ flows: false })
    const Page = (await import('../page')).default

    await expect(Page({ params: Promise.resolve({ id: 'flow-1', slug: 'alice' }) })).rejects.toThrow('REDIRECT:/u/alice')
  })

  it('redirects desktop flow editing back to the workspace', async () => {
    mocks.isDesktop.mockReturnValue(true)
    mocks.getCurrentDesktopVault.mockReturnValue({ path: '/vault' })
    const Page = (await import('../page')).default

    await expect(Page({ params: Promise.resolve({ id: 'flow-1', slug: 'alice' }) })).rejects.toThrow('REDIRECT:/u/alice')

    mocks.getCurrentDesktopVault.mockReturnValue(null)
    await expect(Page({ params: Promise.resolve({ id: 'flow-1', slug: 'alice' }) })).rejects.toThrow('REDIRECT:/')
  })
})
