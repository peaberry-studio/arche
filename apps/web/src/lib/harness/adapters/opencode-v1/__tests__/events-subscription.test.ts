import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { subscribeOpenCodeEvents, translateEventStream } from '@/lib/harness/adapters/opencode-v1/events'
import type { ArcheEvent } from '@/lib/harness/events'

const mocks = vi.hoisted(() => ({ getInstanceBasicAuth: vi.fn() }))
vi.mock('@/lib/harness/adapters/opencode-v1/client', () => ({ getInstanceBasicAuth: mocks.getInstanceBasicAuth }))

describe('v1 event subscription', () => {
  beforeEach(() => {
    mocks.getInstanceBasicAuth.mockResolvedValue({ baseUrl: 'http://workspace:4096', authHeader: 'Basic test' })
  })
  afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals() })

  it('returns instance_unavailable without fetching when the workspace is stopped', async () => {
    mocks.getInstanceBasicAuth.mockResolvedValue(null)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await subscribeOpenCodeEvents('alice', new AbortController().signal)).toEqual({ ok: false, error: { code: 'instance_unavailable' } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('connects using the adapter credentials and resolves before the first event arrives', async () => {
    const controller = new AbortController()
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel })
    const fetchMock = vi.fn().mockResolvedValue(new Response(body))
    vi.stubGlobal('fetch', fetchMock)
    const result = await subscribeOpenCodeEvents('alice', controller.signal)
    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('http://workspace:4096/event', expect.objectContaining({
      signal: controller.signal, headers: expect.objectContaining({ Authorization: 'Basic test' }),
    }))
    if (!result.ok) throw new Error('Expected a connected subscription')
    const iterator = result.data[Symbol.asyncIterator]()
    const next = iterator.next()
    controller.abort()
    expect(await next).toEqual({ done: true, value: undefined })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('returns a typed error on connect failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection refused')))
    expect(await subscribeOpenCodeEvents('alice', new AbortController().signal)).toEqual({ ok: false, error: { code: 'event_stream_unavailable', detail: 'Connection refused' } })
  })

  it('releases the response body on non-success status', async () => {
    const cancel = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }), { status: 401 })))
    expect(await subscribeOpenCodeEvents('alice', new AbortController().signal)).toEqual({ ok: false, error: { code: 'event_stream_unavailable' } })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('yields the current delta before pulling another upstream chunk', async () => {
    let pulls = 0
    const cancel = vi.fn()
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'message.part.delta', properties: { sessionID: 's1', messageID: 'm1', partID: 'p1', delta: String(pulls) } })}\n\n`))
      },
      cancel,
    }, { highWaterMark: 0 })
    const events = translateEventStream(body, new AbortController().signal)
    expect((await events.next()).value).toEqual({ v: 1, type: 'part.delta', sessionId: 's1', messageId: 'm1', partId: 'p1', field: 'text', delta: '1' })
    expect(pulls).toBe(1)
    await events.return(undefined)
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('does not read the next frame from a chunk before its first event is consumed', async () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(encoder.encode('data: {"type":"file.edited"}\n\ndata: {"type":"todo.updated"}\n\n'))
      controller.close()
    } })
    const events: ArcheEvent[] = []
    for await (const event of translateEventStream(body, new AbortController().signal)) events.push(event)
    expect(events).toEqual([{ v: 1, type: 'workspace.touched' }, { v: 1, type: 'workspace.touched' }])
  })
})
