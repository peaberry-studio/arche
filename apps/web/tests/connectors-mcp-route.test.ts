import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockDecryptConfig = vi.fn()
vi.mock('@/lib/connectors/crypto', () => ({
  decryptConfig: (...args: unknown[]) => mockDecryptConfig(...args),
}))

const mockVerifyConnectorGatewayToken = vi.fn()
vi.mock('@/lib/connectors/gateway-tokens', () => ({
  verifyConnectorGatewayToken: (...args: unknown[]) => mockVerifyConnectorGatewayToken(...args),
}))

const mockRefreshConnectorOAuthConfigIfNeeded = vi.fn()
vi.mock('@/lib/connectors/oauth-refresh', () => ({
  refreshConnectorOAuthConfigIfNeeded: (...args: unknown[]) =>
    mockRefreshConnectorOAuthConfigIfNeeded(...args),
}))

const mockFindEnabledByIdAndUserId = vi.fn()
vi.mock('@/lib/services', () => ({
  connectorService: {
    findEnabledByIdAndUserId: (...args: unknown[]) => mockFindEnabledByIdAndUserId(...args),
  },
}))

async function callMcpRoute(input: {
  method?: 'GET' | 'POST'
  connectorId?: string
  body?: unknown
}) {
  const method = input.method ?? 'POST'
  const connectorId = input.connectorId ?? 'conn-zendesk-1'
  const { GET, POST } = await import('@/app/api/internal/mcp/connectors/[id]/mcp/route')

  const request = new Request(`http://localhost/api/internal/mcp/connectors/${connectorId}/mcp`, {
    method,
    headers: {
      authorization: 'Bearer gateway-token',
      ...(input.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
  })

  const route = method === 'GET' ? GET : POST
  const response = await route(request as never, { params: Promise.resolve({ id: connectorId }) })

  const text = await response.text()
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  }
}

describe('internal connector MCP route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    mockVerifyConnectorGatewayToken.mockReturnValue({
      connectorId: 'conn-zendesk-1',
      userId: 'user-1',
      workspaceSlug: 'alice',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
    mockFindEnabledByIdAndUserId.mockResolvedValue({
      id: 'conn-zendesk-1',
      type: 'zendesk',
      config: 'encrypted-config',
      userId: 'user-1',
    })
    mockRefreshConnectorOAuthConfigIfNeeded.mockResolvedValue(null)
    mockDecryptConfig.mockReturnValue({
      subdomain: 'acme',
      email: 'agent@example.com',
      apiToken: 'token-123',
      permissions: {
        allowRead: true,
        allowCreateTickets: true,
        allowUpdateTickets: true,
        allowPublicComments: true,
        allowInternalComments: true,
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('initializes the Zendesk MCP server', async () => {
    const { status, body } = await callMcpRoute({
      body: {
        jsonrpc: '2.0',
        id: '1',
        method: 'initialize',
        params: { protocolVersion: '2025-03-26' },
      },
    })

    expect(status).toBe(200)
    expect(body).toEqual({
      jsonrpc: '2.0',
      id: '1',
      result: {
        protocolVersion: '2025-03-26',
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
        serverInfo: {
          name: 'arche-zendesk-connector',
          version: '0.1.0',
        },
      },
    })
  })

  it('lists Zendesk tools', async () => {
    const { status, body } = await callMcpRoute({
      body: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      },
    })

    expect(status).toBe(200)
    expect(body.jsonrpc).toBe('2.0')
    expect(body.id).toBe(2)
    expect(body.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'search_tickets',
      'get_ticket',
      'list_ticket_comments',
      'create_ticket',
      'update_ticket',
    ])
  })

  it('hides disabled write tools from tools/list', async () => {
    mockDecryptConfig.mockReturnValueOnce({
      subdomain: 'acme',
      email: 'agent@example.com',
      apiToken: 'token-123',
      permissions: {
        allowRead: true,
        allowCreateTickets: false,
        allowUpdateTickets: true,
        allowPublicComments: false,
        allowInternalComments: true,
      },
    })

    const { status, body } = await callMcpRoute({
      body: {
        jsonrpc: '2.0',
        id: 'tools-list-2',
        method: 'tools/list',
      },
    })

    expect(status).toBe(200)
    expect(body.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'search_tickets',
      'get_ticket',
      'list_ticket_comments',
      'update_ticket',
    ])
  })

  it('executes Zendesk tools through JSON-RPC', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ticket: { id: 42, subject: 'Hello', status: 'open' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    )

    const { status, body } = await callMcpRoute({
      body: {
        jsonrpc: '2.0',
        id: 'tool-call-1',
        method: 'tools/call',
        params: {
          name: 'get_ticket',
          arguments: { ticketId: 42 },
        },
      },
    })

    expect(status).toBe(200)
    expect(body.jsonrpc).toBe('2.0')
    expect(body.id).toBe('tool-call-1')

    const text = body.result.content[0].text as string
    expect(JSON.parse(text)).toEqual({
      ok: true,
      ticket: {
        id: 42,
        subject: 'Hello',
        status: 'open',
        priority: null,
        type: null,
        requesterId: null,
        assigneeId: null,
        organizationId: null,
        createdAt: null,
        updatedAt: null,
        tags: [],
        url: 'https://acme.zendesk.com/agent/tickets/42',
      },
    })
  })

  it('acknowledges JSON-RPC notifications without a response body', async () => {
    const { status, body } = await callMcpRoute({
      body: {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      },
    })

    expect(status).toBe(204)
    expect(body).toBeNull()
  })

  it('uses the connector email as the ticket requester', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ticket: { id: 84, subject: 'Need help', status: 'new' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const { status } = await callMcpRoute({
      body: {
        jsonrpc: '2.0',
        id: 'tool-call-2',
        method: 'tools/call',
        params: {
          name: 'create_ticket',
          arguments: {
            subject: 'Need help',
            comment: 'The issue is still happening.',
            requesterEmail: 'external@example.com',
            requesterName: 'External User',
          },
        },
      },
    })

    expect(status).toBe(200)

    const [, requestInit] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(JSON.parse(String(requestInit.body))).toEqual({
      ticket: {
        subject: 'Need help',
        comment: {
          body: 'The issue is still happening.',
          public: true,
        },
        requester: {
          email: 'agent@example.com',
        },
      },
    })
  })

  it('rejects invalid boolean tool arguments instead of coercing them', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { status, body } = await callMcpRoute({
      body: {
        jsonrpc: '2.0',
        id: 'tool-call-3',
        method: 'tools/call',
        params: {
          name: 'update_ticket',
          arguments: {
            ticketId: 42,
            comment: 'Internal note',
            publicComment: 'false',
          },
        },
      },
    })

    expect(status).toBe(200)
    expect(JSON.parse(body.result.content[0].text)).toEqual({
      ok: false,
      error: 'invalid_arguments',
      message: 'publicComment must be a boolean',
    })
    expect(body.result.isError).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects public comments when the connector forbids them', async () => {
    mockDecryptConfig.mockReturnValueOnce({
      subdomain: 'acme',
      email: 'agent@example.com',
      apiToken: 'token-123',
      permissions: {
        allowRead: true,
        allowCreateTickets: true,
        allowUpdateTickets: true,
        allowPublicComments: false,
        allowInternalComments: true,
      },
    })

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { status, body } = await callMcpRoute({
      body: {
        jsonrpc: '2.0',
        id: 'tool-call-5',
        method: 'tools/call',
        params: {
          name: 'update_ticket',
          arguments: {
            ticketId: 42,
            comment: 'This will notify the requester',
          },
        },
      },
    })

    expect(status).toBe(200)
    expect(JSON.parse(body.result.content[0].text)).toEqual({
      ok: false,
      error: 'operation_not_allowed',
      message: 'Public comments are disabled for this Zendesk connector',
    })
    expect(body.result.isError).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects update_ticket calls without any ticket changes', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { status, body } = await callMcpRoute({
      body: {
        jsonrpc: '2.0',
        id: 'tool-call-4',
        method: 'tools/call',
        params: {
          name: 'update_ticket',
          arguments: {
            ticketId: 42,
          },
        },
      },
    })

    expect(status).toBe(200)
    expect(JSON.parse(body.result.content[0].text)).toEqual({
      ok: false,
      error: 'invalid_arguments',
      message: 'At least one ticket field or comment must be provided',
    })
    expect(body.result.isError).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
