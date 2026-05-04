import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRuntimeCapabilities: vi.fn(() => ({ csrf: false })),
  isDesktop: vi.fn(() => false),
  getSession: vi.fn(),
  validateSameOrigin: vi.fn(() => ({ ok: true })),
  validateDesktopToken: vi.fn(() => true),

  instanceService: { findCredentialsBySlug: vi.fn() },
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

vi.mock('@/lib/services', () => ({ instanceService: mocks.instanceService }))
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
    mocks.getSession.mockResolvedValue({
      user: { id: 'u1', email: 'u@test.com', slug: 'alice', role: 'ADMIN' },
      sessionId: 's1',
    })
    mocks.instanceService.findCredentialsBySlug.mockResolvedValue({
      status: 'running',
      serverPassword: 'enc:pw',
    })
  })

  function makePostRequest(body: unknown, slug = 'alice') {
    return new NextRequest(`http://localhost/api/w/${slug}/chat/stream`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    })
  }

  function params(slug = 'alice') {
    return { params: Promise.resolve({ slug }) }
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

  it('returns 400 for too many attachments', async () => {
    const { POST } = await import('../route')
    const attachments = Array.from({ length: 11 }, (_, i) => ({ path: `file-${i}.txt` }))
    const res = await POST(makePostRequest({ sessionId: 's1', text: 'hi', attachments }), params())
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('too_many_attachments')
  })

  it('returns 401 when not authenticated', async () => {
    mocks.getSession.mockResolvedValue(null)
    const { POST } = await import('../route')
    const res = await POST(makePostRequest({ sessionId: 's1', text: 'hi' }), params())
    expect(res.status).toBe(401)
  })
})
