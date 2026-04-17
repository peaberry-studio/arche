import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockAuthenticatePat = vi.fn()
vi.mock('@/lib/mcp/auth', () => ({
  authenticatePat: (request: Request) => mockAuthenticatePat(request),
}))

const mockReadMcpSettings = vi.fn()
vi.mock('@/lib/mcp/settings', () => ({
  readMcpSettings: (...args: unknown[]) => mockReadMcpSettings(...args),
}))

const mockCheckRateLimit = vi.fn()
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}))

const mockCreateEvent = vi.fn()
vi.mock('@/lib/services', () => ({
  auditService: {
    createEvent: (...args: unknown[]) => mockCreateEvent(...args),
  },
}))

const mockGetClientIp = vi.fn(() => '127.0.0.1')
vi.mock('@/lib/http', () => ({
  getClientIp: (...args: unknown[]) => mockGetClientIp(...args),
}))

const mockConnect = vi.fn()
const mockCreateMcpServer = vi.fn(() => ({ connect: mockConnect }))
vi.mock('@/lib/mcp/server', () => ({
  createMcpServer: (...args: unknown[]) => mockCreateMcpServer(...args),
}))

const mockHandleRequest = vi.fn()
const mockTransport = { handleRequest: mockHandleRequest }
const mockTransportConstructor = vi.fn(() => mockTransport)
vi.mock('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js', () => ({
  WebStandardStreamableHTTPServerTransport: mockTransportConstructor,
}))

function makeRequest(body: unknown, headers?: Record<string, string>): Request {
  return new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(headers ?? {}),
    },
    body: JSON.stringify(body),
  })
}

describe('POST /api/mcp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadMcpSettings.mockResolvedValue({
      ok: true,
      enabled: true,
      hash: 'hash-1',
    })
    mockAuthenticatePat.mockResolvedValue({
      ok: true,
      scopes: ['kb:read', 'kb:write', 'agents:read', 'tasks:run'],
      tokenId: 'tok-1',
      user: { id: 'u1', email: 'a@b.com', slug: 'alice', role: 'USER' },
    })
    mockCheckRateLimit.mockReturnValue({
      allowed: true,
      remaining: 99,
      resetAt: Date.now() + 60000,
    })
    mockHandleRequest.mockResolvedValue(new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
  })

  it('returns 401 when MCP is globally disabled', async () => {
    mockReadMcpSettings.mockResolvedValue({
      ok: true,
      enabled: false,
      hash: 'hash-1',
    })

    const { POST } = await import('./route')
    const response = await POST(makeRequest({ jsonrpc: '2.0' }))

    expect(response.status).toBe(401)
    expect(mockAuthenticatePat).not.toHaveBeenCalled()
  })

  it('returns 503 when MCP settings cannot be read', async () => {
    mockReadMcpSettings.mockResolvedValue({
      ok: false,
      enabled: false,
      error: 'kb_unavailable',
    })

    const { POST } = await import('./route')
    const response = await POST(makeRequest({ jsonrpc: '2.0' }))

    expect(response.status).toBe(503)
    expect(mockAuthenticatePat).not.toHaveBeenCalled()
  })

  it('returns 401 when PAT authentication fails', async () => {
    mockAuthenticatePat.mockResolvedValue({ ok: false, status: 401 })

    const { POST } = await import('./route')
    const response = await POST(makeRequest({ jsonrpc: '2.0' }))

    expect(response.status).toBe(401)
    expect(mockTransportConstructor).not.toHaveBeenCalled()
  })

  it('applies pre-auth rate limiting before PAT authentication', async () => {
    mockCheckRateLimit.mockReturnValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 2500,
    })

    const { POST } = await import('./route')
    const response = await POST(makeRequest({ jsonrpc: '2.0' }))

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('3')
    expect(mockAuthenticatePat).not.toHaveBeenCalled()
    expect(mockTransportConstructor).not.toHaveBeenCalled()
  })

  it('returns 429 when the token is rate limited', async () => {
    mockCheckRateLimit
      .mockReturnValueOnce({
        allowed: true,
        remaining: 299,
        resetAt: Date.now() + 60000,
      })
      .mockReturnValueOnce({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 4500,
      })

    const { POST } = await import('./route')
    const response = await POST(makeRequest({ jsonrpc: '2.0' }))

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('5')
    expect(mockAuthenticatePat).toHaveBeenCalledTimes(1)
    expect(mockTransportConstructor).not.toHaveBeenCalled()
  })

  it('returns 413 when the request body exceeds the configured size limit', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      makeRequest(
        { jsonrpc: '2.0' },
        {
          authorization: 'Bearer arche_pat_abc',
          'content-length': String(128 * 1024),
        }
      )
    )

    expect(response.status).toBe(413)
    expect(mockAuthenticatePat).not.toHaveBeenCalled()
  })

  it('connects the server, forwards the parsed request body to the transport, and audits tool calls', async () => {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'search_kb',
        arguments: { query: 'pricing' },
      },
    }

    const { POST } = await import('./route')
    const response = await POST(makeRequest(body, { authorization: 'Bearer arche_pat_abc' }))

    expect(response.status).toBe(200)
    expect(mockTransportConstructor).toHaveBeenCalledWith({
      enableJsonResponse: true,
      sessionIdGenerator: undefined,
    })
    expect(mockCreateMcpServer).toHaveBeenCalledWith({
      scopes: ['kb:read', 'kb:write', 'agents:read', 'tasks:run'],
      user: { id: 'u1', email: 'a@b.com', slug: 'alice', role: 'USER' },
    })
    expect(mockConnect).toHaveBeenCalledWith(mockTransport)
    expect(mockHandleRequest).toHaveBeenCalledWith(expect.any(Request), { parsedBody: body })
    const forwardedRequest = mockHandleRequest.mock.calls[0]?.[0]
    expect(forwardedRequest.headers.get('accept')).toContain('application/json')
    expect(forwardedRequest.headers.get('accept')).toContain('text/event-stream')
    expect(mockCreateEvent).toHaveBeenCalledWith({
      actorUserId: 'u1',
      action: 'mcp.request',
      metadata: {
        ip: '127.0.0.1',
        method: 'tools/call',
        tokenId: 'tok-1',
        toolName: 'search_kb',
      },
    })
  })

  it('preserves a client accept header that already advertises both supported media types', async () => {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'codex', version: '0.1.0' },
      },
    }

    const { POST } = await import('./route')
    await POST(
      makeRequest(body, {
        authorization: 'Bearer arche_pat_abc',
        accept: 'application/json, text/event-stream',
      })
    )

    const forwardedRequest = mockHandleRequest.mock.calls[0]?.[0]
    expect(forwardedRequest.headers.get('accept')).toBe('application/json, text/event-stream')
  })

  it('short-circuits notifications/initialized with an explicit content type', async () => {
    const body = {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    }

    const { POST } = await import('./route')
    const response = await POST(
      makeRequest(body, {
        authorization: 'Bearer arche_pat_abc',
        accept: 'application/json, text/event-stream',
      })
    )

    expect(response.status).toBe(202)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(mockTransportConstructor).not.toHaveBeenCalled()
  })
})
