import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SESSION_ID, textEvents } from '@/lib/harness/adapters/opencode-v2/__tests__/fixtures'
import { subscribeOpenCodeEvents } from '@/lib/harness/adapters/opencode-v2/events'
import { createOpenCodeV2Runtime } from '@/lib/harness/adapters/opencode-v2/runtime'

const auth = vi.hoisted(() => vi.fn())
vi.mock('@/lib/harness/runtime-connection', () => ({ getInstanceBasicAuth: auth }))

const encoder = new TextEncoder()
function snapshotResponse(url: string): Response {
  return new URL(String(url)).pathname === '/api/session'
    ? Response.json({ data: [{ id: SESSION_ID }], cursor: { next: null } })
    : Response.json({ directory: '/workspace' })
}
function stream() {
  let controller: ReadableStreamDefaultController<Uint8Array>
  const cancel = vi.fn()
  const body = new ReadableStream<Uint8Array>({ start(value) { controller = value }, cancel })
  return {
    response: new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }), cancel,
    send: (value: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`)),
    fail: () => controller.error(new Error('source failed')),
  }
}

describe('V2 event transport using the installed client', () => {
  beforeEach(() => { auth.mockImplementation(async (slug: string) => ({ baseUrl: `http://${slug}`, authHeader: `Basic ${slug}` })) })
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); vi.useRealTimers() })

  it('serves the runtime contract subscription through the production transport', async () => {
    const source = stream()
    const fetch = vi.fn(async (url: string) => String(url).endsWith('/api/event') ? source.response : snapshotResponse(url))
    vi.stubGlobal('fetch', fetch)
    const controller = new AbortController()
    const subscribed = await createOpenCodeV2Runtime('alice').subscribeEvents(controller.signal)
    if (!subscribed.ok) throw new Error(subscribed.error.code)
    expect(auth).toHaveBeenCalledWith('alice')
    const iterator = subscribed.data[Symbol.asyncIterator]()
    const next = iterator.next()
    source.send(textEvents[2])
    expect((await next).value).toMatchObject({ type: 'part.delta', delta: 'Hello fixture' })
    controller.abort()
    await iterator.return?.()
    expect(fetch.mock.calls.every(([url]) => !String(url).includes('interrupt'))).toBe(true)
  })

  it('primes the lazy connection, authenticates, and forwards before reading the next event', async () => {
    const source = stream()
    const fetch = vi.fn(async (url: string, _options: RequestInit) => String(url).endsWith('/api/event') ? source.response : snapshotResponse(url))
    vi.stubGlobal('fetch', fetch)
    source.send({ id: 'connected', type: 'server.connected', data: {} })
    const controller = new AbortController()
    const subscribed = await subscribeOpenCodeEvents('alice', controller.signal)
    expect(subscribed.ok).toBe(true)
    if (!subscribed.ok) throw new Error(subscribed.error.code)
    expect(fetch.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(['/api/location', '/api/session', '/api/event'])
    const iterator = subscribed.data[Symbol.asyncIterator]()
    const next = iterator.next()
    source.send(textEvents[2])
    expect((await next).value).toMatchObject({ type: 'part.delta', delta: 'Hello fixture' })
    expect(fetch).toHaveBeenCalledTimes(3)
    controller.abort()
    await iterator.return?.()
    expect(fetch.mock.calls[2][1].signal?.aborted).toBe(true)
  })

  it('isolates subscriber cancellation, workspace auth and locations without interrupting execution', async () => {
    const sources = [stream(), stream()]
    const fetch = vi.fn(async (url: string, options: RequestInit) => {
      const index = String(url).includes('alice') ? 0 : 1
      expect(new Headers(options.headers).get('Authorization')).toBe(index === 0 ? 'Basic alice' : 'Basic bob')
      if (String(url).endsWith('/api/event')) return sources[index].response
      return snapshotResponse(url)
    })
    vi.stubGlobal('fetch', fetch)
    for (const source of sources) source.send({ id: 'connected', type: 'server.connected', data: {} })
    const controllers = [new AbortController(), new AbortController()]
    const [alice, bob] = await Promise.all([subscribeOpenCodeEvents('alice', controllers[0].signal), subscribeOpenCodeEvents('bob', controllers[1].signal)])
    if (!alice.ok || !bob.ok) throw new Error('subscription failed')
    const a = alice.data[Symbol.asyncIterator]()
    const b = bob.data[Symbol.asyncIterator]()
    controllers[0].abort()
    expect((await a.next()).done).toBe(true)
    const next = b.next()
    sources[1].send({ ...textEvents[2], location: { directory: '/another-workspace' }, data: { ...textEvents[2].data, delta: 'must not leak' } })
    sources[1].send(textEvents[2])
    expect((await next).value).toMatchObject({ type: 'part.delta', delta: 'Hello fixture' })
    expect(sources[1].cancel).not.toHaveBeenCalled()
    controllers[1].abort()
    await b.return?.()
    expect(fetch.mock.calls.every(([url]) => !String(url).includes('interrupt'))).toBe(true)
  })

  it('returns a typed connect failure and does not mistake iterator creation for readiness', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).endsWith('/api/event') ? new Response('', { status: 503 }) : snapshotResponse(url)))
    expect(await subscribeOpenCodeEvents('alice', new AbortController().signal)).toMatchObject({ ok: false, error: { code: 'event_stream_unavailable' } })
  })

  it('forwards unlocated execution only for known workspace sessions', async () => {
    const source = stream()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).endsWith('/api/event') ? source.response : snapshotResponse(url)))
    const controller = new AbortController()
    const subscription = await subscribeOpenCodeEvents('alice', controller.signal)
    if (!subscription.ok) throw new Error(subscription.error.code)
    const iterator = subscription.data[Symbol.asyncIterator]()
    const next = iterator.next()
    const execution = { id: 'evt_execution', created: 1, type: 'session.execution.started', durable: { aggregateID: SESSION_ID, seq: 1, version: 1 }, data: { sessionID: SESSION_ID } }
    source.send({ ...execution, data: { sessionID: 'other-workspace' } })
    source.send(execution)
    expect((await next).value).toMatchObject({ type: 'session.status', sessionId: SESSION_ID, status: 'busy' })
    controller.abort()
    await iterator.return?.()
  })

  it('returns on SSE headers without waiting for a first payload and keeps a quiet stream alive', async () => {
    vi.useFakeTimers()
    const source = stream()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).endsWith('/api/event') ? source.response : snapshotResponse(url)))
    const controller = new AbortController()
    const subscribed = await subscribeOpenCodeEvents('alice', controller.signal)
    if (!subscribed.ok) throw new Error(subscribed.error.code)
    await vi.advanceTimersByTimeAsync(30_000)
    const iterator = subscribed.data[Symbol.asyncIterator]()
    const next = iterator.next()
    source.send(textEvents[2])
    expect((await next).value).toMatchObject({ type: 'part.delta' })
    controller.abort()
    await iterator.return?.()
  })

  it('honors caller cancellation while transport headers are pending', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
      if (!String(url).endsWith('/api/event')) return snapshotResponse(url)
      return new Promise<Response>((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
    }))
    const controller = new AbortController()
    const subscribing = subscribeOpenCodeEvents('alice', controller.signal)
    await vi.advanceTimersByTimeAsync(8_000)
    controller.abort()
    expect(await subscribing).toMatchObject({ ok: false, error: { code: 'event_stream_unavailable' } })
  })

  it('releases a failed source and reconnects with a fresh live-only subscription', async () => {
    const sources = [stream(), stream()]
    let connections = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).endsWith('/api/event') ? sources[connections++].response : snapshotResponse(url)))
    sources[0].send({ id: 'connected', type: 'server.connected', data: {} })
    const first = await subscribeOpenCodeEvents('alice', new AbortController().signal)
    if (!first.ok) throw new Error(first.error.code)
    const iterator = first.data[Symbol.asyncIterator]()
    const next = iterator.next()
    sources[0].fail()
    await expect(next).rejects.toBeDefined()
    sources[1].send({ id: 'connected-again', type: 'server.connected', data: {} })
    const controller = new AbortController()
    const second = await subscribeOpenCodeEvents('alice', controller.signal)
    if (!second.ok) throw new Error(second.error.code)
    const resumed = second.data[Symbol.asyncIterator]()
    const event = resumed.next()
    sources[1].send(textEvents[2])
    expect((await event).value).toMatchObject({ type: 'part.delta' })
    expect(connections).toBe(2)
    controller.abort()
    await resumed.return?.()
  })
})
