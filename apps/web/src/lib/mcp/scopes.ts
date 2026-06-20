export const MCP_SCOPE_KB_READ = 'kb:read'
export const MCP_SCOPE_KB_WRITE = 'kb:write'
export const MCP_SCOPE_AGENTS_READ = 'agents:read'

export const MCP_SCOPES = [
  MCP_SCOPE_KB_READ,
  MCP_SCOPE_KB_WRITE,
  MCP_SCOPE_AGENTS_READ,
] as const

export type McpScope = (typeof MCP_SCOPES)[number]

const MCP_SCOPE_SET = new Set<string>(MCP_SCOPES)

export function isMcpScope(value: string): value is McpScope {
  return MCP_SCOPE_SET.has(value)
}

export function hasMcpScope(scopes: readonly string[], scope: McpScope): boolean {
  return scopes.includes(scope)
}

export function parseMcpScopes(value: unknown):
  | { ok: true; scopes: McpScope[] }
  | { ok: false; error: 'invalid_scopes' } {
  if (!Array.isArray(value)) {
    return { ok: false, error: 'invalid_scopes' }
  }

  const scopes: McpScope[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || !isMcpScope(entry)) {
      return { ok: false, error: 'invalid_scopes' }
    }
    scopes.push(entry)
  }

  return {
    ok: true,
    scopes: Array.from(new Set(scopes)).sort((left, right) => left.localeCompare(right)),
  }
}
