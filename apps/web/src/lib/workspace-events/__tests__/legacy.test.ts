import { describe, expect, it } from 'vitest'

import type { ArcheEvent } from '@/lib/harness/events'
import { createLegacyEventSerializer } from '@/lib/workspace-events/legacy'

describe('previous browser event protocol', () => {
  it('preserves assistant text and complete tool state in message.updated info.parts', () => {
    const legacy = createLegacyEventSerializer()
    const events: ArcheEvent[] = [
      { v: 1, type: 'message.upserted', message: { id: 'm1', sessionId: 's1', role: 'assistant', timestamp: '', timestampRaw: 1, content: '', parts: [] } },
      { v: 1, type: 'part.upserted', sessionId: 's1', messageId: 'm1', part: { id: 'text', type: 'text', text: '' } },
      { v: 1, type: 'part.delta', sessionId: 's1', messageId: 'm1', partId: 'text', field: 'text', delta: 'Hello' },
      { v: 1, type: 'part.upserted', mode: 'tool-patch', sessionId: 's1', messageId: 'm1', update: { id: 'call', name: 'subagent', status: 'pending' } },
      { v: 1, type: 'part.upserted', mode: 'tool-patch', sessionId: 's1', messageId: 'm1', update: { id: 'call', status: 'running', input: { agent: 'reviewer' } } },
      { v: 1, type: 'part.upserted', mode: 'tool-patch', sessionId: 's1', messageId: 'm1', update: { id: 'call', status: 'completed', output: 'Reviewed', metadata: { sessionID: 'child' } } },
      { v: 1, type: 'message.upserted', mode: 'patch', sessionId: 's1', messageId: 'm1', patch: { completedAt: 2 } },
    ]
    const frames = events.flatMap(legacy.serialize)
    expect(frames.at(-1)).toMatchObject({ type: 'message.updated', properties: { info: {
      id: 'm1', sessionID: 's1', role: 'assistant', time: { created: 1, completed: 2 },
      parts: [
        { type: 'text', id: 'text', text: 'Hello' },
        { type: 'tool', tool: 'task', callID: 'call', state: { status: 'completed', input: { agent: 'reviewer', subagent_type: 'reviewer' }, output: 'Reviewed', metadata: { sessionID: 'child' } } },
      ],
    } } })
  })

  it('forwards text deltas without needing a server-side message snapshot', () => {
    const legacy = createLegacyEventSerializer()
    expect(legacy.serialize({ v: 1, type: 'part.delta', sessionId: 's1', messageId: 'm1', partId: 'text', field: 'text', delta: 'next' })).toEqual([
      { type: 'message.part.delta', properties: { sessionID: 's1', messageID: 'm1', partID: 'text', field: 'text', delta: 'next' } },
    ])
  })

  it('keeps the cache bounded and releases idle sessions', () => {
    const legacy = createLegacyEventSerializer()
    for (let i = 0; i < 100; i++) legacy.serialize({ v: 1, type: 'part.upserted', mode: 'tool-patch', sessionId: 's1', messageId: `m${i}`, update: { id: 'call', name: 'read', status: 'pending' } })
    const missing: ArcheEvent = { v: 1, type: 'part.upserted', mode: 'tool-patch', sessionId: 's1', messageId: 'm0', update: { id: 'call', status: 'completed', output: 'Done' } }
    expect(legacy.missingToolIdentity(missing)).toEqual({ sessionId: 's1', messageId: 'm0', toolId: 'call' })
    expect(legacy.missingToolIdentity({ ...missing, messageId: 'm99' })).toBeNull()
    legacy.serialize({ v: 1, type: 'session.status', sessionId: 's1', status: 'idle' })
    expect(legacy.missingToolIdentity({ ...missing, messageId: 'm99' })).not.toBeNull()
  })

  it('retains permission correlation fields and the old reply shape', () => {
    const legacy = createLegacyEventSerializer()
    expect(legacy.serialize({ v: 1, type: 'permission.asked', permission: { id: 'permission', sessionId: 's1', messageId: 'm1', callId: 'call', title: 'Read file', state: 'pending' } })[0]).toMatchObject({
      type: 'permission.asked', properties: { id: 'permission', sessionID: 's1', messageID: 'm1', callID: 'call', title: 'Read file' },
    })
    expect(legacy.serialize({ v: 1, type: 'permission.resolved', sessionId: 's1', permissionId: 'permission' })).toEqual([
      { type: 'permission.replied', properties: { sessionID: 's1', requestID: 'permission' } },
    ])
  })
})
