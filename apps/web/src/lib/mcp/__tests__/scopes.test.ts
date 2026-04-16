import { describe, expect, it } from 'vitest'

import {
  DEFAULT_MCP_PAT_SCOPES,
  hasMcpScope,
  isMcpScope,
  MCP_SCOPE_AGENTS_READ,
  MCP_SCOPE_KB_READ,
  MCP_SCOPE_KB_WRITE,
  MCP_SCOPE_TASKS_RUN,
} from '../scopes'

describe('mcp scopes', () => {
  it('exposes the full default self-service scope set', () => {
    expect(DEFAULT_MCP_PAT_SCOPES).toEqual([
      MCP_SCOPE_KB_READ,
      MCP_SCOPE_KB_WRITE,
      MCP_SCOPE_AGENTS_READ,
      MCP_SCOPE_TASKS_RUN,
    ])
  })

  it('does not grant implicit scopes through kb:read', () => {
    const tokenScopes = [MCP_SCOPE_KB_READ]

    expect(hasMcpScope(tokenScopes, MCP_SCOPE_KB_READ)).toBe(true)
    expect(hasMcpScope(tokenScopes, MCP_SCOPE_KB_WRITE)).toBe(false)
    expect(hasMcpScope(tokenScopes, MCP_SCOPE_AGENTS_READ)).toBe(false)
    expect(hasMcpScope(tokenScopes, MCP_SCOPE_TASKS_RUN)).toBe(false)
  })

  it('validates only supported scope values', () => {
    expect(isMcpScope('kb:read')).toBe(true)
    expect(isMcpScope('kb:write')).toBe(true)
    expect(isMcpScope('agents:read')).toBe(true)
    expect(isMcpScope('tasks:run')).toBe(true)
    expect(isMcpScope('skills:read')).toBe(false)
    expect(isMcpScope('admin:write')).toBe(false)
  })
})
