import { describe, expect, it } from 'vitest'

import { parseArcheEvent } from '@/lib/workspace-events/parse-event'
import { createEmptyChatStore, hydrateSessionIntoStore, reduceArcheEvent } from '@/lib/workspace-events/reducer'

describe('Arche browser event boundary', () => {
  it.each([
    'not-json', 'null', '[]',
    JSON.stringify({ type: 'session.status', properties: { sessionID: 's1', status: { type: 'busy' } } }),
    JSON.stringify({ v: 2, type: 'workspace.touched' }),
    JSON.stringify({ v: 1, type: 'future.event' }),
    JSON.stringify({ v: 1, type: 'part.delta', messageId: 'm1', partId: 'p1', delta: 'text', field: 'vendor-field' }),
    JSON.stringify({ v: 1, type: 'part.upserted', messageId: 'm1', part: { type: 'vendor-part' } }),
    JSON.stringify({ v: 1, type: 'part.upserted', messageId: 'm1', part: { type: 'text' } }),
    JSON.stringify({ v: 1, type: 'message.patched', sessionId: 's1', messageId: 'm1', patch: {} }),
    JSON.stringify({ v: 1, type: 'message.upserted', mode: 'patch', sessionId: 's1', messageId: 'm1', patch: { completedAt: 'bad' } }),
    JSON.stringify({ v: 1, type: 'message.upserted', mode: 'commit', sessionId: 's1', messageId: 'm1', timestampRaw: 1 }),
    JSON.stringify({ v: 1, type: 'part.upserted', mode: 'tool-patch', sessionId: 's1', messageId: 'm1', update: { id: 't1', inputDelta: 1 } }),
  ])('ignores malformed, unversioned, future, and raw harness payloads: %s', (data) => {
    expect(parseArcheEvent(data)).toBeNull()
  })

  it('accepts an explicit unknown part with its original type', () => {
    expect(parseArcheEvent(JSON.stringify({ v: 1, type: 'part.upserted', messageId: 'm1', part: { type: 'unknown', originalType: 'future-part', data: { value: 1 } } }))).toMatchObject({ part: { type: 'unknown', originalType: 'future-part' } })
  })

  it('workspace touch changes no conversation state', () => {
    const store = createEmptyChatStore()
    expect(reduceArcheEvent(store, { v: 1, type: 'workspace.touched' })).toEqual({ store, workspaceTouched: true })
    expect(reduceArcheEvent(store, { v: 1, type: 'knowledge.proposals_changed' }).store).toBe(store)
  })

  it('retains normalized snapshot content when there are no incoming parts to merge', () => {
    const snapshot = { id: 'm1', sessionId: 's1', role: 'assistant' as const, content: 'Child progress', timestamp: '', parts: [] }
    expect(hydrateSessionIntoStore(createEmptyChatStore(), 's1', [snapshot]).messages.s1).toEqual([snapshot])
  })
})
