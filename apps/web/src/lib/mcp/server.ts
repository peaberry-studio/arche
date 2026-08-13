import {
  captureKbArticleForReview,
  listKbArticles,
  normalizeKbArticlePath,
  readKbArticle,
  searchKb,
} from '@/lib/mcp/kb-content-store'
import { createKnowledgeReviewChange } from '@/lib/learning/service'
import {
  hasMcpScope,
  MCP_SCOPE_AGENTS_READ,
  MCP_SCOPE_KB_READ,
  MCP_SCOPE_KB_WRITE,
} from '@/lib/mcp/scopes'
import {
  listAgents,
  readAgent,
  readAgentsGuide,
  readSkillResource,
} from '@/lib/mcp/workspace-tools'
import { isRecord } from '@/lib/records'
import type { RuntimeUser } from '@/lib/runtime/types'
import { listSkills, readSkill } from '@/lib/skills/skill-store'

type JsonRpcId = string | number | null
type DecodedToolArgs = Record<string, number | string | undefined>

type ToolArgSpec = { type: 'string' | 'number'; required?: boolean }

type ToolDefinition = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  decodeArgs: (args: unknown) => { ok: true; value: DecodedToolArgs } | { ok: false }
  handler: (args: DecodedToolArgs) => Promise<unknown>
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

      const args = tool.decodeArgs(params?.arguments)
      if (!args.ok) return jsonRpcError(id, -32602, 'Invalid tool arguments', 400)

      const result = await tool.handler(args.value)
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
      defineTool({
        name: 'read_agents_guide',
        description: 'Read AGENTS.md, the primary workspace guide. Use this first for workspace-related tasks.',
        handler: () => readAgentsGuide({ user }),
      }),
      defineTool({
        name: 'list_agents',
        description: 'List configured Arche workspace agents and their capabilities.',
        handler: () => listAgents(),
      }),
      defineTool({
        name: 'read_agent',
        description: 'Read one workspace agent definition by id.',
        args: { id: { type: 'string', required: true } },
        handler: (a) => readAgent(str(a, 'id')),
      }),
      defineTool({
        name: 'list_skills',
        description: 'List workspace skills and assigned agents.',
        handler: () => listSkills(),
      }),
      defineTool({
        name: 'read_skill',
        description: 'Read a workspace skill document by name.',
        args: { name: { type: 'string', required: true } },
        handler: (a) => readSkill(str(a, 'name')),
      }),
      defineTool({
        name: 'read_skill_resource',
        description: 'Read a supporting resource file bundled with a workspace skill.',
        args: { name: { type: 'string', required: true }, path: { type: 'string', required: true }, maxLines: { type: 'number' } },
        handler: (a) => readSkillResource({ name: str(a, 'name'), path: str(a, 'path'), maxLines: optNum(a, 'maxLines') }),
      }),
    )
  }

  if (hasMcpScope(scopes, MCP_SCOPE_KB_READ)) {
    tools.push(
      defineTool({
        name: 'list_kb_articles',
        description: 'List markdown knowledge-base article paths. Use this for discovery before targeted reads.',
        args: { path: { type: 'string' } },
        handler: (a) => listKbArticles({ path: optStr(a, 'path') }),
      }),
      defineTool({
        name: 'read_kb_article',
        description: 'Read a markdown knowledge-base article by path.',
        args: { path: { type: 'string', required: true }, maxLines: { type: 'number' } },
        handler: (a) => readKbArticle({ path: str(a, 'path'), maxLines: optNum(a, 'maxLines') }),
      }),
      defineTool({
        name: 'search_kb',
        description: 'Search markdown knowledge-base articles by text. Use this when the relevant article is unknown.',
        args: { query: { type: 'string', required: true }, path: { type: 'string' }, limit: { type: 'number' } },
        handler: (a) => searchKb({ query: str(a, 'query'), path: optStr(a, 'path'), limit: optNum(a, 'limit') }),
      }),
    )
  }

  if (hasMcpScope(scopes, MCP_SCOPE_KB_WRITE)) {
    tools.push(
      defineTool({
        name: 'create_kb_article',
        description: 'Submit a new markdown knowledge-base article for Knowledge Review. It is applied and published only after explicit user approval. Supports KaTeX math ($...$, $$...$$) and vega-lite fenced charts; follow the Markdown Capabilities section of AGENTS.md for chart quality standards. Requires kb:write.',
        args: { path: { type: 'string', required: true }, content: { type: 'string', required: true } },
        handler: (a) => submitMcpKnowledgeReviewChange({
          content: str(a, 'content'),
          operation: 'create',
          path: str(a, 'path'),
          user,
        }),
      }),
      defineTool({
        name: 'update_kb_article',
        description: 'Submit an update to a markdown knowledge-base article for Knowledge Review. It is applied and published only after explicit user approval. Supports KaTeX math ($...$, $$...$$) and vega-lite fenced charts; follow the Markdown Capabilities section of AGENTS.md for chart quality standards. Requires kb:write.',
        args: { path: { type: 'string', required: true }, content: { type: 'string', required: true } },
        handler: (a) => submitMcpKnowledgeReviewChange({
          content: str(a, 'content'),
          operation: 'update',
          path: str(a, 'path'),
          user,
        }),
      }),
      defineTool({
        name: 'delete_kb_article',
        description: 'Submit a markdown knowledge-base article deletion for Knowledge Review. It is applied and published only after explicit user approval. Requires kb:write.',
        args: { path: { type: 'string', required: true } },
        handler: (a) => submitMcpKnowledgeReviewChange({
          content: '',
          operation: 'delete',
          path: str(a, 'path'),
          user,
        }),
      }),
    )
  }

  return tools
}

