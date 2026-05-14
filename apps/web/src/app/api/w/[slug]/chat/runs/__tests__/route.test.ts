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

  function activeRun(status: 'aborted' | 'failed' | 'running' | 'succeeded' = 'running') {
    return {
      id: 'run-1',
      slug: 'alice',
      sessionId: 's1',
      source: 'web',
      status,
      error: null,
      startedAt: new Date('2026-05-13T12:00:00.000Z'),
      finishedAt: status === 'running' ? null : new Date('2026-05-13T12:01:00.000Z'),
    }
  }

  it('does not start prompts through POST because stream owns the lifecycle', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('../route')
    const res = await POST(postRequest({ sessionId: 's1', text: 'Hi' }), params())

    expect(res.status).toBe(410)
    await expect(res.json()).resolves.toEqual({ error: 'prompt_start_moved_to_stream' })
    expect(mocks.messageRunService.createActiveRunAfterRuntimeStateCheck).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns and clears no active run when OpenCode is already idle', async () => {
    mocks.messageRunService.findActiveRun.mockResolvedValue(activeRun())
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ s1: { type: 'idle' } }), { status: 200 })))

    const { GET } = await import('../route')
    const res = await GET(getRequest('s1'), params())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ activeRun: null })
    expect(mocks.messageRunService.markRunSucceeded).toHaveBeenCalledWith('run-1')
  })

  it('validates GET query fields and inactive runs', async () => {
    const { GET } = await import('../route')

    const missing = await GET(new NextRequest('http://localhost/api/w/alice/chat/runs'), params())
    expect(missing.status).toBe(400)

    const none = await GET(getRequest('s1'), params())
    expect(none.status).toBe(200)
    await expect(none.json()).resolves.toEqual({ activeRun: null })

    mocks.messageRunService.findActiveRun.mockResolvedValue(activeRun('failed'))
    const failed = await GET(getRequest('s1'), params())
    expect(failed.status).toBe(200)
    await expect(failed.json()).resolves.toEqual({ activeRun: null })
    expect(mocks.messageRunService.markActiveRunSucceeded).toHaveBeenCalledWith('alice', 's1')
  })

  it('returns active runs when runtime state is not idle', async () => {
    mocks.messageRunService.findActiveRun.mockResolvedValue(activeRun())
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ s1: { type: 'retry' } }), { status: 200 })))

    const { GET } = await import('../route')
    const res = await GET(getRequest('s1'), params())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      activeRun: {
        runId: 'run-1',
        sessionId: 's1',
        source: 'web',
        status: 'running',
        startedAt: '2026-05-13T12:00:00.000Z',
      },
    })
  })

  it('keeps active runs when runtime status cannot be read', async () => {
    mocks.messageRunService.findActiveRun.mockResolvedValue(activeRun())
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('status down')))

    const { GET } = await import('../route')
    const res = await GET(getRequest('s1'), params())

    expect(res.status).toBe(200)
    expect((await res.json()).activeRun.runId).toBe('run-1')
  })

  it('returns 503 for active run checks without a running instance', async () => {
    mocks.instanceService.findCredentialsBySlug.mockResolvedValue({ status: 'stopped', serverPassword: null })
    mocks.messageRunService.findActiveRun.mockResolvedValue(activeRun())

    const { GET } = await import('../route')
    const getRes = await GET(getRequest('s1'), params())

    expect(getRes.status).toBe(503)
  })
})
