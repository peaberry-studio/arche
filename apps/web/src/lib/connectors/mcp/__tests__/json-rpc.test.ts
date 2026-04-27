import { describe, expect, it, vi } from 'vitest'

import {
  handleEmbeddedConnectorMcpRequest,
  type ParsedEmbeddedConnectorConfig,
} from '@/lib/connectors/mcp/json-rpc'

type FakeConfig = { apiKey: string }

function parseConfig(config: Record<string, unknown>): ParsedEmbeddedConnectorConfig<FakeConfig> {
  if (typeof config.apiKey === 'string') {
    return { ok: true, value: { apiKey: config.apiKey } }
  }

  return { ok: false, missing: ['apiKey'] }
}

const serverInfo = { name: 'test-connector', version: '1.0.0' }
const protocolVersion = '2024-11-05'
const tools = [{ name: 'search', description: 'Search things', inputSchema: { type: 'object' } }]
const getTools = () => tools
const executeTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'result' }] }))

function makeJsonRpcRequest(method: string, params?: unknown, id: unknown = 1): Request {
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  })
}

function callHandler(request: Request, configOverride?: Record<string, unknown>) {
  return handleEmbeddedConnectorMcpRequest({
    request,
    decryptedConfig: configOverride ?? { apiKey: 'sk-test' },
    connectorLabel: 'Test',
    serverInfo,
    protocolVersion,
    parseConfig,
    getTools,
    executeTool,
  })
}

