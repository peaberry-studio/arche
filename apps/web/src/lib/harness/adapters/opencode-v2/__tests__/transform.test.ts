import { afterEach, describe, expect, it, vi } from 'vitest'

import { assistantSnapshot, ASSISTANT_ID, permission, SESSION_ID, tokens, toolSnapshot, TOOL_SESSION_ID, userSnapshot } from '@/lib/harness/adapters/opencode-v2/__tests__/fixtures'
import { accountingPart, contentPartId, toArchePermission, toHarnessError, toHarnessMessage, toHarnessSession, transformParts } from '@/lib/harness/adapters/opencode-v2/transform'

afterEach(() => vi.useRealTimers())

describe('v2 snapshot transforms', () => {
  it('requires a native session with finite timestamps', () => {
    for (const value of [null, [], {}, { id: 's' }, { id: 's', time: { created: 1, updated: Infinity } }]) expect(toHarnessSession(value)).toBeNull()
    expect(toHarnessSession({ id: 's', title: '', parentID: 'p', outcome: 'failed', time: { created: 1, updated: 2 } })).toMatchObject({
      id: 's', title: 'Untitled', parentId: 'p', status: 'error', createdAtRaw: 1, updatedAtRaw: 2,
    })
  })

  it('maps native model.id, agent, timestamps, text and per-message accounting', () => {
    vi.useFakeTimers().setSystemTime(1792511017000)
    const message = toHarnessMessage({ ...assistantSnapshot, sessionID: SESSION_ID })
    expect(message).toEqual({
      id: ASSISTANT_ID, sessionId: SESSION_ID, role: 'assistant', agentId: 'probe', model: { providerId: 'fixture', modelId: 'fixture' },
      content: 'Hello fixture', timestamp: 'Just now', timestampRaw: 1792511016584, completedAt: 1792511016657,
      parts: [{ type: 'text', id: `${ASSISTANT_ID}:text:0`, text: 'Hello fixture' },
        { type: 'step-finish', id: `${ASSISTANT_ID}:usage`, reason: 'stop', cost: 0.000017, tokens: { input: 11, output: 3 } }],
    })
  })

  it('requires the known session ID to be added to native message-list items', () => {
    expect(toHarnessMessage(assistantSnapshot)).toBeNull()
    expect(toHarnessMessage({ ...userSnapshot, sessionID: SESSION_ID })).toMatchObject({ role: 'user', content: 'TEXT_PROBE' })
  })

  it.each([null, [], {}, { id: 'm', sessionID: 's', type: 'assistant' }, { id: 'm', sessionID: 's', type: 'user', time: { created: NaN }, text: '' }])('rejects malformed message boundary %j', (value) => {
    expect(toHarnessMessage(value)).toBeNull()
  })

  it('does not render internal idle/compaction/control records as fake assistant messages', () => {
    for (const type of ['idle', 'compaction', 'agent-switched', 'model-switched', 'location-switched']) {
      expect(toHarnessMessage({ id: 'm', sessionID: 's', time: { created: 1 }, type })).toBeNull()
    }
  })

  it('maps actual tool snapshot content, call ID and metadata without v1 tool fields', () => {
    const message = toHarnessMessage({ ...toolSnapshot, sessionID: TOOL_SESSION_ID })
    expect(message?.parts[0]).toEqual({ type: 'tool', id: 'call_probe', name: 'read', state: {
      status: 'completed', input: { path: '/workspace/sample.txt' }, output: 'Read file /workspace/sample.txt, lines 1-1\n1: fixture-only', title: 'read', metadata: { truncated: false },
    } })
  })

  it('has deterministic identities for interleaved content and preserves empty delta targets', () => {
    const content = [{ type: 'reasoning', text: '' }, toolSnapshot.content[0], { type: 'text', text: ' ' }]
    const parts = transformParts(content, 'm')
    expect(parts.map((part) => 'id' in part ? part.id : undefined)).toEqual(['m:reasoning:0', 'call_probe', 'm:text:0'])
    expect(transformParts(content, 'm')).toEqual(parts)
    expect(contentPartId('m', 'text', 2)).toBe('m:text:2')
  })

  it('normalizes tool running/error states and JSON-safe nested metadata', () => {
    const content = [
      { type: 'tool', id: 'running', name: 'arche_tools_chart_create', state: { status: 'running', input: { count: BigInt(1) }, metadata: { title: 'Chart', chart: { rows: [BigInt(2)] } } } },
      { type: 'tool', id: 'failed', name: 'read', state: { status: 'error', input: { path: 'x' }, error: { type: 'tool.execution', message: 'No such file' }, metadata: { failed: true } } },
    ]
    const parts = transformParts(content, 'm')
    expect(parts).toEqual([
      { type: 'tool', id: 'running', name: 'arche_tools_chart_create', state: { status: 'running', input: { count: '1' }, title: 'Chart', metadata: { title: 'Chart', chart: { rows: ['2'] } } } },
      { type: 'tool', id: 'failed', name: 'read', state: { status: 'error', input: { path: 'x' }, error: 'tool.execution: No such file', metadata: { failed: true } } },
    ])
    expect(() => JSON.stringify(parts)).not.toThrow()
  })

  it('preserves streaming raw input in an explicitly pending tool without parsing partial JSON', () => {
    const tool = { type: 'tool', id: 't', name: 'read', state: { status: 'streaming', input: '{"path":' } }
    expect(transformParts([tool], 'm')).toEqual([{ type: 'tool', id: 't', name: 'read', state: { status: 'pending', input: {}, rawInput: '{"path":' } }])
  })

  it('preserves future part shapes without logging provider data', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const value = { type: 'future', detail: { count: BigInt(4) } }
    expect(transformParts([value, null], 'm')).toEqual([{ type: 'unknown', originalType: 'future', data: { type: 'future', detail: { count: '4' } } }])
    expect(log).not.toHaveBeenCalled()
    log.mockRestore()
  })

  it('maps tool text and file content separately, preserving document/chart metadata', () => {
    const content = [{ type: 'tool', id: 't', name: 'arche_tools_document_inspect', state: {
      status: 'completed', input: { path: 'a.pdf' }, metadata: { document: { title: 'A' }, chart: { data: [1] } },
      content: [{ type: 'text', text: 'first' }, { type: 'file', uri: 'file:///workspace/.arche/attachments/a.pdf', mime: 'application/pdf', name: 'a.pdf' }, { type: 'text', text: 'last' }],
    } }]
    expect(transformParts(content, 'm')).toEqual([
      { type: 'tool', id: 't', name: 'arche_tools_document_inspect', state: { status: 'completed', input: { path: 'a.pdf' }, title: 'arche_tools_document_inspect', output: 'first\nlast', metadata: { document: { title: 'A' }, chart: { data: [1] } } } },
      { type: 'file', id: 't:file:1', path: '.arche/attachments/a.pdf', url: 'file:///workspace/.arche/attachments/a.pdf', mime: 'application/pdf', filename: 'a.pdf' },
    ])
  })

  it('maps URI and inline user attachments without losing their content', () => {
    const message = toHarnessMessage({ ...userSnapshot, sessionID: SESSION_ID, files: [
      { source: { type: 'uri', uri: 'file:///Users/test/vault/.arche/attachments/a%20b.png' }, data: 'AA==', mime: 'image/png', name: 'a b.png' },
      { source: { type: 'inline' }, data: 'YWJj', mime: 'text/plain' },
    ] })
    expect(message?.parts.slice(1)).toEqual([
      { type: 'file', id: `${userSnapshot.id}:file:0`, path: '.arche/attachments/a b.png', url: 'file:///Users/test/vault/.arche/attachments/a%20b.png', mime: 'image/png', filename: 'a b.png' },
      { type: 'file', id: `${userSnapshot.id}:file:1`, path: '', url: 'data:text/plain;base64,YWJj', mime: 'text/plain' },
    ])
  })

  it('maps structured errors to typed execution failures and browser-visible status', () => {
    const error = { type: 'provider.auth', message: 'API key is missing', status: 401, response: { body: 'must not expose' } }
    expect(toHarnessError(error)).toEqual({ code: 'provider_auth_missing', detail: 'provider.auth: API key is missing', status: 401 })
    expect(toHarnessMessage({ ...assistantSnapshot, sessionID: SESSION_ID, error })).toMatchObject({ error: { code: 'provider_auth_missing' }, statusInfo: { status: 'error', detail: 'provider.auth: API key is missing' } })
    expect(toHarnessError({ type: 'aborted', message: 'Step interrupted' })).toEqual({ code: 'runtime_error', detail: 'aborted: Step interrupted' })
  })

  it('counts per-message usage only, preserving zeroes and refusing incomplete accounting', () => {
    expect(accountingPart('m', { cost: 0, finish: 'stop', tokens: { input: 0, output: 0 } })).toMatchObject({ cost: 0, tokens: { input: 0, output: 0 } })
    for (const usage of [{ cost: 1, tokens }, { finish: 'error' }, { finish: 'stop', cost: Infinity, tokens }, { finish: 'stop', cost: 0, tokens: { input: 1 } }]) expect(accountingPart('m', usage)).toBeNull()
  })

  it('normalizes permission snapshots using the same fields as live asked events', () => {
    expect(toArchePermission(permission)).toEqual({ id: permission.id, sessionId: permission.sessionID, title: 'read: sample.txt', permissionType: 'read', pattern: 'sample.txt', messageId: permission.source.messageID, callId: 'call_probe', state: 'pending' })
    expect(toArchePermission({ ...permission, resources: [null] })).toBeNull()
  })
})
