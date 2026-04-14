import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { proxyConnectorMcpRequest } from '@/lib/connectors/mcp/remote-proxy'

const ssrfMocks = vi.hoisted(() => ({
  validateConnectorTestEndpoint: vi.fn(),
}))

vi.mock('@/lib/security/ssrf', () => ({
  validateConnectorTestEndpoint: ssrfMocks.validateConnectorTestEndpoint,
}))

describe('proxyConnectorMcpRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('forwards the request to the connector MCP upstream', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('proxied-body', {
        status: 202,
        headers: {
          'content-type': 'application/json',
          'content-encoding': 'gzip',
          'content-length': '99',
        },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const request = new Request('https://arche.example.com/api/internal/mcp/connectors/connector-1/mcp?cursor=abc', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer gateway-token',
        Host: 'arche.example.com',
        'Content-Length': '11',
        'X-Test': 'forward-me',
      },
      body: '{"ok":true}',
    })

    const response = await proxyConnectorMcpRequest({
      request,
      type: 'linear',
      config: {},
      accessToken: 'oauth-token',
    })

    expect(fetchMock).toHaveBeenCalledOnce()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { duplex?: 'half' }]
    const headers = init.headers instanceof Headers ? init.headers : new Headers(init.headers)

    expect(url).toBe('https://mcp.linear.app/mcp?cursor=abc')
    expect(init.method).toBe('POST')
    expect(init.duplex).toBe('half')
    expect(init.body).toBeTruthy()
    expect(headers.get('authorization')).toBe('Bearer oauth-token')
    expect(headers.get('host')).toBeNull()
    expect(headers.get('content-length')).toBeNull()
    expect(headers.get('accept-encoding')).toBe('identity')
    expect(headers.get('x-test')).toBe('forward-me')

    expect(response.status).toBe(202)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('content-encoding')).toBeNull()
    expect(response.headers.get('content-length')).toBeNull()
    expect(await response.text()).toBe('proxied-body')
  })

  it('rejects invalid custom connector endpoints before proxying', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    ssrfMocks.validateConnectorTestEndpoint.mockResolvedValue({
      ok: false,
      error: 'private_address',
    })

    const response = await proxyConnectorMcpRequest({
      request: new Request('https://arche.example.com/api/internal/mcp/connectors/connector-1/mcp'),
      type: 'custom',
      config: { endpoint: 'https://custom.example/mcp' },
      accessToken: 'oauth-token',
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_connector_endpoint' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
