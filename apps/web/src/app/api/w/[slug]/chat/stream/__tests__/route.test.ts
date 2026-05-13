import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRuntimeCapabilities: vi.fn(() => ({ csrf: false })),
  isDesktop: vi.fn(() => false),
  getSession: vi.fn(),
  validateSameOrigin: vi.fn(() => ({ ok: true })),
  validateDesktopToken: vi.fn(() => true),

  instanceService: { findCredentialsBySlug: vi.fn() },
  messageRunService: {
    findRunById: vi.fn(),
    markRunFailed: vi.fn(),
    markRunSucceeded: vi.fn(),
  },
  decryptPassword: vi.fn(() => 'secret'),
  getInstanceUrl: vi.fn(() => 'http://test-slug:3000'),
  getWorkspaceAgentUrl: vi.fn(() => 'http://agent:3000'),
  normalizeProviderId: vi.fn((id: string) => id),
  resolveRuntimeProviderId: vi.fn((id: string) => id),

  extractPdfText: vi.fn(),
  isPdfMime: vi.fn(() => false),

  createUpstreamSessionStatusReader: vi.fn(() => vi.fn().mockResolvedValue(null)),
  getIdleFinalizationOutcome: vi.fn(() => 'complete' as const),
  getSilentStreamOutcome: vi.fn(() => 'finalize_idle' as const),

  workspaceAgentFetch: vi.fn(),

  INITIAL_SSE_PARSE_STATE: { buffer: '', eventType: '', dataLines: [] },
  parseSseChunk: vi.fn((state, chunk) => ({
    state,
    events: [{ event: 'message', data: chunk }],
  })),

  isValidContextReferencePath: vi.fn(() => true),
  normalizeAttachmentPath: vi.fn((p: string) => p),
  normalizeWorkspacePath: vi.fn((p: string) => p),

  inferAttachmentMimeType: vi.fn(() => 'text/plain'),
  isDocumentMimeType: vi.fn(() => false),
  isPresentationMimeType: vi.fn(() => false),
  isSpreadsheetMimeType: vi.fn(() => false),
  isWorkspaceAttachmentPath: vi.fn(() => true),
  MAX_ATTACHMENTS_PER_MESSAGE: 10,

  isImageMimeType: vi.fn(() => false),

  toWorkspaceFileUrl: vi.fn(() => 'file:///workspace/test.txt'),
}))

vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mocks.getRuntimeCapabilities }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mocks.isDesktop }))
vi.mock('@/lib/runtime/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/csrf', () => ({ validateSameOrigin: mocks.validateSameOrigin }))
vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
  validateDesktopToken: mocks.validateDesktopToken,
}))

