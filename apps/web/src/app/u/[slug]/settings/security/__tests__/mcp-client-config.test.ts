import { describe, expect, it } from 'vitest'

import { buildMcpClientSetup } from '../mcp-client-config'

describe('buildMcpClientSetup', () => {
  const baseUrl = 'https://arche.example.com'
  const token = 'arche_pat_test'

  it('builds a Claude Code add-json command with the MCP server payload inline', () => {
    const result = buildMcpClientSetup('claude-code', baseUrl, token)

    expect(result.label).toBe('Claude')
    expect(result.mode).toBe('command')
    expect(result.value).toContain("claude mcp add-json arche '{\"type\":\"http\"")
    expect(result.value).toContain('"url":"https://arche.example.com/api/mcp"')
    expect(result.value).toContain('"Authorization":"Bearer arche_pat_test"')
  })

  it('builds a Codex command that wires the bearer token through an environment variable', () => {
    const result = buildMcpClientSetup('codex', baseUrl, token)

    expect(result.label).toBe('Codex')
    expect(result.mode).toBe('command')
    expect(result.value).toContain("export ARCHE_MCP_TOKEN='arche_pat_test'")
    expect(result.value).toContain("codex mcp add arche --url 'https://arche.example.com/api/mcp' --bearer-token-env-var ARCHE_MCP_TOKEN")
  })

  it('builds a fallback JSON config for other MCP clients', () => {
    const result = buildMcpClientSetup('config', baseUrl, token)

    expect(result.label).toBe('Config')
    expect(result.mode).toBe('config')
    expect(result.value).toContain('"mcpServers"')
    expect(result.value).toContain('"type": "http"')
    expect(result.value).toContain('"url": "https://arche.example.com/api/mcp"')
    expect(result.value).toContain('"Authorization": "Bearer arche_pat_test"')
  })
})
