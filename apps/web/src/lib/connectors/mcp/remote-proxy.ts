import { getConnectorMcpServerUrl } from '@/lib/connectors/mcp/server-url'
import type { ConnectorType } from '@/lib/connectors/types'
import { validateConnectorTestEndpoint } from '@/lib/security/ssrf'

type ProxyConnectorMcpRequestInput = {
  request: Request
  type: ConnectorType
  config: Record<string, unknown>
  accessToken: string
}

export async function proxyConnectorMcpRequest(input: ProxyConnectorMcpRequestInput): Promise<Response> {
  const upstreamUrl = getConnectorMcpServerUrl(input.type, input.config)
  if (!upstreamUrl) {
    return Response.json({ error: 'invalid_connector_endpoint' }, { status: 400 })
  }

  let upstream: URL
  if (input.type === 'custom') {
    const endpointValidation = await validateConnectorTestEndpoint(upstreamUrl)
    if (!endpointValidation.ok) {
      return Response.json({ error: 'invalid_connector_endpoint' }, { status: 400 })
    }

    upstream = endpointValidation.url
  } else {
    try {
      upstream = new URL(upstreamUrl)
    } catch {
      return Response.json({ error: 'invalid_connector_endpoint' }, { status: 400 })
    }
  }

  upstream.search = new URL(input.request.url).search

  const headers = new Headers(input.request.headers)
  headers.delete('authorization')
  headers.delete('host')
  headers.delete('content-length')
  headers.set('accept-encoding', 'identity')
  headers.set('authorization', `Bearer ${input.accessToken}`)

  const hasBody = input.request.method !== 'GET' && input.request.method !== 'HEAD' && input.request.body
  const init: RequestInit & { duplex?: 'half' } = {
    method: input.request.method,
    headers,
  }

  if (hasBody) {
    init.body = input.request.body
    init.duplex = 'half'
  }

  const upstreamResponse = await fetch(upstream.toString(), init)
  const responseHeaders = new Headers(upstreamResponse.headers)
  responseHeaders.delete('content-encoding')
  responseHeaders.delete('content-length')

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  })
}
