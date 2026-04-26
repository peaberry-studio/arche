import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const oauthConfigMocks = vi.hoisted(() => ({
  getConnectorAuthType: vi.fn<() => 'manual' | 'oauth'>().mockReturnValue('manual'),
  getConnectorOAuthConfig: vi.fn().mockReturnValue(null),
}))

const ahrefsMocks = vi.hoisted(() => ({
  parseAhrefsConnectorConfig: vi.fn(),
  testAhrefsConnection: vi.fn(),
}))

const umamiMocks = vi.hoisted(() => ({
  parseUmamiConnectorConfig: vi.fn(),
  testUmamiConnection: vi.fn(),
}))

const zendeskMocks = vi.hoisted(() => ({
  getZendeskMcpProtocolVersion: vi.fn().mockReturnValue('2025-03-26'),
  parseZendeskConnectorConfig: vi.fn(),
  testZendeskConnection: vi.fn(),
}))

const mcpServerUrlMocks = vi.hoisted(() => ({
  getConnectorMcpServerUrl: vi.fn(),
}))

vi.mock('@/lib/connectors/oauth-config', () => ({
  getConnectorAuthType: oauthConfigMocks.getConnectorAuthType,
  getConnectorOAuthConfig: oauthConfigMocks.getConnectorOAuthConfig,
}))

vi.mock('@/lib/connectors/ahrefs', () => ({
  parseAhrefsConnectorConfig: ahrefsMocks.parseAhrefsConnectorConfig,
  testAhrefsConnection: ahrefsMocks.testAhrefsConnection,
}))

vi.mock('@/lib/connectors/umami', () => ({
  parseUmamiConnectorConfig: umamiMocks.parseUmamiConnectorConfig,
  testUmamiConnection: umamiMocks.testUmamiConnection,
}))

vi.mock('@/lib/connectors/zendesk', () => ({
  getZendeskMcpProtocolVersion: zendeskMocks.getZendeskMcpProtocolVersion,
  parseZendeskConnectorConfig: zendeskMocks.parseZendeskConnectorConfig,
  testZendeskConnection: zendeskMocks.testZendeskConnection,
}))

vi.mock('@/lib/connectors/mcp/server-url', () => ({
  getConnectorMcpServerUrl: mcpServerUrlMocks.getConnectorMcpServerUrl,
}))

import {
  getCustomConnectorTestEndpoint,
  testConnectorConnection,
} from '@/lib/connectors/test-connection'

function mockFetch(response: Partial<{ status: number; body: string }> = {}) {
  const { status = 200, body = '{}' } = response
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(body, { status, headers: { 'content-type': 'application/json' } })
  )
}

function oauthConfig(overrides: Record<string, unknown> = {}) {
  return {
    authType: 'oauth',
    oauth: {
      provider: 'linear',
      accessToken: 'oauth-access-token',
      clientId: 'client-123',
      connectedAt: '2026-01-01T00:00:00Z',
      ...overrides,
    },
  }
}

function setOAuthMode(type: string, accessToken: string | null = 'oauth-access-token') {
  oauthConfigMocks.getConnectorAuthType.mockReturnValue('oauth')
  if (accessToken) {
    oauthConfigMocks.getConnectorOAuthConfig.mockReturnValue({
      provider: type,
      accessToken,
      clientId: 'client-123',
      connectedAt: '2026-01-01T00:00:00Z',
    })
  } else {
    oauthConfigMocks.getConnectorOAuthConfig.mockReturnValue(null)
  }
}

function setManualMode() {
  oauthConfigMocks.getConnectorAuthType.mockReturnValue('manual')
  oauthConfigMocks.getConnectorOAuthConfig.mockReturnValue(null)
}

describe('getCustomConnectorTestEndpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setManualMode()
  })

  it('returns MCP server URL in oauth mode', () => {
    oauthConfigMocks.getConnectorAuthType.mockReturnValue('oauth')
    mcpServerUrlMocks.getConnectorMcpServerUrl.mockReturnValue('https://mcp.example.com/mcp')

    const result = getCustomConnectorTestEndpoint({ authType: 'oauth' })

    expect(result).toBe('https://mcp.example.com/mcp')
    expect(mcpServerUrlMocks.getConnectorMcpServerUrl).toHaveBeenCalledWith('custom', { authType: 'oauth' })
  })

  it('returns null when MCP server URL is null in oauth mode', () => {
    oauthConfigMocks.getConnectorAuthType.mockReturnValue('oauth')
    mcpServerUrlMocks.getConnectorMcpServerUrl.mockReturnValue(null)

    expect(getCustomConnectorTestEndpoint({ authType: 'oauth' })).toBeNull()
  })

  it('returns endpoint string in manual mode', () => {
    const result = getCustomConnectorTestEndpoint({ endpoint: 'https://api.example.com/health' })

    expect(result).toBe('https://api.example.com/health')
  })

  it('returns null when endpoint is missing in manual mode', () => {
    expect(getCustomConnectorTestEndpoint({})).toBeNull()
  })

  it('returns null when endpoint is not a string in manual mode', () => {
    expect(getCustomConnectorTestEndpoint({ endpoint: 42 })).toBeNull()
  })
})

