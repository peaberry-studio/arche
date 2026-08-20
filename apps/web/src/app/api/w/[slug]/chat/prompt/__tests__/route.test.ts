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
    findActiveRun: vi.fn(),
    markActiveRunSucceeded: vi.fn(),
  },
  decryptPassword: vi.fn(() => 'secret'),
  getInstanceUrl: vi.fn(() => 'http://test-slug:3000'),
  getWorkspaceAgentUrl: vi.fn(() => 'http://agent:3000'),
  buildWorkspacePromptParts: vi.fn(),
  ensureProviderAccessFreshForExecution: vi.fn(),
  resolveRuntimeProviderId: vi.fn((id: string) => id),
  MAX_ATTACHMENTS_PER_MESSAGE: 10,
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
vi.mock('@/lib/opencode/providers', () => ({ ensureProviderAccessFreshForExecution: mocks.ensureProviderAccessFreshForExecution }))
vi.mock('@/lib/opencode/workspace-prompt', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/opencode/workspace-prompt')>()
  return {
    ...original,
    buildWorkspacePromptParts: mocks.buildWorkspacePromptParts,
  }
})
vi.mock('@/lib/providers/catalog', () => ({
  resolveRuntimeProviderId: mocks.resolveRuntimeProviderId,
  getCanonicalProviderId: vi.fn((id: string) => id),
  isProviderId: vi.fn(() => true),
  normalizeProviderId: vi.fn((id: string) => id),
}))
vi.mock('@/lib/workspace-agent/client', () => ({ getWorkspaceAgentUrl: mocks.getWorkspaceAgentUrl }))
vi.mock('@/lib/workspace-attachments', () => ({ MAX_ATTACHMENTS_PER_MESSAGE: 10 }))

import { POST } from '../route'

function makeRequest(body: unknown, csrf = true) {
  return new NextRequest('http://localhost/api/w/alice/chat/prompt', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...(csrf ? { Origin: 'http://localhost' } : {}) },
  })
}

function params() {
  return { params: Promise.resolve({ slug: 'alice' }) }
}

