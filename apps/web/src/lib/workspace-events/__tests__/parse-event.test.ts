import { describe, expect, it } from 'vitest'

import { parseArcheEvent } from '@/lib/workspace-events/parse-event'
import { createEmptyChatStore, reduceArcheEvent } from '@/lib/workspace-events/reducer'

describe('Arche browser event boundary', () => {
  it.each([
    'not-json', 'null', '[]',
    JSON.stringify({ type: 'session.status', properties: { sessionID: 's1', status: { type: 'busy' } } }),
    JSON.stringify({ v: 2, type: 'workspace.touched' }),
    JSON.stringify({ v: 1, type: 'future.event' }),
    JSON.stringify({ v: 1, type: 'part.delta', messageId: 'm1', partId: 'p1', delta: 'text', field: 'vendor-field' }),
    JSON.stringify({ v: 1, type: 'part.upserted', messageId: 'm1', part: { type: 'vendor-part' } }),
    JSON.stringify({ v: 1, type: 'part.upserted', messageId: 'm1', part: { type: 'text' } }),
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
})
