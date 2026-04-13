export const MCP_SCOPE_KB_READ = 'kb:read'
export const MCP_SCOPE_AGENTS_READ = 'agents:read'
export const MCP_SCOPE_SKILLS_READ = 'skills:read'

export const DEFAULT_MCP_PAT_SCOPES = [
  MCP_SCOPE_KB_READ,
  MCP_SCOPE_AGENTS_READ,
  MCP_SCOPE_SKILLS_READ,
] as const

export type McpReadScope = (typeof DEFAULT_MCP_PAT_SCOPES)[number]

export const MCP_READ_SCOPE_OPTIONS: Array<{
  description: string
  label: string
  value: McpReadScope
}> = [
  {
    description: 'List, read, and search published KB articles.',
    label: 'Knowledge base',
    value: MCP_SCOPE_KB_READ,
  },
  {
    description: 'Read AGENTS.md plus the workspace agent catalog.',
    label: 'Agents',
    value: MCP_SCOPE_AGENTS_READ,
  },
  {
    description: 'Read workspace skills and bundled skill resources.',
    label: 'Skills',
    value: MCP_SCOPE_SKILLS_READ,
  },
]

export function hasMcpScope(scopes: readonly string[], scope: McpReadScope): boolean {
  if (scope === MCP_SCOPE_KB_READ) {
    return scopes.includes(MCP_SCOPE_KB_READ)
  }

  return scopes.includes(scope) || scopes.includes(MCP_SCOPE_KB_READ)
}

export function isMcpReadScope(value: string): value is McpReadScope {
  return DEFAULT_MCP_PAT_SCOPES.includes(value as McpReadScope)
}