async function submitMcpKnowledgeReviewChange(args: {
  content: string
  operation: 'create' | 'update' | 'delete'
  path: string
  user: RuntimeUser
}): Promise<unknown> {
  // Normalize up front so the path persisted for a create on a missing file is
  // a checked one, rather than depending on captureKbArticleForReview having
  // rejected everything unnormalizable before it answered `not_found`.
  const normalizedPath = normalizeKbArticlePath(args.path)
  if (!normalizedPath) return { ok: false, error: 'invalid_path' }

  const snapshot = await captureKbArticleForReview({ path: args.path })
  if (args.operation === 'create') {
    if (snapshot.ok) return { ok: false, error: 'article_exists' }
    if (snapshot.error !== 'not_found') return { ok: false, error: snapshot.error }
  } else if (!snapshot.ok) {
    return { ok: false, error: snapshot.error }
  }

  const change = await createKnowledgeReviewChange(args.user.id, {
    author: args.user.email,
    agent: 'mcp',
    baseContent: snapshot.ok ? snapshot.snapshot.content : null,
    baseHash: snapshot.ok ? snapshot.snapshot.hash : null,
    confidence: 1,
    evidence: { source: 'MCP knowledge-base request' },
    kbPath: snapshot.ok ? snapshot.snapshot.path : normalizedPath,
    operation: args.operation,
    origin: 'mcp',
    proposedContent: args.content,
    reason: `Submitted through MCP for ${args.operation}.`,
    title: `${args.operation.charAt(0).toUpperCase()}${args.operation.slice(1)} ${args.path.trim()}`,
  })

  return {
    ok: true,
    path: change.kbPath,
    proposal: { id: change.id, status: change.status },
  }
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

function defineTool(spec: {
  name: string
  description: string
  args?: Record<string, ToolArgSpec>
  handler: (args: DecodedToolArgs) => Promise<unknown>
}): ToolDefinition {
  const args = spec.args ?? {}
  const properties: Record<string, unknown> = {}
  const required: string[] = []

  for (const [key, config] of Object.entries(args)) {
    properties[key] = { type: config.type }
    if (config.required) required.push(key)
  }

  return {
    name: spec.name,
    description: spec.description,
    inputSchema: { type: 'object', properties, required, additionalProperties: false },
    decodeArgs: (raw) => {
      const value = raw === undefined ? {} : raw
      if (!isRecord(value)) return { ok: false }

      const allowedKeys = new Set(Object.keys(args))
      if (Object.keys(value).some((key) => !allowedKeys.has(key))) return { ok: false }

      const decoded: DecodedToolArgs = {}
      for (const [key, config] of Object.entries(args)) {
        const rawValue = value[key]
        if (rawValue === undefined) {
          if (config.required) return { ok: false }
          continue
        }
        if (config.type === 'string') {
          if (typeof rawValue !== 'string') return { ok: false }
          decoded[key] = rawValue.trim()
        } else {
          if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) return { ok: false }
          decoded[key] = rawValue
        }
      }
      return { ok: true, value: decoded }
    },
    handler: spec.handler,
  }
}

function str(args: DecodedToolArgs, key: string): string {
  return args[key] as string
}

function optStr(args: DecodedToolArgs, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' && value ? value : undefined
}

function optNum(args: DecodedToolArgs, key: string): number | undefined {
  const value = args[key]
  return typeof value === 'number' ? value : undefined
}
