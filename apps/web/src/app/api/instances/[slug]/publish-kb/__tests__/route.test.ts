import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getRuntimeCapabilities: vi.fn(() => ({ csrf: false })),
  isDesktop: vi.fn(() => false),
  getSession: vi.fn(),
  validateSameOrigin: vi.fn(() => ({ ok: true })),
  validateDesktopToken: vi.fn(() => true),
  isWorkspaceReachable: vi.fn(),
  createWorkspaceAgentClient: vi.fn(),
  createWorkspaceRemoteConfig: vi.fn(),
  listAppliedKnowledgeReviewChanges: vi.fn(),
  markKnowledgeReviewChangesPublished: vi.fn(),
  updateSyncState: vi.fn(),
}))

vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mocks.getRuntimeCapabilities }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mocks.isDesktop }))
vi.mock('@/lib/runtime/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/csrf', () => ({ validateSameOrigin: mocks.validateSameOrigin }))
vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
  validateDesktopToken: mocks.validateDesktopToken,
}))
vi.mock('@/lib/runtime/workspace-host', () => ({
  isWorkspaceReachable: mocks.isWorkspaceReachable,
}))
vi.mock('@/lib/workspace-agent/client', () => ({
  createWorkspaceAgentClient: mocks.createWorkspaceAgentClient,
}))
vi.mock('@/lib/services', () => ({
  kbGithubRemoteService: {
    createWorkspaceRemoteConfig: mocks.createWorkspaceRemoteConfig,
    updateSyncState: mocks.updateSyncState,
  },
}))
vi.mock('@/lib/learning/service', () => ({
  listAppliedKnowledgeReviewChanges: mocks.listAppliedKnowledgeReviewChanges,
  markKnowledgeReviewChangesPublished: mocks.markKnowledgeReviewChangesPublished,
}))
vi.mock('@/lib/auth', () => ({ auditEvent: vi.fn() }))

import { POST } from '../route'

const SESSION = {
  user: { id: 'u1', email: 'alice@test.com', slug: 'alice', role: 'USER' },
  sessionId: 's1',
}

function makeRequest() {
  return new NextRequest('http://localhost/api/instances/alice/publish-kb', {
    method: 'POST',
    headers: { Origin: 'http://localhost' },
  })
}

function params(slug: string) {
  return { params: Promise.resolve({ slug }) }
}

function mockFetch(body: object, status = 200) {
  return vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, diffs: [{ path: 'Notes/Reviewed.md' }] }), {
      headers: { 'Content-Type': 'application/json' },
    }))
    .mockResolvedValue(new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }))
}

