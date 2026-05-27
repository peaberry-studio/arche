import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ensureFlowSchedulerStarted: vi.fn(),
  getCurrentDesktopVault: vi.fn(),
  getDesktopFlowsHref: vi.fn(),
  getRuntimeCapabilities: vi.fn(),
  isDesktop: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`)
  }),
}))

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/components/flows/flows-page', () => ({ FlowsPage: ({ slug }: { slug: string }) => <div data-slug={slug} /> }))
vi.mock('@/lib/flows/scheduler-bootstrap', () => ({ ensureFlowSchedulerStarted: mocks.ensureFlowSchedulerStarted }))
vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mocks.getRuntimeCapabilities }))
vi.mock('@/lib/runtime/desktop/current-vault', () => ({
  getCurrentDesktopVault: mocks.getCurrentDesktopVault,
  getDesktopFlowsHref: mocks.getDesktopFlowsHref,
}))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mocks.isDesktop }))

describe('FlowsListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getDesktopFlowsHref.mockReturnValue('/w/local?flows=list')
  })

  it('renders the flows page and starts the scheduler', async () => {
    mocks.isDesktop.mockReturnValue(false)
    mocks.getRuntimeCapabilities.mockReturnValue({ flows: true })
    const Page = (await import('../page')).default

    const result = await Page({ params: Promise.resolve({ slug: 'alice' }) })

    expect(result.type).toBe('main')
    expect(mocks.ensureFlowSchedulerStarted).toHaveBeenCalled()
  })

  it('redirects when flows are unavailable', async () => {
    mocks.isDesktop.mockReturnValue(false)
    mocks.getRuntimeCapabilities.mockReturnValue({ flows: false })
    const Page = (await import('../page')).default

    await expect(Page({ params: Promise.resolve({ slug: 'alice' }) })).rejects.toThrow('REDIRECT:/u/alice')
  })

  it('redirects desktop flow routes into the workspace flow dialog', async () => {
    mocks.isDesktop.mockReturnValue(true)
    mocks.getCurrentDesktopVault.mockReturnValue({ vaultId: 'vault-1', vaultName: 'Vault', vaultPath: '/tmp/vault' })
    mocks.getRuntimeCapabilities.mockReturnValue({ flows: true })
    const Page = (await import('../page')).default

    await expect(Page({ params: Promise.resolve({ slug: 'alice' }) })).rejects.toThrow('REDIRECT:/w/local?flows=list')
    expect(mocks.getDesktopFlowsHref).toHaveBeenCalledWith('local', 'list')
    expect(mocks.ensureFlowSchedulerStarted).not.toHaveBeenCalled()
  })
})
