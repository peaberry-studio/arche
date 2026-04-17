import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type { RuntimeUser } from '@/lib/runtime/types'
import {
  DEFAULT_MCP_PAT_SCOPES,
  hasMcpScope,
  MCP_SCOPE_AGENTS_READ,
  MCP_SCOPE_KB_READ,
  MCP_SCOPE_KB_WRITE,
  MCP_SCOPE_TASKS_RUN,
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
import {
  deleteKbArticle,
  writeKbArticle,
} from '@/lib/mcp/tools/write-kb-article'

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

  registerTools(server, scopes, input.user)
  registerPrompts(server, scopes, input.user)

  return server
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

function registerTools(
  server: McpServer,
  scopes: readonly string[],
  user?: RuntimeUser
): void {
  if (hasMcpScope(scopes, MCP_SCOPE_KB_READ)) {
    server.registerTool(
      'list_kb_articles',
      {
        description:
          'List knowledge base article paths from the published vault. ' +
          'Use this to discover available documentation before reading specific articles. ' +
          'Pass a path to scope the listing to a subdirectory.',
        inputSchema: {
          path: z.string().optional(),
        },
      },
      async ({ path }) => toToolResult(await listKbArticles({ path }))
    )

    server.registerTool(
      'read_kb_article',
      {
        description:
          'Read a knowledge base article by path. Returns full text content for text files ' +
          'or size metadata for binary files. Use list_kb_articles or search_kb first to ' +
          'discover available paths.',
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
        description:
          'Full-text search across the published knowledge base. Returns matching file paths, ' +
          'line numbers, and context snippets. Use this when you need to find information ' +
          'without knowing which article contains it.',
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

  if (hasMcpScope(scopes, MCP_SCOPE_KB_WRITE)) {
    server.registerTool(
      'write_kb_article',
      {
        description:
          'Create or update a knowledge base article by path in the published vault. ' +
          'Use this to write markdown/text content into the KB repository.',
        inputSchema: {
          path: z.string().min(1),
          content: z.string(),
        },
      },
      async ({ path, content }) => toToolResult(await writeKbArticle({ path, content }))
    )

    server.registerTool(
      'delete_kb_article',
      {
        description:
          'Delete a knowledge base article by path from the published vault.',
        inputSchema: {
          path: z.string().min(1),
        },
      },
      async ({ path }) => toToolResult(await deleteKbArticle({ path }))
    )
  }

  if (hasMcpScope(scopes, MCP_SCOPE_AGENTS_READ)) {
    server.registerTool(
      'read_agents_guide',
      {
        description:
          'Read the AGENTS.md workspace guide — the primary reference for this workspace\'s ' +
          'conventions, architecture, coding standards, and security rules. Read this first ' +
          'before performing any workspace-related task to understand the project context.',
      },
      async () => toToolResult(await readAgentsGuide({ user }))
    )

    server.registerTool(
      'list_agents',
      {
        description:
          'List all workspace agents with their capabilities, model, and mode. ' +
          'Use this to discover available agent personas. To adopt an agent\'s expertise, ' +
          'read its full definition with read_agent.',
      },
      async () => toToolResult(await listAgents())
    )

    server.registerTool(
      'read_agent',
      {
        description:
          'Read a workspace agent\'s full definition including its system prompt, model, ' +
          'temperature, and capabilities. To work as this agent, adopt its system prompt ' +
          'as your instructions and follow its specified constraints.',
        inputSchema: {
          id: z.string().min(1),
        },
      },
      async ({ id }) => toToolResult(await readAgent(id))
    )

    server.registerTool(
      'list_skills',
      {
        description:
          'List all workspace skills and which agents they are assigned to. ' +
          'Skills are reusable instruction sets for specific tasks. ' +
          'Use read_skill to get the full instructions for a skill.',
      },
      async () => toToolResult(await listSkillsForMcp())
    )

    server.registerTool(
      'read_skill',
      {
        description:
          'Read a workspace skill document including its instructions, metadata, and ' +
          'assigned agents. To use a skill, follow the instructions in its body as your ' +
          'guide. If the skill has resources, use read_skill_resource to access them.',
        inputSchema: {
          name: z.string().min(1),
        },
      },
      async ({ name }) => toToolResult(await readSkillForMcp(name))
    )

    server.registerTool(
      'read_skill_resource',
      {
        description:
          'Read a file bundled with a workspace skill. Skills may include supporting files ' +
          'like templates, examples, or reference data. Returns text content for text files ' +
          'or size metadata for binary files.',
        inputSchema: {
          maxLines: z.number().int().positive().optional(),
          name: z.string().min(1),
          path: z.string().min(1),
        },
      },
      async ({ name, path, maxLines }) => toToolResult(await readSkillResource({ name, path, maxLines }))
    )
  }
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

function registerPrompts(
  server: McpServer,
  scopes: readonly string[],
  user?: RuntimeUser
): void {
  if (hasMcpScope(scopes, MCP_SCOPE_AGENTS_READ)) {
    server.registerPrompt(
      'arche-workspace-context',
      {
        description:
          'Load the Arche workspace context: conventions, architecture, coding standards, ' +
          'and your workspace identity. Use this at the start of a session to ground ' +
          'yourself in the project before working.',
      },
      async () => {
        const guide = await readAgentsGuide({ user })
        if (!guide.ok) {
          return {
            messages: [{
              role: 'user' as const,
              content: { type: 'text' as const, text: `Failed to load workspace context: ${guide.error}` },
            }],
          }
        }
        return {
          messages: [{
            role: 'user' as const,
            content: { type: 'text' as const, text: guide.content },
          }],
        }
      }
    )

  }

  if (hasMcpScope(scopes, MCP_SCOPE_TASKS_RUN)) {
    server.registerPrompt(
      'use-agent',
      {
        description:
          'Adopt an Arche workspace agent\'s persona. Loads the agent\'s system prompt, ' +
          'capabilities, and workspace context so you can work as that agent on local tasks.',
        argsSchema: {
          agent_id: z.string().describe(
            'The agent ID to adopt. Use list_agents to discover available agents.'
          ),
          task: z.string().describe('The task to perform as this agent.'),
        },
      },
      async ({ agent_id, task }) => {
        const [guide, agentResult] = await Promise.all([
          readAgentsGuide({ user }),
          readAgent(agent_id),
        ])

        if (!agentResult.ok) {
          return {
            messages: [{
              role: 'user' as const,
              content: {
                type: 'text' as const,
                text: `Agent "${agent_id}" not found. Use list_agents to see available agents.`,
              },
            }],
          }
        }

        const sections: string[] = []

        if (guide.ok) {
          sections.push('# Workspace Context\n\n' + guide.content)
        }

        const a = agentResult.agent
        sections.push(
          `# Agent: ${a.displayName}\n\n` +
          `Model: ${a.model ?? 'default'}\n` +
          `Mode: ${a.mode ?? 'primary'}\n` +
          `Temperature: ${a.temperature ?? 'default'}\n\n` +
          (a.prompt ? `## System Prompt\n\n${a.prompt}` : '*(no system prompt)*')
        )

        sections.push(`# Task\n\n${task}`)

        return {
          messages: [{
            role: 'user' as const,
            content: { type: 'text' as const, text: sections.join('\n\n---\n\n') },
          }],
        }
      }
    )

    server.registerPrompt(
      'use-skill',
      {
        description:
          'Load an Arche workspace skill\'s instructions to guide your work on a task. ' +
          'Skills are curated instruction sets for specific workflows like code review, ' +
          'debugging, documentation, etc.',
        argsSchema: {
          skill_name: z.string().describe(
            'The skill name to use. Use list_skills to discover available skills.'
          ),
          task: z.string().describe('The task to perform using this skill\'s instructions.'),
        },
      },
      async ({ skill_name, task }) => {
        const result = await readSkillForMcp(skill_name)

        if (!result.ok) {
          return {
            messages: [{
              role: 'user' as const,
              content: {
                type: 'text' as const,
                text: `Skill "${skill_name}" not found. Use list_skills to see available skills.`,
              },
            }],
          }
        }

        const skill = result.data
        const sections: string[] = []

        sections.push(
          `# Skill: ${skill.name}\n\n` +
          `${skill.description}\n\n` +
          `## Instructions\n\n${skill.body}`
        )

        sections.push(`# Task\n\n${task}`)

        return {
          messages: [{
            role: 'user' as const,
            content: { type: 'text' as const, text: sections.join('\n\n---\n\n') },
          }],
        }
      }
    )
  }
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
