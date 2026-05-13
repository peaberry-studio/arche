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
    createActiveRunAfterRuntimeStateCheck: vi.fn(),
    findActiveRun: vi.fn(),
    markActiveRunSucceeded: vi.fn(),
    markRunFailed: vi.fn(),
    markRunSucceeded: vi.fn(),
  },
  decryptPassword: vi.fn(() => 'secret'),
  getInstanceUrl: vi.fn(() => 'http://test-slug:3000'),
  getWorkspaceAgentUrl: vi.fn(() => 'http://agent:3000'),
  resolveRuntimeProviderId: vi.fn((id: string) => id),

  extractPdfText: vi.fn(),
  inferAttachmentMimeType: vi.fn(() => 'text/plain'),
  isDocumentMimeType: vi.fn(() => false),
  isPdfMime: vi.fn(() => false),
  isPresentationMimeType: vi.fn(() => false),
  isSpreadsheetMimeType: vi.fn(() => false),
  isValidContextReferencePath: vi.fn(() => true),
  isWorkspaceAttachmentPath: vi.fn(() => true),
  normalizeAttachmentPath: vi.fn((path: string) => path),
  normalizeWorkspacePath: vi.fn((path: string) => path),
  workspaceAgentFetch: vi.fn(),
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
vi.mock('@/lib/providers/catalog', () => ({ resolveRuntimeProviderId: mocks.resolveRuntimeProviderId }))
vi.mock('@/lib/attachments/pdf-text-extractor', () => ({
  extractPdfText: mocks.extractPdfText,
  isPdfMime: mocks.isPdfMime,
}))
vi.mock('@/lib/workspace-agent-client', () => ({ workspaceAgentFetch: mocks.workspaceAgentFetch }))
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
    MAX_ATTACHMENTS_PER_MESSAGE: 10,
  }
})

