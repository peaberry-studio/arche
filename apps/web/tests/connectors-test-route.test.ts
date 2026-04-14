import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetAuthenticatedUser = vi.fn()
vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
}))

const mockValidateSameOrigin = vi.fn()
vi.mock('@/lib/csrf', () => ({
  validateSameOrigin: (...args: unknown[]) => mockValidateSameOrigin(...args),
}))

const mockUserFindUnique = vi.fn()
const mockConnectorFindFirst = vi.fn()
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
    connector: {
      findFirst: (...args: unknown[]) => mockConnectorFindFirst(...args),
    },
  },
}))

const mockDecryptConfig = vi.fn()
vi.mock('@/lib/connectors/crypto', () => ({
  decryptConfig: (...args: unknown[]) => mockDecryptConfig(...args),
}))

const mockRefreshConnectorOAuthConfigIfNeeded = vi.fn()
vi.mock('@/lib/connectors/oauth-refresh', () => ({
  refreshConnectorOAuthConfigIfNeeded: (...args: unknown[]) =>
    mockRefreshConnectorOAuthConfigIfNeeded(...args),
}))

const mockValidateConnectorTestEndpoint = vi.fn()
vi.mock('@/lib/security/ssrf', () => ({
  validateConnectorTestEndpoint: (...args: unknown[]) => mockValidateConnectorTestEndpoint(...args),
}))

function session(slug: string) {
  return { user: { id: 'user-1', email: 'alice@example.com', slug, role: 'USER' }, sessionId: 'session-1' }
}

async function callTestRoute(slug = 'alice', id = 'conn-1') {
  const { POST } = await import('@/app/api/u/[slug]/connectors/[id]/test/route')

  const request = new Request(`http://localhost/api/u/${slug}/connectors/${id}/test`, {
    method: 'POST',
    headers: {
      host: 'localhost',
      origin: 'http://localhost',
    },
  })

  const response = await POST(request as never, { params: Promise.resolve({ slug, id }) })
  return { status: response.status, body: await response.json() }
}

describe('POST /api/u/[slug]/connectors/[id]/test SSRF hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    mockGetAuthenticatedUser.mockResolvedValue(session('alice'))
    mockValidateSameOrigin.mockReturnValue({ ok: true })
    mockUserFindUnique.mockResolvedValue({ id: 'user-1' })
    mockConnectorFindFirst.mockResolvedValue({
      id: 'conn-1',
      userId: 'user-1',
      type: 'custom',
      enabled: true,
      config: 'encrypted-config',
    })
    mockRefreshConnectorOAuthConfigIfNeeded.mockResolvedValue(null)
    mockDecryptConfig.mockReturnValue({ endpoint: 'https://api.example.com/mcp' })
    mockValidateConnectorTestEndpoint.mockResolvedValue({ ok: true, url: new URL('https://api.example.com/mcp') })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok', { status: 200 })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns 400 for blocked custom endpoints without issuing outbound fetch', async () => {
    mockValidateConnectorTestEndpoint.mockResolvedValueOnce({ ok: false, error: 'blocked_endpoint' })

    const { status, body } = await callTestRoute('alice', 'conn-1')

    expect(status).toBe(400)
    expect(body).toEqual({ error: 'blocked_endpoint' })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid custom endpoints', async () => {
    mockValidateConnectorTestEndpoint.mockResolvedValueOnce({ ok: false, error: 'invalid_endpoint' })

    const { status, body } = await callTestRoute('alice', 'conn-1')

    expect(status).toBe(400)
    expect(body).toEqual({ error: 'invalid_endpoint' })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('uses redirect manual when testing allowed custom endpoints', async () => {
    const { status, body } = await callTestRoute('alice', 'conn-1')

    expect(status).toBe(200)
    expect(body).toMatchObject({ ok: true, tested: true })
    expect(mockValidateConnectorTestEndpoint).toHaveBeenCalledWith('https://api.example.com/mcp')
    expect(globalThis.fetch).toHaveBeenCalledWith(
      new URL('https://api.example.com/mcp'),
      expect.objectContaining({
        method: 'GET',
        redirect: 'manual',
      })
    )
  })
})

