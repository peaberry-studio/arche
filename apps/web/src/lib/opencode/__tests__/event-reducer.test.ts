import { describe, expect, it } from 'vitest'

import {
  createEmptyChatStore,
  hydratePermissionsIntoStore,
  hydrateSessionIntoStore,
  isSending,
  overlaySessionRuntimeStatus,
  reduceOpenCodeEvent,
  toWorkspaceMessage,
  type ChatStore,
} from '@/lib/opencode/event-reducer'

function apply(store: ChatStore, type: string, properties: Record<string, unknown> = {}): ChatStore {
  return reduceOpenCodeEvent(store, { type, properties }).store
}

describe('reduceOpenCodeEvent', () => {
  describe('session.status', () => {
    const applyStatus = (type: string) => apply(createEmptyChatStore(), 'session.status', {
      sessionID: 's1',
      status: { type },
    })

    it('marks busy', () => {
      expect(applyStatus('busy').sessionStatus).toEqual({ s1: 'busy' })
    })

    it('marks retry as busy', () => {
      expect(applyStatus('retry').sessionStatus).toEqual({ s1: 'busy' })
    })

    it('marks idle', () => {
      expect(applyStatus('idle').sessionStatus).toEqual({ s1: 'idle' })
    })

    it('treats unknown status as busy (never idle unless explicit)', () => {
      expect(applyStatus('queued').sessionStatus).toEqual({ s1: 'busy' })
    })

    it('does not touch other sessions', () => {
      const store = apply(createEmptyChatStore(), 'session.status', {
        sessionID: 'other',
        status: { type: 'busy' },
      })
      expect(store.sessionStatus).toEqual({ other: 'busy' })
      expect(isSending(store, 's1')).toBe(false)
    })
  })

  it('session.idle sets idle implicitly', () => {
    const store = apply(apply(createEmptyChatStore(), 'session.status', {
      sessionID: 's1',
      status: { type: 'busy' },
    }), 'session.idle', { sessionID: 's1' })
    expect(store.sessionStatus.s1).toBe('idle')
  })

  it('session.error marks last assistant statusInfo error', () => {
    let store = createEmptyChatStore()
    store = apply(store, 'message.updated', {
      info: { id: 'm1', role: 'assistant', sessionID: 's1', time: { created: 1 }, parts: [] },
    })
    store = apply(store, 'session.error', {
      sessionID: 's1',
      error: { data: { message: 'boom' } },
    })
    const assistant = store.messages.s1.find((m) => m.id === 'm1')
    expect(assistant?.statusInfo).toEqual({ status: 'error', detail: 'boom' })
  })

  describe('message.updated', () => {
    it('inserts assistant message', () => {
      const store = apply(createEmptyChatStore(), 'message.updated', {
        info: {
          id: 'm1',
          role: 'assistant',
          sessionID: 's1',
          time: { type: 1000, created: 1000 },
          parts: [{ type: 'text', text: 'hi' }],
        },
      })
      const message = store.messages.s1.find((m) => m.id === 'm1')
      expect(message?.role).toBe('assistant')
      expect(message?.content).toBe('hi')
      expect(message?.parts[0]).toMatchObject({ type: 'text', text: 'hi' })
    })

    it('updates by id instead of duplicating', () => {
      const base = apply(createEmptyChatStore(), 'message.updated', {
        info: { id: 'm1', role: 'assistant', sessionID: 's1', parts: [{ type: 'text', text: 'a' }] },
      })
      const store = apply(base, 'message.updated', {
        info: { id: 'm1', role: 'assistant', sessionID: 's1', parts: [{ type: 'text', text: 'ab' }] },
      })
      expect(store.messages.s1).toHaveLength(1)
      expect(store.messages.s1[0].content).toBe('ab')
    })

    it('sorts messages by created then id', () => {
      let store = createEmptyChatStore()
      store = apply(store, 'message.updated', {
        info: { id: 'm2', role: 'user', sessionID: 's1', time: { created: 2 }, parts: [] },
      })
      store = apply(store, 'message.updated', {
        info: { id: 'm1', role: 'user', sessionID: 's1', time: { created: 1 }, parts: [] },
      })
      expect(store.messages.s1.map((m) => m.id)).toEqual(['m1', 'm2'])
    })
  })

  describe('message.part.updated', () => {
    it('inserts a part into an existing message', () => {
      const store = apply(
        apply(createEmptyChatStore(), 'message.updated', {
          info: { id: 'm1', role: 'assistant', sessionID: 's1', parts: [] },
        }),
        'message.part.updated',
        { part: { id: 'p1', type: 'text', text: 'x', messageID: 'm1', sessionID: 's1' } },
      )
      expect(store.messages.s1[0].parts).toMatchObject([{ type: 'text', text: 'x' }])
    })

    it('replaces an existing part by id', () => {
      let store = apply(createEmptyChatStore(), 'message.updated', {
        info: { id: 'm1', role: 'assistant', sessionID: 's1', parts: [{ id: 'p1', type: 'text', text: 'x' }] },
      })
      store = apply(store, 'message.part.updated', {
        part: { id: 'p1', type: 'text', text: 'xy', messageID: 'm1', sessionID: 's1' },
      })
      const textParts = store.messages.s1[0].parts.filter((p) => p.type === 'text')
      expect(textParts).toHaveLength(1)
      expect(textParts[0].text).toBe('xy')
    })

    it('skips patch / step-start / step-finish', () => {
      let store = apply(createEmptyChatStore(), 'message.updated', {
        info: { id: 'm1', role: 'assistant', sessionID: 's1', parts: [] },
      })
      for (const type of ['patch', 'step-start', 'step-finish']) {
        store = apply(store, 'message.part.updated', {
          part: { id: `p-${type}`, type, messageID: 'm1', sessionID: 's1' },
        })
      }
      expect(store.messages.s1[0].parts).toHaveLength(0)
    })
  })

  describe('message.part.delta', () => {
    it('appends to an existing text part', () => {
      let store = apply(createEmptyChatStore(), 'message.updated', {
        info: { id: 'm1', role: 'assistant', sessionID: 's1', parts: [{ id: 'p1', type: 'text', text: 'He' }] },
      })
      store = apply(store, 'message.part.delta', {
        messageID: 'm1',
        partID: 'p1',
        field: 'text',
        delta: 'llo',
      })
      const textPart = store.messages.s1[0].parts.find((p) => p.type === 'text')
      expect(textPart?.text).toBe('Hello')
    })

    it('appends whitespace-only deltas (streaming word separators)', () => {
      let store = apply(createEmptyChatStore(), 'message.updated', {
        info: { id: 'm1', role: 'assistant', sessionID: 's1', parts: [{ id: 'p1', type: 'text', text: 'Hello' }] },
      })
      store = apply(store, 'message.part.delta', {
        messageID: 'm1',
        partID: 'p1',
        field: 'text',
        delta: ' ',
      })
      store = apply(store, 'message.part.delta', {
        messageID: 'm1',
        partID: 'p1',
        field: 'text',
        delta: 'World',
      })
      const textPart = store.messages.s1[0].parts.find((p) => p.type === 'text')
      expect(textPart?.text).toBe('Hello World')
    })

    it('no-ops when the part does not yet exist', () => {
      let store = apply(createEmptyChatStore(), 'message.updated', {
        info: { id: 'm1', role: 'assistant', sessionID: 's1', parts: [] },
      })
      store = apply(store, 'message.part.delta', {
        messageID: 'm1',
        partID: 'ghost',
        field: 'text',
        delta: 'x',
      })
      expect(store.messages.s1[0].parts).toHaveLength(0)
    })

    it('no-ops when the message does not yet exist', () => {
      const store = apply(createEmptyChatStore(), 'message.part.delta', {
        messageID: 'ghost-message',
        partID: 'p1',
        field: 'text',
        delta: 'x',
      })
      expect(Object.keys(store.messages)).toHaveLength(0)
    })
  })

  describe('part/message removal', () => {
    it('message.part.removed drops the part', () => {
      let store = apply(createEmptyChatStore(), 'message.updated', {
        info: { id: 'm1', role: 'assistant', sessionID: 's1', parts: [
          { id: 'p1', type: 'text', text: 'a' },
          { id: 'p2', type: 'text', text: 'b' },
        ] },
      })
      store = apply(store, 'message.part.removed', { messageID: 'm1', partID: 'p1' })
      expect(store.messages.s1[0].parts.map((p) => p.id)).toEqual(['p2'])
    })

    it('message.removed drops the message', () => {
      let store = apply(createEmptyChatStore(), 'message.updated', {
        info: { id: 'm1', role: 'user', sessionID: 's1', parts: [] },
      })
      store = apply(store, 'message.removed', { messageID: 'm1' })
      expect(store.messages.s1 ?? []).toHaveLength(0)
    })
  })

  describe('permissions', () => {
    it('permission.asked inserts normalized permission', () => {
      const store = apply(createEmptyChatStore(), 'permission.asked', {
        permission: { id: 'perm-1', sessionID: 's1', pattern: 'Edit(*)', permission: 'Edit file' },
      })
      expect(store.permissions.s1).toMatchObject([
        { id: 'perm-1', sessionId: 's1', title: 'Edit file', pattern: 'Edit(*)' },
      ])
    })

    it('permission.updated replaces by id', () => {
      let store = apply(createEmptyChatStore(), 'permission.asked', {
        permission: { id: 'perm-1', sessionID: 's1', permission: 'Edit file' },
      })
      store = apply(store, 'permission.updated', {
        permission: { id: 'perm-1', sessionID: 's1', permission: 'Read file' },
      })
      expect(store.permissions.s1).toHaveLength(1)
      expect(store.permissions.s1[0].title).toBe('Read file')
    })

    it('permission.replied removes by id', () => {
      let store = apply(createEmptyChatStore(), 'permission.asked', {
        permission: { id: 'perm-1', sessionID: 's1', permission: 'Edit file' },
      })
      store = apply(store, 'permission.replied', { sessionID: 's1', requestID: 'perm-1' })
      expect(store.permissions.s1 ?? []).toHaveLength(0)
    })

    it('handles v2.asked / v2.replied', () => {
      let store = apply(createEmptyChatStore(), 'permission.v2.asked', {
        info: { id: 'perm-2', sessionId: 's1', title: 'Read file' },
      })
      expect(store.permissions.s1).toMatchObject([{ id: 'perm-2', sessionId: 's1' }])
      store = apply(store, 'permission.v2.replied', { sessionId: 's1', requestID: 'perm-2' })
      expect(store.permissions.s1 ?? []).toHaveLength(0)
    })
  })

  it('user message with same id is substituted, not duplicated', () => {
    const base = apply(createEmptyChatStore(), 'message.updated', {
      info: { id: 'user-1', role: 'user', sessionID: 's1', parts: [] },
    })
    const store = apply(base, 'message.updated', {
      info: { id: 'user-1', role: 'user', sessionID: 's1', parts: [{ type: 'text', text: 'Hola' }] },
    })
    expect(store.messages.s1).toHaveLength(1)
    expect(store.messages.s1[0].content).toBe('Hola')
  })

  it('workspace touch events set workspaceTouched', () => {
    for (const type of ['file.edited', 'file.created', 'file.deleted', 'file.watcher.updated', 'todo.updated']) {
      const result = reduceOpenCodeEvent(createEmptyChatStore(), { type, properties: {} })
      expect(result.workspaceTouched).toBe(true)
    }
  })

  it('unknown events are ignored', () => {
    const start = createEmptyChatStore()
    const result = reduceOpenCodeEvent(start, { type: 'something.else', properties: { sessionID: 's1' } })
    expect(result.workspaceTouched).toBe(false)
    expect(result.store.sessionStatus).toEqual({})
    expect(result.store.messages).toEqual({})
  })

  it('isSending reflects sessionStatus', () => {
    const store = apply(createEmptyChatStore(), 'session.status', { sessionID: 's1', status: { type: 'busy' } })
    expect(isSending(store, 's1')).toBe(true)
    expect(isSending(store, 'missing')).toBe(false)
  })

  describe('overlaySessionRuntimeStatus', () => {
    const idle = { id: 's1', title: 'Chat', status: 'idle' as const, updatedAt: 'now' }
    const listedBusy = { ...idle, status: 'busy' as const }
    const listedError = { ...idle, status: 'error' as const }

    it('paints busy only from the bus', () => {
      expect(overlaySessionRuntimeStatus(idle, 'busy').status).toBe('busy')
      expect(overlaySessionRuntimeStatus(listedBusy, undefined).status).toBe('idle')
      expect(overlaySessionRuntimeStatus(listedBusy, 'idle').status).toBe('idle')
    })

    it('keeps list error when the bus is not busy', () => {
      expect(overlaySessionRuntimeStatus(listedError, undefined).status).toBe('error')
      expect(overlaySessionRuntimeStatus(listedError, 'idle').status).toBe('error')
      expect(overlaySessionRuntimeStatus(listedError, 'busy').status).toBe('busy')
    })
  })

  it('toWorkspaceMessage is the single snapshot/event mapper', () => {
    const message = toWorkspaceMessage({
      id: 'm1',
      role: 'assistant',
      sessionID: 's1',
      providerID: 'openai',
      modelID: 'gpt-4',
      time: { created: 10, completed: 20 },
      parts: [{ type: 'text', text: 'Hi' }],
    })
    expect(message).toMatchObject({
      id: 'm1',
      sessionId: 's1',
      role: 'assistant',
      content: 'Hi',
      completedAt: 20,
      model: { providerId: 'openai', modelId: 'gpt-4' },
    })
    expect(message?.pending).toBeUndefined()
    expect(message?.statusInfo).toBeUndefined()
  })

  describe('legacy event shapes', () => {
    it.each([
      {
        name: 'info.sessionID',
        properties: { info: { sessionID: 's1' }, status: { type: 'busy' } },
      },
      {
        name: 'info.id',
        properties: { info: { id: 's1' }, status: { type: 'busy' } },
      },
    ])('session.status reads $name', ({ properties }) => {
      const store = apply(createEmptyChatStore(), 'session.status', properties)
      expect(store.sessionStatus.s1).toBe('busy')
    })

    it('session.idle reads info.sessionID', () => {
      const busy = apply(createEmptyChatStore(), 'session.status', {
        info: { sessionID: 's1' },
        status: { type: 'busy' },
      })
      const store = apply(busy, 'session.idle', { info: { sessionID: 's1' } })
      expect(store.sessionStatus.s1).toBe('idle')
    })

    it('session.error reads info.sessionID', () => {
      let store = apply(createEmptyChatStore(), 'message.updated', {
        info: { id: 'm1', role: 'assistant', sessionID: 's1', time: { created: 1 }, parts: [] },
      })
      store = apply(store, 'session.error', {
        info: { sessionID: 's1' },
        error: { data: { message: 'boom' } },
      })
      expect(store.messages.s1[0].statusInfo).toEqual({ status: 'error', detail: 'boom' })
    })

    it('message.part.delta accepts partType + value', () => {
      let store = apply(createEmptyChatStore(), 'message.updated', {
        info: { id: 'm1', role: 'assistant', sessionID: 's1', parts: [{ id: 'p1', type: 'text', text: 'He' }] },
      })
      store = apply(store, 'message.part.delta', {
        messageID: 'm1',
        partID: 'p1',
        partType: 'text',
        value: 'llo',
      })
      const textPart = store.messages.s1[0].parts.find((p) => p.type === 'text')
      expect(textPart?.text).toBe('Hello')
    })

    it('permission.replied reads sessionID nested in permission', () => {
      let store = apply(createEmptyChatStore(), 'permission.asked', {
        permission: { id: 'perm-1', sessionID: 's1', permission: 'Edit file' },
      })
      store = apply(store, 'permission.replied', {
        permission: { id: 'perm-1', sessionID: 's1' },
        response: 'once',
      })
      expect(store.permissions.s1 ?? []).toHaveLength(0)
    })

    it('message.removed reads info.id', () => {
      let store = apply(createEmptyChatStore(), 'message.updated', {
        info: { id: 'm1', role: 'user', sessionID: 's1', parts: [] },
      })
      store = apply(store, 'message.removed', { info: { id: 'm1' } })
      expect(store.messages.s1 ?? []).toHaveLength(0)
    })
  })

  describe('live OpenCode event order', () => {
    it('does not wipe streamed parts when message.updated has no parts', () => {
      let store = apply(createEmptyChatStore(), 'message.updated', {
        info: { id: 'm1', role: 'assistant', sessionID: 's1', time: { created: 1 } },
      })
      store = apply(store, 'message.part.updated', {
        part: { id: 'p1', type: 'text', text: 'Hello', messageID: 'm1', sessionID: 's1' },
      })
      store = apply(store, 'message.updated', {
        info: { id: 'm1', role: 'assistant', sessionID: 's1', time: { created: 1, completed: 2 } },
      })
      expect(store.messages.s1).toHaveLength(1)
      expect(store.messages.s1[0].content).toBe('Hello')
      expect(store.messages.s1[0].parts).toMatchObject([{ type: 'text', text: 'Hello' }])
      expect(store.messages.s1[0].completedAt).toBe(2)
    })

    it('keeps existing user text when a later message.updated has no parts', () => {
      let store = createEmptyChatStore()
      store = {
        ...store,
        messages: {
          s1: [{
            id: 'u1',
            sessionId: 's1',
            role: 'user',
            content: 'Hola',
            timestamp: 'Just now',
            timestampRaw: 10,
            parts: [{ type: 'text', text: 'Hola' }],
          }],
        },
      }
      store = apply(store, 'message.updated', {
        info: { id: 'u1', role: 'user', sessionID: 's1', time: { created: 10 } },
      })
      expect(store.messages.s1).toHaveLength(1)
      expect(store.messages.s1[0].content).toBe('Hola')
    })

    it('applies part.updated that arrived before message.updated', () => {
      let store = apply(createEmptyChatStore(), 'message.part.updated', {
        part: { id: 'p1', type: 'text', text: 'Hi', messageID: 'm1', sessionID: 's1' },
      })
      expect(store.messages.s1 ?? []).toHaveLength(0)
      store = apply(store, 'message.updated', {
        info: { id: 'm1', role: 'assistant', sessionID: 's1', time: { created: 1 } },
      })
      expect(store.messages.s1[0].content).toBe('Hi')
      expect(store.messages.s1[0].role).toBe('assistant')
    })

    it('stores a relative timestamp instead of the raw epoch', () => {
      const created = Date.now()
      const store = apply(createEmptyChatStore(), 'message.updated', {
        info: { id: 'm1', role: 'user', sessionID: 's1', time: { created } },
      })
      expect(store.messages.s1[0].timestamp).toBe('Just now')
      expect(store.messages.s1[0].timestamp).not.toBe(String(created))
      expect(store.messages.s1[0].timestampRaw).toBe(created)
    })

    it('keeps empty text parts so OpenCode deltas can stream', () => {
      let store = apply(createEmptyChatStore(), 'message.updated', {
        info: { id: 'm1', role: 'assistant', sessionID: 's1', time: { created: 1 } },
      })
      store = apply(store, 'message.part.updated', {
        part: { id: 'p1', type: 'text', text: '', messageID: 'm1', sessionID: 's1' },
      })
      expect(store.messages.s1[0].parts).toMatchObject([{ type: 'text', id: 'p1', text: '' }])

      store = apply(store, 'message.part.delta', {
        sessionID: 's1',
        messageID: 'm1',
        partID: 'p1',
        field: 'text',
        delta: 'He',
      })
      store = apply(store, 'message.part.delta', {
        sessionID: 's1',
        messageID: 'm1',
        partID: 'p1',
        field: 'text',
        delta: 'llo',
      })
      expect(store.messages.s1[0].parts).toMatchObject([{ type: 'text', text: 'Hello' }])
      expect(store.messages.s1[0].content).toBe('Hello')

      store = apply(store, 'message.part.updated', {
        part: { id: 'p1', type: 'text', text: 'Hello', messageID: 'm1', sessionID: 's1' },
      })
      expect(store.messages.s1[0].parts).toMatchObject([{ type: 'text', text: 'Hello' }])
    })

    it('streams reasoning deltas from an empty placeholder without wiping later text', () => {
      let store = apply(createEmptyChatStore(), 'message.updated', {
        info: { id: 'm1', role: 'assistant', sessionID: 's1', time: { created: 1 } },
      })
      store = apply(store, 'message.part.updated', {
        part: { id: 'r1', type: 'reasoning', text: '', messageID: 'm1', sessionID: 's1' },
      })
      store = apply(store, 'message.part.delta', {
        sessionID: 's1',
        messageID: 'm1',
        partID: 'r1',
        field: 'text',
        delta: 'think',
      })
      expect(store.messages.s1[0].parts).toMatchObject([{ type: 'reasoning', text: 'think' }])

      store = apply(store, 'message.part.updated', {
        part: { id: 'r1', type: 'reasoning', text: 'think', messageID: 'm1', sessionID: 's1' },
      })
      store = apply(store, 'message.part.updated', {
        part: { id: 't1', type: 'text', text: '', messageID: 'm1', sessionID: 's1' },
      })
      store = apply(store, 'message.part.delta', {
        sessionID: 's1',
        messageID: 'm1',
        partID: 't1',
        field: 'text',
        delta: 'Hi',
      })
      expect(store.messages.s1[0].parts).toMatchObject([
        { type: 'reasoning', text: 'think' },
        { type: 'text', text: 'Hi' },
      ])
    })

    it('does not let an empty part.updated wipe already streamed text', () => {
      let store = apply(createEmptyChatStore(), 'message.updated', {
        info: { id: 'm1', role: 'assistant', sessionID: 's1', time: { created: 1 } },
      })
      store = apply(store, 'message.part.updated', {
        part: { id: 'p1', type: 'text', text: '', messageID: 'm1', sessionID: 's1' },
      })
      store = apply(store, 'message.part.delta', {
        sessionID: 's1',
        messageID: 'm1',
        partID: 'p1',
        field: 'text',
        delta: 'Hello',
      })
      store = apply(store, 'message.part.updated', {
        part: { id: 'p1', type: 'text', text: '', messageID: 'm1', sessionID: 's1' },
      })
      expect(store.messages.s1[0].parts).toMatchObject([{ type: 'text', text: 'Hello' }])
    })

    it('buffers an empty part and its deltas until message.updated arrives', () => {
      let store = apply(createEmptyChatStore(), 'message.part.updated', {
        part: { id: 'p1', type: 'text', text: '', messageID: 'm1', sessionID: 's1' },
      })
      store = apply(store, 'message.part.delta', {
        sessionID: 's1',
        messageID: 'm1',
        partID: 'p1',
        field: 'text',
        delta: 'Hi',
      })
      expect(store.messages.s1 ?? []).toHaveLength(0)
      store = apply(store, 'message.updated', {
        info: { id: 'm1', role: 'assistant', sessionID: 's1', time: { created: 1 } },
      })
      expect(store.messages.s1[0].content).toBe('Hi')
      expect(store.messages.s1[0].parts).toMatchObject([{ type: 'text', text: 'Hi' }])
    })
  })

  describe('hydrateSessionIntoStore', () => {
    it('keeps an existing user message across hydrate', () => {
      const live = createEmptyChatStore()
      const seeded: ChatStore = {
        ...live,
        messages: {
          s1: [{
            id: 'u1',
            sessionId: 's1',
            role: 'user',
            content: 'Hola',
            timestamp: 'Just now',
            parts: [{ type: 'text', text: 'Hola' }],
          }],
        },
      }
      const store = hydrateSessionIntoStore(seeded, 's1', [{
        id: 'u1',
        sessionId: 's1',
        role: 'user',
        content: 'Hola',
        timestamp: 'Just now',
        parts: [{ type: 'text', text: 'Hola' }],
      }])
      expect(store.messages.s1.map((message) => message.id)).toEqual(['u1'])
    })

    it('keeps live streamed parts when hydrate snapshot is emptier', () => {
      const live = apply(createEmptyChatStore(), 'message.updated', {
        info: { id: 'm1', role: 'assistant', sessionID: 's1', time: { created: 1 } },
      })
      const streamed = apply(live, 'message.part.updated', {
        part: { id: 'p1', type: 'text', text: 'Streamed', messageID: 'm1', sessionID: 's1' },
      })
      const store = hydrateSessionIntoStore(streamed, 's1', [{
        id: 'm1',
        sessionId: 's1',
        role: 'assistant',
        content: '',
        timestamp: 'Just now',
        parts: [],
      }])
      expect(store.messages.s1[0].content).toBe('Streamed')
    })
  })

  describe('hydratePermissionsIntoStore', () => {
    const asked = { id: 'perm-1', sessionId: 's1', title: 'Edit', state: 'pending' as const }

    it('keeps a live asked that the snapshot does not include', () => {
      const live: ChatStore = {
        ...createEmptyChatStore(),
        permissions: { s1: [asked] },
      }
      const store = hydratePermissionsIntoStore(live, {}, {})
      expect(store.permissions.s1).toMatchObject([{ id: 'perm-1' }])
    })

    it('drops a baseline permission that the snapshot no longer has', () => {
      const live: ChatStore = {
        ...createEmptyChatStore(),
        permissions: { s1: [asked] },
      }
      const store = hydratePermissionsIntoStore(live, {}, { s1: [asked] })
      expect(store.permissions.s1 ?? []).toHaveLength(0)
    })

    it('does not restore a permission removed on the bus during fetch', () => {
      const baseline = { s1: [asked] }
      const live = createEmptyChatStore()
      const store = hydratePermissionsIntoStore(live, { s1: [asked] }, baseline)
      expect(store.permissions.s1 ?? []).toHaveLength(0)
    })
  })
})
