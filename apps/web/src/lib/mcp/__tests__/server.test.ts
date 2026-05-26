import { describe, expect, it } from 'vitest'

import { handleMcpJsonRpcRequest } from '@/lib/mcp/server'
import { MCP_SCOPE_AGENTS_READ, MCP_SCOPE_KB_READ, MCP_SCOPE_KB_WRITE } from '@/lib/mcp/scopes'

const user = { id: 'u1', email: 'alice@example.com', slug: 'alice', role: 'USER' }

describe('handleMcpJsonRpcRequest', () => {
  it('lists only scoped tools and no flow tools', async () => {
    const response = await handleMcpJsonRpcRequest({
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      scopes: [MCP_SCOPE_KB_READ],
      user,
    })
    const body = await response.json() as { result: { tools: Array<{ name: string }> } }
    const names = body.result.tools.map((tool) => tool.name)

    expect(names).toContain('list_kb_articles')
    expect(names).not.toContain('create_kb_article')
    expect(names.some((name) => name.includes('flow'))).toBe(false)
  })

  it('exposes write and agent tools when scopes allow them', async () => {
    const response = await handleMcpJsonRpcRequest({
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      scopes: [MCP_SCOPE_AGENTS_READ, MCP_SCOPE_KB_READ, MCP_SCOPE_KB_WRITE],
      user,
    })
    const body = await response.json() as { result: { tools: Array<{ name: string }> } }
    const names = body.result.tools.map((tool) => tool.name)

    expect(names).toContain('read_agents_guide')
    expect(names).toContain('create_kb_article')
    expect(names).toContain('delete_kb_article')
  })

  it('rejects write tool calls without kb:write', async () => {
    const response = await handleMcpJsonRpcRequest({
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'create_kb_article', arguments: { path: 'notes/new.md', content: 'hello' } },
      },
      scopes: [MCP_SCOPE_KB_READ],
      user,
    })
    const body = await response.json() as { error: { message: string } }

    expect(response.status).toBe(400)
    expect(body.error.message).toBe('Unknown tool')
  })

  it('rejects invalid required tool arguments before handlers run', async () => {
    const response = await handleMcpJsonRpcRequest({
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'read_kb_article', arguments: { path: 123 } },
      },
      scopes: [MCP_SCOPE_KB_READ],
      user,
    })
    const body = await response.json() as { error: { message: string } }

    expect(response.status).toBe(400)
    expect(body.error.message).toBe('Invalid tool arguments')
  })

  it('rejects invalid optional tool arguments instead of silently defaulting them', async () => {
    const response = await handleMcpJsonRpcRequest({
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'search_kb', arguments: { query: 'roadmap', limit: '10' } },
      },
      scopes: [MCP_SCOPE_KB_READ],
      user,
    })
    const body = await response.json() as { error: { message: string } }

    expect(response.status).toBe(400)
    expect(body.error.message).toBe('Invalid tool arguments')
  })

  it('includes canonical proactive single-agent guidance', async () => {
    const response = await handleMcpJsonRpcRequest({
      body: { jsonrpc: '2.0', id: 1, method: 'prompts/get', params: { name: 'arche-workspace-context' } },
      scopes: [MCP_SCOPE_AGENTS_READ],
      user,
    })
    const body = await response.json() as { result: { messages: Array<{ content: { text: string } }> } }

    expect(body.result.messages[0].content.text).toContain('At the start of a new task')
    expect(body.result.messages[0].content.text).toContain('single-agent')
  })
})