describe('POST /api/u/[slug]/connectors/[id]/test Zendesk checks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    mockGetAuthenticatedUser.mockResolvedValue(session('alice'))
    mockValidateSameOrigin.mockReturnValue({ ok: true })
    mockUserFindUnique.mockResolvedValue({ id: 'user-1' })
    mockConnectorFindFirst.mockResolvedValue({
      id: 'conn-zendesk-1',
      userId: 'user-1',
      type: 'zendesk',
      enabled: true,
      config: 'encrypted-config',
    })
    mockRefreshConnectorOAuthConfigIfNeeded.mockResolvedValue(null)
    mockDecryptConfig.mockReturnValue({
      subdomain: 'acme',
      email: 'agent@example.com',
      apiToken: 'token-123',
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('tests Zendesk credentials against the users/me endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ user: { id: 1, email: 'agent@example.com' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    )

    const { status, body } = await callTestRoute('alice', 'conn-zendesk-1')

    expect(status).toBe(200)
    expect(body).toEqual({
      ok: true,
      tested: true,
      message: 'Zendesk connection verified.',
    })

    expect(globalThis.fetch).toHaveBeenCalledWith(
      new URL('https://acme.zendesk.com/api/v2/users/me.json'),
      expect.objectContaining({
        method: 'GET',
      })
    )

    const [, requestInit] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [URL, RequestInit]
    const headers = requestInit.headers as Headers
    expect(headers.get('Authorization')).toBe(
      `Basic ${Buffer.from('agent@example.com/token:token-123').toString('base64')}`
    )
  })

  it('returns Zendesk API failures to the client', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Too Many Requests', description: 'Slow down' }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '30' },
        })
      )
    )

    const { status, body } = await callTestRoute('alice', 'conn-zendesk-1')

    expect(status).toBe(200)
    expect(body).toEqual({
      ok: false,
      tested: true,
      message: 'Zendesk request failed (429): Slow down',
    })
  })
})

describe('POST /api/u/[slug]/connectors/[id]/test OAuth MCP checks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    mockGetAuthenticatedUser.mockResolvedValue(session('alice'))
    mockValidateSameOrigin.mockReturnValue({ ok: true })
    mockUserFindUnique.mockResolvedValue({ id: 'user-1' })
    mockConnectorFindFirst.mockResolvedValue({
      id: 'conn-1',
      userId: 'user-1',
      type: 'linear',
      enabled: true,
      config: 'encrypted-config',
    })
    mockRefreshConnectorOAuthConfigIfNeeded.mockResolvedValue(null)
    mockDecryptConfig.mockReturnValue({
      authType: 'oauth',
      oauth: {
        provider: 'linear',
        accessToken: 'oauth-token',
        clientId: 'client-1',
      },
    })
    mockValidateConnectorTestEndpoint.mockResolvedValue({ ok: true, url: new URL('https://api.example.com/mcp') })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('tests Linear OAuth using the MCP endpoint initialize call', async () => {
    vi.stubGlobal('fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 'arche-connector-test', result: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    )

    const { status, body } = await callTestRoute('alice', 'conn-1')

    expect(status).toBe(200)
    expect(body).toEqual({
      ok: true,
      tested: true,
      message:
        'Linear MCP connection verified. Restart the workspace to apply the updated connector credentials. If it is still unavailable in chat, enable this connector in Agent capabilities.',
    })

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://mcp.linear.app/mcp',
      expect.objectContaining({
        method: 'POST',
      })
    )

    const [, requestInit] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit
    ]
    const headers = requestInit.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer oauth-token')
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
      },
    })
  })

  it('returns failed test when MCP endpoint rejects OAuth token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 })))

    const { status, body } = await callTestRoute('alice', 'conn-1')

    expect(status).toBe(200)
    expect(body).toEqual({
      ok: false,
      tested: true,
      message: 'Linear MCP authentication failed (401). Reconnect OAuth and retry.',
    })
  })

  it('tests custom OAuth using the configured MCP endpoint initialize call', async () => {
    mockConnectorFindFirst.mockResolvedValueOnce({
      id: 'conn-1',
      userId: 'user-1',
      type: 'custom',
      enabled: true,
      config: 'encrypted-config',
    })
    mockDecryptConfig.mockReturnValueOnce({
      authType: 'oauth',
      endpoint: 'https://custom.example.com/mcp',
      oauth: {
        provider: 'custom',
        accessToken: 'oauth-token',
        clientId: 'client-1',
      },
    })
    mockValidateConnectorTestEndpoint.mockResolvedValueOnce({
      ok: true,
      url: new URL('https://custom.example.com/mcp'),
    })

    vi.stubGlobal('fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 'arche-connector-test', result: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    )

    const { status, body } = await callTestRoute('alice', 'conn-1')

    expect(status).toBe(200)
    expect(body).toEqual({
      ok: true,
      tested: true,
      message:
        'Custom MCP connection verified. Restart the workspace to apply the updated connector credentials. If it is still unavailable in chat, enable this connector in Agent capabilities.',
    })

    expect(mockValidateConnectorTestEndpoint).toHaveBeenCalledWith('https://custom.example.com/mcp')
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://custom.example.com/mcp',
      expect.objectContaining({
        method: 'POST',
      })
    )
  })
})
