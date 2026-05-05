import { describe, expect, it, vi } from 'vitest'

import { handleEmbeddedConnectorMcpRequest } from '@/lib/connectors/mcp/json-rpc'

type TestConfig = { token: string }

function createRequest(body: unknown, init: RequestInit = {}): Request {
  return new Request('https://mcp.example.test', {
    method: 'POST',
    body: JSON.stringify(body),
    ...init,
  })
}

function createInput(overrides: Partial<Parameters<typeof handleEmbeddedConnectorMcpRequest<TestConfig>>[0]> = {}) {
  return {
    request: createRequest({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    decryptedConfig: { token: 'secret' },
    connectorLabel: 'Test',
    serverInfo: { name: 'test-server', version: '1.0.0' },
    protocolVersion: '2025-03-26',
    parseConfig: vi.fn(() => ({ ok: true, value: { token: 'secret' } as TestConfig })),
    getTools: vi.fn(() => [{ name: 'search' }]),
    executeTool: vi.fn(async () => ({ ok: true })),
    ...overrides,
  }
}

async function readJson(response: Response): Promise<unknown> {
  return response.json()
}

describe('handleEmbeddedConnectorMcpRequest', () => {
  it('rejects non-POST requests', async () => {
    const response = await handleEmbeddedConnectorMcpRequest(createInput({
      request: new Request('https://mcp.example.test', { method: 'GET' }),
    }))

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
    expect(await readJson(response)).toEqual({ error: 'method_not_allowed' })
  })

  it('returns invalid config details when required config values are missing', async () => {
    const response = await handleEmbeddedConnectorMcpRequest(createInput({
      parseConfig: vi.fn(() => ({ ok: false, missing: ['token', ' '] })),
    }))

    expect(response.status).toBe(500)
    expect(await readJson(response)).toMatchObject({
      error: {
        code: -32000,
        message: 'Invalid Test connector config: token',
      },
    })
  })

  it('rejects invalid JSON payloads', async () => {
    const response = await handleEmbeddedConnectorMcpRequest(createInput({
      request: new Request('https://mcp.example.test', { method: 'POST', body: '{' }),
    }))

    expect(response.status).toBe(400)
    expect(await readJson(response)).toMatchObject({ error: { code: -32700 } })
  })

  it('rejects non-object JSON-RPC payloads', async () => {
    const response = await handleEmbeddedConnectorMcpRequest(createInput({
      request: createRequest('hello'),
    }))

    expect(response.status).toBe(400)
    expect(await readJson(response)).toMatchObject({ error: { code: -32600 } })
  })

  it('rejects malformed JSON-RPC requests', async () => {
    const response = await handleEmbeddedConnectorMcpRequest(createInput({
      request: createRequest({ jsonrpc: '2.0', id: { nested: true }, method: ' ' }),
    }))

    expect(response.status).toBe(400)
    expect(await readJson(response)).toMatchObject({ id: null, error: { code: -32600 } })
  })

  it('returns no content for notifications', async () => {
    const response = await handleEmbeddedConnectorMcpRequest(createInput({
      request: createRequest({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    }))

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
  })

  it.each([
    ['ping', {}],
    ['resources/list', { resources: [] }],
    ['resources/templates/list', { resourceTemplates: [] }],
    ['prompts/list', { prompts: [] }],
  ])('handles %s requests', async (method, result) => {
    const response = await handleEmbeddedConnectorMcpRequest(createInput({
      request: createRequest({ jsonrpc: '2.0', id: 'req-1', method }),
    }))

    expect(response.status).toBe(200)
    expect(await readJson(response)).toEqual({ jsonrpc: '2.0', id: 'req-1', result })
  })

  it('returns method not found for unknown methods', async () => {
    const response = await handleEmbeddedConnectorMcpRequest(createInput({
      request: createRequest({ jsonrpc: '2.0', id: 1, method: 'unknown/method' }),
    }))

    expect(response.status).toBe(404)
    expect(await readJson(response)).toMatchObject({ error: { code: -32601, message: 'Method not found: unknown/method' } })
  })
})
