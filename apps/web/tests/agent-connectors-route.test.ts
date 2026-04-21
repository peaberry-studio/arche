import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetSession = vi.fn()
const mockGetRuntimeCapabilities = vi.fn()
const mockIsDesktop = vi.fn(() => false)
const mockValidateDesktopToken = vi.fn(() => false)
const mockLoadAgentConnectorCapabilityOptions = vi.fn()

function session(slug: string, role: 'USER' | 'ADMIN' = 'USER') {
  return {
    user: { id: 'user-1', email: 'alice@example.com', slug, role },
    sessionId: 'session-1',
  }
}

async function loadRoute() {
  vi.doMock('@/lib/runtime/session', () => ({
    getSession: () => mockGetSession(),
  }))

  vi.doMock('@/lib/runtime/mode', () => ({
    isDesktop: () => mockIsDesktop(),
  }))

  vi.doMock('@/lib/runtime/capabilities', () => ({
    getRuntimeCapabilities: () => mockGetRuntimeCapabilities(),
  }))

  vi.doMock('@/lib/runtime/desktop/token', () => ({
    DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
    validateDesktopToken: () => mockValidateDesktopToken(),
  }))

  vi.doMock('@/lib/agent-connector-capabilities', () => ({
    loadAgentConnectorCapabilityOptions: () => mockLoadAgentConnectorCapabilityOptions(),
  }))

  return import('@/app/api/u/[slug]/agents/connectors/route')
}

describe('GET /api/u/[slug]/agents/connectors', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    mockGetRuntimeCapabilities.mockReturnValue({
      multiUser: true,
      auth: true,
      containers: true,
      workspaceAgent: true,
      reaper: true,
      connectors: true,
      csrf: true,
      teamManagement: true,
      kickstart: true,
      autopilot: true,
      slackIntegration: true,
      twoFactor: false,
    })
  })

  it('returns the global connector capability catalog for admins', async () => {
    mockGetSession.mockResolvedValue(session('admin', 'ADMIN'))
    mockLoadAgentConnectorCapabilityOptions.mockResolvedValue([
      {
        id: 'globallinear',
        type: 'linear',
        name: 'Linear',
        enabled: true,
        scope: 'type',
        ownerKind: null,
        ownerSlug: null,
      },
      {
        id: 'custom-1',
        type: 'custom',
        name: 'Slack MCP',
        enabled: false,
        scope: 'connector',
        ownerKind: 'SERVICE',
        ownerSlug: 'slack-bot',
      },
    ])

    const { GET } = await loadRoute()
    const response = await GET(new Request('http://localhost/api/u/admin/agents/connectors') as never, {
      params: Promise.resolve({ slug: 'admin' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      connectors: [
        {
          id: 'globallinear',
          type: 'linear',
          name: 'Linear',
          enabled: true,
          scope: 'type',
          ownerKind: null,
          ownerSlug: null,
        },
        {
          id: 'custom-1',
          type: 'custom',
          name: 'Slack MCP',
          enabled: false,
          scope: 'connector',
          ownerKind: 'SERVICE',
          ownerSlug: 'slack-bot',
        },
      ],
    })
  })

  it('rejects non-admin users', async () => {
    mockGetSession.mockResolvedValue(session('alice', 'USER'))

    const { GET } = await loadRoute()
    const response = await GET(new Request('http://localhost/api/u/alice/agents/connectors') as never, {
      params: Promise.resolve({ slug: 'alice' }),
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'forbidden' })
    expect(mockLoadAgentConnectorCapabilityOptions).not.toHaveBeenCalled()
  })
})