describe('testConnectorConnection', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    setManualMode()
  })

  afterEach(() => {
    fetchSpy?.mockRestore()
  })

  describe('ahrefs', () => {
    it('returns success when parse and test pass', async () => {
      const parsed = { apiKey: 'ahrefs-key', domain: 'example.com' }
      ahrefsMocks.parseAhrefsConnectorConfig.mockReturnValue({ ok: true, value: parsed })
      ahrefsMocks.testAhrefsConnection.mockResolvedValue({ ok: true })

      const result = await testConnectorConnection('ahrefs', { apiKey: 'ahrefs-key', domain: 'example.com' })

      expect(result).toEqual({ ok: true, tested: true, message: 'Ahrefs connection verified.' })
      expect(ahrefsMocks.testAhrefsConnection).toHaveBeenCalledWith(parsed)
    })

    it('returns failure when config parse fails with missing fields', async () => {
      ahrefsMocks.parseAhrefsConnectorConfig.mockReturnValue({ ok: false, missing: ['apiKey'] })

      const result = await testConnectorConnection('ahrefs', {})

      expect(result).toEqual({
        ok: false,
        tested: false,
        message: 'Missing required fields: apiKey',
      })
      expect(ahrefsMocks.testAhrefsConnection).not.toHaveBeenCalled()
    })

    it('returns failure when test connection fails', async () => {
      ahrefsMocks.parseAhrefsConnectorConfig.mockReturnValue({ ok: true, value: { apiKey: 'k' } })
      ahrefsMocks.testAhrefsConnection.mockResolvedValue({ ok: false, message: 'Invalid API key' })

      const result = await testConnectorConnection('ahrefs', { apiKey: 'k' })

      expect(result).toEqual({ ok: false, tested: true, message: 'Invalid API key' })
    })
  })

  describe('zendesk', () => {
    it('returns success when parse and test pass', async () => {
      const parsed = { subdomain: 'test', email: 'a@b.com', apiToken: 'tok' }
      zendeskMocks.parseZendeskConnectorConfig.mockReturnValue({ ok: true, value: parsed })
      zendeskMocks.testZendeskConnection.mockResolvedValue({ ok: true })

      const result = await testConnectorConnection('zendesk', parsed)

      expect(result).toEqual({ ok: true, tested: true, message: 'Zendesk connection verified.' })
    })

    it('returns failure when config parse fails with message', async () => {
      zendeskMocks.parseZendeskConnectorConfig.mockReturnValue({ ok: false, message: 'Bad config' })

      const result = await testConnectorConnection('zendesk', {})

      expect(result).toEqual({ ok: false, tested: false, message: 'Bad config' })
    })
  })

  describe('umami', () => {
    it('returns success when parse and test pass', async () => {
      const parsed = { baseUrl: 'https://umami.example.com', username: 'u', password: 'p' }
      umamiMocks.parseUmamiConnectorConfig.mockReturnValue({ ok: true, value: parsed })
      umamiMocks.testUmamiConnection.mockResolvedValue({ ok: true })

      const result = await testConnectorConnection('umami', parsed)

      expect(result).toEqual({ ok: true, tested: true, message: 'Umami connection verified.' })
    })
  })

  describe('linear', () => {
    it('connects via MCP with API key', async () => {
      fetchSpy = mockFetch({ status: 200 })
      mcpServerUrlMocks.getConnectorMcpServerUrl.mockReturnValue('https://mcp.linear.app/mcp')

      const result = await testConnectorConnection('linear', { apiKey: 'lin_api_key' })

      expect(result).toEqual({ ok: true, tested: true, message: 'Linear MCP connection verified.' })
      expect(fetchSpy).toHaveBeenCalledOnce()
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://mcp.linear.app/mcp')
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer lin_api_key')
    })

    it('connects via MCP with OAuth token', async () => {
      setOAuthMode('linear')
      fetchSpy = mockFetch({ status: 200 })
      mcpServerUrlMocks.getConnectorMcpServerUrl.mockReturnValue('https://mcp.linear.app/mcp')

      const result = await testConnectorConnection('linear', oauthConfig({ provider: 'linear' }))

      expect(result).toEqual({ ok: true, tested: true, message: 'Linear MCP connection verified.' })
      const [, init] = fetchSpy!.mock.calls[0] as [string, RequestInit]
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer oauth-access-token')
    })

    it('returns pending when OAuth not completed', async () => {
      setOAuthMode('linear', null)

      const result = await testConnectorConnection('linear', { authType: 'oauth' })

      expect(result).toEqual({
        ok: false,
        tested: false,
        message: 'Complete OAuth from the dashboard before testing this connector.',
      })
    })

    it('returns failure when missing API key in manual mode', async () => {
      const result = await testConnectorConnection('linear', {})

      expect(result).toEqual({ ok: false, tested: false, message: 'Missing API key' })
    })
  })

  describe('notion', () => {
    it('calls Notion REST API with API key in manual mode', async () => {
      fetchSpy = mockFetch({ status: 200 })

      const result = await testConnectorConnection('notion', { apiKey: 'ntn_test_key' })

      expect(result).toEqual({ ok: true, tested: true, message: 'Notion connection verified.' })
      expect(fetchSpy).toHaveBeenCalledOnce()
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://api.notion.com/v1/users/me')
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ntn_test_key')
      expect((init.headers as Record<string, string>)['Notion-Version']).toBe('2022-06-28')
    })

    it('connects via MCP in OAuth mode', async () => {
      setOAuthMode('notion')
      fetchSpy = mockFetch({ status: 200 })
      mcpServerUrlMocks.getConnectorMcpServerUrl.mockReturnValue('https://mcp.notion.com/mcp')

      const result = await testConnectorConnection('notion', oauthConfig({ provider: 'notion' }))

      expect(result).toEqual({ ok: true, tested: true, message: 'Notion MCP connection verified.' })
      const [url] = fetchSpy!.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://mcp.notion.com/mcp')
    })

    it('returns pending when OAuth not completed', async () => {
      setOAuthMode('notion', null)

      const result = await testConnectorConnection('notion', { authType: 'oauth' })

      expect(result).toEqual({
        ok: false,
        tested: false,
        message: 'Complete OAuth from the dashboard before testing this connector.',
      })
    })

    it('returns auth failure on 401 from Notion REST API', async () => {
      fetchSpy = mockFetch({ status: 401 })

      const result = await testConnectorConnection('notion', { apiKey: 'bad-key' })

      expect(result).toEqual({ ok: false, tested: true, message: 'Notion test failed (401)' })
    })

    it('returns auth failure on 403 from Notion REST API', async () => {
      fetchSpy = mockFetch({ status: 403 })

      const result = await testConnectorConnection('notion', { apiKey: 'bad-key' })

      expect(result).toEqual({ ok: false, tested: true, message: 'Notion test failed (403)' })
    })

    it('returns failure when missing OAuth access token', async () => {
      oauthConfigMocks.getConnectorAuthType.mockReturnValue('oauth')
      oauthConfigMocks.getConnectorOAuthConfig.mockReturnValue({
        provider: 'notion',
        accessToken: undefined,
        clientId: 'c',
        connectedAt: '2026-01-01',
      })

      const result = await testConnectorConnection('notion', { authType: 'oauth' })

      expect(result).toEqual({
        ok: false,
        tested: false,
        message: 'Complete OAuth from the dashboard before testing this connector.',
      })
    })
  })

  describe('custom', () => {
    it('connects via MCP in OAuth mode', async () => {
      setOAuthMode('custom')
      fetchSpy = mockFetch({ status: 200 })
      mcpServerUrlMocks.getConnectorMcpServerUrl.mockReturnValue('https://custom-mcp.example.com/mcp')

      const result = await testConnectorConnection('custom', oauthConfig({ provider: 'custom' }))

      expect(result).toEqual({ ok: true, tested: true, message: 'Custom MCP connection verified.' })
      const [url] = fetchSpy!.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://custom-mcp.example.com/mcp')
    })

    it('uses customEndpointUrl option over MCP server URL in OAuth mode', async () => {
      setOAuthMode('custom')
      fetchSpy = mockFetch({ status: 200 })
      mcpServerUrlMocks.getConnectorMcpServerUrl.mockReturnValue('https://default.example.com/mcp')

      const result = await testConnectorConnection(
        'custom',
        oauthConfig({ provider: 'custom' }),
        { customEndpointUrl: new URL('https://override.example.com/mcp') }
      )

      expect(result).toEqual({ ok: true, tested: true, message: 'Custom MCP connection verified.' })
      const [url] = fetchSpy!.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://override.example.com/mcp')
    })

    it('tests endpoint with GET in manual mode', async () => {
      fetchSpy = mockFetch({ status: 200 })

      const result = await testConnectorConnection('custom', { endpoint: 'https://api.example.com/health' })

      expect(result).toEqual({ ok: true, tested: true, message: 'Custom endpoint reachable.' })
      expect(fetchSpy).toHaveBeenCalledOnce()
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://api.example.com/health')
      expect(init.method).toBe('GET')
    })

    it('returns missing endpoint when not provided in manual mode', async () => {
      const result = await testConnectorConnection('custom', {})

      expect(result).toEqual({ ok: false, tested: false, message: 'Missing endpoint' })
    })

    it('returns missing endpoint for OAuth mode when no URL available', async () => {
      setOAuthMode('custom')
      mcpServerUrlMocks.getConnectorMcpServerUrl.mockReturnValue(null)

      const result = await testConnectorConnection('custom', oauthConfig({ provider: 'custom' }))

      expect(result).toEqual({ ok: false, tested: false, message: 'Missing endpoint' })
    })

    it('includes auth header when auth string is present in manual mode', async () => {
      fetchSpy = mockFetch({ status: 200 })

      const result = await testConnectorConnection('custom', {
        endpoint: 'https://api.example.com/health',
        auth: 'my-secret-token',
      })

      expect(result).toEqual({ ok: true, tested: true, message: 'Custom endpoint reachable.' })
      const [, init] = fetchSpy!.mock.calls[0] as [string, RequestInit]
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer my-secret-token')
    })

    it('omits auth header when auth is not a string in manual mode', async () => {
      fetchSpy = mockFetch({ status: 200 })

      await testConnectorConnection('custom', { endpoint: 'https://api.example.com/health' })

      const [, init] = fetchSpy!.mock.calls[0] as [string, RequestInit]
      expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
    })

    it('returns failure when manual endpoint test returns non-ok status', async () => {
      fetchSpy = mockFetch({ status: 503 })

      const result = await testConnectorConnection('custom', { endpoint: 'https://api.example.com/health' })

      expect(result).toEqual({ ok: false, tested: true, message: 'Custom endpoint test failed (503)' })
    })

    it('uses customEndpointUrl option for manual mode fetch', async () => {
      fetchSpy = mockFetch({ status: 200 })

      const result = await testConnectorConnection(
        'custom',
        { endpoint: 'https://api.example.com/health' },
        { customEndpointUrl: new URL('https://validated.example.com/health') }
      )

      expect(result).toEqual({ ok: true, tested: true, message: 'Custom endpoint reachable.' })
      const [url] = fetchSpy!.mock.calls[0] as [URL, RequestInit]
      expect(url.toString()).toBe('https://validated.example.com/health')
    })
  })

  describe('remote MCP connection', () => {
    it('sends MCP initialize request with correct headers', async () => {
      fetchSpy = mockFetch({ status: 200 })
      mcpServerUrlMocks.getConnectorMcpServerUrl.mockReturnValue('https://mcp.linear.app/mcp')

      await testConnectorConnection('linear', { apiKey: 'test-key' })

      const [, init] = fetchSpy!.mock.calls[0] as [string, RequestInit]
      const headers = init.headers as Record<string, string>
      expect(headers['Content-Type']).toBe('application/json')
      expect(headers.Accept).toBe('application/json, text/event-stream')
      expect(init.method).toBe('POST')

      const body = JSON.parse(init.body as string)
      expect(body.jsonrpc).toBe('2.0')
      expect(body.method).toBe('initialize')
      expect(body.params.protocolVersion).toBe('2025-03-26')
      expect(body.params.clientInfo.name).toBe('arche-web')
    })

    it('returns auth failure on 401', async () => {
      fetchSpy = mockFetch({ status: 401 })
      mcpServerUrlMocks.getConnectorMcpServerUrl.mockReturnValue('https://mcp.linear.app/mcp')

      const result = await testConnectorConnection('linear', { apiKey: 'bad-key' })

      expect(result).toEqual({
        ok: false,
        tested: true,
        message: 'Linear MCP authentication failed (401). Reconnect OAuth and retry.',
      })
    })

    it('returns auth failure on 403', async () => {
      fetchSpy = mockFetch({ status: 403 })
      mcpServerUrlMocks.getConnectorMcpServerUrl.mockReturnValue('https://mcp.linear.app/mcp')

      const result = await testConnectorConnection('linear', { apiKey: 'bad-key' })

      expect(result).toEqual({
        ok: false,
        tested: true,
        message: 'Linear MCP authentication failed (403). Reconnect OAuth and retry.',
      })
    })

    it('returns server error for non-auth failure', async () => {
      fetchSpy = mockFetch({ status: 500 })
      mcpServerUrlMocks.getConnectorMcpServerUrl.mockReturnValue('https://mcp.linear.app/mcp')

      const result = await testConnectorConnection('linear', { apiKey: 'key' })

      expect(result).toEqual({ ok: false, tested: true, message: 'Linear MCP test failed (500)' })
    })
  })

  describe('error handling', () => {
    it('catches thrown Error and returns tested: true', async () => {
      ahrefsMocks.parseAhrefsConnectorConfig.mockReturnValue({ ok: true, value: {} })
      ahrefsMocks.testAhrefsConnection.mockRejectedValue(new Error('Network timeout'))

      const result = await testConnectorConnection('ahrefs', {})

      expect(result).toEqual({ ok: false, tested: true, message: 'Network timeout' })
    })

    it('catches non-Error throw and returns generic message', async () => {
      ahrefsMocks.parseAhrefsConnectorConfig.mockReturnValue({ ok: true, value: {} })
      ahrefsMocks.testAhrefsConnection.mockRejectedValue('string error')

      const result = await testConnectorConnection('ahrefs', {})

      expect(result).toEqual({ ok: false, tested: true, message: 'Connection test failed' })
    })

    it('catches fetch errors in remote MCP path', async () => {
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
      mcpServerUrlMocks.getConnectorMcpServerUrl.mockReturnValue('https://mcp.linear.app/mcp')

      const result = await testConnectorConnection('linear', { apiKey: 'key' })

      expect(result).toEqual({ ok: false, tested: true, message: 'ECONNREFUSED' })
    })
  })
})
