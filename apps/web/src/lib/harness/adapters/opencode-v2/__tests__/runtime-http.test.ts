import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { assistantSnapshot, permission, SESSION_ID, userSnapshot } from '@/lib/harness/adapters/opencode-v2/__tests__/fixtures'
import { createOpenCodeV2Runtime } from '@/lib/harness/adapters/opencode-v2/runtime'

const auth = vi.hoisted(() => vi.fn())
vi.mock('@/lib/harness/session-submission-lock', () => ({ withSessionSubmissionLock: (_slug: string, _sessionId: string, options: unknown, submit: (options: unknown) => unknown) => submit(options) }))
vi.mock('@/lib/harness/runtime-connection', () => ({
  getInstanceBasicAuth: auth,
  getInstanceUrl: (_slug: string, baseUrl?: string) => baseUrl ?? 'http://runtime',
}))

function nativeSession(id = SESSION_ID) {
  return { id, title: 'Fixture', time: { created: 10, updated: 20 }, location: { directory: '/workspace' }, agent: 'probe', model: { providerID: 'fixture', id: 'fixture' } }
}

type Request = { method?: string; path: string; query: URLSearchParams; body: unknown; signal?: AbortSignal | null }

function transport(responses: Response[], prompt = false) {
  const requests: Request[] = []
  const fetch = vi.fn(async (input: string | URL, options: RequestInit = {}) => {
    const url = new URL(input)
    if (prompt && url.pathname === '/api/session/active') return Response.json({ data: {} })
    expect(new Headers(options.headers).get('Authorization')).toBe('Basic fixture-only')
    requests.push({ method: options.method, path: url.pathname, query: url.searchParams, body: typeof options.body === 'string' ? JSON.parse(options.body) : undefined, signal: options.signal })
    const response = responses.shift()
    if (!response) throw new Error(`Unexpected request: ${options.method} ${url.pathname}`)
    return response
  })
  vi.stubGlobal('fetch', fetch)
  return { requests, fetch, responses }
}

const empty = () => new Response(null, { status: 204 })

