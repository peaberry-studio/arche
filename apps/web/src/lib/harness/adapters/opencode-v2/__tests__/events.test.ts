import type { OpenCodeEvent, ToolContent } from '@opencode/client'
import { describe, expect, it } from 'vitest'

import { formatTimestamp } from '@/lib/format-timestamp'
import { assistantSnapshot, ASSISTANT_ID, endedEvent, failedEvent, mixedContent, mixedEvents, MIXED_MESSAGE_ID, model, permission, permissionEvents, SESSION_ID, textEvents, toolEvents, toolSnapshot, TOOL_MESSAGE_ID, TOOL_SESSION_ID } from '@/lib/harness/adapters/opencode-v2/__tests__/fixtures'
import { translateOpenCodeEvent } from '@/lib/harness/adapters/opencode-v2/events'
import { toArchePermission, toHarnessMessage, toInboxMessage, transformParts } from '@/lib/harness/adapters/opencode-v2/transform'
import { parseArcheEvent } from '@/lib/workspace-events/parse-event'
import { createEmptyChatStore, hydrateSessionIntoStore, reduceArcheEvent } from '@/lib/workspace-events/reducer'

function apply(events: OpenCodeEvent[]) {
  let store = createEmptyChatStore()
  for (const event of events) {
    const result = translateOpenCodeEvent(event)
    if (!result.ok) throw new Error(result.error.detail)
    for (const arche of result.data) {
      expect(parseArcheEvent(JSON.stringify(arche))).toEqual(arche)
      store = reduceArcheEvent(store, arche).store
    }
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
    expect(first).toEqual({ ok: true, data: [{ v: 1, at: delta.created, type: 'part.delta', sessionId: SESSION_ID, messageId: ASSISTANT_ID, partId: `${ASSISTANT_ID}:text:0`, field: 'text', delta: 'Hello fixture' }] })
    expect(translateOpenCodeEvent({ ...delta, id: 'different-event-id' })).toEqual(first)
    expect(first).not.toBeInstanceOf(Promise)
  })

  it('normalizes captured permission events identically to permission-list snapshots', () => {
    const asked = translateOpenCodeEvent(permissionEvents[0])
    expect(asked).toEqual({ ok: true, data: [{ v: 1, type: 'permission.asked', permission: toArchePermission(permission) }] })
    expect(apply([permissionEvents[0]]).permissions[permission.sessionID]).toEqual([toArchePermission(permission)])
    expect(apply(permissionEvents).permissions).toEqual({})
  })

  it('matches the entire completed captured text snapshot without hydration', () => {
    expect(apply([...textEvents, endedEvent]).messages[SESSION_ID]).toEqual([toHarnessMessage({ ...assistantSnapshot, sessionID: SESSION_ID })])
  })

  it('merges captured partial tools by call ID and matches the complete captured snapshot', () => {
    const start = { ...textEvents[0], data: { sessionID: TOOL_SESSION_ID, assistantMessageID: TOOL_MESSAGE_ID, agent: 'probe', model, started: toolSnapshot.time.created } }
    const end = { ...endedEvent, created: toolSnapshot.time.completed, data: { ...endedEvent.data, sessionID: TOOL_SESSION_ID, assistantMessageID: TOOL_MESSAGE_ID, finish: 'tool-calls' as const } }
    const store = apply([start, ...toolEvents, end])
    expect(store.messages[TOOL_SESSION_ID]).toEqual([toHarnessMessage({ ...toolSnapshot, sessionID: TOOL_SESSION_ID })])
    expect(apply([start, ...toolEvents.slice(0, 2)]).messages[TOOL_SESSION_ID][0].parts).toEqual(transformParts([{ ...toolSnapshot.content[0], state: { status: 'streaming', input: '{"path":"/workspace/sample.txt"}' } }], TOOL_MESSAGE_ID))
  })

  it('does not double count cumulative session usage as per-message accounting', () => {
    const event: OpenCodeEvent = { id: 'evt_usage', created: 1, type: 'session.usage.updated', data: { sessionID: SESSION_ID, cost: 1, tokens: { input: 22, output: 6, reasoning: 0, cache: { read: 0, write: 0 } } } }
    expect(translateOpenCodeEvent(event)).toEqual({ ok: true, data: [] })
  })

  it('does not interpret the connection marker as replay or idle', () => {
    expect(translateOpenCodeEvent({ id: 'connected', type: 'server.connected', data: {} })).toEqual({ ok: true, data: [] })
  })

  it('patches the addressed failed step, preserving creation, model, agent and other messages', () => {
    const data = failedEvent.data
    const start = { ...textEvents[0], data: { ...textEvents[0].data, sessionID: data.sessionID, assistantMessageID: data.assistantMessageID, started: failedEvent.created - 10 } }
    const store = apply([start, failedEvent])
    const snapshot = toHarnessMessage({ id: data.assistantMessageID, sessionID: data.sessionID, type: 'assistant', agent: 'probe', model, content: [], error: data.error, time: { created: failedEvent.created - 10, completed: failedEvent.created } })
    expect(store.messages[data.sessionID]).toEqual([snapshot])
  })

  it('shows queued input with attachments at enqueue, moves it to its delivery time and drops cancelled input', () => {
    const enqueued: OpenCodeEvent = { id: 'evt_enqueue', created: 1, type: 'session.inbox.enqueued', durable: { aggregateID: SESSION_ID, seq: 1, version: 1 },
      data: { sessionID: SESSION_ID, inboxID: 'user', item: { type: 'user', delivery: 'queue', payload: { text: 'hello', files: [{ mime: 'text/plain', data: 'YQ==', name: 'a.txt', source: { type: 'inline' } }] } } } }
    const delivered: OpenCodeEvent = { id: 'evt_delivery', created: 2, type: 'session.inbox.delivered', durable: { aggregateID: SESSION_ID, seq: 2, version: 1 }, data: { sessionID: SESSION_ID, inboxID: 'user' } }
    const native = { sessionID: SESSION_ID, type: 'user', text: 'hello', files: [{ mime: 'text/plain', data: 'YQ==', name: 'a.txt', source: { type: 'inline' } }] }
    const pending = toInboxMessage(SESSION_ID, { id: 'user', type: 'user', delivery: 'queue', payload: { text: native.text, files: native.files }, time: { created: 1 } })
    expect(apply([enqueued]).messages[SESSION_ID]).toEqual([pending])
    expect(apply([enqueued, delivered]).messages[SESSION_ID]).toEqual([toHarnessMessage({ ...native, id: 'user', time: { created: 2 } })])
    expect(apply([enqueued, { ...delivered, type: 'session.inbox.cancelled' }]).messages).toEqual({})
  })

  it('applies a delivery whose enqueue was missed once a snapshot supplies the queued input', () => {
    const delivered: OpenCodeEvent = { id: 'evt_delivery', created: 5, type: 'session.inbox.delivered', durable: { aggregateID: SESSION_ID, seq: 2, version: 1 }, data: { sessionID: SESSION_ID, inboxID: 'queued' } }
    const missed = apply([delivered])
    expect(missed.messages).toEqual({})
    const pending = toInboxMessage(SESSION_ID, { id: 'queued', type: 'user', delivery: 'steer', payload: { text: 'later' }, time: { created: 3 } })
    if (!pending) throw new Error('Invalid fixture')
    const hydrated = hydrateSessionIntoStore(missed, SESSION_ID, [pending])
    expect(hydrated.messages[SESSION_ID]).toEqual([{ ...pending, timestamp: formatTimestamp(5), timestampRaw: 5 }])
    expect(hydrated.pendingUpdates).toEqual({})
    expect(hydrateSessionIntoStore(hydrated, SESSION_ID, [pending]).messages[SESSION_ID][0].timestampRaw).toBe(5)
  })

  it('uses authoritative ended text even when shorter, then rejects stale deltas after completed hydration', () => {
    const shorter = { ...textEvents[3], data: { ...textEvents[3].data, text: 'Hi' } }
    expect(apply([...textEvents.slice(0, 3), shorter]).messages[SESSION_ID][0].content).toBe('Hi')
    const snapshot = toHarnessMessage({ ...assistantSnapshot, sessionID: SESSION_ID })
    if (!snapshot) throw new Error('Invalid fixture')
    const hydrated = hydrateSessionIntoStore(createEmptyChatStore(), SESSION_ID, [snapshot])
    const delta = translateOpenCodeEvent(textEvents[2])
    if (!delta.ok) throw new Error('Invalid fixture')
    expect(reduceArcheEvent(hydrated, delta.data[0]).store).toEqual(hydrated)
  })

  it('reconnects at every text cut point and reaches full snapshot parity', () => {
    const events = [...textEvents, endedEvent]
    for (let cut = 1; cut <= events.length; cut++) {
      const snapshot = toHarnessMessage({ ...assistantSnapshot, sessionID: SESSION_ID,
        ...(cut < events.length && { time: { created: assistantSnapshot.time.created }, finish: undefined, cost: undefined, tokens: undefined,
          content: cut < 2 ? [] : [{ type: 'text', text: cut < 3 ? '' : 'Hello fixture' }] }),
      })
      if (!snapshot) throw new Error('Invalid fixture')
      let resumed = hydrateSessionIntoStore(createEmptyChatStore(), SESSION_ID, [snapshot])
      for (const event of events.slice(cut)) {
        const result = translateOpenCodeEvent(event)
        if (!result.ok) throw new Error('Invalid fixture')
        for (const arche of result.data) resumed = reduceArcheEvent(resumed, arche).store
      }
      expect(resumed.messages[SESSION_ID]).toEqual([toHarnessMessage({ ...assistantSnapshot, sessionID: SESSION_ID })])
    }
  })

  it('preserves tool progress, completed metadata and files with snapshot-identical transforms', () => {
    const original = toolEvents[3]
    const content = [{ type: 'text', text: 'chart' }, { type: 'file', uri: 'file:///workspace/.arche/attachments/chart.png', mime: 'image/png', name: 'chart.png' }] satisfies [ToolContent, ToolContent]
    const metadata = { title: 'Chart', chart: { values: [1, 2] }, document: { pages: 1 } }
    const success = { ...original, data: { ...original.data, content, metadata } }
    const progress: OpenCodeEvent = { id: 'evt_progress', created: original.created - 1, type: 'session.tool.progress', data: { sessionID: TOOL_SESSION_ID, assistantMessageID: TOOL_MESSAGE_ID, id: 'call_probe', metadata: { title: 'Working' } } }
    const actual = apply([...toolEvents.slice(0, 3), progress, success]).pendingParts[TOOL_MESSAGE_ID]
    expect(actual).toEqual(transformParts([{ ...toolSnapshot.content[0], state: { ...toolSnapshot.content[0].state, content, metadata } }], TOOL_MESSAGE_ID))
  })

  it('preserves failed tool content and metadata and clears retry on the addressed step failure', () => {
    const failure: OpenCodeEvent = { id: 'evt_tool_fail', created: toolEvents[3].created, type: 'session.tool.failed', durable: { aggregateID: TOOL_SESSION_ID, seq: 10, version: 2 },
      data: { ...toolEvents[3].data, error: { type: 'tool.execution', message: 'Denied' }, metadata: { diagnostic: true } } }
    const actual = apply([...toolEvents.slice(0, 3), failure]).pendingParts[TOOL_MESSAGE_ID]
    expect(actual).toEqual(transformParts([{ ...toolSnapshot.content[0], state: { ...toolSnapshot.content[0].state, status: 'error', error: failure.data.error, metadata: failure.data.metadata } }], TOOL_MESSAGE_ID))
    const start = { ...textEvents[0], data: { ...textEvents[0].data, ...failedEvent.data, started: failedEvent.created - 2 } }
    const retry: OpenCodeEvent = { id: 'evt_retry', created: failedEvent.created - 1, type: 'session.retry.scheduled', durable: { aggregateID: failedEvent.data.sessionID, seq: 2, version: 1 },
      data: { ...failedEvent.data, attempt: 1, at: failedEvent.created + 100 } }
    expect(apply([start, retry]).messages[failedEvent.data.sessionID][0].parts).toMatchObject([{ type: 'retry', attempt: 1 }])
    expect(apply([start, retry, failedEvent]).messages[failedEvent.data.sessionID][0].parts).toEqual([])
  })

  it('retains partial step/tool updates until a reconnect snapshot supplies missing identity', () => {
    const store = apply(toolEvents.slice(2))
    expect(store.pendingUpdates?.[TOOL_MESSAGE_ID]).toHaveLength(2)
    const snapshot = toHarnessMessage({ ...toolSnapshot, sessionID: TOOL_SESSION_ID, finish: undefined, cost: undefined, tokens: undefined,
      time: { created: toolSnapshot.time.created }, content: [{ ...toolSnapshot.content[0], state: { status: 'running', input: { path: '/workspace/sample.txt' }, metadata: {} } }] })
    if (!snapshot) throw new Error('Invalid fixture')
    const hydrated = hydrateSessionIntoStore(store, TOOL_SESSION_ID, [snapshot])
    expect(hydrated.messages[TOOL_SESSION_ID][0].parts).toEqual(transformParts(toolSnapshot.content, TOOL_MESSAGE_ID))
    expect(hydrated.pendingUpdates).toEqual({})
  })

  it('keeps children, renamed sessions and execution failures isolated', () => {
    const child: OpenCodeEvent = { id: 'evt_child', created: 1, type: 'session.created', durable: { aggregateID: 'child', seq: 1, version: 1 },
      data: { sessionID: 'child', projectID: 'project', location: { directory: '/workspace' }, slug: 'child', title: 'Original', parentID: SESSION_ID, version: '2.0.32' } }
    const rename: OpenCodeEvent = { id: 'evt_rename', created: 2, type: 'session.renamed', durable: { aggregateID: 'child', seq: 2, version: 1 }, data: { sessionID: 'child', title: 'Renamed' } }
    const failure: OpenCodeEvent = { id: 'evt_execution_fail', created: 3, type: 'session.execution.failed', durable: { aggregateID: 'child', seq: 3, version: 1 }, data: { sessionID: 'child', error: { type: 'provider.auth', message: 'API key is missing' } } }
    const store = apply([...textEvents, child, rename, failure])
    expect(store.sessions[0]).toMatchObject({ id: 'child', title: 'Renamed', parentId: SESSION_ID })
    expect(store.sessionStatus.child).toBe('idle')
    expect(store.messages[SESSION_ID][0].statusInfo).toBeUndefined()
    const deleted = apply([child, { id: 'evt_delete', created: 3, type: 'session.deleted', durable: { aggregateID: 'child', seq: 3, version: 2 }, data: { sessionID: 'child' } }])
    expect(deleted.sessions).toEqual([])
  })
})
