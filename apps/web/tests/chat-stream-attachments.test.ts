import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockExtractPdfText = vi.fn()
vi.mock('pdf-parse', () => ({
  default: (...args: unknown[]) => mockExtractPdfText(...args),
}))

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
    mockExtractPdfText.mockResolvedValue({ text: 'Extracted report body' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('extracts PDF attachments before sending prompt parts', async () => {
    let promptBody: Record<string, unknown> | null = null

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.includes(':4097/files/read')) {
        return new Response(
          JSON.stringify({
            ok: true,
            content: Buffer.from('fake-pdf').toString('base64'),
            encoding: 'base64',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }

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
    expect(promptParts[1]).toEqual({
      type: 'text',
      text:
        'Extracted text from attached PDF: /workspace/.arche/attachments/report.pdf\n\nExtracted report body',
    })
    expect(promptParts[2]).toEqual({
      type: 'text',
      text:
        'Attached workspace files:\n- /workspace/.arche/attachments/report.pdf\nIf direct file parsing is unavailable, inspect these paths with available tools.',
    })

    expect(mockExtractPdfText).toHaveBeenCalledTimes(1)
  })

  it('falls back to tools hint when PDF extraction fails', async () => {
    let promptBody: Record<string, unknown> | null = null
    mockExtractPdfText.mockRejectedValue(new Error('parse failed'))

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.includes(':4097/files/read')) {
        return new Response(
          JSON.stringify({
            ok: true,
            content: Buffer.from('fake-pdf').toString('base64'),
            encoding: 'base64',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }

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
        text: 'Use this PDF',
        attachments: [
          {
            path: '.arche/attachments/failure.pdf',
            filename: 'failure.pdf',
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

    const promptParts = (promptBody?.parts ?? []) as Array<Record<string, unknown>>
    expect(promptParts[1]).toEqual({
      type: 'text',
      text:
        'Attached PDF could not be extracted automatically: /workspace/.arche/attachments/failure.pdf\nContinue by using available tools on this path, or ask the user for an OCR-friendly/text PDF if the file is scanned.',
    })
    expect(promptParts[2]).toEqual({
      type: 'text',
      text:
        'Attached workspace files:\n- /workspace/.arche/attachments/failure.pdf\nIf direct file parsing is unavailable, inspect these paths with available tools.',
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
