import { describe, expect, it } from 'vitest'

import { buildKnowledgeGraph } from '@/lib/kb-graph'

describe('buildKnowledgeGraph', () => {
  it('builds file edges from Obsidian links', () => {
    const graph = buildKnowledgeGraph({
      files: [
        { path: 'docs/a.md', content: 'See [[docs/b.md|B]]' },
        { path: 'docs/b.md', content: '' },
      ],
    })

    expect(graph.nodes.map((node) => node.id)).toEqual(['file:docs/a.md', 'file:docs/b.md'])
    expect(graph.edges).toEqual([
      {
        id: 'file-link:file:docs/a.md->file:docs/b.md',
        kind: 'file-link',
        source: 'file:docs/a.md',
        target: 'file:docs/b.md',
      },
    ])
  })

  it('always adds agent nodes and edges them to referenced files', () => {
    const graph = buildKnowledgeGraph({
      agents: [
        {
          id: 'strategist',
          displayName: 'Strategist',
          prompt: 'Use [[docs/plan.md]] and docs/research.md when planning.',
        },
        {
          id: 'writer',
          displayName: 'Writer',
          prompt: 'No explicit knowledge reference.',
        },
      ],
      files: [
        { path: 'docs/plan.md', content: '' },
        { path: 'docs/research.md', content: '' },
      ],
    })

    expect(graph.nodes.some((node) => node.id === 'agent:strategist')).toBe(true)
    expect(graph.nodes.some((node) => node.id === 'agent:writer')).toBe(true)
    expect(graph.edges).toEqual([
      {
        id: 'agent-reference:agent:strategist->file:docs/plan.md',
        kind: 'agent-reference',
        source: 'agent:strategist',
        target: 'file:docs/plan.md',
      },
      {
        id: 'agent-reference:agent:strategist->file:docs/research.md',
        kind: 'agent-reference',
        source: 'agent:strategist',
        target: 'file:docs/research.md',
      },
    ])
  })

  it('detects markdown-style links from agent prompts', () => {
    const graph = buildKnowledgeGraph({
      agents: [
        {
          id: 'researcher',
          displayName: 'Researcher',
          prompt: 'Refer to [the plan](docs/plan.md) before acting.',
        },
      ],
      files: [{ path: 'docs/plan.md', content: '' }],
    })

    expect(graph.edges).toContainEqual({
      id: 'agent-reference:agent:researcher->file:docs/plan.md',
      kind: 'agent-reference',
      source: 'agent:researcher',
      target: 'file:docs/plan.md',
    })
  })

  it('deduplicates duplicate file references', () => {
    const graph = buildKnowledgeGraph({
      files: [
        { path: 'docs/a.md', content: 'See [[docs/b.md]] and [B](docs/b.md).' },
        { path: 'docs/b.md', content: '' },
      ],
    })

    expect(graph.edges).toEqual([
      {
        id: 'file-link:file:docs/a.md->file:docs/b.md',
        kind: 'file-link',
        source: 'file:docs/a.md',
        target: 'file:docs/b.md',
      },
    ])
  })

  it('does not create self-reference edges', () => {
    const graph = buildKnowledgeGraph({
      files: [{ path: 'docs/a.md', content: 'See [[docs/a.md]] and [self](docs/a.md#intro).' }],
    })

    expect(graph.edges).toEqual([])
  })

  it('strips anchors from markdown links', () => {
    const graph = buildKnowledgeGraph({
      files: [
        { path: 'docs/a.md', content: 'See [the plan](docs/plan.md#section).' },
        { path: 'docs/plan.md', content: '' },
      ],
    })

    expect(graph.edges).toContainEqual({
      id: 'file-link:file:docs/a.md->file:docs/plan.md',
      kind: 'file-link',
      source: 'file:docs/a.md',
      target: 'file:docs/plan.md',
    })
  })

  it('does not match raw file paths as substrings', () => {
    const graph = buildKnowledgeGraph({
      agents: [
        {
          id: 'assistant',
          displayName: 'Assistant',
          prompt: 'Use data.md and para.md for context.',
        },
      ],
      files: [
        { path: 'a.md', content: '' },
        { path: 'data.md', content: '' },
      ],
    })

    expect(graph.edges).toEqual([
      {
        id: 'agent-reference:agent:assistant->file:data.md',
        kind: 'agent-reference',
        source: 'agent:assistant',
        target: 'file:data.md',
      },
    ])
  })
})
