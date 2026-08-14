import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  captureKbArticleForReview: vi.fn(),
  createKnowledgeReviewChange: vi.fn(),
}))

vi.mock('@/lib/mcp/kb-content-store', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/mcp/kb-content-store')>()
  return { ...original, captureKbArticleForReview: mocks.captureKbArticleForReview }
})
vi.mock('@/lib/learning/service', () => ({
  createKnowledgeReviewChange: mocks.createKnowledgeReviewChange,
}))

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

  it('advertises KaTeX and vega-lite capabilities in KB write tool descriptions', async () => {
    const response = await handleMcpJsonRpcRequest({
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      scopes: [MCP_SCOPE_KB_READ, MCP_SCOPE_KB_WRITE],
      user,
    })
    const body = await response.json() as { result: { tools: Array<{ name: string; description: string }> } }
    const byName = new Map(body.result.tools.map((tool) => [tool.name, tool.description]))

    expect(byName.get('create_kb_article')).toContain('vega-lite')
    expect(byName.get('create_kb_article')).toContain('KaTeX')
    expect(byName.get('update_kb_article')).toContain('vega-lite')
    expect(byName.get('update_kb_article')).toContain('KaTeX')
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

  describe('KB write tools route through Knowledge Review', () => {
    const writeScopes = [MCP_SCOPE_KB_READ, MCP_SCOPE_KB_WRITE]

    function makeSnapshot(content: string) {
      return { ok: true as const, snapshot: { content, hash: `sha256:${content}`, path: 'Notes/Brief.md' } }
    }

    async function callTool(name: string, args: Record<string, string>) {
      const response = await handleMcpJsonRpcRequest({
        body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
        scopes: writeScopes,
        user,
      })
      const body = await response.json() as { result: { content: Array<{ text: string }>; isError?: boolean } }
      return { isError: body.result.isError === true, result: JSON.parse(body.result.content[0].text) }
    }

    beforeEach(() => {
      vi.clearAllMocks()
      mocks.createKnowledgeReviewChange.mockImplementation(async (_userId: string, input: { operation: string }) => ({
        ok: true as const,
        change: {
          id: 'change-1',
          kbPath: 'Notes/Brief.md',
          status: 'open',
          operation: input.operation,
        },
      }))
    })

    it('rejects create_kb_article when the article already exists', async () => {
      mocks.captureKbArticleForReview.mockResolvedValue(makeSnapshot('existing'))

      const { isError, result } = await callTool('create_kb_article', { path: 'Notes/Brief.md', content: '# New' })

      expect(isError).toBe(true)
      expect(result).toEqual({ ok: false, error: 'article_exists' })
      expect(mocks.createKnowledgeReviewChange).not.toHaveBeenCalled()
    })

    it('submits a create_kb_article as an open Knowledge Review change with no base', async () => {
      mocks.captureKbArticleForReview.mockResolvedValue({ ok: false, error: 'not_found' })

      const { isError, result } = await callTool('create_kb_article', { path: 'Notes/Brief.md', content: '# New' })

      expect(isError).toBe(false)
      expect(result).toEqual({ ok: true, path: 'Notes/Brief.md', proposal: { id: 'change-1', status: 'open' } })
      expect(mocks.captureKbArticleForReview).toHaveBeenCalledWith({ path: 'Notes/Brief.md' })
      expect(mocks.createKnowledgeReviewChange).toHaveBeenCalledWith('u1', expect.objectContaining({
        operation: 'create',
        baseContent: null,
        baseHash: null,
        proposedContent: '# New',
        origin: 'mcp',
        agent: 'mcp',
        author: 'alice@example.com',
      }))
    })

    it('submits an update_kb_article with the captured base snapshot', async () => {
      mocks.captureKbArticleForReview.mockResolvedValue(makeSnapshot('current body'))

      const { result } = await callTool('update_kb_article', { path: 'Notes/Brief.md', content: '# Updated' })

      expect(result).toMatchObject({ ok: true, proposal: { id: 'change-1' } })
      expect(mocks.createKnowledgeReviewChange).toHaveBeenCalledWith('u1', expect.objectContaining({
        operation: 'update',
        baseContent: 'current body',
        baseHash: 'sha256:current body',
        proposedContent: '# Updated',
      }))
    })

    it('rejects update_kb_article when the article is missing', async () => {
      mocks.captureKbArticleForReview.mockResolvedValue({ ok: false, error: 'not_found' })

      const { isError, result } = await callTool('update_kb_article', { path: 'Notes/Missing.md', content: '# Updated' })

      expect(isError).toBe(true)
      expect(result).toEqual({ ok: false, error: 'not_found' })
      expect(mocks.createKnowledgeReviewChange).not.toHaveBeenCalled()
    })

    it('submits a delete_kb_article with an empty proposed payload', async () => {
      mocks.captureKbArticleForReview.mockResolvedValue(makeSnapshot('current body'))

      const { result } = await callTool('delete_kb_article', { path: 'Notes/Brief.md' })

      expect(result).toMatchObject({ ok: true, proposal: { id: 'change-1' } })
      expect(mocks.createKnowledgeReviewChange).toHaveBeenCalledWith('u1', expect.objectContaining({
        operation: 'delete',
        baseContent: 'current body',
        baseHash: 'sha256:current body',
        proposedContent: '',
      }))
    })

    it.each([
      ['a non-markdown target', 'Notes/Brief.txt'],
      ['an absolute path', '/etc/passwd.md'],
      ['a parent traversal', '../../secrets.md'],
      ['a dot-prefixed segment publish rejects', '.hidden/secret.md'],
      ['a dot-prefixed article publish rejects', '.obsidian.md'],
    ])('rejects %s before reading or persisting anything', async (_label, path) => {
      const { isError, result } = await callTool('create_kb_article', { path, content: '# New' })

      expect(isError).toBe(true)
      expect(result).toEqual({ ok: false, error: 'invalid_path' })
      expect(mocks.captureKbArticleForReview).not.toHaveBeenCalled()
      expect(mocks.createKnowledgeReviewChange).not.toHaveBeenCalled()
    })

    it('persists the normalized path when creating an article that does not exist yet', async () => {
      mocks.captureKbArticleForReview.mockResolvedValue({ ok: false, error: 'not_found' })

      const { result } = await callTool('create_kb_article', { path: '  Notes//Brief.md  ', content: '# New' })

      expect(result).toMatchObject({ ok: true })
      expect(mocks.createKnowledgeReviewChange).toHaveBeenCalledWith('u1', expect.objectContaining({
        kbPath: 'Notes/Brief.md',
      }))
    })
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
