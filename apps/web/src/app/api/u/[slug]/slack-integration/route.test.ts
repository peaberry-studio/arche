import { beforeEach, describe, expect, it, vi } from 'vitest'

const loadSlackAgentOptionsMock = vi.fn()
const saveIntegrationConfigMock = vi.fn()
const findIntegrationMock = vi.fn()
const clearIntegrationMock = vi.fn()
const ensureSlackServiceUserMock = vi.fn()
const syncSlackSocketManagerMock = vi.fn()
const testSlackCredentialsMock = vi.fn()
const auditEventMock = vi.fn()

const authState = {
  user: { id: 'admin-1', role: 'ADMIN', slug: 'alice' },
}

vi.mock('@/lib/auth', () => ({
  auditEvent: (...args: unknown[]) => auditEventMock(...args),
}))

vi.mock('@/lib/runtime/require-capability', () => ({
  requireCapability: () => null,
}))

vi.mock('@/lib/runtime/with-auth', () => ({
  withAuth: (_options: unknown, handler: (request: Request, context: unknown) => Promise<Response>) => {
    return async (request: Request, { params }: { params: Promise<{ slug: string }> }) => {
      const resolvedParams = await params
      return handler(request, {
        params: resolvedParams,
        sessionId: 'session-1',
        slug: resolvedParams.slug,
        user: authState.user,
      })
    }
  },
}))

vi.mock('@/lib/slack/agents', () => ({
  loadSlackAgentOptions: (...args: unknown[]) => loadSlackAgentOptionsMock(...args),
}))

vi.mock('@/lib/slack/integration', () => ({
  isSlackAppToken: (value: string) => value.startsWith('xapp-'),
  isSlackBotToken: (value: string) => value.startsWith('xoxb-'),
  serializeSlackIntegration: (record: { enabled: boolean } | null, primaryAgentId: string | null) => ({
    configured: true,
    defaultAgentId: record ? 'researcher' : null,
    enabled: record?.enabled ?? false,
    hasAppToken: true,
    hasBotToken: true,
    lastError: null,
    lastEventAt: null,
    lastSocketConnectedAt: null,
    resolvedDefaultAgentId: primaryAgentId,
    slackAppId: 'A123',
    slackBotUserId: 'U123',
    slackTeamId: 'T123',
    status: record?.enabled ? 'connecting' : 'disabled',
    updatedAt: null,
    version: 1,
  }),
  testSlackCredentials: (...args: unknown[]) => testSlackCredentialsMock(...args),
}))

vi.mock('@/lib/slack/service-user', () => ({
  ensureSlackServiceUser: (...args: unknown[]) => ensureSlackServiceUserMock(...args),
}))

vi.mock('@/lib/slack/socket-mode', () => ({
  syncSlackSocketManager: (...args: unknown[]) => syncSlackSocketManagerMock(...args),
}))

vi.mock('@/lib/services', () => ({
  slackService: {
    clearIntegration: (...args: unknown[]) => clearIntegrationMock(...args),
    findIntegration: (...args: unknown[]) => findIntegrationMock(...args),
    saveIntegrationConfig: (...args: unknown[]) => saveIntegrationConfigMock(...args),
  },
}))