describe('/api/w/[slug]/chat/runs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getRuntimeCapabilities.mockReturnValue({ csrf: false })
    mocks.getSession.mockResolvedValue({
      user: { id: 'u1', email: 'u@test.com', slug: 'alice', role: 'ADMIN' },
      sessionId: 'auth-session',
    })
    mocks.instanceService.findCredentialsBySlug.mockResolvedValue({
      status: 'running',
      serverPassword: 'enc:pw',
    })
    mocks.extractPdfText.mockResolvedValue({ ok: true, text: 'PDF body', truncated: false })
    mocks.inferAttachmentMimeType.mockReturnValue('text/plain')
    mocks.isDocumentMimeType.mockReturnValue(false)
    mocks.isPdfMime.mockReturnValue(false)
    mocks.isPresentationMimeType.mockReturnValue(false)
    mocks.isSpreadsheetMimeType.mockReturnValue(false)
    mocks.isValidContextReferencePath.mockReturnValue(true)
    mocks.isWorkspaceAttachmentPath.mockReturnValue(true)
    mocks.normalizeAttachmentPath.mockImplementation((path: string) => path)
    mocks.normalizeWorkspacePath.mockImplementation((path: string) => path)
    mocks.workspaceAgentFetch.mockResolvedValue({ ok: false, data: { ok: false } })
    mocks.messageRunService.createActiveRunAfterRuntimeStateCheck.mockResolvedValue({
      ok: true,
      run: {
        id: 'run-1',
        slug: 'alice',
        sessionId: 's1',
        source: 'web',
        status: 'running',
        error: null,
        startedAt: new Date('2026-05-13T12:00:00.000Z'),
        finishedAt: null,
      },
    })
    mocks.messageRunService.findActiveRun.mockResolvedValue(null)
    mocks.messageRunService.markActiveRunSucceeded.mockResolvedValue(undefined)
    mocks.messageRunService.markRunFailed.mockResolvedValue(undefined)
    mocks.messageRunService.markRunSucceeded.mockResolvedValue(undefined)
  })

  function postRequest(body: unknown) {
    return new NextRequest('http://localhost/api/w/alice/chat/runs', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    })
  }

  function getRequest(sessionId: string) {
    return new NextRequest(`http://localhost/api/w/alice/chat/runs?sessionId=${sessionId}`)
  }

  function params() {
    return { params: Promise.resolve({ slug: 'alice' }) }
  }

  it('starts an OpenCode prompt under a durable run lock', async () => {
    const fetchMock = vi.fn((url: string | URL) => {
      const href = String(url)
      if (href === 'http://test-slug:3000/session/s1/prompt_async') {
        return Promise.resolve(new Response('', { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected fetch ${href}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('../route')
    const res = await POST(postRequest({
      sessionId: 's1',
      text: 'Hi',
      model: { providerId: 'openai', modelId: 'gpt-5.2' },
    }), params())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      runId: 'run-1',
      sessionId: 's1',
      status: 'running',
    })
    expect(mocks.messageRunService.createActiveRunAfterRuntimeStateCheck).toHaveBeenCalledWith({
      readRuntimeSessionState: expect.any(Function),
      slug: 'alice',
      sessionId: 's1',
      source: 'web',
    })
    const promptCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/session/s1/prompt_async'))
    expect(promptCall).toBeDefined()
    expect(JSON.parse(String(promptCall?.[1]?.body))).toEqual({
      parts: [{ type: 'text', text: 'Hi' }],
      model: { providerID: 'openai', modelID: 'gpt-5.2' },
    })
  })

  it('sends built PDF and image attachment parts to prompt_async', async () => {
    mocks.isPdfMime.mockImplementation((mime: string) => mime === 'application/pdf')
    mocks.workspaceAgentFetch
      .mockResolvedValueOnce({
        ok: true,
        data: {
          ok: true,
          content: Buffer.from('pdf bytes').toString('base64'),
          encoding: 'base64',
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          ok: true,
          content: 'image bytes',
          encoding: 'utf-8',
        },
      })
    const fetchMock = vi.fn((url: string | URL) => {
      const href = String(url)
      if (href === 'http://test-slug:3000/session/s1/prompt_async') {
        return Promise.resolve(new Response('', { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected fetch ${href}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('../route')
    const res = await POST(postRequest({
      sessionId: 's1',
      text: 'Summarize these files',
      attachments: [
        { path: '.arche/attachments/report.pdf', filename: 'report.pdf', mime: 'application/pdf' },
        { path: '.arche/attachments/screenshot.png', filename: 'screenshot.png', mime: 'image/png' },
      ],
    }), params())

    expect(res.status).toBe(200)
    const promptCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/session/s1/prompt_async'))
    const promptBody = JSON.parse(String(promptCall?.[1]?.body))

    expect(promptBody.parts).toContainEqual({ type: 'text', text: 'Summarize these files' })
    expect(promptBody.parts).toContainEqual({
      type: 'file',
      mime: 'image/png',
      filename: 'screenshot.png',
      url: `data:image/png;base64,${Buffer.from('image bytes').toString('base64')}`,
    })
    expect(promptBody.parts.some((part: { text?: string }) =>
      part.text?.includes('Extracted text from attached PDF') && part.text.includes('PDF body'),
    )).toBe(true)
    expect(promptBody.parts.some((part: { text?: string }) =>
      part.text?.includes('Attached workspace files:') && part.text.includes('/workspace/.arche/attachments/report.pdf'),
    )).toBe(true)
  })

  it('rejects concurrent prompts without calling prompt_async', async () => {
    mocks.messageRunService.createActiveRunAfterRuntimeStateCheck.mockImplementationOnce(async (params: {
      readRuntimeSessionState: () => Promise<unknown>
    }) => {
      await params.readRuntimeSessionState()
      return {
        ok: false,
        error: 'session_busy',
        activeRun: {
          id: 'run-active',
          slug: 'alice',
          sessionId: 's1',
          source: 'web',
          status: 'running',
          error: null,
          startedAt: new Date('2026-05-13T12:00:00.000Z'),
          finishedAt: null,
        },
      }
    })
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ s1: { type: 'busy' } }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('../route')
    const res = await POST(postRequest({ sessionId: 's1', text: 'Hi' }), params())

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('session_busy')
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://test-slug:3000/session/status')
  })

  it('returns and clears no active run when OpenCode is already idle', async () => {
    mocks.messageRunService.findActiveRun.mockResolvedValue({
      id: 'run-1',
      slug: 'alice',
      sessionId: 's1',
      source: 'web',
      status: 'running',
      error: null,
      startedAt: new Date('2026-05-13T12:00:00.000Z'),
      finishedAt: null,
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ s1: { type: 'idle' } }), { status: 200 })))

    const { GET } = await import('../route')
    const res = await GET(getRequest('s1'), params())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ activeRun: null })
    expect(mocks.messageRunService.markRunSucceeded).toHaveBeenCalledWith('run-1')
  })
})
