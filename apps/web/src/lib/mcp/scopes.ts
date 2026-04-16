export const MCP_SCOPE_KB_READ = 'kb:read'
export const MCP_SCOPE_KB_WRITE = 'kb:write'
export const MCP_SCOPE_AGENTS_READ = 'agents:read'
export const MCP_SCOPE_TASKS_RUN = 'tasks:run'

export const DEFAULT_MCP_PAT_SCOPES = [
  MCP_SCOPE_KB_READ,
  MCP_SCOPE_KB_WRITE,
  MCP_SCOPE_AGENTS_READ,
  MCP_SCOPE_TASKS_RUN,
] as const

export type McpScope = (typeof DEFAULT_MCP_PAT_SCOPES)[number]

export const MCP_SCOPE_OPTIONS: Array<{
  description: string
  label: string
  value: McpScope
}> = [
  {
    description: 'List, read, and search published KB articles.',
    label: 'Knowledge base read',
    value: MCP_SCOPE_KB_READ,
  },
  {
    description: 'Create, update, and delete knowledge base content.',
    label: 'Knowledge base write',
    value: MCP_SCOPE_KB_WRITE,
  },
  {
    description: 'Read AGENTS.md, the workspace agent catalog, and skills.',
    label: 'Agents read',
    value: MCP_SCOPE_AGENTS_READ,
  },
  {
    description: 'Run task-oriented MCP prompts such as use-agent and use-skill.',
    label: 'Tasks run',
    value: MCP_SCOPE_TASKS_RUN,
  },
]

export function hasMcpScope(scopes: readonly string[], scope: McpScope): boolean {
  return scopes.includes(scope)
}

export function isMcpScope(value: string): value is McpScope {
  return DEFAULT_MCP_PAT_SCOPES.includes(value as McpScope)
}