describe('/api/u/[slug]/slack-integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.user = { id: 'admin-1', role: 'ADMIN', slug: 'alice' }
    loadSlackAgentOptionsMock.mockResolvedValue({
      agents: [{ displayName: 'Assistant', id: 'assistant', isPrimary: true }],
      ok: true,
      primaryAgentId: 'assistant',
    })
    findIntegrationMock.mockResolvedValue({
      appTokenSecret: 'xapp-saved',
      botTokenSecret: 'xoxb-saved',
      createdAt: new Date(),
      defaultAgentId: 'researcher',
      enabled: true,
      lastError: null,
      lastEventAt: null,
      lastSocketConnectedAt: null,
      singletonKey: 'default',
      slackAppId: 'A123',
      slackBotUserId: 'U123',
      slackTeamId: 'T123',
      updatedAt: new Date(),
      version: 1,
    })
    ensureSlackServiceUserMock.mockResolvedValue({ ok: true, user: { id: 'service-1', slug: 'slack-bot' } })
    testSlackCredentialsMock.mockResolvedValue({
      appId: 'A123',
      botUserId: 'U123',
      ok: true,
      socketUrlAvailable: true,
      teamId: 'T123',
    })
    saveIntegrationConfigMock.mockResolvedValue(undefined)
    clearIntegrationMock.mockResolvedValue(undefined)
    syncSlackSocketManagerMock.mockResolvedValue(undefined)
  })

  it('returns the integration payload for admins', async () => {
    const { GET } = await import('./route')
    const response = await GET(new Request('http://localhost/api/u/alice/slack-integration') as never, {
      params: Promise.resolve({ slug: 'alice' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      agents: [{ displayName: 'Assistant', id: 'assistant', isPrimary: true }],
      integration: expect.objectContaining({ enabled: true, slackTeamId: 'T123' }),
    })
  })

  it('saves and enables the integration after validating the tokens', async () => {
    const { PUT } = await import('./route')
    const response = await PUT(
      new Request('http://localhost/api/u/alice/slack-integration', {
        body: JSON.stringify({
          appToken: 'xapp-new',
          botToken: 'xoxb-new',
          defaultAgentId: 'assistant',
          enabled: true,
        }),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      }) as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(200)
    expect(ensureSlackServiceUserMock).toHaveBeenCalled()
    expect(testSlackCredentialsMock).toHaveBeenCalledWith({
      appToken: 'xapp-new',
      botToken: 'xoxb-new',
    })
    expect(saveIntegrationConfigMock).toHaveBeenCalledWith({
      appTokenSecret: 'xapp-new',
      botTokenSecret: 'xoxb-new',
      clearLastError: true,
      defaultAgentId: 'assistant',
      enabled: true,
      slackAppId: 'A123',
      slackBotUserId: 'U123',
      slackTeamId: 'T123',
    })
    expect(syncSlackSocketManagerMock).toHaveBeenCalledWith(false)
  })

  it('rejects non-admin users', async () => {
    authState.user = { id: 'user-1', role: 'USER', slug: 'alice' }

    const { GET } = await import('./route')
    const response = await GET(new Request('http://localhost/api/u/alice/slack-integration') as never, {
      params: Promise.resolve({ slug: 'alice' }),
    })

    expect(response.status).toBe(403)
  })

  it('disables the integration without testing tokens', async () => {
    const { PUT } = await import('./route')
    const response = await PUT(
      new Request('http://localhost/api/u/alice/slack-integration', {
        body: JSON.stringify({
          defaultAgentId: null,
          enabled: false,
        }),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      }) as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(200)
    expect(testSlackCredentialsMock).not.toHaveBeenCalled()
    expect(saveIntegrationConfigMock).toHaveBeenCalledWith({
      clearLastError: true,
      defaultAgentId: null,
      enabled: false,
      slackAppId: 'A123',
      slackBotUserId: 'U123',
      slackTeamId: 'T123',
    })
  })

  it('returns cannot_reconnect_disabled before resolving tokens for a disabled integration', async () => {
    findIntegrationMock.mockResolvedValue({
      appTokenSecret: null,
      botTokenSecret: null,
      createdAt: new Date(),
      defaultAgentId: 'researcher',
      enabled: false,
      lastError: null,
      lastEventAt: null,
      lastSocketConnectedAt: null,
      singletonKey: 'default',
      slackAppId: null,
      slackBotUserId: null,
      slackTeamId: null,
      updatedAt: new Date(),
      version: 1,
    })

    const { PUT } = await import('./route')
    const response = await PUT(
      new Request('http://localhost/api/u/alice/slack-integration', {
        body: JSON.stringify({ defaultAgentId: 'assistant', enabled: false, reconnect: true }),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      }) as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'cannot_reconnect_disabled' })
    expect(testSlackCredentialsMock).not.toHaveBeenCalled()
  })
})
