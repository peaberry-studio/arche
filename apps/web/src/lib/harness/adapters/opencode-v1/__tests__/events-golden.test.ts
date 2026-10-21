import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { eventStreams, streamingFixture } from '@/lib/harness/adapters/opencode-v1/__tests__/fixtures/event-streams'
import { reduceOpenCodeEvent } from '@/lib/harness/adapters/opencode-v1/__tests__/legacy-event-reducer'
import { toWorkspaceMessage, translateEventStream, translateOpenCodeEvent } from '@/lib/harness/adapters/opencode-v1/events'
import { toHarnessMessage, transformParts } from '@/lib/harness/adapters/opencode-v1/transform'
import type { ArcheEvent } from '@/lib/harness/events'
import { createEmptyChatStore, hydrateSessionIntoStore, reduceArcheEvent } from '@/lib/workspace-events/reducer'

describe('v1 event translation golden parity', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_700_000_000_000) })
  afterEach(() => { vi.useRealTimers() })

  it.each(Object.entries(eventStreams))('%s matches the frozen old reducer after every event', (_name, fixture) => {
    let legacy = createEmptyChatStore()
    let arche = createEmptyChatStore()
    for (const event of fixture) {
      const expected = reduceOpenCodeEvent(legacy, event)
      legacy = expected.store
      let touched = false
      for (const translated of translateOpenCodeEvent(event)) {
        const result = reduceArcheEvent(arche, translated)
        arche = result.store
        touched ||= result.workspaceTouched
      }
      expect(arche).toEqual(legacy)
      expect(touched).toBe(expected.workspaceTouched)
    }
  })

  it('replays exactly 2,000 streaming events with matching state', () => {
    expect(streamingFixture).toHaveLength(2_000)
    let legacy = createEmptyChatStore()
    let arche = createEmptyChatStore()
    for (const event of streamingFixture) {
      legacy = reduceOpenCodeEvent(legacy, event).store
      for (const translated of translateOpenCodeEvent(event)) arche = reduceArcheEvent(arche, translated).store
    }
    expect(arche).toEqual(legacy)
  })

  it('uses identical Arche parts for snapshots and live events, including every part kind', () => {
    const parts = [
      { id: 'text', type: 'text', text: 'Hi' }, { id: 'reasoning', type: 'reasoning', text: 'Think' },
      { id: 'file', type: 'file', url: 'file:///workspace/report.md' }, { id: 'image', type: 'image', url: 'https://example.com/image.png' },
      ...['pending', 'running', 'completed', 'error'].map((status) => ({ id: status, type: 'tool', tool: 'read', state: { status, input: {}, output: 'ok', error: 'failed', title: 'Read' } })),
      { id: 'start', type: 'step-start' }, { id: 'finish', type: 'step-finish', tokens: {} },
      { id: 'patch', type: 'patch', files: ['report.md'] }, { id: 'agent', type: 'agent', name: 'writer' },
      { id: 'subtask', type: 'subtask' }, { id: 'retry', type: 'retry' }, { id: 'other', type: 'future-part', raw: true },
    ]
    const info = { id: 'm1', sessionID: 's1', role: 'assistant', parts, time: { created: 1, completed: 2 } }
    const snapshot = toHarnessMessage(info)
    expect(toWorkspaceMessage(info)).toEqual(snapshot)
    const translated = translateOpenCodeEvent({ type: 'message.updated', properties: { info } })
    const live = translated.reduce((store, event) => reduceArcheEvent(store, event).store, createEmptyChatStore())
    expect(snapshot).not.toBeNull()
    expect(live.messages.s1[0].parts).toEqual(snapshot?.parts)
    expect(transformParts([{ id: 'other', type: 'future-part', raw: true }])).toEqual([{ type: 'unknown', originalType: 'future-part', data: { id: 'other', type: 'future-part', raw: true } }])
  })

  it('hydrates a reconnect snapshot without losing live text and applies later deltas', () => {
    const info = { id: 'm1', sessionID: 's1', role: 'assistant', time: { created: 1 }, parts: [{ id: 'p1', type: 'text', text: 'Hello ' }] }
    const snapshot = toWorkspaceMessage(info)!
    const fromStart = reduceArcheEvent(createEmptyChatStore(), { v: 1, type: 'message.upserted', message: snapshot }).store
    let reconnected = hydrateSessionIntoStore(createEmptyChatStore(), 's1', [snapshot])
    const delta: ArcheEvent = { v: 1, type: 'part.delta', sessionId: 's1', messageId: 'm1', partId: 'p1', field: 'text', delta: 'world' }
    reconnected = reduceArcheEvent(reconnected, delta).store
    expect(reconnected).toEqual(reduceArcheEvent(fromStart, delta).store)
  })

  it('drops unknown events and translates each file/todo event to exactly one workspace touch', () => {
    expect(translateOpenCodeEvent({ type: 'future.event', properties: { secret: 'hidden' } })).toEqual([])
    for (const event of eventStreams.touch.slice(0, 5)) expect(translateOpenCodeEvent(event)).toEqual([{ v: 1, type: 'workspace.touched' }])
  })

  it('handles chunked SSE and malformed frames without buffering the next event', async () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      for (const chunk of [': heartbeat\n\ndata: not-json\n\ndata: {"type":"future.event"}\n\ndata: {"type":"message.part.delta",', '"properties":{"sessionID":"s1","messageID":"m1","partID":"p1","delta":" "}}\n\n']) controller.enqueue(encoder.encode(chunk))
      controller.close()
    } })
    const events: ArcheEvent[] = []
    for await (const event of translateEventStream(body, new AbortController().signal)) events.push(event)
    expect(events).toEqual([{ v: 1, type: 'part.delta', sessionId: 's1', messageId: 'm1', partId: 'p1', field: 'text', delta: ' ' }])
  })
})
