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

  it('returns agent option load errors before saving settings', async () => {
    loadSlackAgentOptionsMock.mockResolvedValueOnce({ ok: false, error: 'kb_unavailable' })

    const { PUT } = await import('./route')
    const response = await PUT(
      new Request('http://localhost/api/u/alice/slack-integration', {
        body: JSON.stringify({ defaultAgentId: 'assistant', enabled: false }),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      }) as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'kb_unavailable' })
    expect(saveIntegrationConfigMock).not.toHaveBeenCalled()
  })

  it('reports corrupted saved tokens when enabling without replacement tokens', async () => {
    findIntegrationMock.mockResolvedValue({
      appTokenSecret: null,
      botTokenSecret: null,
      configCorrupted: true,
      createdAt: new Date(),
      defaultAgentId: 'assistant',
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
        body: JSON.stringify({ defaultAgentId: 'assistant', enabled: true }),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      }) as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_saved_tokens',
      message: 'Saved Slack tokens are corrupted. Re-enter tokens and save.',
    })
  })

  it('clears Slack identity fields when replacing tokens on a disabled integration', async () => {
    const { PUT } = await import('./route')
    const response = await PUT(
      new Request('http://localhost/api/u/alice/slack-integration', {
        body: JSON.stringify({ appToken: 'xapp-new', botToken: 'xoxb-new', defaultAgentId: null, enabled: false }),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      }) as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(200)
    expect(saveIntegrationConfigMock).toHaveBeenCalledWith(expect.objectContaining({
      slackAppId: null,
      slackBotUserId: null,
      slackTeamId: null,
    }))
    expect(testSlackCredentialsMock).not.toHaveBeenCalled()
  })

  it('rejects invalid JSON and non-object bodies', async () => {
    const { PUT } = await import('./route')
    const invalidJson = await PUT(
      new Request('http://localhost/api/u/alice/slack-integration', {
        body: 'not json{',
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      }) as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )
    const invalidBody = await PUT(
      new Request('http://localhost/api/u/alice/slack-integration', {
        body: JSON.stringify(['not', 'an', 'object']),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      }) as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(invalidJson.status).toBe(400)
    await expect(invalidJson.json()).resolves.toEqual({ error: 'invalid_json' })
    expect(invalidBody.status).toBe(400)
    await expect(invalidBody.json()).resolves.toEqual({ error: 'invalid_body' })
  })

  it('rethrows non-syntax JSON parse failures', async () => {
    const { PUT } = await import('./route')
    const request = {
      json: vi.fn().mockRejectedValue(new Error('body stream failed')),
    } as unknown as Request

    await expect(PUT(request as never, { params: Promise.resolve({ slug: 'alice' }) })).rejects.toThrow(
      'body stream failed',
    )
  })

  it('rejects unknown agents and malformed tokens', async () => {
    const { PUT } = await import('./route')
    const unknownAgent = await PUT(
      new Request('http://localhost/api/u/alice/slack-integration', {
        body: JSON.stringify({ defaultAgentId: 'missing-agent' }),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      }) as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )
    const invalidBotToken = await PUT(
      new Request('http://localhost/api/u/alice/slack-integration', {
        body: JSON.stringify({ botToken: 'bad-token', defaultAgentId: 'assistant' }),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      }) as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )
    const invalidAppToken = await PUT(
      new Request('http://localhost/api/u/alice/slack-integration', {
        body: JSON.stringify({ appToken: 'bad-token', defaultAgentId: 'assistant' }),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      }) as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(unknownAgent.status).toBe(400)
    await expect(unknownAgent.json()).resolves.toEqual({ error: 'unknown_agent' })
    expect(invalidBotToken.status).toBe(400)
    await expect(invalidBotToken.json()).resolves.toEqual({ error: 'invalid_bot_token', message: 'Bot token must start with xoxb-.' })
    expect(invalidAppToken.status).toBe(400)
    await expect(invalidAppToken.json()).resolves.toEqual({ error: 'invalid_app_token', message: 'App token must start with xapp-.' })
  })

  it('surfaces service user and Slack credential validation failures', async () => {
    const { PUT } = await import('./route')
    ensureSlackServiceUserMock.mockResolvedValueOnce({ ok: false, error: 'service_user_unavailable' })
    const serviceUserFailure = await PUT(
      new Request('http://localhost/api/u/alice/slack-integration', {
        body: JSON.stringify({ defaultAgentId: 'assistant', enabled: true }),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      }) as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )
    testSlackCredentialsMock.mockRejectedValueOnce(new Error('Slack auth failed'))
    const credentialFailure = await PUT(
      new Request('http://localhost/api/u/alice/slack-integration', {
        body: JSON.stringify({ defaultAgentId: 'assistant', enabled: true }),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      }) as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(serviceUserFailure.status).toBe(409)
    await expect(serviceUserFailure.json()).resolves.toEqual({ error: 'service_user_unavailable' })
    expect(credentialFailure.status).toBe(400)
    await expect(credentialFailure.json()).resolves.toEqual({ error: 'slack_test_failed', message: 'Slack auth failed' })
  })

  it('returns load errors after save or delete when settings cannot be reloaded', async () => {
    const { DELETE, PUT } = await import('./route')
    loadSlackAgentOptionsMock
      .mockResolvedValueOnce({ agents: [{ displayName: 'Assistant', id: 'assistant', isPrimary: true }], ok: true, primaryAgentId: 'assistant' })
      .mockResolvedValueOnce({ ok: false, error: 'kb_unavailable' })
      .mockResolvedValueOnce({ ok: false, error: 'load_failed' })

    const saveResponse = await PUT(
      new Request('http://localhost/api/u/alice/slack-integration', {
        body: JSON.stringify({ defaultAgentId: 'assistant', enabled: false }),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      }) as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )
    const deleteResponse = await DELETE(new Request('http://localhost/api/u/alice/slack-integration', { method: 'DELETE' }) as never, {
      params: Promise.resolve({ slug: 'alice' }),
    })

    expect(saveResponse.status).toBe(503)
    await expect(saveResponse.json()).resolves.toEqual({ error: 'kb_unavailable' })
    expect(deleteResponse.status).toBe(500)
    await expect(deleteResponse.json()).resolves.toEqual({ error: 'load_failed' })
  })
})
