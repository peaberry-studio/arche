import { describe, expect, it } from 'vitest'

import { buildMcpClientSetup } from '../mcp-client-config'

describe('buildMcpClientSetup', () => {
  const baseUrl = 'https://arche.example.com'
  const token = 'arche_pat_test'

  it('builds a Claude Code add-json command with a pretty-printed MCP server payload', () => {
    const result = buildMcpClientSetup('claude-code', baseUrl, token)

    expect(result.label).toBe('Claude Code')
    expect(result.mode).toBe('command')
    expect(result.value.startsWith("claude mcp add-json arche '{")).toBe(true)
    expect(result.value).toContain('\n  "type": "http"')
    expect(result.value).toContain('"url": "https://arche.example.com/api/mcp"')
    expect(result.value).toContain('"Authorization": "Bearer arche_pat_test"')
  })

  it('builds a Codex command with line continuations for readability', () => {
    const result = buildMcpClientSetup('codex', baseUrl, token)

    expect(result.label).toBe('Codex')
    expect(result.mode).toBe('command')
    expect(result.value).toContain("export ARCHE_MCP_TOKEN='arche_pat_test'")
    expect(result.value).toContain('codex mcp add arche \\')
    expect(result.value).toContain("  --url 'https://arche.example.com/api/mcp' \\")
    expect(result.value).toContain('  --bearer-token-env-var ARCHE_MCP_TOKEN')
  })

  it('builds a Cursor mcp.json snippet with instructions on where to save it', () => {
    const result = buildMcpClientSetup('cursor', baseUrl, token)

    expect(result.label).toBe('Cursor')
    expect(result.mode).toBe('config')
    expect(result.description).toContain('~/.cursor/mcp.json')
    expect(result.description).toContain('.cursor/mcp.json')
    expect(result.value).toContain('"mcpServers"')
    expect(result.value).toContain('"url": "https://arche.example.com/api/mcp"')
    expect(result.value).toContain('"Authorization": "Bearer arche_pat_test"')
  })

  it('builds a fallback JSON config for other MCP clients', () => {
    const result = buildMcpClientSetup('config', baseUrl, token)

    expect(result.label).toBe('Manual')
    expect(result.mode).toBe('config')
    expect(result.value).toContain('"mcpServers"')
    expect(result.value).toContain('"type": "http"')
    expect(result.value).toContain('"url": "https://arche.example.com/api/mcp"')
    expect(result.value).toContain('"Authorization": "Bearer arche_pat_test"')
  })
})
