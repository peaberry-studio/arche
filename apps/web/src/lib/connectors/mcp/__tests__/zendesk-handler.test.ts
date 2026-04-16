import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleZendeskMcpRequest } from '@/lib/connectors/mcp/zendesk-handler'

const zendeskMocks = vi.hoisted(() => ({
  executeZendeskMcpTool: vi.fn(),
  getZendeskMcpProtocolVersion: vi.fn(),
  getZendeskMcpTools: vi.fn(),
  parseZendeskConnectorConfig: vi.fn(),
}))

vi.mock('@/lib/connectors/zendesk', () => ({
  executeZendeskMcpTool: zendeskMocks.executeZendeskMcpTool,
  getZendeskMcpProtocolVersion: zendeskMocks.getZendeskMcpProtocolVersion,
  getZendeskMcpTools: zendeskMocks.getZendeskMcpTools,
  parseZendeskConnectorConfig: zendeskMocks.parseZendeskConnectorConfig,
}))

function buildRequest(body: unknown, init?: RequestInit): Request {
  return new Request('https://arche.example.com/api/internal/mcp/connectors/connector-1/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    ...init,
  })
}

describe('handleZendeskMcpRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    zendeskMocks.parseZendeskConnectorConfig.mockReturnValue({
      ok: true,
      value: {
        subdomain: 'acme',
        email: 'agent@acme.com',
        apiToken: 'secret',
        permissions: {
          allowRead: true,
          allowCreateTickets: true,
          allowUpdateTickets: true,
          allowPublicComments: true,
          allowInternalComments: true,
        },
      },
    })
    zendeskMocks.getZendeskMcpProtocolVersion.mockReturnValue('2025-03-26')
    zendeskMocks.getZendeskMcpTools.mockReturnValue([{ name: 'search_tickets' }])
    zendeskMocks.executeZendeskMcpTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] })
  })

  it('returns initialize metadata for Zendesk MCP clients', async () => {
    const response = await handleZendeskMcpRequest(
      buildRequest({ jsonrpc: '2.0', id: 'req-1', method: 'initialize' }),
      {}
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      id: 'req-1',
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

  it('delegates tool calls to the Zendesk MCP tool executor', async () => {
    const response = await handleZendeskMcpRequest(
      buildRequest({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'search_tickets',
          arguments: { query: 'priority:urgent' },
        },
      }),
      {}
    )

    expect(zendeskMocks.executeZendeskMcpTool).toHaveBeenCalledWith(
      {
        subdomain: 'acme',
        email: 'agent@acme.com',
        apiToken: 'secret',
        permissions: {
          allowRead: true,
          allowCreateTickets: true,
          allowUpdateTickets: true,
          allowPublicComments: true,
          allowInternalComments: true,
        },
      },
      'search_tickets',
      { query: 'priority:urgent' }
    )
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      id: 7,
      result: { content: [{ type: 'text', text: 'ok' }] },
    })
  })

  it('returns a JSON-RPC error when the connector config is invalid', async () => {
    zendeskMocks.parseZendeskConnectorConfig.mockReturnValue({
      ok: false,
      message: 'Missing apiToken',
    })

    const response = await handleZendeskMcpRequest(
      buildRequest({ jsonrpc: '2.0', id: 'req-2', method: 'initialize' }),
      {}
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32000,
        message: 'Missing apiToken',
      },
    })
  })

  it('lists tools using the parsed connector permissions', async () => {
    const response = await handleZendeskMcpRequest(
      buildRequest({ jsonrpc: '2.0', id: 'req-4', method: 'tools/list' }),
      {}
    )

    expect(zendeskMocks.getZendeskMcpTools).toHaveBeenCalledWith({
      subdomain: 'acme',
      email: 'agent@acme.com',
      apiToken: 'secret',
      permissions: {
        allowRead: true,
        allowCreateTickets: true,
        allowUpdateTickets: true,
        allowPublicComments: true,
        allowInternalComments: true,
      },
    })
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      id: 'req-4',
      result: {
        tools: [{ name: 'search_tickets' }],
      },
    })
  })

  it('rejects requests without a tool name', async () => {
    const response = await handleZendeskMcpRequest(
      buildRequest({
        jsonrpc: '2.0',
        id: 'req-3',
        method: 'tools/call',
        params: {},
      }),
      {}
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      id: 'req-3',
      error: {
        code: -32602,
        message: 'tools/call requires a tool name',
      },
    })
  })
})
