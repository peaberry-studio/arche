import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentDesktopVault: vi.fn(),
  getDesktopFlowsHref: vi.fn(),
  getRuntimeCapabilities: vi.fn(),
  isDesktop: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`)
  }),
}))

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/components/flows/flow-editor', () => ({ FlowEditor: ({ slug }: { slug: string }) => <div data-slug={slug} /> }))
vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mocks.getRuntimeCapabilities }))
vi.mock('@/lib/runtime/desktop/current-vault', () => ({
  getCurrentDesktopVault: mocks.getCurrentDesktopVault,
  getDesktopFlowsHref: mocks.getDesktopFlowsHref,
}))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mocks.isDesktop }))

describe('NewFlowPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getDesktopFlowsHref.mockReturnValue('/w/local?flows=new')
  })

  it('renders the create flow editor', async () => {
    mocks.isDesktop.mockReturnValue(false)
    mocks.getRuntimeCapabilities.mockReturnValue({ flows: true })
    const Page = (await import('../page')).default

    const result = await Page({ params: Promise.resolve({ slug: 'alice' }) })

    expect(result.type).toBe('main')
  })

  it('redirects when flows are unavailable', async () => {
    mocks.isDesktop.mockReturnValue(false)
    mocks.getRuntimeCapabilities.mockReturnValue({ flows: false })
    const Page = (await import('../page')).default

    await expect(Page({ params: Promise.resolve({ slug: 'alice' }) })).rejects.toThrow('REDIRECT:/u/alice')
  })

  it('redirects desktop flow creation into the workspace flow dialog', async () => {
    mocks.isDesktop.mockReturnValue(true)
    mocks.getCurrentDesktopVault.mockReturnValue({ vaultId: 'vault-1', vaultName: 'Vault', vaultPath: '/tmp/vault' })
    mocks.getRuntimeCapabilities.mockReturnValue({ flows: true })
    const Page = (await import('../page')).default

    await expect(Page({ params: Promise.resolve({ slug: 'alice' }) })).rejects.toThrow('REDIRECT:/w/local?flows=new')
    expect(mocks.getDesktopFlowsHref).toHaveBeenCalledWith('local', 'new')
  })
})