describe('V2 adapter with the real matched HTTP client', () => {
  beforeEach(() => { auth.mockResolvedValue({ baseUrl: 'http://runtime', authHeader: 'Basic fixture-only' }) })
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

  it('creates, renames, re-reads and deletes using native envelopes and 204 responses', async () => {
    const { requests, responses } = transport([
      Response.json({ directory: '/workspace' }), Response.json({ data: nativeSession() }),
      empty(), Response.json({ data: { ...nativeSession(), title: 'Renamed' } }), empty(),
    ])
    const runtime = createOpenCodeV2Runtime('alice')
    expect(await runtime.createSession({ title: 'Fixture' })).toMatchObject({ ok: true, data: { id: SESSION_ID, title: 'Fixture', createdAtRaw: 10 } })
    expect(await runtime.updateSession(SESSION_ID, 'Renamed')).toMatchObject({ ok: true, data: { id: SESSION_ID, title: 'Renamed' } })
    expect(await runtime.deleteSession(SESSION_ID)).toEqual({ ok: true, data: undefined })
    expect(requests.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
      { method: 'GET', path: '/api/location', body: undefined },
      { method: 'POST', path: '/api/session', body: { title: 'Fixture', location: { directory: '/workspace' } } },
      { method: 'PATCH', path: `/api/session/${SESSION_ID}`, body: { title: 'Renamed' } },
      { method: 'GET', path: `/api/session/${SESSION_ID}`, body: undefined },
      { method: 'DELETE', path: `/api/session/${SESSION_ID}`, body: undefined },
    ])
    expect(responses).toHaveLength(0)
  })

  it('follows the final short-page cursor while preserving root scope over HTTP', async () => {
    const { requests } = transport([
      Response.json({ directory: '/workspace' }),
      Response.json({ data: [nativeSession()], cursor: { next: 'last-page', previous: null } }),
      Response.json({ data: [], cursor: { next: null, previous: null } }),
    ])
    expect(await createOpenCodeV2Runtime('alice').listSessions({ rootsOnly: true })).toMatchObject({ ok: true, data: [{ id: SESSION_ID }] })
    expect(requests.slice(1).map(({ query }) => Object.fromEntries(query))).toEqual([
      { directory: '/workspace', parentID: 'null', order: 'desc', limit: '100' },
      { directory: '/workspace', parentID: 'null', order: 'desc', limit: '100', cursor: 'last-page' },
    ])
  })

  it('normalizes recorded message snapshots through the real client without exposing native envelopes', async () => {
    const { requests } = transport([
      Response.json({ data: nativeSession() }),
      Response.json({ data: [{ id: 'msg_queued', sessionID: SESSION_ID, type: 'user', delivery: 'steer', payload: { text: 'QUEUED_PROBE' }, time: { created: 1792511016700 } }] }),
      Response.json({ data: [userSnapshot, assistantSnapshot], cursor: { next: 'after-last', previous: null } }),
      Response.json({ data: [], cursor: { next: null, previous: null } }),
    ])
    expect(await createOpenCodeV2Runtime('alice').listMessages(SESSION_ID)).toMatchObject({ ok: true, data: [
      { id: userSnapshot.id, sessionId: SESSION_ID, role: 'user', content: 'TEXT_PROBE' },
      { id: assistantSnapshot.id, sessionId: SESSION_ID, role: 'assistant', content: 'Hello fixture', parts: expect.arrayContaining([{ type: 'step-finish', id: `${assistantSnapshot.id}:usage`, reason: 'stop', cost: 0.000017, tokens: { input: 11, output: 3 } }]) },
      { id: 'msg_queued', sessionId: SESSION_ID, role: 'user', content: 'QUEUED_PROBE', timestampRaw: 1792511016700 },
    ] })
    expect(requests.map(({ path, query }) => [path, Object.fromEntries(query)])).toEqual([
      [`/api/session/${SESSION_ID}`, {}],
      [`/api/session/${SESSION_ID}/inbox`, {}],
      [`/api/session/${SESSION_ID}/message`, { order: 'asc', limit: '100' }],
      [`/api/session/${SESSION_ID}/message`, { limit: '100', cursor: 'after-last' }],
    ])
  })

  it('serializes text prompt identity and selection before submitting and forwards cancellation', async () => {
    const { requests } = transport([
      Response.json({ data: nativeSession() }), empty(), empty(),
      Response.json({ data: { id: 'msg_fixture_caller', type: 'user', text: 'one\n\ntwo' } }),
    ], true)
    const signal = new AbortController().signal
    expect(await createOpenCodeV2Runtime('alice').prompt({ sessionId: SESSION_ID, messageId: 'msg_fixture_caller', agent: 'alternate', model: { providerId: 'fixture', modelId: 'alternate' }, parts: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }] }, { signal })).toEqual({ ok: true, data: undefined })
    expect(requests.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
      { method: 'GET', path: `/api/session/${SESSION_ID}`, body: undefined },
      { method: 'POST', path: `/api/session/${SESSION_ID}/agent`, body: { agent: 'alternate' } },
      { method: 'POST', path: `/api/session/${SESSION_ID}/model`, body: { model: { providerID: 'fixture', id: 'alternate' } } },
      { method: 'POST', path: `/api/session/${SESSION_ID}/prompt`, body: { id: 'msg_fixture_caller', text: 'one\n\ntwo' } },
    ])
    expect(requests.every((request) => request.signal === signal)).toBe(true)
  })

  it('forwards snapshot cancellation through session lookup, inbox and every message page', async () => {
    const { requests } = transport([
      Response.json({ data: nativeSession() }), Response.json({ data: [] }),
      Response.json({ data: [userSnapshot], cursor: { next: 'last', previous: null } }),
      Response.json({ data: [assistantSnapshot], cursor: { next: null, previous: null } }),
    ])
    const signal = new AbortController().signal
    expect(await createOpenCodeV2Runtime('alice').listMessages(SESSION_ID, { signal })).toMatchObject({ ok: true })
    expect(requests).toHaveLength(4)
    expect(requests.every((request) => request.signal === signal)).toBe(true)
  })

  it('does not switch an already selected agent/model', async () => {
    const { requests } = transport([Response.json({ data: nativeSession() }), Response.json({ data: { id: 'msg_fixture_caller' } })], true)
    expect(await createOpenCodeV2Runtime('alice').prompt({ sessionId: SESSION_ID, agent: 'probe', model: { providerId: 'fixture', modelId: 'fixture' }, parts: [{ type: 'text', text: 'hello' }] })).toEqual({ ok: true, data: undefined })
    expect(requests.map(({ path }) => path)).toEqual([`/api/session/${SESSION_ID}`, `/api/session/${SESSION_ID}/prompt`])
  })

  it('does not submit after a selection failure', async () => {
    const { requests } = transport([
      Response.json({ data: nativeSession() }),
      Response.json({ _tag: 'AgentNotFoundError', message: 'Unknown agent' }, { status: 404 }),
    ], true)
    expect(await createOpenCodeV2Runtime('alice').prompt({ sessionId: SESSION_ID, agent: 'missing', parts: [{ type: 'text', text: 'hello' }] })).toMatchObject({ ok: false, error: { code: 'runtime_error', detail: 'Unknown agent' } })
    expect(requests.map(({ path }) => path)).toEqual([`/api/session/${SESSION_ID}`, `/api/session/${SESSION_ID}/agent`])
  })

  it('maps the canonical Fireworks selection back to the verified native provider ID', async () => {
    const { requests } = transport([Response.json({ data: nativeSession() }), empty(), Response.json({ data: { id: 'msg_fixture_caller' } })], true)
    expect(await createOpenCodeV2Runtime('alice').prompt({ sessionId: SESSION_ID, model: { providerId: 'fireworks', modelId: 'fixture' }, parts: [{ type: 'text', text: 'hello' }] })).toEqual({ ok: true, data: undefined })
    expect(requests[1]).toMatchObject({ path: `/api/session/${SESSION_ID}/model`, body: { model: { providerID: 'fireworks-ai', id: 'fixture' } } })
  })

  it('does not switch an already selected native Fireworks model when the UI sends its canonical ID', async () => {
    const { requests } = transport([Response.json({ data: { ...nativeSession(), model: { providerID: 'fireworks-ai', id: 'fixture' } } }), Response.json({ data: { id: 'msg_fixture_caller' } })], true)
    expect(await createOpenCodeV2Runtime('alice').prompt({ sessionId: SESSION_ID, model: { providerId: 'fireworks', modelId: 'fixture' }, parts: [{ type: 'text', text: 'hello' }] })).toEqual({ ok: true, data: undefined })
    expect(requests.map(({ path }) => path)).toEqual([`/api/session/${SESSION_ID}`, `/api/session/${SESSION_ID}/prompt`])
  })

  it('acknowledges the interrupt primitive and reports status only from native active drains', async () => {
    const { requests } = transport([
      Response.json({ data: nativeSession() }), Response.json({ interrupted: true }), Response.json({ data: [] }), Response.json({ data: [] }),
      Response.json({ data: { [SESSION_ID]: { type: 'running' }, other: { type: 'running' } } }), Response.json({ data: {} }),
    ])
    const runtime = createOpenCodeV2Runtime('alice')
    expect(await runtime.abortSession(SESSION_ID)).toEqual({ ok: true, data: undefined })
    expect(requests[1].path).toBe(`/api/session/${SESSION_ID}/interrupt`)
    expect(Object.fromEntries(requests[1].query)).toEqual({ resume: 'false' })
    expect(await runtime.sessionStatus()).toEqual({ ok: true, data: { [SESSION_ID]: { type: 'busy' }, other: { type: 'busy' } } })
    expect(await runtime.sessionStatus()).toEqual({ ok: true, data: {} })
    expect(requests.slice(4).map(({ method, path }) => `${method} ${path}`)).toEqual(['GET /api/session/active', 'GET /api/session/active'])
  })

  it('submits no-reply input with resume disabled so it stays queued and undelivered', async () => {
    const { requests } = transport([Response.json({ data: nativeSession() }), Response.json({ data: { id: 'msg_note', type: 'user' } })], true)
    expect(await createOpenCodeV2Runtime('alice').prompt({ sessionId: SESSION_ID, messageId: 'msg_note', noReply: true, parts: [{ type: 'text', text: 'context only' }] })).toEqual({ ok: true, data: undefined })
    expect(requests[1]).toMatchObject({ method: 'POST', path: `/api/session/${SESSION_ID}/prompt`, body: { id: 'msg_note', text: 'context only', resume: false } })
  })

  it('cancels the queued input that native interrupt leaves behind and verifies the inbox again', async () => {
    const { requests, responses } = transport([
      Response.json({ data: nativeSession() }), Response.json({ interrupted: true }),
      Response.json({ data: [{ id: 'msg_queued', type: 'user', text: 'queued', time: { created: 1 } }] }),
      empty(), Response.json({ data: [] }),
    ])
    expect(await createOpenCodeV2Runtime('alice').abortSession(SESSION_ID)).toEqual({ ok: true, data: undefined })
    expect(requests.slice(2).map(({ method, path }) => ({ method, path }))).toEqual([
      { method: 'GET', path: `/api/session/${SESSION_ID}/inbox` },
      { method: 'DELETE', path: `/api/session/${SESSION_ID}/inbox/msg_queued` },
      { method: 'GET', path: `/api/session/${SESSION_ID}/inbox` },
    ])
    expect(responses).toHaveLength(0)
  })

  it('fails an unconfirmed late queue instead of inferring idle from an interrupt acknowledgement', async () => {
    transport([
      Response.json({ data: nativeSession() }), Response.json({ interrupted: false }),
      Response.json({ data: [] }), Response.json({ data: [{ id: 'msg_late' }] }),
    ])
    expect(await createOpenCodeV2Runtime('alice').abortSession(SESSION_ID)).toMatchObject({ ok: false, error: { code: 'execution_termination_unconfirmed' } })
  })

  it('submits verified workspace and inline attachments without dropping names, URIs, text or caller identity', async () => {
    const { requests } = transport([Response.json({ data: nativeSession() }), Response.json({ data: { id: 'msg_files' } })], true)
    const files = [
      { mime: 'text/plain', filename: 'note ü.txt', url: 'file:///workspace/context/note%20%C3%BC.txt' },
      { mime: 'application/x-directory', filename: 'context', url: 'file:///workspace/context' },
      { mime: 'image/png', filename: 'pixel.png', url: 'file:///workspace/pixel.png' },
      { mime: 'image/png', filename: 'inline.png', url: 'data:image/png;base64,aW1hZ2U=' },
    ]
    const signal = new AbortController().signal
    expect(await createOpenCodeV2Runtime('alice').prompt({ sessionId: SESSION_ID, messageId: 'msg_files', parts: [{ type: 'text', text: 'Attachments' }, ...files.map((file) => ({ type: 'file' as const, ...file }))] }, { signal })).toEqual({ ok: true, data: undefined })
    expect(requests[1]).toMatchObject({ path: `/api/session/${SESSION_ID}/prompt`, body: { id: 'msg_files', text: 'Attachments', files: files.map((file) => ({ uri: file.url, name: file.filename })) }, signal })
  })

  it.each([
    ['https://example.invalid/image.png', 'image/png'],
    ['file:///etc/passwd', 'text/plain'],
    ['file:///workspace/../etc/passwd', 'text/plain'],
    ['file:///workspace/a%2f..%2f..%2fsecret.txt', 'text/plain'],
    ['file:///workspace/a%5csecret.txt', 'text/plain'],
    ['file:///workspace/%invalid.txt', 'text/plain'],
    ['file:///workspace/note.txt?ignored', 'text/plain'],
    ['file:///workspace/note.txt#ignored', 'text/plain'],
    ['file://remote/workspace/note.txt', 'text/plain'],
    ['data:image/png;base64,aW1hZ2U=', 'image/jpeg'],
    ['data:application/pdf;base64,aW1hZ2U=', 'application/pdf'],
    ['data:image/svg+xml;base64,aW1hZ2U=', 'image/svg+xml'],
    ['data:text/plain,inline', 'text/plain'],
  ])('rejects out-of-workspace or non-V1 file input %s (%s) before selection or prompt mutation', async (url, mime) => {
    const { requests } = transport([Response.json({ data: nativeSession() })], true)
    expect(await createOpenCodeV2Runtime('alice').prompt({ sessionId: SESSION_ID, agent: 'alternate', parts: [{ type: 'file', mime, url }] })).toMatchObject({ ok: false, error: { code: 'runtime_unsupported' } })
    expect(requests).toHaveLength(1)
  })

  it('accepts every file part the V1 prompt builder emits', async () => {
    const { requests } = transport([Response.json({ data: nativeSession() }), Response.json({ data: { id: 'msg_files' } })], true)
    const files = [
      ...['image/jpeg', 'image/png', 'image/gif', 'image/webp'].map((mime) => ({ mime, filename: `inline.${mime.slice(6)}`, url: `data:${mime};base64,aW1hZ2U=` })),
      ...[
        ['image/jpeg', 'photo.jpg'], ['image/svg+xml', 'logo.svg'], ['text/markdown', 'notes.md'], ['application/json', 'data.json'],
        ['application/xml', 'data.xml'], ['application/zip', 'bundle.zip'], ['application/msword', 'legacy.doc'], ['audio/mpeg', 'clip.mp3'],
        ['text/plain', 'run.log'],
      ].map(([mime, filename]) => ({ mime, filename, url: `file:///workspace/.arche/attachments/${encodeURIComponent(filename)}` })),
    ]
    expect(await createOpenCodeV2Runtime('alice').prompt({ sessionId: SESSION_ID, messageId: 'msg_files', parts: [{ type: 'text', text: 'Attachments' }, ...files.map((file) => ({ type: 'file' as const, ...file }))] })).toEqual({ ok: true, data: undefined })
    expect(requests[1]).toMatchObject({ path: `/api/session/${SESSION_ID}/prompt`, body: { id: 'msg_files', text: 'Attachments', files: files.map((file) => ({ uri: file.url, name: file.filename })) } })
  })

  it.each(['once', 'always', 'reject'] as const)('lists a recorded permission and sends native decision %s', async (response) => {
    const { requests } = transport([Response.json({ location: { directory: '/workspace' }, data: [permission] }), empty()])
    const runtime = createOpenCodeV2Runtime('alice')
    expect(await runtime.listPermissions()).toMatchObject({ ok: true, data: [{ id: permission.id, sessionId: permission.sessionID, kind: 'read', pattern: 'sample.txt', state: 'pending' }] })
    expect(await runtime.replyPermission({ sessionId: permission.sessionID, permissionId: permission.id, response })).toEqual({ ok: true, data: undefined })
    expect(requests[1]).toMatchObject({ method: 'POST', path: `/api/session/${permission.sessionID}/permission/${permission.id}/reply`, body: { decision: response } })
  })

  it('normalizes the actual client rejection of a missing session before interrupt', async () => {
    const { requests } = transport([Response.json({ _tag: 'SessionNotFoundError', sessionID: 'missing', name: 'SessionNotFoundError' }, { status: 404 })])
    expect(await createOpenCodeV2Runtime('alice').abortSession('missing')).toEqual({ ok: false, error: { code: 'session_not_found', detail: 'SessionNotFoundError', status: 404 } })
    expect(requests).toHaveLength(1)
  })

})
