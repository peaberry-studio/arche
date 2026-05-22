import { describe, expect, it } from 'vitest'

import { MCP_SCOPE_AGENTS_READ, MCP_SCOPE_KB_READ, MCP_SCOPE_KB_WRITE, parseMcpScopes } from '@/lib/mcp/scopes'

describe('parseMcpScopes', () => {
  it('accepts known scopes and deduplicates them', () => {
    expect(parseMcpScopes([MCP_SCOPE_KB_WRITE, MCP_SCOPE_KB_READ, MCP_SCOPE_KB_WRITE])).toEqual({
      ok: true,
      scopes: [MCP_SCOPE_KB_READ, MCP_SCOPE_KB_WRITE],
    })
  })

  it('rejects unknown scopes', () => {
    expect(parseMcpScopes([MCP_SCOPE_AGENTS_READ, 'flows:run'])).toEqual({ ok: false, error: 'invalid_scopes' })
  })
})