describe('handleEmbeddedConnectorMcpRequest', () => {
  it('returns 405 for non-POST requests', async () => {
    const request = new Request('http://localhost/mcp', { method: 'GET' })
    const res = await callHandler(request)

    expect(res.status).toBe(405)
    expect(res.headers.get('Allow')).toBe('POST')
    expect(await res.json()).toEqual({ error: 'method_not_allowed' })
  })

  it('returns server error when config parsing fails', async () => {
    const request = makeJsonRpcRequest('initialize')
    const res = await callHandler(request, { wrongKey: 'value' })
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.error.code).toBe(-32000)
    expect(json.error.message).toContain('Invalid Test connector config')
    expect(json.error.message).toContain('apiKey')
  })

  it('returns config error message when provided', async () => {
    const badParseConfig = (): ParsedEmbeddedConnectorConfig<FakeConfig> => ({
      ok: false,
      message: 'Custom error message',
    })
    const request = makeJsonRpcRequest('initialize')
    const res = await handleEmbeddedConnectorMcpRequest({
      request,
      decryptedConfig: {},
      connectorLabel: 'Test',
      serverInfo,
      protocolVersion,
      parseConfig: badParseConfig,
      getTools,
      executeTool,
    })
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.error.message).toBe('Custom error message')
  })

  it('returns generic config error when no message or missing fields are provided', async () => {
    const emptyParseConfig = (): ParsedEmbeddedConnectorConfig<FakeConfig> => ({
      ok: false,
    })
    const request = makeJsonRpcRequest('initialize')
    const res = await handleEmbeddedConnectorMcpRequest({
      request,
      decryptedConfig: {},
      connectorLabel: 'Acme',
      serverInfo,
      protocolVersion,
      parseConfig: emptyParseConfig,
      getTools,
      executeTool,
    })
    const json = await res.json()

    expect(json.error.message).toBe('Invalid Acme connector config')
  })

  it('filters blank entries from missing fields in config errors', async () => {
    const sparseParseConfig = (): ParsedEmbeddedConnectorConfig<FakeConfig> => ({
      ok: false,
      missing: ['field1', '', '  ', 'field2'],
    })
    const request = makeJsonRpcRequest('initialize')
    const res = await handleEmbeddedConnectorMcpRequest({
      request,
      decryptedConfig: {},
      connectorLabel: 'Test',
      serverInfo,
      protocolVersion,
      parseConfig: sparseParseConfig,
      getTools,
      executeTool,
    })
    const json = await res.json()

    expect(json.error.message).toBe('Invalid Test connector config: field1, field2')
  })

  it('returns parse error for invalid JSON', async () => {
    const request = new Request('http://localhost/mcp', {
      method: 'POST',
      body: 'not json',
    })
    const res = await callHandler(request)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error.code).toBe(-32700)
    expect(json.error.message).toBe('Invalid JSON payload')
  })

  it('returns invalid request for non-object body', async () => {
    const request = new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([1, 2, 3]),
    })
    const res = await callHandler(request)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error.code).toBe(-32600)
  })

  it('returns invalid request when jsonrpc is not 2.0', async () => {
    const request = new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '1.0', method: 'initialize', id: 1 }),
    })
    const res = await callHandler(request)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error.code).toBe(-32600)
  })

  it('returns invalid request when method is missing', async () => {
    const request = new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1 }),
    })
    const res = await callHandler(request)
    const json = await res.json()

    expect(json.error.code).toBe(-32600)
  })

  it('returns invalid request for malformed ids and blank methods', async () => {
    const request = new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: { nested: true }, method: ' ' }),
    })
    const res = await callHandler(request)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.id).toBeNull()
    expect(json.error.code).toBe(-32600)
  })

  it('returns 204 for notifications', async () => {
    const request = new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    })
    const res = await callHandler(request)

    expect(res.status).toBe(204)
    expect(res.body).toBeNull()
  })

  it('handles initialize method', async () => {
    const res = await callHandler(makeJsonRpcRequest('initialize'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.result.protocolVersion).toBe(protocolVersion)
    expect(json.result.serverInfo).toEqual(serverInfo)
    expect(json.result.capabilities.tools.listChanged).toBe(false)
    expect(json.id).toBe(1)
  })

  it.each([
    ['ping', {}],
    ['resources/list', { resources: [] }],
    ['resources/templates/list', { resourceTemplates: [] }],
    ['prompts/list', { prompts: [] }],
  ])('handles %s requests', async (method, result) => {
    const res = await callHandler(makeJsonRpcRequest(method, undefined, 'req-1'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ jsonrpc: '2.0', id: 'req-1', result })
  })

  it('handles tools/list method', async () => {
    const res = await callHandler(makeJsonRpcRequest('tools/list'))
    const json = await res.json()

    expect(json.result.tools).toEqual(tools)
  })

  it('handles tools/call with valid tool name', async () => {
    executeTool.mockResolvedValueOnce({ content: [{ type: 'text', text: 'hello' }] })
    const res = await callHandler(
      makeJsonRpcRequest('tools/call', { name: 'search', arguments: { query: 'test' } }),
    )
    const json = await res.json()

    expect(json.result.content[0].text).toBe('hello')
    expect(executeTool).toHaveBeenCalledWith(
      { apiKey: 'sk-test' },
      'search',
      { query: 'test' },
    )
  })

  it('returns error when tools/call is missing tool name', async () => {
    const res = await callHandler(makeJsonRpcRequest('tools/call', {}))
    const json = await res.json()

    expect(json.error.code).toBe(-32602)
    expect(json.error.message).toContain('tool name')
  })

  it('returns error when tools/call has no params', async () => {
    const res = await callHandler(makeJsonRpcRequest('tools/call'))
    const json = await res.json()

    expect(json.error.code).toBe(-32602)
  })

  it('returns method not found for unknown methods', async () => {
    const res = await callHandler(makeJsonRpcRequest('unknown/method'))
    const json = await res.json()

    expect(res.status).toBe(404)
    expect(json.error.code).toBe(-32601)
    expect(json.error.message).toContain('unknown/method')
  })

  it('preserves string id in response', async () => {
    const res = await callHandler(makeJsonRpcRequest('ping', undefined, 'req-42'))
    const json = await res.json()

    expect(json.id).toBe('req-42')
  })

  it('normalizes null id for missing id', async () => {
    const request = new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'ping' }),
    })
    const res = await callHandler(request)
    const json = await res.json()

    expect(json.id).toBeNull()
  })

  it('normalizes non-finite number id to null', async () => {
    const res = await callHandler(makeJsonRpcRequest('ping', undefined, Infinity))
    const json = await res.json()

    expect(json.id).toBeNull()
  })
})