describe('POST /api/instances/[slug]/publish-kb', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.isWorkspaceReachable.mockResolvedValue(true)
    mocks.createWorkspaceAgentClient.mockResolvedValue({
      baseUrl: 'http://agent:8080',
      authHeader: 'Bearer tok',
    })
    mocks.createWorkspaceRemoteConfig.mockResolvedValue({ ok: true, remote: null })
    mocks.updateSyncState.mockResolvedValue(undefined)
    mocks.listAppliedKnowledgeReviewChanges.mockResolvedValue([{ kbPath: 'Notes/Reviewed.md' }])
    mocks.markKnowledgeReviewChangesPublished.mockResolvedValue([])
  })

  it('returns published result on success', async () => {
    const spy = mockFetch({ ok: true, status: 'published', commitHash: 'abc123' })
    const res = await POST(makeRequest(), params('alice'))
    const body = await res.json()
    expect(body).toEqual({ ok: true, status: 'published', commitHash: 'abc123' })
    spy.mockRestore()
  })

  it('publishes without a path manifest when the workspace has no diffs', async () => {
    mocks.listAppliedKnowledgeReviewChanges.mockResolvedValue([])
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, diffs: [] }), {
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValue(new Response(JSON.stringify({ ok: true, status: 'nothing_to_publish' }), {
        headers: { 'Content-Type': 'application/json' },
      }))

    const res = await POST(makeRequest(), params('alice'))
    const body = await res.json()

    expect(body).toEqual({ ok: true, status: 'nothing_to_publish' })
    expect(mocks.listAppliedKnowledgeReviewChanges).not.toHaveBeenCalled()
    expect(spy).toHaveBeenLastCalledWith('http://agent:8080/kb/publish', expect.objectContaining({
      body: JSON.stringify({}),
    }))
    spy.mockRestore()
  })

  it('rejects unreviewed workspace diffs with a readable message', async () => {
    mocks.listAppliedKnowledgeReviewChanges.mockResolvedValue([])
    const spy = mockFetch({ ok: true, status: 'published' })

    const res = await POST(makeRequest(), params('alice'))
    const body = await res.json()

    expect(body).toEqual({
      ok: false,
      status: 'error',
      message: 'No reviewed changes to publish. Apply changes from Knowledge Review first, or discard unreviewed edits.',
    })
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('translates agent manifest errors into readable messages', async () => {
    const spy = mockFetch({ ok: false, status: 'error', message: 'unreviewed_changes_present' })

    const res = await POST(makeRequest(), params('alice'))
    const body = await res.json()

    expect(body.message).toBe('The workspace contains unreviewed changes. Review or discard them before publishing.')
    spy.mockRestore()
  })

  it('returns 409 when instance not running', async () => {
    mocks.isWorkspaceReachable.mockResolvedValue(false)
    const res = await POST(makeRequest(), params('alice'))
    expect(res.status).toBe(409)
  })

  it('returns 409 when agent unavailable', async () => {
    mocks.createWorkspaceAgentClient.mockResolvedValue(null)
    const res = await POST(makeRequest(), params('alice'))
    expect(res.status).toBe(409)
    expect(mocks.createWorkspaceRemoteConfig).not.toHaveBeenCalled()
  })

  it('handles agent HTTP error', async () => {
    const spy = mockFetch({ message: 'internal error' }, 500)
    const res = await POST(makeRequest(), params('alice'))
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.status).toBe('error')
    spy.mockRestore()
  })

  it('returns GitHub remote configuration errors before contacting the agent endpoint', async () => {
    mocks.createWorkspaceRemoteConfig.mockResolvedValue({ ok: false, error: 'token failed' })
    const spy = vi.spyOn(globalThis, 'fetch')

    const res = await POST(makeRequest(), params('alice'))
    const body = await res.json()

    expect(body).toEqual({ ok: false, status: 'error', message: 'token failed' })
    expect(mocks.createWorkspaceAgentClient.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createWorkspaceRemoteConfig.mock.invocationCallOrder[0],
    )
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('handles non-JSON response', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not json', { status: 500 }),
    )
    const res = await POST(makeRequest(), params('alice'))
    const body = await res.json()
    expect(body.ok).toBe(false)
    spy.mockRestore()
  })

  it('handles network error', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
    const res = await POST(makeRequest(), params('alice'))
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.message).toBe('ECONNREFUSED')
    spy.mockRestore()
  })

  it('handles non-Error exception', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue('string error')
    const res = await POST(makeRequest(), params('alice'))
    const body = await res.json()
    expect(body.message).toBe('Unknown error')
    spy.mockRestore()
  })

  it('passes GitHub remote credentials to the workspace agent when configured', async () => {
    mocks.createWorkspaceRemoteConfig.mockResolvedValue({
      ok: true,
      remote: {
        branch: 'main',
        repoCloneUrl: 'https://github.com/acme/kb.git',
        token: 'token-1',
      },
    })
    const spy = mockFetch({ ok: true, status: 'published', githubStatus: 'pushed' })

    const res = await POST(makeRequest(), params('alice'))
    const body = await res.json()

    expect(body.status).toBe('published')
    expect(spy).toHaveBeenCalledWith('http://agent:8080/kb/publish', expect.objectContaining({
      body: JSON.stringify({
        github: {
          branch: 'main',
          repoCloneUrl: 'https://github.com/acme/kb.git',
          token: 'token-1',
        },
        paths: ['Notes/Reviewed.md'],
      }),
    }))
    expect(mocks.updateSyncState).toHaveBeenCalledWith(expect.objectContaining({
      lastError: null,
      lastSyncStatus: 'success',
    }))
    spy.mockRestore()
  })

  it('marks GitHub publish conflicts', async () => {
    mocks.createWorkspaceRemoteConfig.mockResolvedValue({
      ok: true,
      remote: {
        branch: 'main',
        repoCloneUrl: 'https://github.com/acme/kb.git',
        token: 'token-1',
      },
    })
    const spy = mockFetch({ ok: true, status: 'conflicts', message: 'merge conflict' })

    const res = await POST(makeRequest(), params('alice'))
    const body = await res.json()

    expect(body.status).toBe('conflicts')
    expect(mocks.updateSyncState).toHaveBeenCalledWith(expect.objectContaining({
      lastError: 'merge conflict',
      lastSyncStatus: 'conflicts',
    }))
    spy.mockRestore()
  })

  it('marks GitHub publish errors from the agent response', async () => {
    mocks.createWorkspaceRemoteConfig.mockResolvedValue({
      ok: true,
      remote: {
        branch: 'main',
        repoCloneUrl: 'https://github.com/acme/kb.git',
        token: 'token-1',
      },
    })
    const spy = mockFetch({ ok: false, status: 'push_rejected', githubMessage: 'fetch first' })

    const res = await POST(makeRequest(), params('alice'))
    const body = await res.json()

    expect(body.status).toBe('push_rejected')
    expect(mocks.updateSyncState).toHaveBeenCalledWith(expect.objectContaining({
      lastError: 'fetch first',
      lastSyncStatus: 'error',
    }))
    spy.mockRestore()
  })

  it('marks GitHub publish HTTP errors', async () => {
    mocks.createWorkspaceRemoteConfig.mockResolvedValue({
      ok: true,
      remote: {
        branch: 'main',
        repoCloneUrl: 'https://github.com/acme/kb.git',
        token: 'token-1',
      },
    })
    const spy = mockFetch({ message: 'agent failed' }, 500)

    const res = await POST(makeRequest(), params('alice'))
    const body = await res.json()

    expect(body).toEqual({ ok: false, status: 'error', message: 'agent failed' })
    expect(mocks.updateSyncState).toHaveBeenCalledWith(expect.objectContaining({
      lastError: 'agent failed',
      lastSyncStatus: 'error',
    }))
    spy.mockRestore()
  })
})
