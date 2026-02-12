import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetAuthenticatedUser = vi.fn()
vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
}))

const mockFindUnique = vi.fn()
vi.mock('@/lib/prisma', () => ({
  prisma: {
    instance: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
  },
}))

const mockDecryptPassword = vi.fn()
vi.mock('@/lib/spawner/crypto', () => ({
  decryptPassword: (...args: unknown[]) => mockDecryptPassword(...args),
}))

function session(slug: string, role: 'USER' | 'ADMIN' = 'USER') {
  return {
    user: { id: 'user-1', email: 'alice@example.com', slug, role },
    sessionId: 'session-1',
  }
}

describe('chat stream attachments forwarding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    mockGetAuthenticatedUser.mockResolvedValue(session('alice'))
    mockFindUnique.mockResolvedValue({
      serverPassword: 'encrypted-password',
      status: 'running',
    })
    mockDecryptPassword.mockReturnValue('secret-password')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('forwards selected attachments as file parts to prompt_async', async () => {
    let promptBody: Record<string, unknown> | null = null

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.includes('/prompt_async')) {
        promptBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return new Response('prompt_failed', { status: 500 })
      }

      throw new Error(`Unexpected fetch url: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('@/app/api/w/[slug]/chat/stream/route')
    const req = new Request('http://localhost/api/w/alice/chat/stream', {
      method: 'POST',
      headers: {
        host: 'localhost',
        origin: 'http://localhost',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: 'session-1',
        text: 'Please summarize this file',
        attachments: [
          {
            path: '.arche/attachments/report.pdf',
            filename: 'report.pdf',
            mime: 'application/pdf',
          },
        ],
      }),
    })

    const res = await POST(req as never, {
      params: Promise.resolve({ slug: 'alice' }),
    })

    expect(res.status).toBe(200)
    await res.text()

    expect(promptBody).not.toBeNull()
    const promptParts = (promptBody?.parts ?? []) as Array<Record<string, unknown>>
    expect(promptParts).toHaveLength(3)
    expect(promptParts[0]).toEqual({
      type: 'text',
      text: 'Please summarize this file',
    })
    expect(promptParts[1].type).toBe('file')
    expect(promptParts[1].filename).toBe('report.pdf')
    expect(promptParts[1].mime).toBe('application/pdf')
    expect(promptParts[1].url).toBe('file:///workspace/.arche/attachments/report.pdf')
    expect(promptParts[2]).toEqual({
      type: 'text',
      text:
        'Attached workspace files:\n- /workspace/.arche/attachments/report.pdf\nIf direct file parsing is unavailable, inspect these paths with available tools.',
    })
  })

  it('normalizes unsupported octet-stream mime to safe fallback', async () => {
    let promptBody: Record<string, unknown> | null = null

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.includes('/prompt_async')) {
        promptBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return new Response('prompt_failed', { status: 500 })
      }

      throw new Error(`Unexpected fetch url: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('@/app/api/w/[slug]/chat/stream/route')
    const req = new Request('http://localhost/api/w/alice/chat/stream', {
      method: 'POST',
      headers: {
        host: 'localhost',
        origin: 'http://localhost',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: 'session-1',
        text: 'Use this attachment',
        attachments: [
          {
            path: '.arche/attachments/blob.unknown',
            filename: 'blob.unknown',
            mime: 'application/octet-stream',
          },
        ],
      }),
    })

    const res = await POST(req as never, {
      params: Promise.resolve({ slug: 'alice' }),
    })

    expect(res.status).toBe(200)
    await res.text()

    const promptParts = (promptBody?.parts ?? []) as Array<Record<string, unknown>>
    expect(promptParts[1].mime).toBe('text/plain')
  })
})
