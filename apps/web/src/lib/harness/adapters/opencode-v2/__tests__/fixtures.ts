import type { OpenCodeEvent, SessionMessageAssistant, SessionMessageUser } from '@opencode/client'

export const SESSION_ID = 'ses_ea6048292ffe0bPAsAMcQt9vTY'
export const ASSISTANT_ID = 'msg_159fb7e830018I81f3LFGrzJ2B'
const location = { directory: '/workspace' }
const durable = { aggregateID: SESSION_ID, seq: 5, version: 1 as const }
const address = { sessionID: SESSION_ID, assistantMessageID: ASSISTANT_ID }
export const model = { id: 'fixture', providerID: 'fixture', variant: 'default' }
export const tokens = { input: 11, output: 3, reasoning: 0, cache: { read: 0, write: 0 } }

export const textEvents = [
  { id: 'evt_text_step', created: 1792511016590, type: 'session.step.started', location, durable,
    data: { ...address, agent: 'probe', model, started: 1792511016584 } },
  { id: 'evt_text_start', created: 1792511016591, type: 'session.text.started', location, durable,
    data: { ...address, ordinal: 0 } },
  { id: 'evt_text_delta', created: 1792511016655, type: 'session.text.delta', location,
    data: { ...address, ordinal: 0, delta: 'Hello fixture' } },
  { id: 'evt_text_end', created: 1792511016655, type: 'session.text.ended', location, durable,
    data: { ...address, ordinal: 0, text: 'Hello fixture' } },
] satisfies [OpenCodeEvent, OpenCodeEvent, OpenCodeEvent, OpenCodeEvent]

export const endedEvent = { id: 'evt_step_end', created: 1792511016657, type: 'session.step.ended', location, durable,
  data: { ...address, finish: 'stop', rawFinish: 'stop', cost: 0.000017, tokens },
} satisfies OpenCodeEvent

export const assistantSnapshot = {
  id: ASSISTANT_ID, time: { created: 1792511016584, streamed: 1792511016656, completed: 1792511016657 },
  type: 'assistant', agent: 'probe', model, content: [{ type: 'text', text: 'Hello fixture' }],
  finish: 'stop', rawFinish: 'stop', cost: 0.000017, tokens,
} satisfies SessionMessageAssistant

export const userSnapshot = {
  id: 'msg_159fb7dbc001MSt9jasN6Afaeh', time: { created: 1792511016576 }, text: 'TEXT_PROBE', type: 'user',
} satisfies SessionMessageUser

export const TOOL_SESSION_ID = 'ses_ea6048116ffenwlp8u0uIKd5Wj'
export const TOOL_MESSAGE_ID = 'msg_159fb7f08001LZbK5k02RDrKwB'
const toolAddress = { sessionID: TOOL_SESSION_ID, assistantMessageID: TOOL_MESSAGE_ID, id: 'call_probe' }
const toolDurable = { ...durable, aggregateID: TOOL_SESSION_ID }
const toolContent = [{ type: 'text' as const, text: 'Read file /workspace/sample.txt, lines 1-1\n1: fixture-only' }]
export const toolSnapshot = {
  id: TOOL_MESSAGE_ID, type: 'assistant', agent: 'probe', model,
  time: { created: 1792511016715, streamed: 1792511016784, completed: 1792511016818 },
  content: [{ type: 'tool', id: 'call_probe', name: 'read', executed: false,
    state: { status: 'completed', input: { path: '/workspace/sample.txt' }, content: [toolContent[0]], metadata: { truncated: false } },
    time: { created: 1792511016718, ran: 1792511016783, completed: 1792511016817 },
  }], finish: 'tool-calls', rawFinish: 'tool_calls', cost: 0.000017, tokens,
} satisfies SessionMessageAssistant

