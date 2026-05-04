import { beforeEach, describe, expect, it, vi } from 'vitest'

const auditEventMock = vi.fn()
const findIntegrationMock = vi.fn()
const testSlackCredentialsMock = vi.fn()

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

vi.mock('@/lib/slack/integration', () => ({
  isSlackAppToken: (value: string) => value.startsWith('xapp-'),
  isSlackBotToken: (value: string) => value.startsWith('xoxb-'),
  testSlackCredentials: (...args: unknown[]) => testSlackCredentialsMock(...args),
}))

vi.mock('@/lib/services', () => ({
  slackService: {
    findIntegration: (...args: unknown[]) => findIntegrationMock(...args),
  },
}))

describe('/api/u/[slug]/slack-integration/test', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.user = { id: 'admin-1', role: 'ADMIN', slug: 'alice' }
    findIntegrationMock.mockResolvedValue({
      appTokenSecret: 'xapp-saved',
      botTokenSecret: 'xoxb-saved',
    })
    testSlackCredentialsMock.mockResolvedValue({
      appId: 'A123',
      botUserId: 'U123',
      ok: true,
      socketUrlAvailable: true,
      teamId: 'T123',
    })
  })

  it('tests Slack credentials for admins and falls back to saved tokens', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/u/alice/slack-integration/test', {
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }) as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      appId: 'A123',
      botUserId: 'U123',
      ok: true,
      socketUrlAvailable: true,
      teamId: 'T123',
    })
    expect(testSlackCredentialsMock).toHaveBeenCalledWith({
      appToken: 'xapp-saved',
      botToken: 'xoxb-saved',
    })
    expect(auditEventMock).toHaveBeenCalledWith({
      action: 'slack_integration.connection_tested',
      actorUserId: 'admin-1',
      metadata: {
        appId: 'A123',
        botUserId: 'U123',
        ok: true,
        socketUrlAvailable: true,
        teamId: 'T123',
      },
    })
  })

  it('rejects non-admin users', async () => {
    authState.user = { id: 'user-1', role: 'USER', slug: 'alice' }

    const { POST } = await import('./route')
    const response = await POST(new Request('http://localhost/api/u/alice/slack-integration/test', {
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }) as never, {
      params: Promise.resolve({ slug: 'alice' }),
    })

    expect(response.status).toBe(403)
  })

  it('returns invalid_json for malformed request bodies', async () => {
    const { POST } = await import('./route')
    const response = await POST(new Request('http://localhost/api/u/alice/slack-integration/test', {
      body: '{',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }) as never, {
      params: Promise.resolve({ slug: 'alice' }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_json' })
    expect(testSlackCredentialsMock).not.toHaveBeenCalled()
  })

  it('uses body tokens when provided instead of saved tokens', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/u/alice/slack-integration/test', {
        body: JSON.stringify({ botToken: 'xoxb-body', appToken: 'xapp-body' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }) as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(200)
    expect(testSlackCredentialsMock).toHaveBeenCalledWith({
      appToken: 'xapp-body',
      botToken: 'xoxb-body',
    })
  })

  it('returns missing_tokens when no tokens are provided and no integration exists', async () => {
    findIntegrationMock.mockResolvedValue(null)

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/u/alice/slack-integration/test', {
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }) as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'missing_tokens' })
    expect(testSlackCredentialsMock).not.toHaveBeenCalled()
  })

  it('returns invalid_saved_tokens when saved tokens are corrupted', async () => {
    findIntegrationMock.mockResolvedValue({
      appTokenSecret: '',
      botTokenSecret: '',
      configCorrupted: true,
    })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/u/alice/slack-integration/test', {
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }) as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_saved_tokens',
      message: 'Saved Slack tokens are corrupted. Re-enter tokens and save.',
    })
    expect(testSlackCredentialsMock).not.toHaveBeenCalled()
  })

  it('returns invalid_bot_token for malformed bot token', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/u/alice/slack-integration/test', {
        body: JSON.stringify({ botToken: 'invalid', appToken: 'xapp-valid' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }) as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_bot_token',
      message: 'Bot token must start with xoxb-.',
    })
    expect(testSlackCredentialsMock).not.toHaveBeenCalled()
  })

  it('returns invalid_app_token for malformed app token', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/u/alice/slack-integration/test', {
        body: JSON.stringify({ botToken: 'xoxb-valid', appToken: 'invalid' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }) as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_app_token',
      message: 'App token must start with xapp-.',
    })
    expect(testSlackCredentialsMock).not.toHaveBeenCalled()
  })

  it('returns slack_test_failed when testSlackCredentials throws', async () => {
    testSlackCredentialsMock.mockRejectedValue(new Error('network error'))

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/u/alice/slack-integration/test', {
        body: JSON.stringify({ botToken: 'xoxb-test', appToken: 'xapp-test' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }) as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'slack_test_failed',
      message: 'network error',
    })
  })
})
