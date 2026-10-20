import type { OpenCodeEvent } from '@/lib/harness/adapters/opencode-v1/opencode-event'

// Sanitized v1 wire shapes preserved from the existing live-event regression tests.
export const eventStreams: Record<string, OpenCodeEvent[]> = {
  text: [
    { type: 'session.status', properties: { sessionID: 's1', status: { type: 'busy' } } },
    { type: 'message.part.updated', properties: { part: { id: 'p1', type: 'text', text: '', messageID: 'm1', sessionID: 's1' } } },
    { type: 'message.part.delta', properties: { sessionID: 's1', messageID: 'm1', partID: 'p1', field: 'text', delta: 'Hello' } },
    { type: 'message.part.delta', properties: { sessionID: 's1', messageID: 'm1', partID: 'p1', field: 'text', delta: ' ' } },
    { type: 'message.updated', properties: { info: { id: 'm1', role: 'assistant', sessionID: 's1', agent: 'writer', providerID: 'openai', modelID: 'gpt-4', time: { created: 1 } } } },
    { type: 'message.part.delta', properties: { sessionID: 's1', messageID: 'm1', partID: 'p1', field: 'text', delta: 'world' } },
    { type: 'message.part.updated', properties: { part: { id: 'p1', type: 'text', text: '', messageID: 'm1', sessionID: 's1' } } },
    { type: 'message.updated', properties: { info: { id: 'm1', role: 'assistant', sessionID: 's1', time: { created: 1, completed: 2 } } } },
    { type: 'session.idle', properties: { sessionID: 's1' } },
  ],
  tool: [
    { type: 'message.updated', properties: { info: { id: 'm1', role: 'assistant', sessionID: 's1', time: { created: 1 } } } },
    { type: 'message.part.updated', properties: { part: { id: 'p1', callID: 'call1', type: 'tool', tool: 'read', messageID: 'm1', sessionID: 's1', state: { status: 'pending', input: {} } } } },
    { type: 'message.part.updated', properties: { part: { id: 'p1', callID: 'call1', type: 'tool', tool: 'read', messageID: 'm1', sessionID: 's1', state: { status: 'running', input: { path: 'report.md' }, title: 'Reading report' } } } },
    { type: 'message.part.updated', properties: { part: { id: 'p1', callID: 'call1', type: 'tool', tool: 'read', messageID: 'm1', sessionID: 's1', state: { status: 'completed', input: { path: 'report.md' }, output: '# Report', title: 'Read report', metadata: { attachments: [] } } } } },
  ],
  permission: [
    { type: 'permission.asked', properties: { permission: { id: 'perm1', sessionID: 's1', permission: 'edit', patterns: ['report.md'], tool: { messageID: 'm1', callID: 'call1' } } } },
    { type: 'permission.replied', properties: { sessionID: 's1', requestID: 'perm1', reply: 'once' } },
    { type: 'permission.v2.asked', properties: { info: { id: 'perm2', sessionId: 's1', title: 'Read file', resources: ['report.md'] } } },
    { type: 'permission.v2.replied', properties: { permission: { id: 'perm2', sessionID: 's1' }, response: 'reject' } },
  ],
  subagent: [
    { type: 'session.created', properties: { info: { id: 's1', title: 'Parent' } } },
    { type: 'session.created', properties: { info: { id: 'child1', title: 'Research', parentID: 's1' } } },
    { type: 'session.status', properties: { info: { id: 'child1' }, status: { type: 'busy' } } },
    { type: 'message.updated', properties: { info: { id: 'child-message', role: 'assistant', sessionID: 'child1', time: { created: 1 }, parts: [{ id: 'sub1', type: 'subtask', prompt: 'Research', description: 'Find sources', agent: 'researcher' }] } } },
    { type: 'permission.asked', properties: { id: 'child-permission', sessionID: 'child1', permission: 'webfetch', patterns: ['https://example.com'] } },
    { type: 'session.status', properties: { info: { sessionID: 'child1' }, status: { type: 'idle' } } },
  ],
  error: [
    { type: 'message.updated', properties: { info: { id: 'm1', role: 'assistant', sessionID: 's1', time: { created: 1 }, parts: [{ id: 'r1', type: 'reasoning', text: 'Thinking' }] } } },
    { type: 'session.error', properties: { info: { sessionID: 's1' }, error: { name: 'APIError', data: { message: 'Provider unavailable' } } } },
  ],
  touch: [
    { type: 'file.created', properties: { file: 'report.md' } },
    { type: 'file.edited', properties: { file: 'report.md' } },
    { type: 'file.deleted', properties: { file: 'report.md' } },
    { type: 'file.watcher.updated', properties: { file: 'report.md', event: 'change' } },
    { type: 'todo.updated', properties: { sessionID: 's1', todos: [] } },
    { type: 'server.heartbeat' },
  ],
}

// Replay the preserved streaming shape for a fixed 2,000-event workload.
export const streamingFixture: OpenCodeEvent[] = [
  eventStreams.text[0],
  eventStreams.text[4],
  eventStreams.text[1],
  ...Array.from({ length: 1_995 }, (_, index): OpenCodeEvent => ({
    type: 'message.part.delta',
    properties: { sessionID: 's1', messageID: 'm1', partID: 'p1', field: 'text', delta: ['Hello', ' ', 'world', '\n'][index % 4] },
  })),
  eventStreams.text[7],
  eventStreams.text[8],
]
