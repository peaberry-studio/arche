import { describe, expect, it } from 'vitest'

import { buildMcpClientSetup } from '../mcp-client-config'

describe('buildMcpClientSetup', () => {
  const baseUrl = 'https://arche.example.com'
  const token = 'arche_pat_test'

  it('builds a Claude Code config with HTTP transport and headers', () => {
    const result = buildMcpClientSetup('claude-code', baseUrl, token)

    expect(result.filePath).toBe('.mcp.json')
    expect(result.language).toBe('json')
    expect(result.content).toContain('"type": "http"')
    expect(result.content).toContain('"url": "https://arche.example.com/api/mcp"')
    expect(result.content).toContain('"Authorization": "Bearer arche_pat_test"')
  })

  it('builds a Codex TOML config', () => {
    const result = buildMcpClientSetup('codex', baseUrl, token)

    expect(result.filePath).toBe('~/.codex/config.toml')
    expect(result.language).toBe('toml')
    expect(result.content).toContain('[mcp_servers.arche]')
    expect(result.content).toContain('url = "https://arche.example.com/api/mcp"')
    expect(result.content).toContain('Authorization = "Bearer arche_pat_test"')
  })

  it('builds an OpenCode remote MCP config', () => {
    const result = buildMcpClientSetup('opencode', baseUrl, token)

    expect(result.filePath).toBe('opencode.json')
    expect(result.content).toContain('"type": "remote"')
    expect(result.content).toContain('"oauth": false')
    expect(result.content).toContain('"Authorization": "Bearer arche_pat_test"')
  })
})
