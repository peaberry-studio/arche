import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRuntimeCapabilities: vi.fn(() => ({ csrf: false })),
  isDesktop: vi.fn(() => false),
  getSession: vi.fn(),
  validateSameOrigin: vi.fn((): { ok: boolean; error?: string } => ({ ok: true })),
  validateDesktopToken: vi.fn(() => true),
  getRuntimeForSlug: vi.fn(),
  isArchivedSession: vi.fn(),
  sessionStatus: vi.fn(),
  listChildren: vi.fn(),
  prompt: vi.fn(),
  findIdBySlug: vi.fn(),
  messageRunService: {
    findActiveRun: vi.fn(),
    markActiveRunSucceeded: vi.fn(),
  },
  getWorkspaceAgentConnection: vi.fn(),
  buildWorkspacePromptParts: vi.fn(),
  ensureProviderAccessFreshForExecution: vi.fn(),
  MAX_ATTACHMENTS_PER_MESSAGE: 10,
}))

vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mocks.getRuntimeCapabilities }))
vi.mock('@/lib/services/legacy-session-archive', () => ({ isArchivedSession: mocks.isArchivedSession }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mocks.isDesktop }))
vi.mock('@/lib/runtime/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/csrf', () => ({ validateSameOrigin: mocks.validateSameOrigin }))
vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
  validateDesktopToken: mocks.validateDesktopToken,
}))
vi.mock('@/lib/services', () => ({
  messageRunService: mocks.messageRunService,
  userService: { findIdBySlug: mocks.findIdBySlug },
}))
vi.mock('@/lib/harness/registry', () => ({
  getRuntimeForSlug: mocks.getRuntimeForSlug,
  buildWorkspacePromptParts: mocks.buildWorkspacePromptParts,
  normalizeMessageAttachments: (value: unknown) => Array.isArray(value) ? value : [],
  normalizeContextPaths: (value: unknown) => Array.isArray(value) ? value : [],
}))
vi.mock('@/lib/runtime/workspace-host', () => ({ getWorkspaceAgentConnection: mocks.getWorkspaceAgentConnection }))
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
  return { ok: true, data: statusRecord }
}

