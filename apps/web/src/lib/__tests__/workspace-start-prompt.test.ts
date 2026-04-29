import { describe, expect, it } from 'vitest'

import { setWorkspaceStartPrompt, takeWorkspaceStartPrompt } from '@/lib/workspace-start-prompt'

function createMemoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
  }
}

describe('workspace start prompt storage', () => {
  it('setWorkspaceStartPrompt stores a trimmed prompt', () => {
    const storage = createMemoryStorage()
    const ok = setWorkspaceStartPrompt(storage, 'alice', '  hello world  ')

    expect(ok).toBe(true)
    expect(takeWorkspaceStartPrompt(storage, 'alice')).toEqual({
      text: 'hello world',
      contextPaths: [],
    })
  })

  it('setWorkspaceStartPrompt returns false for empty/whitespace prompt', () => {
    const storage = createMemoryStorage()
    expect(setWorkspaceStartPrompt(storage, 'alice', '   ')).toBe(false)
    expect(takeWorkspaceStartPrompt(storage, 'alice')).toBeNull()
  })

  it('takeWorkspaceStartPrompt returns null when not set', () => {
    const storage = createMemoryStorage()
    expect(takeWorkspaceStartPrompt(storage, 'alice')).toBeNull()
  })

  it('takeWorkspaceStartPrompt consumes the value (one-shot)', () => {
    const storage = createMemoryStorage()
    setWorkspaceStartPrompt(storage, 'alice', 'hello')

    expect(takeWorkspaceStartPrompt(storage, 'alice')).toEqual({
      text: 'hello',
      contextPaths: [],
    })
    expect(takeWorkspaceStartPrompt(storage, 'alice')).toBeNull()
  })

  it('takeWorkspaceStartPrompt isolates by slug', () => {
    const storage = createMemoryStorage()
    setWorkspaceStartPrompt(storage, 'alice', 'hello')

    expect(takeWorkspaceStartPrompt(storage, 'bob')).toBeNull()
    expect(takeWorkspaceStartPrompt(storage, 'alice')).toEqual({
      text: 'hello',
      contextPaths: [],
    })
  })

  it('stores selected context paths with the prompt', () => {
    const storage = createMemoryStorage()
    const ok = setWorkspaceStartPrompt(storage, 'alice', {
      text: 'Review this',
      contextPaths: ['docs/plan.md', ' docs/plan.md ', 'notes/research.md'],
    })

    expect(ok).toBe(true)
    expect(takeWorkspaceStartPrompt(storage, 'alice')).toEqual({
      text: 'Review this',
      contextPaths: ['docs/plan.md', 'notes/research.md'],
    })
  })

  it('reads legacy plain text prompts', () => {
    const storage = createMemoryStorage()
    storage.setItem('arche.workspaceStartPrompt.v1:alice', 'legacy prompt')

    expect(takeWorkspaceStartPrompt(storage, 'alice')).toEqual({
      text: 'legacy prompt',
      contextPaths: [],
    })
  })

})