vi.mock('@/lib/services', () => ({
  instanceService: mocks.instanceService,
  messageRunService: mocks.messageRunService,
}))
vi.mock('@/lib/spawner/crypto', () => ({ decryptPassword: mocks.decryptPassword }))
vi.mock('@/lib/opencode/client', () => ({ getInstanceUrl: mocks.getInstanceUrl }))
vi.mock('@/lib/workspace-agent/client', () => ({ getWorkspaceAgentUrl: mocks.getWorkspaceAgentUrl }))
vi.mock('@/lib/providers/catalog', () => ({
  normalizeProviderId: mocks.normalizeProviderId,
  resolveRuntimeProviderId: mocks.resolveRuntimeProviderId,
}))
vi.mock('@/lib/attachments/pdf-text-extractor', () => ({
  extractPdfText: mocks.extractPdfText,
  isPdfMime: mocks.isPdfMime,
}))
vi.mock('@/app/api/w/[slug]/chat/stream/watchdog', () => ({
  getIdleFinalizationOutcome: mocks.getIdleFinalizationOutcome,
  getSilentStreamOutcome: mocks.getSilentStreamOutcome,
}))
vi.mock('@/app/api/w/[slug]/chat/stream/status-reader', () => ({
  createUpstreamSessionStatusReader: mocks.createUpstreamSessionStatusReader,
}))
vi.mock('@/lib/workspace-agent-client', () => ({ workspaceAgentFetch: mocks.workspaceAgentFetch }))
vi.mock('@/lib/sse-parser', () => ({
  INITIAL_SSE_PARSE_STATE: mocks.INITIAL_SSE_PARSE_STATE,
  parseSseChunk: mocks.parseSseChunk,
}))
vi.mock('@/lib/workspace-paths', () => ({
  isValidContextReferencePath: mocks.isValidContextReferencePath,
  normalizeAttachmentPath: mocks.normalizeAttachmentPath,
  normalizeWorkspacePath: mocks.normalizeWorkspacePath,
}))
vi.mock('@/lib/workspace-attachments', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/workspace-attachments')>()
  return {
    ...original,
    inferAttachmentMimeType: mocks.inferAttachmentMimeType,
    isDocumentMimeType: mocks.isDocumentMimeType,
    isPresentationMimeType: mocks.isPresentationMimeType,
    isSpreadsheetMimeType: mocks.isSpreadsheetMimeType,
    isWorkspaceAttachmentPath: mocks.isWorkspaceAttachmentPath,
    MAX_ATTACHMENTS_PER_MESSAGE: mocks.MAX_ATTACHMENTS_PER_MESSAGE,
  }
})

