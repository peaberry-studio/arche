import { describe, expect, it } from 'vitest'

import {
  createEmptyChatStore,
  isSending,
  reduceOpenCodeEvent,
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

  it('optimistic user with same id is substituted, not duplicated', () => {
    const base = apply(createEmptyChatStore(), 'message.updated', {
      info: { id: 'user-1', role: 'user', sessionID: 's1', parts: [] },
    })
    // Re-arrive as the confirmed server message with the same id.
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
})
