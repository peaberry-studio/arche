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
    expect(takeWorkspaceStartPrompt(storage, 'alice')).toBe('hello world')
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

    expect(takeWorkspaceStartPrompt(storage, 'alice')).toBe('hello')
    expect(takeWorkspaceStartPrompt(storage, 'alice')).toBeNull()
  })

  it('takeWorkspaceStartPrompt isolates by slug', () => {
    const storage = createMemoryStorage()
    setWorkspaceStartPrompt(storage, 'alice', 'hello')

    expect(takeWorkspaceStartPrompt(storage, 'bob')).toBeNull()
    expect(takeWorkspaceStartPrompt(storage, 'alice')).toBe('hello')
  })

})
