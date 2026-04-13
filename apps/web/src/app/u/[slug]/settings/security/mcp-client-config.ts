export type McpClientPreset = 'claude-code' | 'codex' | 'config'

type McpClientSetupMode = 'command' | 'config'

export type McpClientSetup = {
  preset: McpClientPreset
  label: string
  description: string
  mode: McpClientSetupMode
  value: string
}

const MCP_SERVER_NAME = 'arche'
const CODEX_TOKEN_ENV_VAR = 'ARCHE_MCP_TOKEN'

export function buildMcpClientSetup(
  preset: McpClientPreset,
  baseUrl: string,
  token: string,
): McpClientSetup {
  const url = `${baseUrl.replace(/\/$/, '')}/api/mcp`

  switch (preset) {
    case 'claude-code':
      return {
        preset,
        label: 'Claude',
        description: 'Run once in the project where you want Claude Code to use Arche.',
        mode: 'command',
        value: [
          'claude mcp add-json',
          MCP_SERVER_NAME,
          shellQuote(
            JSON.stringify({
              type: 'http',
              url,
              headers: {
                Authorization: `Bearer ${token}`,
              },
            }),
          ),
        ].join(' '),
      }

    case 'codex':
      return {
        preset,
        label: 'Codex',
        description: 'Run in the same shell session you use to start Codex so the token env var is available.',
        mode: 'command',
        value: [
          `export ${CODEX_TOKEN_ENV_VAR}=${shellQuote(token)}`,
          `codex mcp add ${MCP_SERVER_NAME} --url ${shellQuote(url)} --bearer-token-env-var ${CODEX_TOKEN_ENV_VAR}`,
        ].join('\n'),
      }

    case 'config':
      return {
        preset,
        label: 'Config',
        description: 'Fallback JSON for any MCP client that accepts manual HTTP server configuration.',
        mode: 'config',
        value: `${JSON.stringify({
          mcpServers: {
            [MCP_SERVER_NAME]: {
              type: 'http',
              url,
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
          },
        }, null, 2)}\n`,
      }
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`
}
