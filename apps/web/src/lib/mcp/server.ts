import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type { RuntimeUser } from '@/lib/runtime/types'
import {
  DEFAULT_MCP_PAT_SCOPES,
  hasMcpScope,
  MCP_SCOPE_AGENTS_READ,
  MCP_SCOPE_KB_READ,
  MCP_SCOPE_SKILLS_READ,
} from '@/lib/mcp/scopes'
import {
  listAgents,
  readAgent,
} from '@/lib/mcp/tools/agents'
import { listKbArticles } from '@/lib/mcp/tools/list-kb-articles'
import { readAgentsGuide } from '@/lib/mcp/tools/read-agents-guide'
import { readKbArticle } from '@/lib/mcp/tools/read-kb-article'
import { searchKb } from '@/lib/mcp/tools/search-kb'
import {
  listSkillsForMcp,
  readSkillForMcp,
  readSkillResource,
} from '@/lib/mcp/tools/skills'

type CreateMcpServerInput = {
  scopes?: readonly string[]
  user?: RuntimeUser
}

export function createMcpServer(input: CreateMcpServerInput = {}): McpServer {
  const server = new McpServer({
    name: 'arche',
    version: process.env.ARCHE_GIT_SHA || 'dev',
  })

  const scopes = input.scopes ?? DEFAULT_MCP_PAT_SCOPES

  if (hasMcpScope(scopes, MCP_SCOPE_KB_READ)) {
    server.registerTool(
      'list_kb_articles',
      {
        description: 'List knowledge base article paths from the published vault.',
        inputSchema: {
          path: z.string().optional(),
        },
      },
      async ({ path }) => toToolResult(await listKbArticles({ path }))
    )

    server.registerTool(
      'read_kb_article',
      {
        description: 'Read a knowledge base article or return metadata for binary files.',
        inputSchema: {
          path: z.string(),
          maxLines: z.number().int().positive().optional(),
        },
      },
      async ({ path, maxLines }) => toToolResult(await readKbArticle({ path, maxLines }))
    )

    server.registerTool(
      'search_kb',
      {
        description: 'Search the published knowledge base by text query.',
        inputSchema: {
          query: z.string(),
          path: z.string().optional(),
          caseSensitive: z.boolean().optional(),
          limit: z.number().int().positive().optional(),
        },
      },
      async ({ query, path, caseSensitive, limit }) => {
        return toToolResult(await searchKb({ query, path, caseSensitive, limit }))
      }
    )
  }

  if (hasMcpScope(scopes, MCP_SCOPE_AGENTS_READ)) {
    server.registerTool(
      'read_agents_guide',
      {
        description: 'Read the published AGENTS.md guide for this workspace.',
      },
      async () => toToolResult(await readAgentsGuide({ user: input.user }))
    )

    server.registerTool(
      'list_agents',
      {
        description: 'List workspace agents and their capabilities.',
      },
      async () => toToolResult(await listAgents())
    )

    server.registerTool(
      'read_agent',
      {
        description: 'Read a workspace agent definition, including prompt and capabilities.',
        inputSchema: {
          id: z.string().min(1),
        },
      },
      async ({ id }) => toToolResult(await readAgent(id))
    )
  }

  if (hasMcpScope(scopes, MCP_SCOPE_SKILLS_READ)) {
    server.registerTool(
      'list_skills',
      {
        description: 'List workspace skills and the agents assigned to them.',
      },
      async () => toToolResult(await listSkillsForMcp())
    )

    server.registerTool(
      'read_skill',
      {
        description: 'Read a workspace skill document, including assignments and resource paths.',
        inputSchema: {
          name: z.string().min(1),
        },
      },
      async ({ name }) => toToolResult(await readSkillForMcp(name))
    )

    server.registerTool(
      'read_skill_resource',
      {
        description: 'Read a file from a workspace skill bundle.',
        inputSchema: {
          maxLines: z.number().int().positive().optional(),
          name: z.string().min(1),
          path: z.string().min(1),
        },
      },
      async ({ name, path, maxLines }) => toToolResult(await readSkillResource({ name, path, maxLines }))
    )
  }

  return server
}

function toToolResult(result: unknown): {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
} {
  const text = JSON.stringify(result, null, 2)
  const isError = isResultError(result)

  if (isError) {
    return {
      content: [{ type: 'text', text }],
      isError: true,
    }
  }

  return {
    content: [{ type: 'text', text }],
  }
}

function isResultError(result: unknown): boolean {
  return Boolean(result && typeof result === 'object' && 'ok' in result && (result as { ok: boolean }).ok === false)
}
