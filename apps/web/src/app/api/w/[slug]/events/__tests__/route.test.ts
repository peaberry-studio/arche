import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRuntimeCapabilities: vi.fn(() => ({ csrf: false })),
  isDesktop: vi.fn(() => false),
  getSession: vi.fn(),
  validateSameOrigin: vi.fn(() => ({ ok: true })),
  validateDesktopToken: vi.fn(() => true),
  instanceService: { findCredentialsBySlug: vi.fn() },
  decryptPassword: vi.fn(() => 'secret'),
  getInstanceUrl: vi.fn(() => 'http://test-slug:3000'),
}))

vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mocks.getRuntimeCapabilities }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mocks.isDesktop }))
vi.mock('@/lib/runtime/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/csrf', () => ({ validateSameOrigin: mocks.validateSameOrigin }))
vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
  validateDesktopToken: mocks.validateDesktopToken,
}))
vi.mock('@/lib/services', () => ({ instanceService: mocks.instanceService }))
vi.mock('@/lib/spawner/crypto', () => ({ decryptPassword: mocks.decryptPassword }))
vi.mock('@/lib/opencode/client', () => ({ getInstanceUrl: mocks.getInstanceUrl }))

import { GET } from '../route'

function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
}

function params() {
  return { params: Promise.resolve({ slug: 'alice' }) }
}

async function readAll(res: Response): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  let text = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
  }
  decoder.decode()
  return text
}

describe('GET /api/w/[slug]/events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    mocks.getSession.mockResolvedValue({
      user: { id: 'u1', email: 'alice@test.com', slug: 'alice', role: 'USER' },
      sessionId: 's1',
    })
    mocks.instanceService.findCredentialsBySlug.mockResolvedValue({
      status: 'running',
      serverPassword: 'enc:pw',
    })
    mocks.decryptPassword.mockReturnValue('secret')
    mocks.getInstanceUrl.mockReturnValue('http://test-slug:3000')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns 401 when unauthenticated', async () => {
    mocks.getSession.mockResolvedValue(null)
    const res = await GET(new NextRequest('http://localhost/api/w/alice/events'), params())
    expect(res.status).toBe(401)
  })

  it('returns 403 for another workspace without ADMIN', async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: 'u2', email: 'bob@test.com', slug: 'bob', role: 'USER' },
      sessionId: 's2',
    })
    const res = await GET(new NextRequest('http://localhost/api/w/alice/events'), params())
    expect(res.status).toBe(403)
  })

  it('returns 503 when the instance is not running', async () => {
    mocks.instanceService.findCredentialsBySlug.mockResolvedValue({ status: 'stopped', serverPassword: null })
    const res = await GET(new NextRequest('http://localhost/api/w/alice/events'), params())
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('instance_unavailable')
  })

  it('returns 502 when the upstream event stream cannot connect', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))))
    const res = await GET(new NextRequest('http://localhost/api/w/alice/events'), params())
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('event_stream_unavailable')
    vi.unstubAllGlobals()
  })

  it('returns 502 when the upstream connect exceeds the timeout window', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = vi.fn((_url: string | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          })
        }),
      )
      vi.stubGlobal('fetch', fetchMock)

      const resPromise = GET(new NextRequest('http://localhost/api/w/alice/events'), params())
      await vi.advanceTimersByTimeAsync(8_000)
      const res = await resPromise

      expect(res.status).toBe(502)
      expect((await res.json()).error).toBe('event_stream_unavailable')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps the upstream pipe open beyond the connect timeout window', async () => {
    vi.useFakeTimers()
    try {
      const pendingBody = new ReadableStream<Uint8Array>({
        start() { /* never enqueues or closes */ },
      })
      const fetchMock = vi.fn().mockResolvedValue(new Response(pendingBody))
      vi.stubGlobal('fetch', fetchMock)

      const res = await GET(new NextRequest('http://localhost/api/w/alice/events'), params())
      const upstreamSignal = fetchMock.mock.calls[0][1]?.signal as AbortSignal

      // The connect timeout must not abort the persistent body read.
      await vi.advanceTimersByTimeAsync(60_000)
      expect(upstreamSignal.aborted).toBe(false)

      await res.body?.cancel()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('aborts the upstream /event fetch when the browser disconnects', async () => {
    const pendingBody = new ReadableStream<Uint8Array>({
      start() { /* never enqueues or closes */ },
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response(pendingBody))
    vi.stubGlobal('fetch', fetchMock)

    const controller = new AbortController()
    await GET(
      new NextRequest('http://localhost/api/w/alice/events', { signal: controller.signal }),
      params(),
    )
    const upstreamSignal = fetchMock.mock.calls[0][1]?.signal as AbortSignal
    expect(upstreamSignal.aborted).toBe(false)

    controller.abort()
    await vi.waitFor(() => {
      expect(upstreamSignal.aborted).toBe(true)
    })

    // Only the /event pipe of this connection is aborted; no OpenCode session
    // endpoint is ever touched.
    const openCodeCalls = fetchMock.mock.calls.map(([input]) => String(input))
    expect(openCodeCalls).toHaveLength(1)
    expect(openCodeCalls[0]).toContain('/event')
  })

  it('forwards the OpenCode JSON unchanged', async () => {
    const eventJson = JSON.stringify({
      type: 'session.status',
      properties: { sessionID: 's1', status: { type: 'busy' } },
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response(sseBody([`data: ${eventJson}\n\n`]), {
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await GET(new NextRequest('http://localhost/api/w/alice/events'), params())
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    const body = await readAll(res)
    expect(body).toContain(`data: ${eventJson}`)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://test-slug:3000/event',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: expect.stringContaining('Basic ') }) }),
    )
  })

  it('sends heartbeat comments every 10s', async () => {
    vi.useFakeTimers()
    const pendingBody = new ReadableStream<Uint8Array>({
      start() { /* never enqueues or closes */ },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(pendingBody)))
    const res = await GET(new NextRequest('http://localhost/api/w/alice/events'), params())

    const reader = res.body?.getReader()
    expect(reader).toBeTruthy()
    const readPromise = reader!.read()
    await vi.advanceTimersByTimeAsync(10_000)
    const first = await readPromise
    const chunk = new TextDecoder().decode(first.value)
    expect(chunk).toMatch(/^: heartbeat \d+/)
  })

  it('aborting the request does not abort the OpenCode session', async () => {
    const pendingBody = new ReadableStream<Uint8Array>({
      start() { /* never resolves */ },
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response(pendingBody))
    vi.stubGlobal('fetch', fetchMock)

    const controller = new AbortController()
    const res = await GET(
      new NextRequest('http://localhost/api/w/alice/events', { signal: controller.signal }),
      params(),
    )
    const reader = res.body?.getReader()
    controller.abort()
    await reader!.read().catch(() => undefined)

    const openCodeCalls = fetchMock.mock.calls.map(([input]) => String(input))
    expect(openCodeCalls).toHaveLength(1)
    expect(openCodeCalls[0]).toContain('/event')
    expect(openCodeCalls[0]).not.toContain('/abort')
    expect(openCodeCalls[0]).not.toContain('/session/')
  })

  it('closes the response when the upstream stream ends', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(sseBody(['data: {"type":"session.idle","properties":{"sessionID":"s1"}}\n\n']))))
    const res = await GET(new NextRequest('http://localhost/api/w/alice/events'), params())
    const body = await readAll(res)
    expect(body).toContain('session.idle')
  })
})
