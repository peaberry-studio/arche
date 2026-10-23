import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ArcheEvent } from '@/lib/harness/events'

const mocks = vi.hoisted(() => ({
  getRuntimeCapabilities: vi.fn(() => ({ csrf: false })),
  isDesktop: vi.fn(() => false),
  getSession: vi.fn(),
  validateSameOrigin: vi.fn(() => ({ ok: true })),
  validateDesktopToken: vi.fn(() => true),
  getRuntimeForSlug: vi.fn(),
  subscribeEvents: vi.fn(),
  listMessages: vi.fn(),
  abortSession: vi.fn(),
  subscribeWorkspaceEvents: vi.fn(),
}))
const broadcast = vi.hoisted(() => ({
  listener: null as ((event: { type: string }) => void) | null,
  unsubscribe: vi.fn(),
}))
vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mocks.getRuntimeCapabilities }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mocks.isDesktop }))
vi.mock('@/lib/runtime/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/csrf', () => ({ validateSameOrigin: mocks.validateSameOrigin }))
vi.mock('@/lib/runtime/desktop/token', () => ({ DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token', validateDesktopToken: mocks.validateDesktopToken }))
vi.mock('@/lib/harness/registry', () => ({ getRuntimeForSlug: mocks.getRuntimeForSlug }))
vi.mock('@/lib/runtime/workspace-broadcast', () => ({ subscribeWorkspaceEvents: mocks.subscribeWorkspaceEvents }))

import { GET } from '@/app/api/w/[slug]/events/route'

function request(signal?: AbortSignal, protocol: 'arche-v1' | 'legacy' = 'arche-v1') {
  const url = `http://localhost/api/w/alice/events${protocol === 'arche-v1' ? '?protocol=arche-v1' : ''}`
  return GET(new NextRequest(url, { signal }), { params: Promise.resolve({ slug: 'alice' }) })
}

function pendingSubscription() {
  mocks.subscribeEvents.mockImplementation(async (signal: AbortSignal) => ({
    ok: true,
    data: (async function* () {
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve()
        else signal.addEventListener('abort', () => resolve(), { once: true })
      })
      yield* []
    })(),
  }))
}

const CONNECTED = ': connected\n\n'

async function readText(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  return new TextDecoder().decode((await reader.read()).value)
}

function eventSubscription(events: ArcheEvent[]) {
  mocks.subscribeEvents.mockResolvedValue({ ok: true, data: (async function* () { yield* events })() })
}

describe('GET /api/w/[slug]/events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({ user: { id: 'u1', email: 'alice@test.com', slug: 'alice', role: 'USER' }, sessionId: 's1' })
    mocks.getRuntimeForSlug.mockResolvedValue({ ok: true, data: { subscribeEvents: mocks.subscribeEvents, listMessages: mocks.listMessages, abortSession: mocks.abortSession } })
    mocks.listMessages.mockResolvedValue({ ok: true, data: [] })
    mocks.subscribeWorkspaceEvents.mockImplementation((_userId: string, listener: (event: { type: string }) => void) => {
      broadcast.listener = listener
      return broadcast.unsubscribe
    })
    pendingSubscription()
  })
  afterEach(() => { vi.useRealTimers() })

  it('returns 401 before resolving a runtime when unauthenticated', async () => {
    mocks.getSession.mockResolvedValue(null)
    expect((await request()).status).toBe(401)
    expect(mocks.getRuntimeForSlug).not.toHaveBeenCalled()
  })

  it('returns 403 for another workspace', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'u2', slug: 'bob', role: 'USER' }, sessionId: 's2' })
    expect((await request()).status).toBe(403)
    expect(mocks.subscribeEvents).not.toHaveBeenCalled()
  })

  it('returns 503 when the runtime is unsupported', async () => {
    mocks.getRuntimeForSlug.mockResolvedValue({ ok: false, error: { code: 'runtime_unsupported' } })
    const response = await request()
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'runtime_unsupported' })
  })

  it('returns 503 when the instance is unavailable', async () => {
    mocks.subscribeEvents.mockResolvedValue({ ok: false, error: { code: 'instance_unavailable' } })
    const response = await request()
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'instance_unavailable' })
  })

  it('returns 502 when the upstream cannot connect', async () => {
    mocks.subscribeEvents.mockResolvedValue({ ok: false, error: { code: 'event_stream_unavailable' } })
    const response = await request()
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'event_stream_unavailable' })
  })

  it('bounds only the upstream connect deadline', async () => {
    vi.useFakeTimers()
    mocks.subscribeEvents.mockImplementation((signal: AbortSignal) => new Promise((resolve) => {
      signal.addEventListener('abort', () => resolve({ ok: false, error: { code: 'event_stream_unavailable' } }), { once: true })
    }))
    const response = request()
    await vi.advanceTimersByTimeAsync(8_000)
    expect((await response).status).toBe(502)
    expect(mocks.subscribeEvents.mock.calls[0][0].aborted).toBe(true)
  })

  it('keeps the subscription alive beyond the connect deadline and sends 10-second heartbeats', async () => {
    vi.useFakeTimers()
    const response = await request()
    const reader = response.body!.getReader()
    expect(await readText(reader)).toBe(CONNECTED)
    const firstRead = reader.read()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(new TextDecoder().decode((await firstRead).value)).toMatch(/^: heartbeat \d+\n\n$/)
    await vi.advanceTimersByTimeAsync(50_000)
    expect(mocks.subscribeEvents.mock.calls[0][0].aborted).toBe(false)
    await reader.cancel()
  })

  it('flushes a frame at connect so the client sees the stream open before any event', async () => {
    const response = await request()
    const reader = response.body!.getReader()
    expect(await readText(reader)).toBe(CONNECTED)
    await reader.cancel()
  })

  it('writes normalized Arche frames and closes on upstream EOF', async () => {
    const events: ArcheEvent[] = [{ v: 1, type: 'session.status', sessionId: 's1', status: 'busy' }, { v: 1, type: 'workspace.touched' }]
    eventSubscription(events)
    const response = await request()
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(await response.text()).toBe(CONNECTED + events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''))
    expect(mocks.getRuntimeForSlug).toHaveBeenCalledWith('alice')
  })

  it('keeps the previous browser protocol when no version is requested', async () => {
    eventSubscription([
      { v: 1, type: 'session.status', sessionId: 's1', status: 'busy' },
      { v: 1, type: 'message.upserted', message: { id: 'm1', sessionId: 's1', role: 'assistant', content: 'Hello', timestamp: '', timestampRaw: 1, parts: [{ type: 'text', id: 'text', text: 'Hello' }] } },
      { v: 1, type: 'workspace.touched' },
    ])
    const response = await request(undefined, 'legacy')
    const frames = (await response.text()).split('\n').filter((line) => line.startsWith('data: ')).map((line) => JSON.parse(line.slice(6)))
    expect(frames).toEqual([
      { type: 'session.status', properties: { sessionID: 's1', status: { type: 'busy' } } },
      { type: 'message.updated', properties: { info: { id: 'm1', sessionID: 's1', role: 'assistant', time: { created: 1 }, parts: [{ type: 'text', id: 'text', text: 'Hello', messageID: 'm1', sessionID: 's1' }] } } },
      { type: 'file.edited', properties: {} },
    ])
  })

  it('recovers only tool identity when an old browser reconnects after input.started', async () => {
    mocks.listMessages.mockResolvedValue({ ok: true, data: [{ id: 'm1', sessionId: 's1', role: 'assistant', parts: [
      { type: 'text', id: 'text', text: 'Snapshot ahead of stream' },
      { type: 'tool', id: 'call', name: 'subagent', state: { status: 'completed', input: { agent: 'reviewer' }, output: 'Future output', title: 'Future title' } },
    ] }] })
    eventSubscription([{ v: 1, type: 'part.upserted', mode: 'tool-patch', sessionId: 's1', messageId: 'm1', update: { id: 'call', status: 'completed', output: 'Current output' } }])
    const response = await request(undefined, 'legacy')
    const text = await response.text()
    expect(text).not.toContain('Snapshot ahead of stream')
    expect(text).not.toContain('Future output')
    expect(text).toContain('"tool":"task"')
    expect(text).toContain('"subagent_type":"reviewer"')
    expect(text).toContain('"output":"Current output"')
    expect(mocks.listMessages).toHaveBeenCalledWith('s1', expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it('recovers every tool identity from the same message with one snapshot', async () => {
    mocks.listMessages.mockResolvedValue({ ok: true, data: [{ id: 'm1', sessionId: 's1', role: 'assistant', parts: [
      { type: 'tool', id: 'first', name: 'read', state: { status: 'completed', input: { filePath: '/kb/first.md' }, output: 'Future first' } },
      { type: 'tool', id: 'second', name: 'read', state: { status: 'completed', input: { filePath: '/kb/second.md' }, output: 'Future second' } },
    ] }] })
    eventSubscription([
      { v: 1, type: 'part.upserted', mode: 'tool-patch', sessionId: 's1', messageId: 'm1', update: { id: 'first', status: 'completed', output: 'Current first' } },
      { v: 1, type: 'part.upserted', mode: 'tool-patch', sessionId: 's1', messageId: 'm1', update: { id: 'second', status: 'completed', output: 'Current second' } },
    ])
    const response = await request(undefined, 'legacy')
    const frames = (await response.text()).split('\n').filter((line) => line.startsWith('data: ')).map((line) => JSON.parse(line.slice(6)))
    expect(frames).toHaveLength(2)
    expect(frames.map((frame) => frame.properties.part.state)).toEqual([
      { status: 'completed', input: { filePath: '/kb/first.md' }, output: 'Current first', title: 'read' },
      { status: 'completed', input: { filePath: '/kb/second.md' }, output: 'Current second', title: 'read' },
    ])
    expect(mocks.listMessages).toHaveBeenCalledOnce()
  })

  it.each(['timeout', 'disconnect'])('cancels legacy identity hydration on %s', async (kind) => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    mocks.listMessages.mockImplementation((_sessionId: string, options: { signal: AbortSignal }) => new Promise((resolve) => {
      signal = options.signal
      options.signal.addEventListener('abort', () => resolve({ ok: false, error: { code: 'runtime_error' } }), { once: true })
    }))
    eventSubscription([{ v: 1, type: 'part.upserted', mode: 'tool-patch', sessionId: 's1', messageId: 'm1', update: { id: 'call', status: 'running', input: {} } }])
    const response = await request(undefined, 'legacy')
    const reader = response.body!.getReader()
    expect(await readText(reader)).toBe(CONNECTED)
    expect(signal?.aborted).toBe(false)
    if (kind === 'timeout') await vi.advanceTimersByTimeAsync(2_000)
    else await reader.cancel()
    expect(signal?.aborted).toBe(true)
    if (kind === 'timeout') expect((await reader.read()).done).toBe(true)
  })

  it('forwards a delta without waiting for the next upstream event', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    mocks.subscribeEvents.mockResolvedValue({ ok: true, data: (async function* () {
      yield { v: 1, type: 'workspace.touched' }
      await gate
      yield { v: 1, type: 'workspace.touched' }
    })() })
    const response = await request()
    const reader = response.body!.getReader()
    expect(await readText(reader)).toBe(CONNECTED)
    expect(await readText(reader)).toContain('workspace.touched')
    release()
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('workspace.touched')
    expect((await reader.read()).done).toBe(true)
  })

  it.each(['request', 'body'])('releases the subscription and broadcast on %s cancellation without aborting a session', async (kind) => {
    const controller = new AbortController()
    const response = await request(controller.signal)
    expect(mocks.subscribeEvents.mock.calls[0][0].aborted).toBe(false)
    if (kind === 'request') controller.abort()
    else await response.body!.cancel()
    expect(mocks.subscribeEvents.mock.calls[0][0].aborted).toBe(true)
    expect(broadcast.unsubscribe).toHaveBeenCalledOnce()
    expect(mocks.abortSession).not.toHaveBeenCalled()
  })

  it('injects only modeled workspace broadcasts with a schema version', async () => {
    const response = await request()
    const reader = response.body!.getReader()
    expect(await readText(reader)).toBe(CONNECTED)
    broadcast.listener?.({ type: 'unmodeled.notification' })
    broadcast.listener?.({ type: 'knowledge.proposals_changed' })
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: {"v":1,"type":"knowledge.proposals_changed"}\n\n')
    expect(mocks.subscribeWorkspaceEvents).toHaveBeenCalledWith('u1', expect.any(Function))
    await reader.cancel()
  })

  it('closes on upstream failure without aborting execution', async () => {
    mocks.subscribeEvents.mockResolvedValue({ ok: true, data: (async function* () { throw new Error('disconnected'); yield* [] })() })
    const response = await request()
    expect(await response.text()).toBe(CONNECTED)
    expect(mocks.abortSession).not.toHaveBeenCalled()
    expect(broadcast.unsubscribe).toHaveBeenCalledOnce()
  })
})
