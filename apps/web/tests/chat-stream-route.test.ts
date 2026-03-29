import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RuntimeSessionResult } from '@/lib/runtime/types'

const mockGetSession = vi.fn<() => Promise<RuntimeSessionResult>>()

const mockFindCredentialsBySlug = vi.fn()

const mockDecryptPassword = vi.fn(() => 'secret-password')

function session(slug: string, role: 'USER' | 'ADMIN' = 'USER') {
  return {
    user: { id: 'user-1', email: 'alice@example.com', slug, role },
    sessionId: 'session-1',
  }
}

async function loadRoute() {
  vi.doMock('@/lib/runtime/session', () => ({
    getSession: () => mockGetSession(),
  }))

  vi.doMock('@/lib/runtime/mode', () => ({
    isDesktop: () => false,
  }))

  vi.doMock('@/lib/runtime/capabilities', () => ({
    getRuntimeCapabilities: () => ({
      multiUser: true,
      auth: true,
      containers: true,
      workspaceAgent: true,
      reaper: true,
      csrf: true,
      twoFactor: true,
      teamManagement: true,
      connectors: true,
      kickstart: true,
    }),
  }))

  vi.doMock('@/lib/csrf', () => ({
    validateSameOrigin: vi.fn((request: Request) => {
      const origin = request.headers.get('origin')
      return origin ? { ok: true } : { ok: false }
    }),
  }))

  vi.doMock('@/lib/runtime/desktop/token', () => ({
    DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
    validateDesktopToken: () => false,
  }))

  vi.doMock('@/lib/services', () => ({
    instanceService: {
      findCredentialsBySlug: (...args: unknown[]) => mockFindCredentialsBySlug(...args),
    },
  }))

  vi.doMock('@/lib/spawner/crypto', () => ({
    decryptPassword: (...args: unknown[]) => mockDecryptPassword(...args),
  }))

  vi.doMock('@/lib/opencode/client', () => ({
    getInstanceUrl: (slug: string) => `http://${slug}.test`,
  }))

  vi.doMock('@/lib/workspace-agent/client', () => ({
    getWorkspaceAgentUrl: (slug: string) => `http://${slug}.workspace-agent.test:4097`,
  }))

  return import('@/app/api/w/[slug]/chat/stream/route')
}

function createRequest(
  slug = 'alice',
  body: BodyInit | null = JSON.stringify({ sessionId: 'session-1', text: 'Hello' }),
  init?: {
    headers?: Record<string, string>
    signal?: AbortSignal
  },
) {
  return new Request(`http://localhost/api/w/${slug}/chat/stream`, {
    method: 'POST',
    headers: {
      host: 'localhost',
      origin: 'http://localhost',
      'content-type': 'application/json',
      ...init?.headers,
    },
    body,
    signal: init?.signal,
  })
}

function emptyEventStreamResponse() {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close()
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    },
  )
}

describe('POST /api/w/[slug]/chat/stream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockGetSession.mockResolvedValue(session('alice'))
    mockFindCredentialsBySlug.mockResolvedValue({
      serverPassword: 'encrypted-password',
      status: 'running',
    })
    mockDecryptPassword.mockReturnValue('secret-password')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unmock('@/lib/runtime/session')
    vi.unmock('@/lib/runtime/mode')
    vi.unmock('@/lib/runtime/capabilities')
    vi.unmock('@/lib/csrf')
    vi.unmock('@/lib/runtime/desktop/token')
    vi.unmock('@/lib/services')
    vi.unmock('@/lib/spawner/crypto')
    vi.unmock('@/lib/opencode/client')
    vi.unmock('@/lib/workspace-agent/client')
  })

  it('returns 401 when the session is missing', async () => {
    mockGetSession.mockResolvedValue(null)

    const { POST } = await loadRoute()
    const response = await POST(createRequest() as never, {
      params: Promise.resolve({ slug: 'alice' }),
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' })
  })

  it('returns 403 when the user cannot access the requested workspace', async () => {
    mockGetSession.mockResolvedValue(session('bob'))

    const { POST } = await loadRoute()
    const response = await POST(createRequest('alice') as never, {
      params: Promise.resolve({ slug: 'alice' }),
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'forbidden' })
  })

  it('returns 400 when the request body is not valid JSON', async () => {
    const { POST } = await loadRoute()
    const response = await POST(createRequest('alice', 'not-json') as never, {
      params: Promise.resolve({ slug: 'alice' }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_json' })
  })

  it('returns 503 when the workspace instance is unavailable', async () => {
    mockFindCredentialsBySlug.mockResolvedValue(null)

    const { POST } = await loadRoute()
    const response = await POST(createRequest() as never, {
      params: Promise.resolve({ slug: 'alice' }),
    })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'instance_unavailable' })
  })

  it('passes the client abort signal to upstream event and prompt requests', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.endsWith('/event')) {
        return emptyEventStreamResponse()
      }

      if (url.includes('/prompt_async')) {
        return new Response('', { status: 200 })
      }

      throw new Error(`Unexpected fetch url: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const abortController = new AbortController()
    const { POST } = await loadRoute()
    const response = await POST(
      createRequest(
        'alice',
        JSON.stringify({ sessionId: 'session-1', text: 'Hello' }),
        { signal: abortController.signal },
      ) as never,
      {
        params: Promise.resolve({ slug: 'alice' }),
      },
    )

    expect(response.status).toBe(200)
    await response.text()

    const eventSignal = fetchMock.mock.calls[0]?.[1]?.signal
    const promptSignal = fetchMock.mock.calls[1]?.[1]?.signal

    expect(eventSignal).toBeInstanceOf(AbortSignal)
    expect(promptSignal).toBeInstanceOf(AbortSignal)
    expect(eventSignal?.aborted).toBe(false)
    expect(promptSignal?.aborted).toBe(false)

    abortController.abort()

    expect(eventSignal?.aborted).toBe(true)
    expect(promptSignal?.aborted).toBe(true)
  })

  it('aborts the upstream event stream and closes the SSE response when the client disconnects', async () => {
    let upstreamAborted = false

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            init?.signal?.addEventListener(
              'abort',
              () => {
                upstreamAborted = true
                try {
                  controller.close()
                } catch {
                  // The route may already have closed the mock upstream stream.
                }
              },
              { once: true },
            )
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const abortController = new AbortController()
    const { POST } = await loadRoute()
    const response = await POST(
      createRequest(
        'alice',
        JSON.stringify({ sessionId: 'session-1', resume: true }),
        { signal: abortController.signal },
      ) as never,
      {
        params: Promise.resolve({ slug: 'alice' }),
      },
    )

    expect(response.status).toBe(200)

    const responseTextPromise = response.text()
    abortController.abort()

    const result = await Promise.race([
      responseTextPromise.then(() => 'closed'),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve('timeout'), 100)
      }),
    ])

    expect(upstreamAborted).toBe(true)
    expect(result).toBe('closed')
  })
})
