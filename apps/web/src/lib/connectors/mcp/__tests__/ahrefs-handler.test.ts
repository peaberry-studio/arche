import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleAhrefsMcpRequest } from '@/lib/connectors/mcp/ahrefs-handler'

const ahrefsMocks = vi.hoisted(() => ({
  executeAhrefsMcpTool: vi.fn(),
  getAhrefsMcpProtocolVersion: vi.fn(),
  getAhrefsMcpTools: vi.fn(),
  parseAhrefsConnectorConfig: vi.fn(),
}))

vi.mock('@/lib/connectors/ahrefs', () => ({
  executeAhrefsMcpTool: ahrefsMocks.executeAhrefsMcpTool,
  getAhrefsMcpProtocolVersion: ahrefsMocks.getAhrefsMcpProtocolVersion,
  getAhrefsMcpTools: ahrefsMocks.getAhrefsMcpTools,
  parseAhrefsConnectorConfig: ahrefsMocks.parseAhrefsConnectorConfig,
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

describe('handleAhrefsMcpRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ahrefsMocks.parseAhrefsConnectorConfig.mockReturnValue({
      ok: true,
      value: {
        apiKey: 'ahrefs-api-key-123',
      },
    })
    ahrefsMocks.getAhrefsMcpProtocolVersion.mockReturnValue('2025-03-26')
    ahrefsMocks.getAhrefsMcpTools.mockReturnValue([{ name: 'get_domain_rating' }])
    ahrefsMocks.executeAhrefsMcpTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] })
  })

  it('returns initialize metadata for Ahrefs MCP clients', async () => {
    const response = await handleAhrefsMcpRequest(
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
          name: 'arche-ahrefs-connector',
          version: '0.1.0',
        },
      },
    })
  })

  it('delegates tool calls to the Ahrefs MCP tool executor', async () => {
    const response = await handleAhrefsMcpRequest(
      buildRequest({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'get_domain_rating',
          arguments: { target: 'example.com' },
        },
      }),
      {}
    )

    expect(ahrefsMocks.executeAhrefsMcpTool).toHaveBeenCalledWith(
      { apiKey: 'ahrefs-api-key-123' },
      'get_domain_rating',
      { target: 'example.com' }
    )
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      id: 7,
      result: { content: [{ type: 'text', text: 'ok' }] },
    })
  })

  it('returns a JSON-RPC error when the connector config is invalid', async () => {
    ahrefsMocks.parseAhrefsConnectorConfig.mockReturnValue({
      ok: false,
      message: 'Missing apiKey',
    })

    const response = await handleAhrefsMcpRequest(
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
    ahrefsMocks.parseAhrefsConnectorConfig.mockReturnValue({
      ok: false,
    })

    const response = await handleAhrefsMcpRequest(
      buildRequest({ jsonrpc: '2.0', id: 'req-3', method: 'initialize' }),
      {}
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32000,
        message: 'Invalid Ahrefs connector config',
      },
    })
  })

  it('lists tools', async () => {
    const response = await handleAhrefsMcpRequest(
      buildRequest({ jsonrpc: '2.0', id: 'req-4', method: 'tools/list' }),
      {}
    )

    expect(ahrefsMocks.getAhrefsMcpTools).toHaveBeenCalled()
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      id: 'req-4',
      result: {
        tools: [{ name: 'get_domain_rating' }],
      },
    })
  })

  it('rejects requests without a tool name', async () => {
    const response = await handleAhrefsMcpRequest(
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