describe('POST /api/w/[slug]/chat/stream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getRuntimeCapabilities.mockReturnValue({ csrf: false })
    mocks.isDesktop.mockReturnValue(false)
    mocks.validateSameOrigin.mockReturnValue({ ok: true })
    mocks.validateDesktopToken.mockReturnValue(true)
    mocks.decryptPassword.mockReturnValue('secret')
    mocks.getInstanceUrl.mockReturnValue('http://test-slug:3000')
    mocks.getWorkspaceAgentUrl.mockReturnValue('http://agent:3000')
    mocks.normalizeProviderId.mockImplementation((id: string) => id)
    mocks.resolveRuntimeProviderId.mockImplementation((id: string) => id)
    mocks.extractPdfText.mockReset()
    mocks.isPdfMime.mockReturnValue(false)
    mocks.createUpstreamSessionStatusReader.mockReturnValue(vi.fn().mockResolvedValue(null))
    mocks.getIdleFinalizationOutcome.mockReturnValue('complete')
    mocks.getSilentStreamOutcome.mockReturnValue('finalize_idle')
    mocks.workspaceAgentFetch.mockReset()
    mocks.parseSseChunk.mockImplementation((state, chunk) => ({
      state,
      events: [{ event: 'message', data: chunk }],
    }))
    mocks.isValidContextReferencePath.mockReturnValue(true)
    mocks.normalizeAttachmentPath.mockImplementation((p: string) => p)
    mocks.normalizeWorkspacePath.mockImplementation((p: string) => p)
    mocks.inferAttachmentMimeType.mockReturnValue('text/plain')
    mocks.isDocumentMimeType.mockReturnValue(false)
    mocks.isPresentationMimeType.mockReturnValue(false)
    mocks.isSpreadsheetMimeType.mockReturnValue(false)
    mocks.isWorkspaceAttachmentPath.mockReturnValue(true)
    mocks.getSession.mockResolvedValue({
      user: { id: 'u1', email: 'u@test.com', slug: 'alice', role: 'ADMIN' },
      sessionId: 's1',
    })
    mocks.instanceService.findCredentialsBySlug.mockResolvedValue({
      status: 'running',
      serverPassword: 'enc:pw',
    })
    mocks.messageRunService.findRunById.mockResolvedValue({
      id: 'run-1',
      slug: 'alice',
      sessionId: 's1',
      source: 'web',
      status: 'running',
      error: null,
      startedAt: new Date(),
      finishedAt: null,
    })
    mocks.messageRunService.markRunFailed.mockResolvedValue(undefined)
    mocks.messageRunService.markRunSucceeded.mockResolvedValue(undefined)
  })

  function makePostRequest(body: unknown, slug = 'alice', signal?: AbortSignal) {
    const requestBody =
      body &&
      typeof body === 'object' &&
      !Array.isArray(body) &&
      'sessionId' in body &&
      !('resume' in body) &&
      ('text' in body || 'runId' in body)
        ? { runId: 'run-1', ...body }
        : body
    return new NextRequest(`http://localhost/api/w/${slug}/chat/stream`, {
      method: 'POST',
      body: JSON.stringify(requestBody),
      headers: { 'Content-Type': 'application/json' },
      signal,
    })
  }

  function params(slug = 'alice') {
    return { params: Promise.resolve({ slug }) }
  }

  function eventStream(events: Array<Record<string, unknown> | string>) {
    const encoder = new TextEncoder()
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) {
          controller.enqueue(encoder.encode(typeof event === 'string' ? event : JSON.stringify(event)))
        }
        controller.close()
      },
    })
  }

  function mockOpenCodeFetch(events: Array<Record<string, unknown> | string>) {
    return vi.fn((url: string | URL, init?: RequestInit) => {
      const href = String(url)
      if (href === 'http://test-slug:3000/event') {
        return Promise.resolve(new Response(eventStream(events), { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected fetch ${init?.method ?? 'GET'} ${href}`))
    })
  }

  it('returns 503 when instance not running', async () => {
    mocks.instanceService.findCredentialsBySlug.mockResolvedValue({ status: 'stopped', serverPassword: null })
    const { POST } = await import('../route')
    const res = await POST(makePostRequest({ sessionId: 's1', text: 'hi' }), params())
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.error).toBe('instance_unavailable')
  })

  it('returns 400 for invalid JSON body', async () => {
    const { POST } = await import('../route')
    const req = new NextRequest('http://localhost/api/w/alice/chat/stream', {
      method: 'POST',
      body: 'not json{',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, params())
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('invalid_json')
  })

  it('returns 400 when missing sessionId', async () => {
    const { POST } = await import('../route')
    const res = await POST(makePostRequest({ text: 'hi' }), params())
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('missing_fields')
  })

  it('returns 400 when text, resume and attachments are all absent', async () => {
    const { POST } = await import('../route')
    const res = await POST(makePostRequest({ sessionId: 's1' }), params())
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('missing_fields')
  })

  it('returns 404 when run is not found', async () => {
    mocks.messageRunService.findRunById.mockResolvedValue(null)
    const { POST } = await import('../route')
    const res = await POST(makePostRequest({ sessionId: 's1', runId: 'missing-run' }), params())
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe('run_not_found')
  })

  it('returns terminal SSE events for completed runs', async () => {
    const { POST } = await import('../route')

    mocks.messageRunService.findRunById.mockResolvedValueOnce({
      id: 'run-1',
      slug: 'alice',
      sessionId: 's1',
      source: 'web',
      status: 'succeeded',
      error: null,
      startedAt: new Date(),
      finishedAt: new Date(),
    })
    const succeeded = await POST(makePostRequest({ sessionId: 's1', runId: 'run-1' }), params())
    await expect(succeeded.text()).resolves.toContain('event: done')

    mocks.messageRunService.findRunById.mockResolvedValueOnce({
      id: 'run-1',
      slug: 'alice',
      sessionId: 's1',
      source: 'web',
      status: 'aborted',
      error: null,
      startedAt: new Date(),
      finishedAt: new Date(),
    })
    const aborted = await POST(makePostRequest({ sessionId: 's1', runId: 'run-1' }), params())
    await expect(aborted.text()).resolves.toContain('cancelled')

    mocks.messageRunService.findRunById.mockResolvedValueOnce({
      id: 'run-1',
      slug: 'alice',
      sessionId: 's1',
      source: 'web',
      status: 'failed',
      error: 'provider_auth_missing',
      startedAt: new Date(),
      finishedAt: new Date(),
    })
    const failed = await POST(makePostRequest({ sessionId: 's1', runId: 'run-1' }), params())
    await expect(failed.text()).resolves.toContain('provider_auth_missing')
  })

  it('returns 401 when not authenticated', async () => {
    mocks.getSession.mockResolvedValue(null)
    const { POST } = await import('../route')
    const res = await POST(makePostRequest({ sessionId: 's1', text: 'hi' }), params())
    expect(res.status).toBe(401)
  })

  it('streams assistant status, parts, metadata, workspace updates, and completion', async () => {
    const fetchMock = mockOpenCodeFetch([
      {
        type: 'session.status',
        properties: { info: { sessionID: 's1' }, status: { type: 'busy' } },
      },
      {
        type: 'session.status',
        properties: { info: { sessionID: 's1' }, status: { type: 'retry', message: 'Retrying' } },
      },
      {
        type: 'message.updated',
        properties: {
          info: {
            id: 'm1',
            role: 'assistant',
            sessionID: 's1',
            providerID: 'openai-compatible',
            modelID: 'gpt-5.2',
            agent: 'assistant',
          },
        },
      },
      {
        type: 'message.part.updated',
        properties: { part: { id: 'p1', messageID: 'm1', sessionID: 's1', type: 'reasoning' } },
      },
      {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'p2',
            messageID: 'm1',
            sessionID: 's1',
            type: 'tool',
            tool: 'bash',
            state: { status: 'running', title: 'Running command' },
          },
        },
      },
      {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'p3',
            messageID: 'm1',
            sessionID: 's1',
            type: 'tool',
            tool: 'bash',
            state: { status: 'error', error: 'failed' },
          },
        },
      },
      {
        type: 'message.part.updated',
        properties: { part: { id: 'p4', messageID: 'm1', sessionID: 's1', type: 'agent', name: 'researcher' } },
      },
      {
        type: 'message.part.updated',
        properties: { part: { id: 'p5', messageID: 'm1', sessionID: 's1', type: 'subtask', agent: 'reviewer' } },
      },
      {
        type: 'message.part.delta',
        properties: { messageID: 'm1', partID: 'p6', partType: 'text', value: 'hello' },
      },
      { type: 'file.edited', properties: { path: 'Notes/file.md' } },
      'not json',
      { type: 'session.idle', properties: { info: { sessionID: 's1' } } },
    ])
    vi.stubGlobal('fetch', fetchMock)
    mocks.normalizeProviderId.mockImplementation((id: string) => `normalized:${id}`)
    mocks.resolveRuntimeProviderId.mockImplementation((id: string) => `runtime:${id}`)
    mocks.normalizeWorkspacePath.mockImplementation((path: string) => path.trim())
    mocks.isValidContextReferencePath.mockImplementation((path: string) => !path.includes('invalid'))

    const { POST } = await import('../route')
    const res = await POST(makePostRequest({
      sessionId: 's1',
      text: 'Hi',
      model: { providerId: 'openai', modelId: 'gpt-5.2' },
      contextPaths: [' notes/a.md ', 'notes/a.md', 'invalid/../path'],
    }), params())

    const text = await res.text()

    expect(text).toContain('event: assistant-meta')
    expect(text).toContain('"providerID":"normalized:openai-compatible"')
    expect(text).toContain('event: workspace-updated')
    expect(text).toContain('"path":"Notes/file.md"')
    expect(text).toContain('event: agent')
    expect(text).toContain('"agent":"researcher"')
    expect(text).toContain('"agent":"reviewer"')
    expect(text).toContain('event: done')
    expect(text).toContain('"status":"complete"')

    expect(fetchMock).not.toHaveBeenCalledWith(
      'http://test-slug:3000/session/s1/prompt_async',
      expect.anything(),
    )
  })

  it('does not stream untyped deltas as visible text', async () => {
    const fetchMock = mockOpenCodeFetch([
      {
        type: 'message.updated',
        properties: { info: { id: 'm1', role: 'assistant', sessionID: 's1' } },
      },
      {
        type: 'message.part.delta',
        properties: { messageID: 'm1', partID: 'r1', value: 'early hidden reasoning' },
      },
      {
        type: 'message.part.updated',
        properties: { part: { id: 'r1', messageID: 'm1', sessionID: 's1', type: 'reasoning' } },
      },
      {
        type: 'message.part.delta',
        properties: { messageID: 'm1', partID: 'r1', value: 'later hidden reasoning' },
      },
      { type: 'session.idle', properties: { info: { sessionID: 's1' } } },
    ])
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('../route')
    const res = await POST(makePostRequest({ sessionId: 's1', text: 'Hi' }), params())

    const text = await res.text()

    expect(text).not.toContain('early hidden reasoning')
    expect(text).not.toContain('"type":"text"')
    expect(text).toContain('"type":"reasoning"')
    expect(text).toContain('later hidden reasoning')
  })

  it('forwards OpenCode permission approval events', async () => {
    const fetchMock = mockOpenCodeFetch([
      {
        type: 'message.updated',
        properties: { info: { id: 'm1', role: 'assistant', sessionID: 's1' } },
      },
      {
        type: 'permission.updated',
        properties: {
          permission: {
            id: 'perm-1',
            type: 'tool',
            sessionID: 's1',
            messageID: 'm1',
            callID: 'call-1',
            pattern: 'arche_linear_conn_create_issue',
            title: 'Create Linear issue',
            metadata: { tool: 'arche_linear_conn_create_issue' },
          },
        },
      },
      { type: 'session.status', properties: { info: { sessionID: 's1' }, status: { type: 'idle' } } },
      { type: 'session.idle', properties: { info: { sessionID: 's1' } } },
      {
        type: 'permission.replied',
        properties: {
          permission: { id: 'perm-1', sessionID: 's1' },
          response: 'once',
        },
      },
      { type: 'session.idle', properties: { info: { sessionID: 's1' } } },
    ])
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('../route')
    const res = await POST(makePostRequest({ sessionId: 's1', text: 'Hi' }), params())

    const text = await res.text()

    expect(text).toContain('event: permission')
    expect(text).toContain('"id":"perm-1"')
    expect(text).toContain('"title":"Create Linear issue"')
    expect(text).toContain('event: permission-replied')
    expect(text).toContain('"response":"once"')
  })

  it('forwards permission events using fallback payload shapes', async () => {
    const fetchMock = mockOpenCodeFetch([
      {
        type: 'message.updated',
        properties: { info: { id: 'm1', role: 'assistant', sessionID: 's1' } },
      },
      {
        type: 'permission.updated',
        properties: {
          id: 'perm-info',
          messageId: 'm1',
          metadata: { toolName: 'fallback-tool' },
          pattern: 'fallback-pattern',
          permissionId: 'perm-ignored',
          sessionID: 's1',
          type: 'tool',
        },
      },
      {
        type: 'permission.replied',
        properties: {
          permissionId: 'perm-info',
          response: 'always',
          sessionID: 's1',
        },
      },
      { type: 'session.idle', properties: { info: { sessionID: 's1' } } },
    ])
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('../route')
    const res = await POST(makePostRequest({ sessionId: 's1', text: 'Hi' }), params())

    const text = await res.text()

    expect(text).toContain('fallback-tool')
    expect(text).toContain('fallback-pattern')
    expect(text).toContain('"response":"always"')
  })

  it('streams an error when the upstream event subscription fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })))

    const { POST } = await import('../route')
    const res = await POST(makePostRequest({ sessionId: 's1', text: 'hi' }), params())

    await expect(res.text()).resolves.toContain('Failed to connect to event stream')
  })

  it('streams an error when subscribing to upstream events throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('stream down')))

    const { POST } = await import('../route')
    const res = await POST(makePostRequest({ sessionId: 's1', text: 'hi' }), params())

    await expect(res.text()).resolves.toContain('stream down')
  })

  it('filters unrelated events and marks run failures from session errors', async () => {
    const fetchMock = mockOpenCodeFetch([
      {
        type: 'session.status',
        properties: { info: { sessionID: 'other-session' }, status: { type: 'busy' } },
      },
      {
        type: 'message.updated',
        properties: { info: { id: 'other-message', role: 'assistant', sessionID: 'other-session' } },
      },
      {
        type: 'message.part.updated',
        properties: { part: { id: 'early', messageID: 'm-late', sessionID: 's1', type: 'step-start' } },
      },
      {
        type: 'message.updated',
        properties: { info: { id: 'm-late', role: 'assistant', sessionID: 's1' } },
      },
      {
        type: 'message.part.updated',
        properties: { part: { id: 'p-text', messageID: 'm-late', sessionID: 's1', type: 'text' } },
      },
      {
        type: 'message.part.updated',
        properties: { part: { id: 'p-tool', messageID: 'm-late', sessionID: 's1', type: 'tool', tool: 'bash', state: { status: 'done' } } },
      },
      {
        type: 'message.part.updated',
        properties: { part: { id: 'p-retry', messageID: 'm-late', sessionID: 's1', type: 'retry' } },
      },
      {
        type: 'session.error',
        properties: { info: { sessionID: 's1' }, error: { data: { message: 'provider missing' } } },
      },
    ])
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('../route')
    const res = await POST(makePostRequest({ sessionId: 's1', text: 'Hi' }), params())

    const text = await res.text()
    expect(text).toContain('provider missing')
    expect(text).not.toContain('other-message')
    expect(mocks.messageRunService.markRunFailed).toHaveBeenCalledWith('run-1', 'provider missing')
  })

  it('streams resume delta events without sending a new prompt', async () => {
    const fetchMock = vi.fn((url: string | URL) => {
      const href = String(url)
      if (href === 'http://test-slug:3000/event') {
        return Promise.resolve(new Response(eventStream([
          {
            type: 'message.part.delta',
            properties: {
              info: { sessionID: 's1' },
              part: { id: 'part-1', type: 'reasoning' },
              value: 'resumed reasoning',
            },
          },
          { type: 'session.idle', properties: { info: { sessionID: 's1' } } },
        ]), { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected fetch ${href}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('../route')
    const res = await POST(makePostRequest({
      sessionId: 's1',
      resume: true,
      messageId: 'assistant-1',
    }), params())

    const text = await res.text()
    expect(text).toContain('event: part')
    expect(text).toContain('"messageId":"assistant-1"')
    expect(text).toContain('"type":"reasoning"')
    expect(text).toContain('event: done')
    expect(fetchMock).not.toHaveBeenCalledWith(
      'http://test-slug:3000/session/s1/prompt_async',
      expect.anything(),
    )
  })

  it('aborts the upstream event subscription when a resume client disconnects', async () => {
    let upstreamSignal: AbortSignal | undefined
    const fetchMock = vi.fn((url: string | URL, init?: RequestInit) => {
      const href = String(url)
      if (href === 'http://test-slug:3000/event') {
        upstreamSignal = init?.signal as AbortSignal | undefined
        return Promise.resolve(new Response(new ReadableStream<Uint8Array>(), { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected fetch ${href}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    const clientAbortController = new AbortController()

    const { POST } = await import('../route')
    await POST(makePostRequest({
      sessionId: 's1',
      resume: true,
      messageId: 'assistant-1',
    }, 'alice', clientAbortController.signal), params())

    await vi.waitFor(() => {
      expect(upstreamSignal).toBeDefined()
    })

    clientAbortController.abort()

    await vi.waitFor(() => {
      expect(upstreamSignal?.aborted).toBe(true)
    })
  })
})
