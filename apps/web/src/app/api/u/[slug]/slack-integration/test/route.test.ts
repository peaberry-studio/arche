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

vi.mock('@/lib/slack/crypto', () => ({
  decryptSlackToken: (value: string) => value,
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
})
