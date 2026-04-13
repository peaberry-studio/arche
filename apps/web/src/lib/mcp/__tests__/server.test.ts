import { beforeEach, describe, expect, it, vi } from 'vitest'

const registerTool = vi.fn()
const registerPrompt = vi.fn()
const mockServerInstance = {
  registerTool,
  registerPrompt,
}

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn(() => mockServerInstance),
}))

const mockListKbArticles = vi.fn()
const mockListAgents = vi.fn()
const mockListSkillsForMcp = vi.fn()
const mockReadAgent = vi.fn()
const mockReadAgentsGuide = vi.fn()
const mockReadKbArticle = vi.fn()
const mockReadSkillForMcp = vi.fn()
const mockReadSkillResource = vi.fn()
const mockSearchKb = vi.fn()

vi.mock('@/lib/mcp/tools/agents', () => ({
  listAgents: (...args: unknown[]) => mockListAgents(...args),
  readAgent: (...args: unknown[]) => mockReadAgent(...args),
}))

vi.mock('@/lib/mcp/tools/list-kb-articles', () => ({
  listKbArticles: (...args: unknown[]) => mockListKbArticles(...args),
}))

vi.mock('@/lib/mcp/tools/read-agents-guide', () => ({
  readAgentsGuide: (...args: unknown[]) => mockReadAgentsGuide(...args),
}))

vi.mock('@/lib/mcp/tools/read-kb-article', () => ({
  readKbArticle: (...args: unknown[]) => mockReadKbArticle(...args),
}))

vi.mock('@/lib/mcp/tools/search-kb', () => ({
  searchKb: (...args: unknown[]) => mockSearchKb(...args),
}))

vi.mock('@/lib/mcp/tools/skills', () => ({
  listSkillsForMcp: (...args: unknown[]) => mockListSkillsForMcp(...args),
  readSkillForMcp: (...args: unknown[]) => mockReadSkillForMcp(...args),
  readSkillResource: (...args: unknown[]) => mockReadSkillResource(...args),
}))

