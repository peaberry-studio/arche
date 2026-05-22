import {
  createKbArticle,
  deleteKbArticle,
  listKbArticles,
  readKbArticle,
  searchKb,
  updateKbArticle,
} from '@/lib/mcp/kb-content-store'
import {
  hasMcpScope,
  MCP_SCOPE_AGENTS_READ,
  MCP_SCOPE_KB_READ,
  MCP_SCOPE_KB_WRITE,
} from '@/lib/mcp/scopes'
import {
  listAgents,
  listSkillsForMcp,
  readAgent,
  readAgentsGuide,
  readSkillForMcp,
  readSkillResource,
} from '@/lib/mcp/workspace-tools'
import { isRecord } from '@/lib/records'
import type { RuntimeUser } from '@/lib/runtime/types'

type JsonRpcId = string | number | null
type ToolHandler = (args: unknown) => Promise<unknown>

type ToolDefinition = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: ToolHandler
}

export type McpRequestMetadata = {
  method: string | null
  toolName: string | null
}

export function getMcpRequestMetadata(body: unknown): McpRequestMetadata {
  if (!isRecord(body)) return { method: null, toolName: null }
  const method = typeof body.method === 'string' ? body.method : null
  const params = isRecord(body.params) ? body.params : null
  return {
    method,
    toolName: method === 'tools/call' && typeof params?.name === 'string' ? params.name : null,
  }
}

export async function handleMcpJsonRpcRequest(input: {
  body: unknown
  scopes: readonly string[]
  user: RuntimeUser
}): Promise<Response> {
  if (!isRecord(input.body)) {
    return jsonRpcError(null, -32600, 'Invalid JSON-RPC request', 400)
  }

  const id = toJsonRpcId(input.body.id)
  if (input.body.jsonrpc !== '2.0' || typeof input.body.method !== 'string' || !input.body.method.trim()) {
    return jsonRpcError(id, -32600, 'Invalid JSON-RPC request', 400)
  }

  if (input.body.method.startsWith('notifications/')) {
    return new Response(null, { status: 204 })
  }

  const tools = buildToolDefinitions(input.scopes, input.user)

  switch (input.body.method) {
    case 'initialize':
      return jsonRpcResult(id, {
        protocolVersion: '2025-06-18',
        capabilities: {
          prompts: { listChanged: false },
          resources: {},
          tools: { listChanged: false },
        },
        serverInfo: {
          name: 'arche',
          version: process.env.ARCHE_GIT_SHA || process.env.ARCHE_RELEASE_VERSION || 'dev',
        },
      })

    case 'ping':
      return jsonRpcResult(id, {})

    case 'tools/list':
      return jsonRpcResult(id, {
        tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      })

    case 'tools/call': {
      const params = isRecord(input.body.params) ? input.body.params : null
      const name = typeof params?.name === 'string' ? params.name : ''
      const tool = tools.find((entry) => entry.name === name)
      if (!tool) return jsonRpcError(id, -32602, 'Unknown tool', 400)

      const result = await tool.handler(params?.arguments)
      return jsonRpcResult(id, toToolResult(result))
    }

    case 'prompts/list':
      return jsonRpcResult(id, {
        prompts: hasMcpScope(input.scopes, MCP_SCOPE_AGENTS_READ)
          ? [{ name: 'arche-workspace-context', description: 'Load canonical Arche workspace operating mode and guide.' }]
          : [],
      })

    case 'prompts/get': {
      const params = isRecord(input.body.params) ? input.body.params : null
      if (params?.name !== 'arche-workspace-context' || !hasMcpScope(input.scopes, MCP_SCOPE_AGENTS_READ)) {
        return jsonRpcError(id, -32602, 'Unknown prompt', 400)
      }

      const guide = await readAgentsGuide({ user: input.user })
      const text = guide.ok
        ? [buildProactiveWorkspaceContextPreamble(), guide.content].join('\n\n---\n\n')
        : `${buildProactiveWorkspaceContextPreamble()}\n\nFailed to load workspace guide: ${guide.error}`

      return jsonRpcResult(id, {
        description: 'Canonical Arche workspace context for proactive MCP-aware clients.',
        messages: [{ role: 'user', content: { type: 'text', text } }],
      })
    }

    case 'resources/list':
      return jsonRpcResult(id, { resources: [] })

    case 'resources/templates/list':
      return jsonRpcResult(id, { resourceTemplates: [] })

    default:
      return jsonRpcError(id, -32601, `Method not found: ${input.body.method}`, 404)
  }
}

