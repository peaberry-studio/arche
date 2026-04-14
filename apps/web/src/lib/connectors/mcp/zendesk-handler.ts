import {
  executeZendeskMcpTool,
  getZendeskMcpProtocolVersion,
  getZendeskMcpTools,
  parseZendeskConnectorConfig,
} from '@/lib/connectors/zendesk'

const ZENDESK_MCP_SERVER_INFO = {
  name: 'arche-zendesk-connector',
  version: '0.1.0',
}

type JsonRpcId = string | number | null

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function toJsonRpcId(value: unknown): JsonRpcId {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}

function jsonRpcResult(id: JsonRpcId, result: unknown): Response {
  return Response.json({ jsonrpc: '2.0', id, result })
}

function jsonRpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  status = 400,
  data?: Record<string, unknown>
): Response {
  return Response.json(
    {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
        ...(data ? { data } : {}),
      },
    },
    { status }
  )
}

export async function handleZendeskMcpRequest(
  request: Request,
  decryptedConfig: Record<string, unknown>
): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'method_not_allowed' }, { status: 405, headers: { Allow: 'POST' } })
  }

  const parsedConfig = parseZendeskConnectorConfig(decryptedConfig)
  if (!parsedConfig.ok) {
    return jsonRpcError(
      null,
      -32000,
      parsedConfig.message ?? `Invalid Zendesk connector config: ${parsedConfig.missing?.join(', ')}`,
      500
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonRpcError(null, -32700, 'Invalid JSON payload', 400)
  }

  if (!isRecord(body)) {
    return jsonRpcError(null, -32600, 'Invalid JSON-RPC request', 400)
  }

  const id = toJsonRpcId(body.id)
  if (body.jsonrpc !== '2.0' || typeof body.method !== 'string' || !body.method.trim()) {
    return jsonRpcError(id, -32600, 'Invalid JSON-RPC request', 400)
  }

  if (body.method.startsWith('notifications/')) {
    return new Response(null, { status: 204 })
  }

  switch (body.method) {
    case 'initialize':
      return jsonRpcResult(id, {
        protocolVersion: getZendeskMcpProtocolVersion(),
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
        serverInfo: ZENDESK_MCP_SERVER_INFO,
      })

    case 'ping':
      return jsonRpcResult(id, {})

    case 'tools/list':
      return jsonRpcResult(id, {
        tools: getZendeskMcpTools(),
      })

    case 'resources/list':
      return jsonRpcResult(id, { resources: [] })

    case 'resources/templates/list':
      return jsonRpcResult(id, { resourceTemplates: [] })

    case 'prompts/list':
      return jsonRpcResult(id, { prompts: [] })

    case 'tools/call': {
      const params = isRecord(body.params) ? body.params : null
      const toolName = typeof params?.name === 'string' ? params.name : null
      if (!toolName) {
        return jsonRpcError(id, -32602, 'tools/call requires a tool name', 400)
      }

      const result = await executeZendeskMcpTool(parsedConfig.value, toolName, params?.arguments)
      return jsonRpcResult(id, result)
    }

    default:
      return jsonRpcError(id, -32601, `Method not found: ${body.method}`, 404)
  }
}