describe('createMcpServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers the full developer-context tool surface for default scopes', async () => {
    const { createMcpServer } = await import('../server')

    createMcpServer()

    expect(registerTool).toHaveBeenCalledTimes(9)
    expect(registerTool).toHaveBeenCalledWith(
      'list_kb_articles',
      expect.objectContaining({ description: expect.any(String) }),
      expect.any(Function)
    )
    expect(registerTool).toHaveBeenCalledWith(
      'read_agents_guide',
      expect.objectContaining({ description: expect.any(String) }),
      expect.any(Function)
    )
    expect(registerTool).toHaveBeenCalledWith(
      'list_agents',
      expect.objectContaining({ description: expect.any(String) }),
      expect.any(Function)
    )
    expect(registerTool).toHaveBeenCalledWith(
      'read_agent',
      expect.objectContaining({ description: expect.any(String) }),
      expect.any(Function)
    )
    expect(registerTool).toHaveBeenCalledWith(
      'read_kb_article',
      expect.objectContaining({ description: expect.any(String) }),
      expect.any(Function)
    )
    expect(registerTool).toHaveBeenCalledWith(
      'list_skills',
      expect.objectContaining({ description: expect.any(String) }),
      expect.any(Function)
    )
    expect(registerTool).toHaveBeenCalledWith(
      'read_skill',
      expect.objectContaining({ description: expect.any(String) }),
      expect.any(Function)
    )
    expect(registerTool).toHaveBeenCalledWith(
      'read_skill_resource',
      expect.objectContaining({ description: expect.any(String) }),
      expect.any(Function)
    )
    expect(registerTool).toHaveBeenCalledWith(
      'search_kb',
      expect.objectContaining({ description: expect.any(String) }),
      expect.any(Function)
    )
  })

  it('registers prompts for default scopes', async () => {
    const { createMcpServer } = await import('../server')

    createMcpServer()

    expect(registerPrompt).toHaveBeenCalledTimes(3)
    expect(registerPrompt).toHaveBeenCalledWith(
      'arche-workspace-context',
      expect.objectContaining({ description: expect.any(String) }),
      expect.any(Function)
    )
    expect(registerPrompt).toHaveBeenCalledWith(
      'use-agent',
      expect.objectContaining({ description: expect.any(String), argsSchema: expect.any(Object) }),
      expect.any(Function)
    )
    expect(registerPrompt).toHaveBeenCalledWith(
      'use-skill',
      expect.objectContaining({ description: expect.any(String), argsSchema: expect.any(Object) }),
      expect.any(Function)
    )
  })

  it('filters tool registration by PAT scopes', async () => {
    const { createMcpServer } = await import('../server')

    createMcpServer({ scopes: ['agents:read'] })

    expect(registerTool).toHaveBeenCalledTimes(3)
    expect(registerTool).toHaveBeenNthCalledWith(
      1,
      'read_agents_guide',
      expect.objectContaining({ description: expect.any(String) }),
      expect.any(Function)
    )
    expect(registerTool).toHaveBeenNthCalledWith(
      2,
      'list_agents',
      expect.objectContaining({ description: expect.any(String) }),
      expect.any(Function)
    )
    expect(registerTool).toHaveBeenNthCalledWith(
      3,
      'read_agent',
      expect.objectContaining({ description: expect.any(String) }),
      expect.any(Function)
    )
  })

  it('filters prompt registration by PAT scopes', async () => {
    const { createMcpServer } = await import('../server')

    createMcpServer({ scopes: ['agents:read'] })

    expect(registerPrompt).toHaveBeenCalledTimes(2)
    expect(registerPrompt).toHaveBeenCalledWith(
      'arche-workspace-context',
      expect.objectContaining({ description: expect.any(String) }),
      expect.any(Function)
    )
    expect(registerPrompt).toHaveBeenCalledWith(
      'use-agent',
      expect.objectContaining({ description: expect.any(String) }),
      expect.any(Function)
    )
  })

  it('registers only skills prompt when only skills:read scope is granted', async () => {
    const { createMcpServer } = await import('../server')

    createMcpServer({ scopes: ['skills:read'] })

    expect(registerPrompt).toHaveBeenCalledTimes(1)
    expect(registerPrompt).toHaveBeenCalledWith(
      'use-skill',
      expect.objectContaining({ description: expect.any(String) }),
      expect.any(Function)
    )
  })

  it('wires tool handlers to the MCP tool modules', async () => {
    mockListKbArticles.mockResolvedValue({ ok: true, articles: ['README.md'] })
    mockListAgents.mockResolvedValue({ ok: true, agents: [{ id: 'assistant' }] })
    mockListSkillsForMcp.mockResolvedValue({ ok: true, data: [{ name: 'lint' }] })
    mockReadAgent.mockResolvedValue({ ok: true, agent: { id: 'assistant' } })
    mockReadAgentsGuide.mockResolvedValue({ ok: true, content: '# Guide' })
    mockReadKbArticle.mockResolvedValue({
      ok: true,
      kind: 'text',
      content: '# Hello',
      truncated: false,
    })
    mockReadSkillForMcp.mockResolvedValue({ ok: true, data: { name: 'lint' } })
    mockReadSkillResource.mockResolvedValue({
      ok: true,
      kind: 'text',
      content: 'echo hello',
      truncated: false,
    })
    mockSearchKb.mockResolvedValue({
      ok: true,
      matches: [{ file: 'README.md', line: 1, snippet: 'HEAD:README.md:1:Hello' }],
    })

    const { createMcpServer } = await import('../server')
    createMcpServer({
      user: { email: 'alice@example.com', id: 'u1', role: 'USER', slug: 'alice' },
    })

    const guideHandler = registerTool.mock.calls.find(([name]) => name === 'read_agents_guide')?.[2]
    const listAgentsHandler = registerTool.mock.calls.find(([name]) => name === 'list_agents')?.[2]
    const listHandler = registerTool.mock.calls.find(([name]) => name === 'list_kb_articles')?.[2]
    const listSkillsHandler = registerTool.mock.calls.find(([name]) => name === 'list_skills')?.[2]
    const readAgentHandler = registerTool.mock.calls.find(([name]) => name === 'read_agent')?.[2]
    const readHandler = registerTool.mock.calls.find(([name]) => name === 'read_kb_article')?.[2]
    const readSkillHandler = registerTool.mock.calls.find(([name]) => name === 'read_skill')?.[2]
    const readSkillResourceHandler = registerTool.mock.calls.find(([name]) => name === 'read_skill_resource')?.[2]
    const searchHandler = registerTool.mock.calls.find(([name]) => name === 'search_kb')?.[2]

    await guideHandler?.()
    await listAgentsHandler?.()
    await listHandler?.({ path: 'docs' })
    await listSkillsHandler?.()
    await readAgentHandler?.({ id: 'assistant' })
    await readHandler?.({ path: 'README.md' })
    await readSkillHandler?.({ name: 'lint' })
    await readSkillResourceHandler?.({ name: 'lint', path: 'scripts/check.sh' })
    await searchHandler?.({ query: 'hello' })

    expect(mockReadAgentsGuide).toHaveBeenCalledWith({
      user: { email: 'alice@example.com', id: 'u1', role: 'USER', slug: 'alice' },
    })
    expect(mockListAgents).toHaveBeenCalledWith()
    expect(mockListKbArticles).toHaveBeenCalledWith({ path: 'docs' })
    expect(mockListSkillsForMcp).toHaveBeenCalledWith()
    expect(mockReadAgent).toHaveBeenCalledWith('assistant')
    expect(mockReadKbArticle).toHaveBeenCalledWith({ path: 'README.md' })
    expect(mockReadSkillForMcp).toHaveBeenCalledWith('lint')
    expect(mockReadSkillResource).toHaveBeenCalledWith({ name: 'lint', path: 'scripts/check.sh', maxLines: undefined })
    expect(mockSearchKb).toHaveBeenCalledWith({ query: 'hello' })
  })

  it('arche-workspace-context prompt returns the agents guide', async () => {
    mockReadAgentsGuide.mockResolvedValue({ ok: true, content: '# Guide\nHello' })

    const { createMcpServer } = await import('../server')
    createMcpServer({
      user: { email: 'alice@example.com', id: 'u1', role: 'USER', slug: 'alice' },
    })

    const handler = registerPrompt.mock.calls.find(
      ([name]: [string]) => name === 'arche-workspace-context'
    )?.[2]
    const result = await handler?.()

    expect(result).toEqual({
      messages: [{
        role: 'user',
        content: { type: 'text', text: '# Guide\nHello' },
      }],
    })
  })

  it('arche-workspace-context prompt returns error when guide unavailable', async () => {
    mockReadAgentsGuide.mockResolvedValue({ ok: false, error: 'kb_unavailable' })

    const { createMcpServer } = await import('../server')
    createMcpServer()

    const handler = registerPrompt.mock.calls.find(
      ([name]: [string]) => name === 'arche-workspace-context'
    )?.[2]
    const result = await handler?.()

    expect(result).toEqual({
      messages: [{
        role: 'user',
        content: { type: 'text', text: 'Failed to load workspace context: kb_unavailable' },
      }],
    })
  })

  it('use-agent prompt composes guide, agent prompt, and task', async () => {
    mockReadAgentsGuide.mockResolvedValue({ ok: true, content: '# Guide' })
    mockReadAgent.mockResolvedValue({
      ok: true,
      agent: {
        id: 'reviewer',
        displayName: 'Reviewer',
        model: 'openai/gpt-5.2',
        mode: 'subagent',
        temperature: 0.1,
        prompt: 'You are a code reviewer.',
      },
    })

    const { createMcpServer } = await import('../server')
    createMcpServer()

    const handler = registerPrompt.mock.calls.find(
      ([name]: [string]) => name === 'use-agent'
    )?.[2]
    const result = await handler?.({ agent_id: 'reviewer', task: 'Review the auth module' })

    expect(result.messages).toHaveLength(1)
    const text = result.messages[0].content.text
    expect(text).toContain('# Workspace Context')
    expect(text).toContain('# Guide')
    expect(text).toContain('# Agent: Reviewer')
    expect(text).toContain('Model: openai/gpt-5.2')
    expect(text).toContain('You are a code reviewer.')
    expect(text).toContain('# Task')
    expect(text).toContain('Review the auth module')
  })

  it('use-agent prompt returns error for unknown agent', async () => {
    mockReadAgentsGuide.mockResolvedValue({ ok: true, content: '# Guide' })
    mockReadAgent.mockResolvedValue({ ok: false, error: 'not_found' })

    const { createMcpServer } = await import('../server')
    createMcpServer()

    const handler = registerPrompt.mock.calls.find(
      ([name]: [string]) => name === 'use-agent'
    )?.[2]
    const result = await handler?.({ agent_id: 'nope', task: 'anything' })

    expect(result.messages[0].content.text).toContain('Agent "nope" not found')
  })

  it('use-skill prompt composes skill instructions and task', async () => {
    mockReadSkillForMcp.mockResolvedValue({
      ok: true,
      data: {
        name: 'code-review',
        description: 'Thorough code review skill',
        body: 'Step 1: Read the diff\nStep 2: Check for bugs',
      },
    })

    const { createMcpServer } = await import('../server')
    createMcpServer()

    const handler = registerPrompt.mock.calls.find(
      ([name]: [string]) => name === 'use-skill'
    )?.[2]
    const result = await handler?.({ skill_name: 'code-review', task: 'Review PR #42' })

    expect(result.messages).toHaveLength(1)
    const text = result.messages[0].content.text
    expect(text).toContain('# Skill: code-review')
    expect(text).toContain('Thorough code review skill')
    expect(text).toContain('Step 1: Read the diff')
    expect(text).toContain('# Task')
    expect(text).toContain('Review PR #42')
  })

  it('use-skill prompt returns error for unknown skill', async () => {
    mockReadSkillForMcp.mockResolvedValue({ ok: false, error: 'not_found' })

    const { createMcpServer } = await import('../server')
    createMcpServer()

    const handler = registerPrompt.mock.calls.find(
      ([name]: [string]) => name === 'use-skill'
    )?.[2]
    const result = await handler?.({ skill_name: 'nope', task: 'anything' })

    expect(result.messages[0].content.text).toContain('Skill "nope" not found')
  })
})