function buildToolDefinitions(scopes: readonly string[], user: RuntimeUser): ToolDefinition[] {
  const tools: ToolDefinition[] = []

  if (hasMcpScope(scopes, MCP_SCOPE_AGENTS_READ)) {
    tools.push(
      {
        name: 'read_agents_guide',
        description: 'Read AGENTS.md, the primary workspace guide. Use this first for workspace-related tasks.',
        inputSchema: emptySchema(),
        handler: () => readAgentsGuide({ user }),
      },
      {
        name: 'list_agents',
        description: 'List configured Arche workspace agents and their capabilities.',
        inputSchema: emptySchema(),
        handler: () => listAgents(),
      },
      {
        name: 'read_agent',
        description: 'Read one workspace agent definition by id.',
        inputSchema: objectSchema({ id: { type: 'string' } }, ['id']),
        handler: (args) => readAgent(getStringArg(args, 'id')),
      },
      {
        name: 'list_skills',
        description: 'List workspace skills and assigned agents.',
        inputSchema: emptySchema(),
        handler: () => listSkillsForMcp(),
      },
      {
        name: 'read_skill',
        description: 'Read a workspace skill document by name.',
        inputSchema: objectSchema({ name: { type: 'string' } }, ['name']),
        handler: (args) => readSkillForMcp(getStringArg(args, 'name')),
      },
      {
        name: 'read_skill_resource',
        description: 'Read a supporting resource file bundled with a workspace skill.',
        inputSchema: objectSchema({ name: { type: 'string' }, path: { type: 'string' }, maxLines: { type: 'number' } }, ['name', 'path']),
        handler: (args) => readSkillResource({
          name: getStringArg(args, 'name'),
          path: getStringArg(args, 'path'),
          maxLines: getNumberArg(args, 'maxLines'),
        }),
      }
    )
  }

  if (hasMcpScope(scopes, MCP_SCOPE_KB_READ)) {
    tools.push(
      {
        name: 'list_kb_articles',
        description: 'List markdown knowledge-base article paths. Use this for discovery before targeted reads.',
        inputSchema: objectSchema({ path: { type: 'string' } }),
        handler: (args) => listKbArticles({ path: getOptionalStringArg(args, 'path') }),
      },
      {
        name: 'read_kb_article',
        description: 'Read a markdown knowledge-base article by path.',
        inputSchema: objectSchema({ path: { type: 'string' }, maxLines: { type: 'number' } }, ['path']),
        handler: (args) => readKbArticle({ path: getStringArg(args, 'path'), maxLines: getNumberArg(args, 'maxLines') }),
      },
      {
        name: 'search_kb',
        description: 'Search markdown knowledge-base articles by text. Use this when the relevant article is unknown.',
        inputSchema: objectSchema({ query: { type: 'string' }, path: { type: 'string' }, limit: { type: 'number' } }, ['query']),
        handler: (args) => searchKb({
          query: getStringArg(args, 'query'),
          path: getOptionalStringArg(args, 'path'),
          limit: getNumberArg(args, 'limit'),
        }),
      }
    )
  }

  if (hasMcpScope(scopes, MCP_SCOPE_KB_WRITE)) {
    tools.push(
      {
        name: 'create_kb_article',
        description: 'Create a new markdown knowledge-base article. Requires kb:write.',
        inputSchema: objectSchema({ path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']),
        handler: (args) => createKbArticle({ path: getStringArg(args, 'path'), content: getStringArg(args, 'content') }),
      },
      {
        name: 'update_kb_article',
        description: 'Update an existing markdown knowledge-base article. Requires kb:write.',
        inputSchema: objectSchema({ path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']),
        handler: (args) => updateKbArticle({ path: getStringArg(args, 'path'), content: getStringArg(args, 'content') }),
      },
      {
        name: 'delete_kb_article',
        description: 'Delete a markdown knowledge-base article. Requires kb:write.',
        inputSchema: objectSchema({ path: { type: 'string' } }, ['path']),
        handler: (args) => deleteKbArticle({ path: getStringArg(args, 'path') }),
      }
    )
  }

  return tools
}

function buildProactiveWorkspaceContextPreamble(): string {
  return [
    '# Arche MCP Operating Mode',
    '',
    'Treat Arche workspace context as ambient context, not as a tool surface used only on explicit request.',
    'At the start of a new task, decide whether workspace context is plausibly relevant. If it is, check Arche MCP context before answering.',
    'Prefer discovery first: read the workspace guide, list or search relevant artifacts, then read only the specific agents, skills, or KB articles needed.',
    'Prefer a single-agent interpretation by default; do not involve multiple agents unless the task clearly requires it.',
    'Do not narrate routine MCP lookups unless an action has side effects or needs user approval.',
    'Do not run flows or mutate connectors through MCP in this phase.',
  ].join('\n')
}

function toToolResult(result: unknown): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  const isError = Boolean(isRecord(result) && result.ok === false)
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    ...(isError ? { isError: true } : {}),
  }
}

function jsonRpcResult(id: JsonRpcId, result: unknown): Response {
  return Response.json({ jsonrpc: '2.0', id, result })
}

function jsonRpcError(id: JsonRpcId, code: number, message: string, status: number): Response {
  return Response.json({ jsonrpc: '2.0', id, error: { code, message } }, { status })
}

function toJsonRpcId(value: unknown): JsonRpcId {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}

function emptySchema(): Record<string, unknown> {
  return objectSchema({})
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: 'object', properties, required, additionalProperties: false }
}

function getStringArg(args: unknown, key: string): string {
  if (!isRecord(args) || typeof args[key] !== 'string') return ''
  return args[key].trim()
}

function getOptionalStringArg(args: unknown, key: string): string | undefined {
  const value = getStringArg(args, key)
  return value || undefined
}

function getNumberArg(args: unknown, key: string): number | undefined {
  if (!isRecord(args) || typeof args[key] !== 'number' || !Number.isFinite(args[key])) return undefined
  return args[key]
}
