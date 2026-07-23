import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auditCreateEvent: vi.fn(),
  authenticatePat: vi.fn(),
  checkDbRateLimit: vi.fn(),
  getSettings: vi.fn(),
  handleMcpJsonRpcRequest: vi.fn(),
}))

vi.mock('@/lib/mcp/auth', () => ({ authenticatePat: mocks.authenticatePat }))
vi.mock('@/lib/mcp/server', () => ({
  getMcpRequestMetadata: () => ({ method: 'tools/list', toolName: null }),
  handleMcpJsonRpcRequest: mocks.handleMcpJsonRpcRequest,
}))
vi.mock('@/lib/services', () => ({
  auditService: { createEvent: mocks.auditCreateEvent },
  mcpSettingsService: { getSettings: mocks.getSettings },
  rateLimitService: { checkDbRateLimit: mocks.checkDbRateLimit },
}))

import { POST } from './route'

describe('POST /api/mcp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.checkDbRateLimit.mockResolvedValue({ allowed: true, remaining: 99, resetAt: Date.now() + 1000 })
    mocks.authenticatePat.mockResolvedValue({
      ok: true,
      tokenId: 'pat-1',
      scopes: ['kb:read'],
      user: { id: 'u1', email: 'alice@example.com', slug: 'alice', role: 'USER', mcpAllowed: true },
    })
    mocks.getSettings.mockResolvedValue({ enabled: true })
    mocks.handleMcpJsonRpcRequest.mockResolvedValue(Response.json({ jsonrpc: '2.0', id: 1, result: {} }))
  })

  it('rejects valid tokens when MCP is globally disabled', async () => {
    mocks.getSettings.mockResolvedValue({ enabled: false })

    const response = await POST(createRequest())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' })
    expect(mocks.auditCreateEvent).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'u1',
      action: 'mcp.request',
    }))
    expect(mocks.handleMcpJsonRpcRequest).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated MCP requests', async () => {
    mocks.authenticatePat.mockResolvedValue({ ok: false, status: 401 })

    const response = await POST(createRequest())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' })
    expect(mocks.auditCreateEvent).not.toHaveBeenCalled()
    expect(mocks.handleMcpJsonRpcRequest).not.toHaveBeenCalled()
  })

  it('rejects authenticated disallowed users and audits the request', async () => {
    mocks.authenticatePat.mockResolvedValue({
      ok: true,
      tokenId: 'pat-1',
      scopes: ['kb:read'],
      user: { id: 'u1', email: 'alice@example.com', slug: 'alice', role: 'USER', mcpAllowed: false },
    })

    const response = await POST(createRequest())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' })
    expect(mocks.auditCreateEvent).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'u1',
      action: 'mcp.request',
    }))
    expect(mocks.handleMcpJsonRpcRequest).not.toHaveBeenCalled()
  })

  it('enforces the pre-auth rate limit', async () => {
    mocks.checkDbRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: Date.now() + 5000 })

    const response = await POST(createRequest())

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({ error: 'rate_limited' })
    expect(mocks.authenticatePat).not.toHaveBeenCalled()
  })

  it('enforces the token rate limit', async () => {
    mocks.checkDbRateLimit
      .mockResolvedValueOnce({ allowed: true, remaining: 99, resetAt: Date.now() + 1000 })
      .mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: Date.now() + 5000 })

    const response = await POST(createRequest())

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({ error: 'rate_limited' })
    expect(mocks.auditCreateEvent).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'u1',
      action: 'mcp.request',
      metadata: expect.objectContaining({ tokenId: 'pat-1' }),
    }))
    expect(mocks.handleMcpJsonRpcRequest).not.toHaveBeenCalled()
  })

  it('audits authenticated batch requests before rejecting them', async () => {
    const response = await POST(createRequest({ body: [{ jsonrpc: '2.0', id: 1, method: 'tools/list' }] }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'batch_not_supported' })
    expect(mocks.auditCreateEvent).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'u1',
      action: 'mcp.request',
      metadata: expect.objectContaining({ tokenId: 'pat-1' }),
    }))
    expect(mocks.handleMcpJsonRpcRequest).not.toHaveBeenCalled()
  })

  it('rejects oversized requests before authentication', async () => {
    const response = await POST(createRequest({ headers: { 'content-length': String(1024 * 1024 + 1) } }))

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({ error: 'payload_too_large' })
    expect(mocks.authenticatePat).not.toHaveBeenCalled()
  })

  it('audits authenticated MCP requests', async () => {
    const response = await POST(createRequest())

    expect(response.status).toBe(200)
    expect(mocks.auditCreateEvent).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'u1',
      action: 'mcp.request',
      metadata: expect.objectContaining({ tokenId: 'pat-1' }),
    }))
  })
})

function createRequest(input: { body?: unknown; headers?: Record<string, string> } = {}): Request {
  return new Request('https://arche.example.com/api/mcp', {
    method: 'POST',
    headers: {
      authorization: 'Bearer arche_pat_secret',
      'content-type': 'application/json',
      'user-agent': 'vitest',
      ...input.headers,
    },
    body: JSON.stringify(input.body ?? { jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  })
}
