import { isRecord } from '@/lib/connectors/connector-values'

type JsonRpcId = string | number | null

export type ParsedEmbeddedConnectorConfig<TConfig> =
  | { ok: true; value: TConfig }
  | { ok: false; missing?: string[]; message?: string }

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

function getInvalidConnectorConfigMessage(
  connectorLabel: string,
  parsed: { message?: string; missing?: string[] }
): string {
  if (parsed.message) {
    return parsed.message
  }

  const missing = parsed.missing?.filter((entry) => entry.trim()) ?? []
  if (missing.length > 0) {
    return `Invalid ${connectorLabel} connector config: ${missing.join(', ')}`
  }

  return `Invalid ${connectorLabel} connector config`
}

export async function handleEmbeddedConnectorMcpRequest<TConfig>(input: {
  request: Request
  decryptedConfig: Record<string, unknown>
  connectorLabel: string
  serverInfo: { name: string; version: string }
  protocolVersion: string
  parseConfig: (config: Record<string, unknown>) => ParsedEmbeddedConnectorConfig<TConfig>
  getTools: (config: TConfig) => unknown
  executeTool: (config: TConfig, toolName: string, args: unknown) => Promise<unknown>
}): Promise<Response> {
  if (input.request.method !== 'POST') {
    return Response.json({ error: 'method_not_allowed' }, { status: 405, headers: { Allow: 'POST' } })
  }

  const parsedConfig = input.parseConfig(input.decryptedConfig)
  if (!parsedConfig.ok) {
    return jsonRpcError(
      null,
      -32000,
      getInvalidConnectorConfigMessage(input.connectorLabel, parsedConfig),
      500
    )
  }

  let body: unknown
  try {
    body = await input.request.json()
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
        protocolVersion: input.protocolVersion,
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
        serverInfo: input.serverInfo,
      })

    case 'ping':
      return jsonRpcResult(id, {})

    case 'tools/list':
      return jsonRpcResult(id, {
        tools: input.getTools(parsedConfig.value),
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

      const result = await input.executeTool(parsedConfig.value, toolName, params?.arguments)
      return jsonRpcResult(id, result)
    }

    default:
      return jsonRpcError(id, -32601, `Method not found: ${body.method}`, 404)
  }
}
