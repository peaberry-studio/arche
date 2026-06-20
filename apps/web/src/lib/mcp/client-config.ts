export type McpClientConfigInput = {
  endpoint: string
  token: string
}

export type McpQuickConnect = {
  id: string
  label: string
  command: string
}

export function buildMcpQuickConnects(input: McpClientConfigInput): McpQuickConnect[] {
  const bearer = `Bearer ${input.token}`
  return [
    {
      id: 'claude-code',
      label: 'Claude Code',
      command: `claude mcp add arche --transport http "${input.endpoint}" -H "Authorization: ${bearer}"`,
    },
    {
      id: 'codex',
      label: 'Codex',
      command: `codex mcp add --name arche --transport http "${input.endpoint}" --header "Authorization: ${bearer}"`,
    },
    {
      id: 'cursor',
      label: 'Cursor',
      command: `cursor mcp add arche --url "${input.endpoint}" --header "Authorization: ${bearer}"`,
    },
  ]
}
