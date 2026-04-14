import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const routeMocks = vi.hoisted(() => ({
  decryptConfig: vi.fn(),
  verifyConnectorGatewayToken: vi.fn(),
  refreshConnectorOAuthConfigIfNeeded: vi.fn(),
  handleZendeskMcpRequest: vi.fn(),
  proxyConnectorMcpRequest: vi.fn(),
  connectorService: {
    findEnabledByIdAndUserId: vi.fn(),
  },
}))

vi.mock('@/lib/connectors/crypto', () => ({
  decryptConfig: routeMocks.decryptConfig,
}))

vi.mock('@/lib/connectors/gateway-tokens', () => ({
  verifyConnectorGatewayToken: routeMocks.verifyConnectorGatewayToken,
}))

vi.mock('@/lib/connectors/mcp/remote-proxy', () => ({
  proxyConnectorMcpRequest: routeMocks.proxyConnectorMcpRequest,
}))

vi.mock('@/lib/connectors/mcp/zendesk-handler', () => ({
  handleZendeskMcpRequest: routeMocks.handleZendeskMcpRequest,
}))

vi.mock('@/lib/connectors/oauth-refresh', () => ({
  refreshConnectorOAuthConfigIfNeeded: routeMocks.refreshConnectorOAuthConfigIfNeeded,
}))

vi.mock('@/lib/services', () => ({
  connectorService: routeMocks.connectorService,
}))

function buildRequest(headers?: HeadersInit): NextRequest {
  return new NextRequest('https://arche.example.com/api/internal/mcp/connectors/connector-1/mcp', {
    method: 'POST',
    headers,
  })
}

function buildContext() {
  return {
    params: Promise.resolve({ id: 'connector-1' }),
  }
}

describe('POST /api/internal/mcp/connectors/[id]/mcp', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    routeMocks.verifyConnectorGatewayToken.mockReturnValue({
      connectorId: 'connector-1',
      userId: 'user-1',
      workspaceSlug: 'alice',
    })
    routeMocks.connectorService.findEnabledByIdAndUserId.mockResolvedValue({
      id: 'connector-1',
      userId: 'user-1',
      type: 'zendesk',
      config: 'encrypted-config',
      enabled: true,
    })
    routeMocks.refreshConnectorOAuthConfigIfNeeded.mockResolvedValue(null)
    routeMocks.decryptConfig.mockReturnValue({
      subdomain: 'acme',
      email: 'agent@acme.com',
      apiToken: 'secret',
    })
    routeMocks.handleZendeskMcpRequest.mockResolvedValue(Response.json({ ok: true }))
    routeMocks.proxyConnectorMcpRequest.mockResolvedValue(Response.json({ ok: true }))
  })

  it('rejects requests without a gateway token', async () => {
    const { POST } = await import('./route')

    const response = await POST(buildRequest(), buildContext())

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'unauthorized' })
  })

  it('dispatches Zendesk connectors to the embedded handler', async () => {
    const { POST } = await import('./route')

    const response = await POST(buildRequest({ Authorization: 'Bearer gateway-token' }), buildContext())

    expect(response.status).toBe(200)
    expect(routeMocks.handleZendeskMcpRequest).toHaveBeenCalledOnce()
    expect(routeMocks.handleZendeskMcpRequest).toHaveBeenCalledWith(expect.any(NextRequest), {
      subdomain: 'acme',
      email: 'agent@acme.com',
      apiToken: 'secret',
    })
    expect(routeMocks.proxyConnectorMcpRequest).not.toHaveBeenCalled()
  })

  it('dispatches OAuth connectors through the shared remote proxy', async () => {
    routeMocks.connectorService.findEnabledByIdAndUserId.mockResolvedValue({
      id: 'connector-1',
      userId: 'user-1',
      type: 'linear',
      config: 'encrypted-config',
      enabled: true,
    })
    routeMocks.decryptConfig.mockReturnValue({
      authType: 'oauth',
      oauth: {
        provider: 'linear',
        accessToken: 'oauth-token',
        clientId: 'client-1',
      },
    })

    const { POST } = await import('./route')
    const response = await POST(buildRequest({ Authorization: 'Bearer gateway-token' }), buildContext())

    expect(response.status).toBe(200)
    expect(routeMocks.proxyConnectorMcpRequest).toHaveBeenCalledWith({
      request: expect.any(NextRequest),
      type: 'linear',
      config: {
        authType: 'oauth',
        oauth: {
          provider: 'linear',
          accessToken: 'oauth-token',
          clientId: 'client-1',
        },
      },
      accessToken: 'oauth-token',
    })
    expect(routeMocks.handleZendeskMcpRequest).not.toHaveBeenCalled()
  })
})
