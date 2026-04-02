import { beforeEach, describe, expect, it, vi } from 'vitest'

const registerTool = vi.fn()
const mockServerInstance = {
  registerTool,
}

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn(() => mockServerInstance),
}))

const mockListKbArticles = vi.fn()
const mockReadKbArticle = vi.fn()
const mockSearchKb = vi.fn()

vi.mock('@/lib/mcp/tools/list-kb-articles', () => ({
  listKbArticles: (...args: unknown[]) => mockListKbArticles(...args),
}))

vi.mock('@/lib/mcp/tools/read-kb-article', () => ({
  readKbArticle: (...args: unknown[]) => mockReadKbArticle(...args),
}))

vi.mock('@/lib/mcp/tools/search-kb', () => ({
  searchKb: (...args: unknown[]) => mockSearchKb(...args),
}))

describe('createMcpServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers the three KB tools', async () => {
    const { createMcpServer } = await import('../server')

    createMcpServer()

    expect(registerTool).toHaveBeenCalledTimes(3)
    expect(registerTool).toHaveBeenCalledWith(
      'list_kb_articles',
      expect.objectContaining({ description: expect.any(String) }),
      expect.any(Function)
    )
    expect(registerTool).toHaveBeenCalledWith(
      'read_kb_article',
      expect.objectContaining({ description: expect.any(String) }),
      expect.any(Function)
    )
    expect(registerTool).toHaveBeenCalledWith(
      'search_kb',
      expect.objectContaining({ description: expect.any(String) }),
      expect.any(Function)
    )
  })

  it('wires tool handlers to the KB tool modules', async () => {
    mockListKbArticles.mockResolvedValue({ ok: true, articles: ['README.md'] })
    mockReadKbArticle.mockResolvedValue({
      ok: true,
      kind: 'text',
      content: '# Hello',
      truncated: false,
    })
    mockSearchKb.mockResolvedValue({
      ok: true,
      matches: [{ file: 'README.md', line: 1, snippet: 'HEAD:README.md:1:Hello' }],
    })

    const { createMcpServer } = await import('../server')
    createMcpServer()

    const listHandler = registerTool.mock.calls.find(([name]) => name === 'list_kb_articles')?.[2]
    const readHandler = registerTool.mock.calls.find(([name]) => name === 'read_kb_article')?.[2]
    const searchHandler = registerTool.mock.calls.find(([name]) => name === 'search_kb')?.[2]

    await listHandler?.({ path: 'docs' })
    await readHandler?.({ path: 'README.md' })
    await searchHandler?.({ query: 'hello' })

    expect(mockListKbArticles).toHaveBeenCalledWith({ path: 'docs' })
    expect(mockReadKbArticle).toHaveBeenCalledWith({ path: 'README.md' })
    expect(mockSearchKb).toHaveBeenCalledWith({ query: 'hello' })
  })
})
