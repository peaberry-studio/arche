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
vi.mock('@/components/flows/flow-run-history-view', () => ({
  FlowRunHistoryView: ({ flowId, slug }: { flowId: string; slug: string }) => (
    <div data-flow-id={flowId} data-slug={slug} />
  ),
}))
vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mocks.getRuntimeCapabilities }))
vi.mock('@/lib/runtime/desktop/current-vault', () => ({
  getCurrentDesktopVault: mocks.getCurrentDesktopVault,
  getDesktopFlowsHref: mocks.getDesktopFlowsHref,
}))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mocks.isDesktop }))

describe('FlowRunsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getDesktopFlowsHref.mockReturnValue('/w/local?flows=runs&flowId=flow-1')
  })

  it('renders the run history view', async () => {
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

  it('redirects desktop run history into the workspace flow dialog', async () => {
    mocks.isDesktop.mockReturnValue(true)
    mocks.getCurrentDesktopVault.mockReturnValue({ vaultId: 'vault-1', vaultName: 'Vault', vaultPath: '/tmp/vault' })
    mocks.getRuntimeCapabilities.mockReturnValue({ flows: true })
    const Page = (await import('../page')).default

    await expect(Page({ params: Promise.resolve({ id: 'flow-1', slug: 'alice' }) })).rejects.toThrow('REDIRECT:/w/local?flows=runs&flowId=flow-1')
    expect(mocks.getDesktopFlowsHref).toHaveBeenCalledWith('local', 'runs', 'flow-1')
  })
})
