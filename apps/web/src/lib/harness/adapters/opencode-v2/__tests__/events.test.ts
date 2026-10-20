import type { OpenCodeEvent } from '@opencode/client'
import { describe, expect, it, vi } from 'vitest'

import { assistantSnapshot, ASSISTANT_ID, endedEvent, failedEvent, mixedContent, mixedEvents, MIXED_MESSAGE_ID, permission, permissionEvents, SESSION_ID, textEvents, toolEvents } from '@/lib/harness/adapters/opencode-v2/__tests__/fixtures'
import { subscribeOpenCodeEvents, translateOpenCodeEvent, V2_EVENT_STREAM_UNVERIFIED } from '@/lib/harness/adapters/opencode-v2/events'
import { toArchePermission, toHarnessMessage, transformParts } from '@/lib/harness/adapters/opencode-v2/transform'
import { createEmptyChatStore, hydrateSessionIntoStore, reduceArcheEvent } from '@/lib/workspace-events/reducer'

function apply(events: OpenCodeEvent[]) {
  let store = createEmptyChatStore()
  for (const event of events) {
    const result = translateOpenCodeEvent(event)
    if (!result.ok) throw new Error(result.error.detail)
    for (const arche of result.data) store = reduceArcheEvent(store, arche).store
  }
  return store
}

describe('v2 synchronous event translation', () => {
  it('reduces captured live text to the same text/IDs as the message snapshot', () => {
    const store = apply(textEvents)
    const snapshot = toHarnessMessage({ ...assistantSnapshot, sessionID: SESSION_ID })
    expect(store.messages[SESSION_ID][0].parts).toEqual(snapshot?.parts.filter((part) => part.type === 'text'))
    expect(store.messages[SESSION_ID][0].content).toBe(snapshot?.content)
    expect(store.messages[SESSION_ID][0].timestampRaw).toBe(snapshot?.timestampRaw)
  })

  it('hydrates after the stream without duplicating text or accounting parts', () => {
    const snapshot = toHarnessMessage({ ...assistantSnapshot, sessionID: SESSION_ID })
    if (!snapshot) throw new Error('Invalid fixture')
    const hydrated = hydrateSessionIntoStore(apply(textEvents), SESSION_ID, [snapshot])
    expect(hydrated.messages[SESSION_ID]).toEqual([snapshot])
    expect(hydrateSessionIntoStore(hydrated, SESSION_ID, [snapshot])).toEqual(hydrated)
  })

  it('matches captured interleaved reasoning/text IDs using separate ordinal counters', () => {
    expect(apply(mixedEvents).pendingParts[MIXED_MESSAGE_ID]).toEqual(transformParts(mixedContent, MIXED_MESSAGE_ID))
  })

  it('uses ordinal IDs rather than event IDs and translates each delta immediately', () => {
    const delta = textEvents[2]
    const first = translateOpenCodeEvent(delta)
    expect(first).toEqual({ ok: true, data: [{ v: 1, type: 'part.delta', sessionId: SESSION_ID, messageId: ASSISTANT_ID, partId: `${ASSISTANT_ID}:text:0`, field: 'text', delta: 'Hello fixture' }] })
    expect(translateOpenCodeEvent({ ...delta, id: 'different-event-id' })).toEqual(first)
    expect(first).not.toBeInstanceOf(Promise)
  })

  it('normalizes captured permission events identically to permission-list snapshots', () => {
    const asked = translateOpenCodeEvent(permissionEvents[0])
    expect(asked).toEqual({ ok: true, data: [{ v: 1, type: 'permission.asked', permission: toArchePermission(permission) }] })
    expect(apply([permissionEvents[0]]).permissions[permission.sessionID]).toEqual([toArchePermission(permission)])
    expect(apply(permissionEvents).permissions).toEqual({})
  })

  it('refuses captured partial tool events rather than fabricating names, inputs or state', () => {
    for (const event of toolEvents) expect(translateOpenCodeEvent(event)).toMatchObject({ ok: false, error: { code: 'runtime_unsupported', detail: expect.stringContaining('UNVERIFIED') } })
  })

  it('refuses partial step completion/failure rather than inventing timestamp/model metadata', () => {
    for (const event of [endedEvent, failedEvent]) expect(translateOpenCodeEvent(event)).toMatchObject({ ok: false, error: { code: 'runtime_unsupported' } })
  })

  it('does not double count cumulative session usage as per-message accounting', () => {
    const event: OpenCodeEvent = { id: 'evt_usage', created: 1, type: 'session.usage.updated', data: { sessionID: SESSION_ID, cost: 1, tokens: { input: 22, output: 6, reasoning: 0, cache: { read: 0, write: 0 } } } }
    expect(translateOpenCodeEvent(event)).toEqual({ ok: true, data: [] })
  })

  it('does not interpret the connection marker as replay or idle', () => {
    expect(translateOpenCodeEvent({ id: 'connected', type: 'server.connected', data: {} })).toEqual({ ok: true, data: [] })
  })

  it('fails subscription before opening transport while patch semantics remain unavailable', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('must not connect'))
    try {
      expect(await subscribeOpenCodeEvents('alice', new AbortController().signal)).toEqual({ ok: false, error: { code: 'runtime_unsupported', detail: V2_EVENT_STREAM_UNVERIFIED } })
      expect(fetch).not.toHaveBeenCalled()
    } finally { fetch.mockRestore() }
  })
})
