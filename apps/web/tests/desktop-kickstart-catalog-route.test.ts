import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockValidateDesktopToken = vi.fn()
vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
  validateDesktopToken: (...args: unknown[]) => mockValidateDesktopToken(...args),
}))

const mockGetKickstartTemplateSummaries = vi.fn()
vi.mock('@/kickstart/templates', () => ({
  getKickstartTemplateSummaries: (...args: unknown[]) => mockGetKickstartTemplateSummaries(...args),
}))

const mockGetKickstartAgentSummaries = vi.fn()
vi.mock('@/kickstart/agents/catalog', () => ({
  getKickstartAgentSummaries: (...args: unknown[]) => mockGetKickstartAgentSummaries(...args),
}))

const mockFetchModelsCatalog = vi.fn()
vi.mock('@/lib/models-catalog', () => ({
  fetchModelsCatalog: (...args: unknown[]) => mockFetchModelsCatalog(...args),
}))

describe('desktop kickstart catalog route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    mockValidateDesktopToken.mockReturnValue(true)
    mockGetKickstartAgentSummaries.mockReturnValue([])
    mockGetKickstartTemplateSummaries.mockReturnValue([
      {
        id: 'blank',
        label: 'Blank',
        description: 'Minimal template',
        recommendedAgentIds: ['assistant'],
        agentOverrides: {},
      },
    ])
    mockFetchModelsCatalog.mockResolvedValue({ ok: true, models: [] })
  })

  it('returns 401 when desktop token is missing or invalid', async () => {
    mockValidateDesktopToken.mockReturnValue(false)

    const { GET } = await import('@/app/api/internal/desktop/kickstart/catalog/route')
    const response = await GET(new Request('http://localhost/api/internal/desktop/kickstart/catalog') as never)
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error).toBe('unauthorized')
  })

  it('returns template summaries for the desktop launcher', async () => {
    const { GET } = await import('@/app/api/internal/desktop/kickstart/catalog/route')
    const response = await GET(new Request('http://localhost/api/internal/desktop/kickstart/catalog', {
      headers: {
        'x-arche-desktop-token': 'desktop-token',
      },
    }) as never)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.templates).toHaveLength(1)
    expect(body.templates[0]?.id).toBe('blank')
    expect(body.agents).toEqual([])
    expect(body.models).toEqual([])
  })
})
