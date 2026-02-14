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

  it('adds auto-context references as @path text without attaching file contents', async () => {
    let promptBody: Record<string, unknown> | null = null

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.endsWith('/event')) {
        return emptyEventStreamResponse()
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
        text: 'Please help with these files',
        contextPaths: [
          '/src/app/page.tsx',
          'src/app/page.tsx',
          'src/lib/utils.ts',
          '.arche/secrets.txt',
          '../etc/passwd',
          '',
        ],
      }),
    })

    const res = await POST(req as never, {
      params: Promise.resolve({ slug: 'alice' }),
    })

    expect(res.status).toBe(200)
    await res.text()

    const promptParts = (promptBody?.parts ?? []) as Array<Record<string, unknown>>
    expect(promptParts).toHaveLength(2)
    expect(promptParts[0]).toEqual({
      type: 'text',
      text: 'Please help with these files',
    })
    expect(promptParts[1]).toEqual({
      type: 'text',
      text:
        'Workspace context references (open files):\n@src/app/page.tsx\n@src/lib/utils.ts\nThese are references only; inspect files with tools when needed.',
    })
  })

  it('limits auto-context references to 20 paths', async () => {
    let promptBody: Record<string, unknown> | null = null

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.endsWith('/event')) {
        return emptyEventStreamResponse()
      }

      if (url.includes('/prompt_async')) {
        promptBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return new Response('prompt_failed', { status: 500 })
      }

      throw new Error(`Unexpected fetch url: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const contextPaths = Array.from({ length: 25 }, (_, index) => `src/file-${index + 1}.ts`)

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
        text: 'Scope this change',
        contextPaths,
      }),
    })

    const res = await POST(req as never, {
      params: Promise.resolve({ slug: 'alice' }),
    })

    expect(res.status).toBe(200)
    await res.text()

    const promptParts = (promptBody?.parts ?? []) as Array<Record<string, unknown>>
    const contextText = String(promptParts[1]?.text ?? '')
    const referencedPaths = contextText
      .split('\n')
      .filter((line) => line.startsWith('@'))

    expect(referencedPaths).toHaveLength(20)
    expect(referencedPaths[0]).toBe('@src/file-1.ts')
    expect(referencedPaths[19]).toBe('@src/file-20.ts')
    expect(contextText).not.toContain('@src/file-21.ts')
  })

  it('extracts PDF attachments before sending prompt parts', async () => {
    let promptBody: Record<string, unknown> | null = null

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.endsWith('/event')) {
        return emptyEventStreamResponse()
      }

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

      if (url.endsWith('/event')) {
        return emptyEventStreamResponse()
      }

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

      if (url.endsWith('/event')) {
        return emptyEventStreamResponse()
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

  it('routes spreadsheet attachments to spreadsheet tools hints', async () => {
    let promptBody: Record<string, unknown> | null = null

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.endsWith('/event')) {
        return emptyEventStreamResponse()
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
        text: 'Analyze attached data',
        attachments: [
          {
            path: '.arche/attachments/sales.xlsx',
            filename: 'sales.xlsx',
            mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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
    expect(promptParts).toHaveLength(3)
    expect(promptParts[1]).toEqual({
      type: 'text',
      text:
        'Attached spreadsheet file: /workspace/.arche/attachments/sales.xlsx\nYou must use spreadsheet_inspect first to detect sheets and columns, then use spreadsheet_sample/spreadsheet_query/spreadsheet_stats for focused analysis and calculations.',
    })
    expect(promptParts[2]).toEqual({
      type: 'text',
      text:
        'Attached workspace files:\n- /workspace/.arche/attachments/sales.xlsx\nIf direct file parsing is unavailable, inspect these paths with available tools.',
    })
  })

  it('subscribes to event stream before sending prompt', async () => {
    const fetchUrls: string[] = []

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      fetchUrls.push(url)

      if (url.endsWith('/event')) {
        return emptyEventStreamResponse()
      }

      if (url.includes('/prompt_async')) {
        expect(init?.method).toBe('POST')
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
        text: 'hello',
      }),
    })

    const res = await POST(req as never, {
      params: Promise.resolve({ slug: 'alice' }),
    })

    expect(res.status).toBe(200)
    await res.text()

    const eventIndex = fetchUrls.findIndex((url) => url.endsWith('/event'))
    const promptIndex = fetchUrls.findIndex((url) => url.includes('/prompt_async'))
    expect(eventIndex).toBeGreaterThanOrEqual(0)
    expect(promptIndex).toBeGreaterThanOrEqual(0)
    expect(eventIndex).toBeLessThan(promptIndex)
  })

  it('returns stream_no_assistant_message when session idles before assistant message', async () => {
    const encoder = new TextEncoder()

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.includes('/prompt_async')) {
        return new Response(null, { status: 204 })
      }

      if (url.endsWith('/event')) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                [
                  'event: message',
                  'data: {"type":"message.updated","properties":{"info":{"id":"msg-user","role":"user","sessionID":"session-1"}}}',
                  '',
                  'event: message',
                  'data: {"type":"message.part.updated","properties":{"part":{"id":"part-user","type":"text","text":"hello","messageID":"msg-user","sessionID":"session-1"}}}',
                  '',
                  'event: message',
                  'data: {"type":"session.status","properties":{"status":{"type":"busy"},"sessionID":"session-1"}}',
                  '',
                  'event: message',
                  'data: {"type":"session.status","properties":{"status":{"type":"idle"},"sessionID":"session-1"}}',
                  '',
                  '',
                ].join('\n'),
              ),
            )
            controller.close()
          },
        })

        return new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
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
        text: 'hello',
      }),
    })

    const res = await POST(req as never, {
      params: Promise.resolve({ slug: 'alice' }),
    })

    expect(res.status).toBe(200)
    const sseOutput = await res.text()

    expect(sseOutput).toContain('event: error')
    expect(sseOutput).toContain('stream_no_assistant_message')
    expect(sseOutput).not.toContain('event: done')
    expect(sseOutput).toContain('"messageId":"msg-user"')
  })

  it('returns stream_incomplete when assistant message has no streamed parts', async () => {
    const encoder = new TextEncoder()

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.includes('/prompt_async')) {
        return new Response(null, { status: 204 })
      }

      if (url.endsWith('/event')) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                [
                  'event: message',
                  'data: {"type":"message.updated","properties":{"info":{"id":"msg-assistant","role":"assistant","sessionID":"session-1"}}}',
                  '',
                  'event: message',
                  'data: {"type":"session.status","properties":{"status":{"type":"busy"},"sessionID":"session-1"}}',
                  '',
                  'event: message',
                  'data: {"type":"session.status","properties":{"status":{"type":"idle"},"sessionID":"session-1"}}',
                  '',
                  '',
                ].join('\n'),
              ),
            )
            controller.close()
          },
        })

        return new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
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
        text: 'hello',
      }),
    })

    const res = await POST(req as never, {
      params: Promise.resolve({ slug: 'alice' }),
    })

    expect(res.status).toBe(200)
    const sseOutput = await res.text()

    expect(sseOutput).toContain('event: error')
    expect(sseOutput).toContain('stream_incomplete')
    expect(sseOutput).not.toContain('event: done')
  })

  it('ignores idle status before prompt acknowledgement', async () => {
    const encoder = new TextEncoder()

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.includes('/prompt_async')) {
        return new Response(null, { status: 204 })
      }

      if (url.endsWith('/event')) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                [
                  'event: message',
                  'data: {"type":"session.status","properties":{"status":{"type":"idle"},"sessionID":"session-1"}}',
                  '',
                  'event: message',
                  'data: {"type":"session.status","properties":{"status":{"type":"busy"},"sessionID":"session-1"}}',
                  '',
                  'event: message',
                  'data: {"type":"message.updated","properties":{"info":{"id":"msg-assistant","role":"assistant","sessionID":"session-1"}}}',
                  '',
                  'event: message',
                  'data: {"type":"message.part.updated","properties":{"part":{"id":"part-1","type":"text","text":"Hello","messageID":"msg-assistant","sessionID":"session-1"},"delta":"Hello"}}',
                  '',
                  'event: message',
                  'data: {"type":"session.status","properties":{"status":{"type":"idle"},"sessionID":"session-1"}}',
                  '',
                  '',
                ].join('\n')
              )
            )
            controller.close()
          },
        })

        return new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
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
        text: 'hello',
      }),
    })

    const res = await POST(req as never, {
      params: Promise.resolve({ slug: 'alice' }),
    })

    expect(res.status).toBe(200)
    const sseOutput = await res.text()

    expect(sseOutput).toContain('event: done')
    expect(sseOutput).not.toContain('stream_no_assistant_message')
  })

  it('requires sessionID for session-scoped status events', async () => {
    const encoder = new TextEncoder()

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.includes('/prompt_async')) {
        return new Response(null, { status: 204 })
      }

      if (url.endsWith('/event')) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                [
                  'event: message',
                  'data: {"type":"session.status","properties":{"status":{"type":"busy"},"sessionID":"session-1"}}',
                  '',
                  'event: message',
                  'data: {"type":"session.idle","properties":{}}',
                  '',
                  'event: message',
                  'data: {"type":"message.updated","properties":{"info":{"id":"msg-assistant","role":"assistant","sessionID":"session-1"}}}',
                  '',
                  'event: message',
                  'data: {"type":"message.part.updated","properties":{"part":{"id":"part-1","type":"text","text":"Hello","messageID":"msg-assistant","sessionID":"session-1"},"delta":"Hello"}}',
                  '',
                  'event: message',
                  'data: {"type":"session.status","properties":{"status":{"type":"idle"},"sessionID":"session-1"}}',
                  '',
                  '',
                ].join('\n')
              )
            )
            controller.close()
          },
        })

        return new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
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
        text: 'hello',
      }),
    })

    const res = await POST(req as never, {
      params: Promise.resolve({ slug: 'alice' }),
    })

    expect(res.status).toBe(200)
    const sseOutput = await res.text()

    expect(sseOutput).toContain('event: done')
    expect(sseOutput).not.toContain('stream_no_assistant_message')
  })

  it('parses multi-line SSE events and forwards assistant parts', async () => {
    const encoder = new TextEncoder()

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.includes('/prompt_async')) {
        return new Response(null, { status: 204 })
      }

      if (url.endsWith('/event')) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                [
                  'event: message',
                  'data: {"type":"message.updated","properties":{"info":{"id":"msg-1","role":"assistant","sessionID":"session-1"}}}',
                  '',
                  '',
                ].join('\n'),
              ),
            )
            controller.enqueue(
              encoder.encode(
                [
                  'event: message',
                  'data: {"type":"message.part.updated","properties":{"part":{"type":"text","messageID":"msg-1","sessionID":"session-1"},',
                  'data: "delta":{"text":"Hello"}}}',
                  '',
                  'event: message',
                  'data: {"type":"session.status","properties":{"status":{"type":"idle"},"sessionID":"session-1"}}',
                  '',
                  '',
                ].join('\n'),
              ),
            )
            controller.close()
          },
        })

        return new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
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
        text: 'hello',
      }),
    })

    const res = await POST(req as never, {
      params: Promise.resolve({ slug: 'alice' }),
    })

    expect(res.status).toBe(200)
    const sseOutput = await res.text()

    expect(sseOutput).toContain('event: part')
    expect(sseOutput).toContain('"messageId":"msg-1"')
    expect(sseOutput).toContain('event: done')
  })

  it('keeps assistant part when part arrives before message metadata', async () => {
    const encoder = new TextEncoder()

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.includes('/prompt_async')) {
        return new Response(null, { status: 204 })
      }

      if (url.endsWith('/event')) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                [
                  'event: message',
                  'data: {"type":"message.part.updated","properties":{"part":{"id":"part-1","type":"text","text":"Hello","messageID":"msg-o1","sessionID":"session-1"},"delta":"Hello"}}',
                  '',
                  'event: message',
                  'data: {"type":"message.updated","properties":{"info":{"id":"msg-o1","role":"assistant","sessionID":"session-1"}}}',
                  '',
                  'event: message',
                  'data: {"type":"session.status","properties":{"status":{"type":"idle"},"sessionID":"session-1"}}',
                  '',
                  '',
                ].join('\n'),
              ),
            )
            controller.close()
          },
        })

        return new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
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
        text: 'hello',
      }),
    })

    const res = await POST(req as never, {
      params: Promise.resolve({ slug: 'alice' }),
    })

    expect(res.status).toBe(200)
    const sseOutput = await res.text()

    expect(sseOutput).toContain('event: part')
    expect(sseOutput).toContain('"messageId":"msg-o1"')
    expect(sseOutput).toContain('event: done')
  })
})
