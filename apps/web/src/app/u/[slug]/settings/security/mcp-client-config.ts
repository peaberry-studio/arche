export type McpClientPreset =
  | 'claude-code'
  | 'codex'
  | 'cursor'
  | 'opencode'
  | 'generic'

export type McpClientSetup = {
  preset: McpClientPreset
  label: string
  filePath: string
  language: 'json' | 'toml'
  content: string
}

export function buildMcpClientSetup(
  preset: McpClientPreset,
  baseUrl: string,
  token: string
): McpClientSetup {
  const url = `${baseUrl.replace(/\/$/, '')}/api/mcp`

  switch (preset) {
    case 'claude-code':
      return {
        preset,
        label: 'Claude Code',
        filePath: '.mcp.json',
        language: 'json',
        content: stringifyJson({
          mcpServers: {
            arche: {
              type: 'http',
              url,
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
          },
        }),
      }

    case 'codex':
      return {
        preset,
        label: 'Codex',
        filePath: '~/.codex/config.toml',
        language: 'toml',
        content: [
          '[mcp_servers.arche]',
          `url = "${url}"`,
          '',
          '[mcp_servers.arche.headers]',
          `Authorization = "Bearer ${token}"`,
        ].join('\n'),
      }

    case 'cursor':
      return {
        preset,
        label: 'Cursor',
        filePath: '~/.cursor/mcp.json',
        language: 'json',
        content: stringifyJson({
          mcpServers: {
            arche: {
              url,
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
          },
        }),
      }

    case 'opencode':
      return {
        preset,
        label: 'OpenCode',
        filePath: 'opencode.json',
        language: 'json',
        content: stringifyJson({
          $schema: 'https://opencode.ai/config.json',
          mcp: {
            arche: {
              type: 'remote',
              url,
              enabled: true,
              oauth: false,
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
          },
        }),
      }

    case 'generic':
      return {
        preset,
        label: 'Generic',
        filePath: 'mcp.json',
        language: 'json',
        content: stringifyJson({
          mcpServers: {
            arche: {
              type: 'http',
              url,
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
          },
        }),
      }
  }
}

function stringifyJson(value: object): string {
  return `${JSON.stringify(value, null, 2)}\n`
}