function statusResponse(statusRecord: unknown) {
  return new Response(JSON.stringify(statusRecord), {
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/w/[slug]/chat/prompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getRuntimeCapabilities.mockReturnValue({ csrf: false })
    mocks.validateSameOrigin.mockReturnValue({ ok: true })
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
    mocks.getWorkspaceAgentUrl.mockReturnValue('http://agent:3000')
    mocks.buildWorkspacePromptParts.mockResolvedValue({ ok: true, parts: [{ type: 'text', text: 'Hola' }] })
    mocks.ensureProviderAccessFreshForExecution.mockResolvedValue(undefined)
    mocks.messageRunService.findActiveRun.mockResolvedValue(null)
    mocks.messageRunService.markActiveRunSucceeded.mockResolvedValue(undefined)
  })

  it('202: calls prompt_async with id + parts and does not open /event', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(statusResponse({ s1: { type: 'idle' } })) // session/status
      .mockResolvedValueOnce(new Response('', { status: 200 })) // prompt_async
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(makeRequest({
      sessionId: 's1',
      messageId: 'user-1',
      text: 'Hola',
      model: { providerId: 'openai', modelId: 'gpt-4o' },
    }), params())

    expect(res.status).toBe(202)
    expect((await res.json())).toEqual({ ok: true })
    expect(mocks.buildWorkspacePromptParts).toHaveBeenCalledWith(expect.objectContaining({
      text: 'Hola',
      agent: { baseUrl: 'http://agent:3000', authHeader: expect.stringContaining('Basic ') },
    }))
    expect(fetchMock).toHaveBeenCalledWith(
      'http://test-slug:3000/session/s1/prompt_async',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          id: 'user-1',
          parts: [{ type: 'text', text: 'Hola' }],
          model: { providerID: 'openai', modelID: 'gpt-4o' },
        }),
      }),
    )
    const allUrls = fetchMock.mock.calls.map(([input]) => String(input))
    expect(allUrls.some((url) => url.endsWith('/event'))).toBe(false)
  })

  it('returns 409 when OpenCode is busy', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(statusResponse({ s1: { type: 'busy' } })))
    const res = await POST(makeRequest({ sessionId: 's1', messageId: 'user-1', text: 'Hola' }), params())
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('session_busy')
  })

  it('returns 409 when a MessageRun lock exists and OpenCode is busy', async () => {
    mocks.messageRunService.findActiveRun.mockResolvedValue({ id: 'run-1', status: 'running' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(statusResponse({ s1: { type: 'retry' } })))
    const res = await POST(makeRequest({ sessionId: 's1', messageId: 'user-1', text: 'Hola' }), params())
    expect(res.status).toBe(409)
  })

  it('reaps an idle MessageRun lock and continues with 202', async () => {
    mocks.messageRunService.findActiveRun.mockResolvedValue({ id: 'run-1', status: 'running' })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(statusResponse({ s1: { type: 'idle' } }))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(makeRequest({ sessionId: 's1', messageId: 'user-1', text: 'Hola' }), params())
    expect(res.status).toBe(202)
    expect(mocks.messageRunService.markActiveRunSucceeded).toHaveBeenCalledWith('alice', 's1')
  })

  it('returns 400 when text and attachments are missing', async () => {
    const res = await POST(makeRequest({ sessionId: 's1', messageId: 'user-1' }), params())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('missing_fields')
  })

  it('returns 503 when the instance is unavailable', async () => {
    mocks.instanceService.findCredentialsBySlug.mockResolvedValue({ status: 'stopped', serverPassword: null })
    const res = await POST(makeRequest({ sessionId: 's1', messageId: 'user-1', text: 'Hola' }), params())
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('instance_unavailable')
  })

  it('returns 502 when OpenCode rejects the prompt', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(statusResponse({ s1: { type: 'idle' } }))
      .mockResolvedValueOnce(new Response('rejected', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await POST(makeRequest({ sessionId: 's1', messageId: 'user-1', text: 'Hola' }), params())
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('prompt_failed')
  })

  it('requires CSRF when runtime capabilities enforce it', async () => {
    mocks.getRuntimeCapabilities.mockReturnValue({ csrf: true })
    mocks.validateSameOrigin.mockReturnValue({ ok: false, error: 'cross_origin' })
    const res = await POST(makeRequest({ sessionId: 's1', messageId: 'user-1', text: 'Hola' }), params())
    expect(res.status).toBe(403)
  })

  it('returns 403 for another workspace without ADMIN', async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: 'u2', email: 'bob@test.com', slug: 'bob', role: 'USER' },
      sessionId: 's2',
    })
    const res = await POST(makeRequest({ sessionId: 's1', messageId: 'user-1', text: 'Hola' }), params())
    expect(res.status).toBe(403)
  })

  it('returns 409 when runtime status is unknown and a MessageRun is running', async () => {
    mocks.messageRunService.findActiveRun.mockResolvedValue({ id: 'run-1', status: 'running' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('nope', { status: 500 })))
    const res = await POST(makeRequest({ sessionId: 's1', messageId: 'user-1', text: 'Hola' }), params())
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('session_busy')
    expect(mocks.messageRunService.markActiveRunSucceeded).not.toHaveBeenCalled()
  })

  it('prompts when runtime status is unknown and no MessageRun is running', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('nope', { status: 500 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await POST(makeRequest({ sessionId: 's1', messageId: 'user-1', text: 'Hola' }), params())
    expect(res.status).toBe(202)
    expect(mocks.messageRunService.findActiveRun).toHaveBeenCalledWith('alice', 's1')
    expect(mocks.messageRunService.markActiveRunSucceeded).not.toHaveBeenCalled()
  })

  it('passes an 8s timeout to the session status probe', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(statusResponse({ s1: { type: 'idle' } }))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await POST(makeRequest({ sessionId: 's1', messageId: 'user-1', text: 'Hola' }), params())

    expect(timeoutSpy).toHaveBeenCalledWith(8_000)
    timeoutSpy.mockRestore()
  })

  it('returns 400 when the body is invalid JSON', async () => {
    const request = new NextRequest('http://localhost/api/w/alice/chat/prompt', {
      method: 'POST',
      body: '{',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
    })
    const res = await POST(request, params())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_json')
  })
})
