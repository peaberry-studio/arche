import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { listKbArticles } from '@/lib/mcp/tools/list-kb-articles'
import { readKbArticle } from '@/lib/mcp/tools/read-kb-article'
import { searchKb } from '@/lib/mcp/tools/search-kb'

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'arche-kb',
    version: process.env.ARCHE_GIT_SHA || 'dev',
  })

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