export const toolEvents = [
  { id: 'evt_tool_start', created: 1792511016718, type: 'session.tool.input.started', location, durable: toolDurable,
    data: { ...toolAddress, name: 'read' } },
  { id: 'evt_tool_input', created: 1792511016782, type: 'session.tool.input.ended', location, durable: toolDurable,
    data: { ...toolAddress, text: '{"path":"/workspace/sample.txt"}' } },
  { id: 'evt_tool_called', created: 1792511016783, type: 'session.tool.called', location, durable: toolDurable,
    data: { ...toolAddress, input: { path: '/workspace/sample.txt' }, executed: false } },
  { id: 'evt_tool_success', created: 1792511016817, type: 'session.tool.success', location, durable: { ...toolDurable, version: 2 },
    data: { ...toolAddress, content: [toolContent[0]], metadata: { truncated: false }, executed: false } },
] satisfies [OpenCodeEvent, OpenCodeEvent, OpenCodeEvent, OpenCodeEvent]

export const permission = {
  id: 'per_159fb7f52001pXs4xNcoT3hndW', sessionID: TOOL_SESSION_ID, action: 'read', resources: ['sample.txt'], save: ['*'],
  source: { type: 'tool' as const, messageID: TOOL_MESSAGE_ID, id: 'call_probe' },
}
export const permissionEvents = [
  { id: 'evt_permission_ask', created: 1792511016786, type: 'permission.asked', location, data: permission },
  { id: 'evt_permission_reply', created: 1792511016815, type: 'permission.replied', location,
    data: { sessionID: TOOL_SESSION_ID, requestID: permission.id, reply: 'once' } },
] satisfies OpenCodeEvent[]

export const failedEvent = {
  id: 'evt_step_fail', created: 1792511017463, type: 'session.step.failed', location,
  durable: { ...durable, aggregateID: 'ses_ea6047e61ffepdvlHS7LOV3QGG' },
  data: { sessionID: 'ses_ea6047e61ffepdvlHS7LOV3QGG', assistantMessageID: 'msg_159fb81e2001wXnqyMdgqF7QxY',
    error: { type: 'aborted', message: 'Step interrupted' } },
} satisfies OpenCodeEvent

export const MIXED_SESSION_ID = 'ses_ea5ff10a1ffeyHy3EaeR1kY2pj'
export const MIXED_MESSAGE_ID = 'msg_15a00ef79001vmuh9fAHOa8not'
const mixedAddress = { sessionID: MIXED_SESSION_ID, assistantMessageID: MIXED_MESSAGE_ID, ordinal: 0 }
const mixedDurable = { ...durable, aggregateID: MIXED_SESSION_ID }
export const mixedEvents = [
  { id: 'evt_reason_start', created: 1792511373183, type: 'session.reasoning.started', location, durable: mixedDurable,
    data: { ...mixedAddress, state: { reasoningField: 'reasoning_content' } } },
  { id: 'evt_reason_delta', created: 1792511373271, type: 'session.reasoning.delta', location,
    data: { ...mixedAddress, delta: 'Fixture reasoning' } },
  { id: 'evt_mixed_text_start', created: 1792511373271, type: 'session.text.started', location, durable: mixedDurable,
    data: mixedAddress },
  { id: 'evt_reason_end', created: 1792511373271, type: 'session.reasoning.ended', location, durable: mixedDurable,
    data: { ...mixedAddress, text: 'Fixture reasoning', state: { reasoningField: 'reasoning_content' } } },
  { id: 'evt_mixed_text_delta', created: 1792511373271, type: 'session.text.delta', location,
    data: { ...mixedAddress, delta: 'Hello fixture' } },
  { id: 'evt_mixed_text_end', created: 1792511373271, type: 'session.text.ended', location, durable: mixedDurable,
    data: { ...mixedAddress, text: 'Hello fixture' } },
] satisfies OpenCodeEvent[]
export const mixedContent = [
  { type: 'reasoning', text: 'Fixture reasoning', state: { reasoningField: 'reasoning_content' }, time: { created: 1792511373183, completed: 1792511373271 } },
  { type: 'text', text: 'Hello fixture' },
]
