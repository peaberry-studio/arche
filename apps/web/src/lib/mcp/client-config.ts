export type McpClientConfigInput = {
  endpoint: string
  token: string
}

export type McpClientConfig = {
  id: string
  label: string
  description: string
  content: string
}

export function buildMcpClientConfigs(input: McpClientConfigInput): McpClientConfig[] {
  const serverConfig = {
    mcpServers: {
      arche: {
        type: 'http',
        url: input.endpoint,
        headers: {
          Authorization: `Bearer ${input.token}`,
        },
      },
    },
  }

  return [
    {
      id: 'claude-code',
      label: 'Claude Code',
      description: 'Add this to your Claude Code MCP configuration.',
      content: JSON.stringify(serverConfig, null, 2),
    },
    {
      id: 'codex',
      label: 'Codex',
      description: 'Add this server block to your Codex config.',
      content: [
        '[mcp_servers.arche]',
        `url = "${escapeTomlString(input.endpoint)}"`,
        `headers = { Authorization = "Bearer ${escapeTomlString(input.token)}" }`,
      ].join('\n'),
    },
    {
      id: 'cursor',
      label: 'Cursor',
      description: 'Add this to .cursor/mcp.json or Cursor MCP settings.',
      content: JSON.stringify(serverConfig, null, 2),
    },
    {
      id: 'generic',
      label: 'Generic MCP',
      description: 'Use these values with any HTTP MCP client.',
      content: JSON.stringify({ url: input.endpoint, authorization: `Bearer ${input.token}` }, null, 2),
    },
  ]
}

function escapeTomlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
