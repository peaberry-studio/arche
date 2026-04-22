import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleUmamiMcpRequest } from '@/lib/connectors/mcp/umami-handler'

const umamiMocks = vi.hoisted(() => ({
  executeUmamiMcpTool: vi.fn(),
  getUmamiMcpProtocolVersion: vi.fn(),
  getUmamiMcpTools: vi.fn(),
  parseUmamiConnectorConfig: vi.fn(),
}))

vi.mock('@/lib/connectors/umami', () => ({
  executeUmamiMcpTool: umamiMocks.executeUmamiMcpTool,
  getUmamiMcpProtocolVersion: umamiMocks.getUmamiMcpProtocolVersion,
  getUmamiMcpTools: umamiMocks.getUmamiMcpTools,
  parseUmamiConnectorConfig: umamiMocks.parseUmamiConnectorConfig,
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

describe('handleUmamiMcpRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    umamiMocks.parseUmamiConnectorConfig.mockReturnValue({
      ok: true,
      value: {
        authMethod: 'api-key',
        baseUrl: 'https://api.umami.is/v1',
        apiKey: 'api-key-123',
      },
    })
    umamiMocks.getUmamiMcpProtocolVersion.mockReturnValue('2025-03-26')
    umamiMocks.getUmamiMcpTools.mockReturnValue([{ name: 'list_websites' }])
    umamiMocks.executeUmamiMcpTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] })
  })

  it('returns initialize metadata for Umami MCP clients', async () => {
    const response = await handleUmamiMcpRequest(
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
          name: 'arche-umami-connector',
          version: '0.1.0',
        },
      },
    })
  })

  it('delegates tool calls to the Umami MCP executor', async () => {
    const response = await handleUmamiMcpRequest(
      buildRequest({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'list_websites',
          arguments: { pageSize: 5 },
        },
      }),
      {}
    )

    expect(umamiMocks.executeUmamiMcpTool).toHaveBeenCalledWith(
      {
        authMethod: 'api-key',
        baseUrl: 'https://api.umami.is/v1',
        apiKey: 'api-key-123',
      },
      'list_websites',
      { pageSize: 5 }
    )
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      id: 7,
      result: { content: [{ type: 'text', text: 'ok' }] },
    })
  })

  it('returns a JSON-RPC error when the connector config is invalid', async () => {
    umamiMocks.parseUmamiConnectorConfig.mockReturnValue({
      ok: false,
      message: 'Missing apiKey',
    })

    const response = await handleUmamiMcpRequest(
      buildRequest({ jsonrpc: '2.0', id: 'req-2', method: 'initialize' }),
      {}
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32000,
        message: 'Missing apiKey',
      },
    })
  })

  it('falls back to a generic invalid config message when no details are available', async () => {
    umamiMocks.parseUmamiConnectorConfig.mockReturnValue({
      ok: false,
    })

    const response = await handleUmamiMcpRequest(
      buildRequest({ jsonrpc: '2.0', id: 'req-3', method: 'initialize' }),
      {}
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32000,
        message: 'Invalid Umami connector config',
      },
    })
  })
})
