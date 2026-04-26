import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const routeMocks = vi.hoisted(() => ({
  decryptConfig: vi.fn(),
  verifyConnectorGatewayToken: vi.fn(),
  refreshConnectorOAuthConfigIfNeeded: vi.fn(),
  handleAhrefsMcpRequest: vi.fn(),
  handleUmamiMcpRequest: vi.fn(),
  handleZendeskMcpRequest: vi.fn(),
  handleMetaAdsMcpRequest: vi.fn(),
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

vi.mock('@/lib/connectors/mcp/ahrefs-handler', () => ({
  handleAhrefsMcpRequest: routeMocks.handleAhrefsMcpRequest,
}))

vi.mock('@/lib/connectors/mcp/umami-handler', () => ({
  handleUmamiMcpRequest: routeMocks.handleUmamiMcpRequest,
}))

vi.mock('@/lib/connectors/mcp/zendesk-handler', () => ({
  handleZendeskMcpRequest: routeMocks.handleZendeskMcpRequest,
}))

vi.mock('@/lib/connectors/mcp/meta-ads-handler', () => ({
  handleMetaAdsMcpRequest: routeMocks.handleMetaAdsMcpRequest,
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
    routeMocks.handleAhrefsMcpRequest.mockResolvedValue(Response.json({ ok: true }))
    routeMocks.handleUmamiMcpRequest.mockResolvedValue(Response.json({ ok: true }))
    routeMocks.handleMetaAdsMcpRequest.mockResolvedValue(Response.json({ ok: true }))
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

  it('dispatches Umami connectors to the embedded handler', async () => {
    routeMocks.connectorService.findEnabledByIdAndUserId.mockResolvedValue({
      id: 'connector-1',
      userId: 'user-1',
      type: 'umami',
      config: 'encrypted-config',
      enabled: true,
    })
    routeMocks.decryptConfig.mockReturnValue({
      authMethod: 'api-key',
      baseUrl: 'https://api.umami.is/v1',
      apiKey: 'secret',
    })

    const { POST } = await import('./route')

    const response = await POST(buildRequest({ Authorization: 'Bearer gateway-token' }), buildContext())

    expect(response.status).toBe(200)
    expect(routeMocks.handleUmamiMcpRequest).toHaveBeenCalledOnce()
    expect(routeMocks.handleUmamiMcpRequest).toHaveBeenCalledWith(expect.any(NextRequest), {
      authMethod: 'api-key',
      baseUrl: 'https://api.umami.is/v1',
      apiKey: 'secret',
    })
    expect(routeMocks.handleZendeskMcpRequest).not.toHaveBeenCalled()
    expect(routeMocks.proxyConnectorMcpRequest).not.toHaveBeenCalled()
  })

  it('dispatches Ahrefs connectors to the embedded handler', async () => {
    routeMocks.connectorService.findEnabledByIdAndUserId.mockResolvedValue({
      id: 'connector-1',
      userId: 'user-1',
      type: 'ahrefs',
      config: 'encrypted-config',
      enabled: true,
    })
    routeMocks.decryptConfig.mockReturnValue({
      apiKey: 'ahrefs-secret',
    })

    const { POST } = await import('./route')

    const response = await POST(buildRequest({ Authorization: 'Bearer gateway-token' }), buildContext())

    expect(response.status).toBe(200)
    expect(routeMocks.handleAhrefsMcpRequest).toHaveBeenCalledOnce()
    expect(routeMocks.handleAhrefsMcpRequest).toHaveBeenCalledWith(expect.any(NextRequest), {
      apiKey: 'ahrefs-secret',
    })
    expect(routeMocks.handleZendeskMcpRequest).not.toHaveBeenCalled()
    expect(routeMocks.handleUmamiMcpRequest).not.toHaveBeenCalled()
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

  it('dispatches Meta Ads connectors to the embedded handler', async () => {
    routeMocks.connectorService.findEnabledByIdAndUserId.mockResolvedValue({
      id: 'connector-1',
      userId: 'user-1',
      type: 'meta-ads',
      config: 'encrypted-config',
      enabled: true,
    })
    routeMocks.decryptConfig.mockReturnValue({
      authType: 'oauth',
      appId: 'meta-app-id',
      appSecret: 'meta-app-secret',
      selectedAdAccountIds: ['act_123'],
      oauth: {
        provider: 'meta-ads',
        accessToken: 'meta-token',
        clientId: 'meta-app-id',
      },
    })

    const { POST } = await import('./route')
    const response = await POST(buildRequest({ Authorization: 'Bearer gateway-token' }), buildContext())

    expect(response.status).toBe(200)
    expect(routeMocks.handleMetaAdsMcpRequest).toHaveBeenCalledWith(expect.any(NextRequest), {
      authType: 'oauth',
      appId: 'meta-app-id',
      appSecret: 'meta-app-secret',
      selectedAdAccountIds: ['act_123'],
      oauth: {
        provider: 'meta-ads',
        accessToken: 'meta-token',
        clientId: 'meta-app-id',
      },
    })
    expect(routeMocks.proxyConnectorMcpRequest).not.toHaveBeenCalled()
  })
})
