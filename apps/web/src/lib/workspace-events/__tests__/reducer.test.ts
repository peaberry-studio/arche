import { describe, expect, it } from 'vitest'

import type { ArcheEvent } from '@/lib/harness/events'
import { createEmptyChatStore, hydrateSessionIntoStore, prunePendingSessionUpdates, reduceArcheEvent } from '@/lib/workspace-events/reducer'
import type { WorkspaceMessage } from '@/types/workspace-runtime'

describe('deferred workspace events', () => {
  const snapshot: WorkspaceMessage = {
    id: 'm1', sessionId: 's1', role: 'assistant', content: '', timestamp: '', timestampRaw: 1,
    parts: [{ type: 'tool', id: 'call', name: 'read', state: { status: 'running', input: {} } }],
  }

  it('coalesces streaming arguments and replays the complete tool state after hydration', () => {
    let store = createEmptyChatStore()
    const apply = (update: Extract<ArcheEvent, { mode: 'tool-patch' }>['update']) => {
      store = reduceArcheEvent(store, { v: 1, type: 'part.upserted', mode: 'tool-patch', sessionId: 's1', messageId: 'm1', update }).store
    }
    for (let i = 0; i < 2_000; i++) apply({ id: 'call', inputDelta: 'a' })
    expect(store.pendingUpdates?.m1).toHaveLength(1)
    expect(store.pendingUpdates?.m1[0]).toMatchObject({ update: { inputDelta: 'a'.repeat(2_000) } })
    apply({ id: 'call', rawInput: '{"path":"note.md"}' })
    apply({ id: 'call', status: 'running', input: { path: 'note.md' } })
    apply({ id: 'call', status: 'completed', output: 'File contents', metadata: { title: 'note.md' } })

    const hydrated = hydrateSessionIntoStore(store, 's1', [snapshot])
    expect(hydrated.pendingUpdates).toEqual({})
    expect(hydrated.messages.s1[0].parts).toEqual([{
      type: 'tool', id: 'call', name: 'read', state: {
        status: 'completed', input: { path: 'note.md' }, output: 'File contents', title: 'note.md', metadata: { title: 'note.md' },
      },
    }])
  })

  it('replays deferred patches when the tool identity arrives before the message', () => {
    let store = reduceArcheEvent(createEmptyChatStore(), { v: 1, type: 'part.upserted', mode: 'tool-patch', sessionId: 's1', messageId: 'm1', update: { id: 'call', inputDelta: 'abc' } }).store
    store = reduceArcheEvent(store, { v: 1, type: 'part.upserted', mode: 'tool-patch', sessionId: 's1', messageId: 'm1', update: { id: 'call', name: 'read', status: 'pending', rawInput: '' } }).store
    expect(store.pendingUpdates).toEqual({})
    expect(store.pendingParts.m1).toMatchObject([{ name: 'read', state: { rawInput: 'abc' } }])
  })

  it('bounds forgotten message queues and evicts their buffered parts', () => {
    let store = createEmptyChatStore()
    for (let i = 0; i < 1_000; i++) {
      const messageId = `m${i}`
      store = reduceArcheEvent(store, { v: 1, type: 'part.upserted', sessionId: 's1', messageId, part: { type: 'text', id: 'text', text: 'orphan' } }).store
      store = reduceArcheEvent(store, { v: 1, type: 'message.upserted', mode: 'commit', sessionId: 's1', messageId, timestamp: '', timestampRaw: i }).store
    }
    expect(Object.keys(store.pendingUpdates ?? {})).toHaveLength(100)
    expect(Object.keys(store.pendingParts)).toHaveLength(100)
    expect(store.pendingUpdates?.m999).toBeDefined()
    expect(store.pendingParts.m0).toBeUndefined()
  })

  it('cleans one idle session while preserving another session and hydrated messages', () => {
    let store = hydrateSessionIntoStore(createEmptyChatStore(), 's1', [snapshot])
    for (const sessionId of ['s1', 's2']) {
      store = reduceArcheEvent(store, { v: 1, type: 'message.upserted', mode: 'commit', sessionId, messageId: `compaction-${sessionId}`, timestamp: '', timestampRaw: 2 }).store
    }
    const cleaned = prunePendingSessionUpdates(store, 's1')
    expect(Object.keys(cleaned.pendingUpdates ?? {})).toEqual(['compaction-s2'])
    expect(cleaned.messages.s1).toEqual([snapshot])
  })
})