describe('POST /api/w/[slug]/chat/prompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isArchivedSession.mockResolvedValue(false)
    mocks.findIdBySlug.mockResolvedValue({ id: 'workspace-owner' })
    mocks.getRuntimeCapabilities.mockReturnValue({ csrf: false })
    mocks.validateSameOrigin.mockReturnValue({ ok: true })
    mocks.getSession.mockResolvedValue({
      user: { id: 'u1', email: 'alice@test.com', slug: 'alice', role: 'USER' },
      sessionId: 's1',
    })
    mocks.getRuntimeForSlug.mockResolvedValue({ ok: true, data: {
      sessionStatus: mocks.sessionStatus,
      listChildren: mocks.listChildren,
      prompt: mocks.prompt,
      syncProviderAccess: mocks.ensureProviderAccessFreshForExecution,
    } })
    mocks.sessionStatus.mockResolvedValue(statusResponse({ s1: { type: 'idle' } }))
    mocks.listChildren.mockResolvedValue({ ok: true, data: [] })
    mocks.prompt.mockResolvedValue({ ok: true })
    mocks.getWorkspaceAgentConnection.mockResolvedValue({ baseUrl: 'http://agent:3000', authHeader: 'Basic expected' })
    mocks.buildWorkspacePromptParts.mockResolvedValue({ ok: true, parts: [{ type: 'text', text: 'Hola' }] })
    mocks.ensureProviderAccessFreshForExecution.mockResolvedValue(undefined)
    mocks.messageRunService.findActiveRun.mockResolvedValue(null)
    mocks.messageRunService.markActiveRunSucceeded.mockResolvedValue(undefined)
  })

  it('202: submits a normalized prompt with message id and does not open an event stream', async () => {
    const fetchMock = vi.fn()
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
    expect(mocks.prompt).toHaveBeenCalledWith({
      sessionId: 's1',
      messageId: 'user-1',
      parts: [{ type: 'text', text: 'Hola' }],
      model: { providerId: 'openai', modelId: 'gpt-4o' },
    }, { signal: expect.any(AbortSignal) })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.ensureProviderAccessFreshForExecution).toHaveBeenCalledWith({ userId: 'u1' })
    expect(mocks.findIdBySlug).not.toHaveBeenCalled()
  })

  it('refreshes the workspace owner credentials, never the visiting admin credentials', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', slug: 'admin', role: 'ADMIN' }, sessionId: 'auth' })

    const res = await POST(makeRequest({ sessionId: 's1', messageId: 'm1', text: 'Hello' }), params())

    expect(res.status).toBe(202)
    expect(mocks.findIdBySlug).toHaveBeenCalledExactlyOnceWith('alice')
    expect(mocks.ensureProviderAccessFreshForExecution).toHaveBeenCalledExactlyOnceWith({ userId: 'workspace-owner' })
  })

  it('refuses an admin prompt for a missing workspace owner without syncing or dispatching', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'admin-1', slug: 'admin', role: 'ADMIN' }, sessionId: 'auth' })
    mocks.findIdBySlug.mockResolvedValue(null)

    const res = await POST(makeRequest({ sessionId: 's1', messageId: 'm1', text: 'Hello' }), params())

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'user_not_found' })
    expect(mocks.ensureProviderAccessFreshForExecution).not.toHaveBeenCalled()
    expect(mocks.prompt).not.toHaveBeenCalled()
  })

  it('returns 409 when OpenCode is busy', async () => {
    mocks.sessionStatus.mockResolvedValue(statusResponse({ s1: { type: 'busy' } }))
    const res = await POST(makeRequest({ sessionId: 's1', messageId: 'user-1', text: 'Hola' }), params())
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('session_busy')
  })

  it('returns 409 when a MessageRun lock exists and OpenCode is busy', async () => {
    mocks.messageRunService.findActiveRun.mockResolvedValue({ id: 'run-1', status: 'running' })
    mocks.sessionStatus.mockResolvedValue(statusResponse({ s1: { type: 'retry' } }))
    const res = await POST(makeRequest({ sessionId: 's1', messageId: 'user-1', text: 'Hola' }), params())
    expect(res.status).toBe(409)
  })

  it('reaps an idle MessageRun lock and continues with 202', async () => {
    mocks.messageRunService.findActiveRun.mockResolvedValue({ id: 'run-1', status: 'running' })

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
    mocks.getWorkspaceAgentConnection.mockResolvedValue(null)
    const res = await POST(makeRequest({ sessionId: 's1', messageId: 'user-1', text: 'Hola' }), params())
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('instance_unavailable')
  })

  it('returns 502 when OpenCode rejects the prompt', async () => {
    mocks.prompt.mockResolvedValue({ ok: false, error: { code: 'runtime_error' } })
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
    expect(mocks.isArchivedSession).not.toHaveBeenCalled()
    expect(mocks.getRuntimeForSlug).not.toHaveBeenCalled()
  })

  it.each(['USER', 'ADMIN'])('rejects archived prompts as %s before runtime access', async (role) => {
    mocks.getSession.mockResolvedValue({ user: { id: 'u1', slug: role === 'ADMIN' ? 'admin' : 'alice', role }, sessionId: 'auth' })
    mocks.isArchivedSession.mockResolvedValue(true)
    const res = await POST(makeRequest({ sessionId: 'old', messageId: 'user-1', text: 'Hello' }), params())
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'session_archived' })
    expect(mocks.isArchivedSession).toHaveBeenCalledWith('alice', 'old')
    expect(mocks.getRuntimeForSlug).not.toHaveBeenCalled()
    expect(mocks.getWorkspaceAgentConnection).not.toHaveBeenCalled()
    expect(mocks.messageRunService.findActiveRun).not.toHaveBeenCalled()
    expect(mocks.ensureProviderAccessFreshForExecution).not.toHaveBeenCalled()
    expect(mocks.prompt).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated archive requests before storage access', async () => {
    mocks.getSession.mockResolvedValue(null)
    const res = await POST(makeRequest({ sessionId: 'old', messageId: 'm', text: 'Hello' }), params())
    expect(res.status).toBe(401)
    expect(mocks.isArchivedSession).not.toHaveBeenCalled()
  })

  it('returns 409 when runtime status is unknown and a MessageRun is running', async () => {
    mocks.messageRunService.findActiveRun.mockResolvedValue({ id: 'run-1', status: 'running' })
    mocks.sessionStatus.mockResolvedValue({ ok: false, error: { code: 'runtime_error' } })
    const res = await POST(makeRequest({ sessionId: 's1', messageId: 'user-1', text: 'Hola' }), params())
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('session_busy')
    expect(mocks.messageRunService.markActiveRunSucceeded).not.toHaveBeenCalled()
  })

  it('rejects unknown runtime status even without a MessageRun lock', async () => {
    mocks.sessionStatus.mockResolvedValue({ ok: false, error: { code: 'runtime_error' } })
    const res = await POST(makeRequest({ sessionId: 's1', messageId: 'user-1', text: 'Hola' }), params())
    expect(res.status).toBe(409)
    expect(mocks.prompt).not.toHaveBeenCalled()
    expect(mocks.messageRunService.markActiveRunSucceeded).not.toHaveBeenCalled()
  })

  it('passes bounded signals to the status probe and prompt dispatch', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')

    await POST(makeRequest({ sessionId: 's1', messageId: 'user-1', text: 'Hola' }), params())

    expect(timeoutSpy.mock.calls.some(([ms]) => ms > 0 && ms <= 8_000)).toBe(true)
    expect(timeoutSpy).toHaveBeenCalledWith(60_000)
    timeoutSpy.mockRestore()
  })

  it.each(['busy', 'retry'])('rejects an idle root with a %s grandchild without settling its lock', async (type) => {
    mocks.listChildren.mockImplementation(async (id: string) => ({ ok: true, data: id === 's1' ? [{ id: 'child' }] : id === 'child' ? [{ id: 'grandchild' }] : [] }))
    mocks.sessionStatus.mockResolvedValue(statusResponse({ s1: { type: 'idle' }, grandchild: { type } }))
    mocks.messageRunService.findActiveRun.mockResolvedValue({ id: 'run-1', status: 'running' })
    const res = await POST(makeRequest({ sessionId: 's1', messageId: 'user-1', text: 'Hola' }), params())
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'session_busy' })
    expect(mocks.messageRunService.markActiveRunSucceeded).not.toHaveBeenCalled()
    expect(mocks.buildWorkspacePromptParts).not.toHaveBeenCalled()
    expect(mocks.ensureProviderAccessFreshForExecution).not.toHaveBeenCalled()
    expect(mocks.prompt).not.toHaveBeenCalled()
  })

  it('preserves missing-session errors from family discovery', async () => {
    mocks.listChildren.mockResolvedValue({ ok: false, error: { code: 'session_not_found' } })
    const res = await POST(makeRequest({ sessionId: 'missing', messageId: 'user-1', text: 'Hola' }), params())
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'session_not_found' })
    expect(mocks.prompt).not.toHaveBeenCalled()
  })

  it.each([
    ['session_not_found', 404],
    ['session_busy', 409],
  ])('returns the normalized prompt error %s', async (code, status) => {
    mocks.prompt.mockResolvedValue({ ok: false, error: { code } })
    const res = await POST(makeRequest({ sessionId: 's1', messageId: 'user-1', text: 'Hola' }), params())
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ error: code })
  })

  it('keeps provider refresh best-effort when the runtime returns a typed failure', async () => {
    mocks.ensureProviderAccessFreshForExecution.mockResolvedValue({ ok: false, error: { code: 'sync_failed' } })
    const res = await POST(makeRequest({ sessionId: 's1', messageId: 'user-1', text: 'Hola' }), params())
    expect(res.status).toBe(202)
    expect(mocks.prompt).toHaveBeenCalled()
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
