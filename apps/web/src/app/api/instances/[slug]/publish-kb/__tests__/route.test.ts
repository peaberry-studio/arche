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
  findIdBySlug: vi.fn(),
  updateSyncState: vi.fn(),
  auditEvent: vi.fn(),
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
vi.mock('@/lib/services/user', () => ({ findIdBySlug: mocks.findIdBySlug }))
vi.mock('@/lib/learning/service', () => ({
  listAppliedKnowledgeReviewChanges: mocks.listAppliedKnowledgeReviewChanges,
  markKnowledgeReviewChangesPublished: mocks.markKnowledgeReviewChangesPublished,
}))
vi.mock('@/lib/auth', () => ({ auditEvent: mocks.auditEvent }))

import { GET, POST } from '../route'

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

function mockFetch(
  body: object,
  status = 200,
  options: {
    diffs?: Array<{ conflicted?: boolean; path: string }>
    fileRead?: { body: object; status?: number }
    includeFileRead?: boolean
  } = {},
) {
  const spy = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      diffs: options.diffs ?? [{ path: 'Notes/Reviewed.md' }],
    }), {
      headers: { 'Content-Type': 'application/json' },
    }))

  if (options.includeFileRead !== false) {
    spy.mockResolvedValueOnce(new Response(JSON.stringify(options.fileRead?.body ?? {
      ok: true,
      hash: 'sha256:reviewed',
    }), {
      status: options.fileRead?.status,
      headers: { 'Content-Type': 'application/json' },
    }))
  }

  return spy.mockResolvedValue(new Response(JSON.stringify(body), {
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
    mocks.findIdBySlug.mockResolvedValue({ id: 'u1' })
    mocks.listAppliedKnowledgeReviewChanges.mockResolvedValue([{ kbPath: 'Notes/Reviewed.md', operation: 'update', appliedHash: 'sha256:reviewed' }])
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

  it('publishes user-only workspace diffs without path hashes', async () => {
    mocks.listAppliedKnowledgeReviewChanges.mockResolvedValue([])
    const spy = mockFetch(
      { ok: true, status: 'published', commitHash: 'abc123', files: ['Notes/Reviewed.md'] },
      200,
      { includeFileRead: false },
    )

    const res = await POST(makeRequest(), params('alice'))
    const body = await res.json()

    expect(body).toEqual({ ok: true, status: 'published', commitHash: 'abc123', files: ['Notes/Reviewed.md'] })
    expect(spy).toHaveBeenLastCalledWith('http://agent:8080/kb/publish', expect.objectContaining({
      body: JSON.stringify({
        paths: ['Notes/Reviewed.md'],
        pathHashes: {},
      }),
    }))
    expect(mocks.auditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'knowledge.user_published',
      metadata: expect.objectContaining({ paths: ['Notes/Reviewed.md'] }),
    }))
    expect(mocks.markKnowledgeReviewChangesPublished).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('publishes matching applied changes and user edits together', async () => {
    const spy = mockFetch(
      {
        ok: true,
        status: 'published',
        commitHash: 'abc123',
        files: ['Notes/Reviewed.md', 'Notes/User.md'],
      },
      200,
      { diffs: [{ path: 'Notes/Reviewed.md' }, { path: 'Notes/User.md' }] },
    )

    const res = await POST(makeRequest(), params('alice'))

    expect((await res.json()).ok).toBe(true)
    expect(spy).toHaveBeenCalledWith('http://agent:8080/files/read', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ path: 'Notes/Reviewed.md' }),
    }))
    expect(spy).not.toHaveBeenCalledWith('http://agent:8080/files/read', expect.objectContaining({
      body: JSON.stringify({ path: 'Notes/User.md' }),
    }))
    expect(spy).toHaveBeenLastCalledWith('http://agent:8080/kb/publish', expect.objectContaining({
      body: JSON.stringify({
        paths: ['Notes/Reviewed.md', 'Notes/User.md'],
        pathHashes: { 'Notes/Reviewed.md': 'sha256:reviewed' },
      }),
    }))
    expect(mocks.markKnowledgeReviewChangesPublished).toHaveBeenCalledWith(expect.objectContaining({
      paths: ['Notes/Reviewed.md'],
    }))
    spy.mockRestore()
  })

  it('publishes drifted applied changes as user overrides and marks them published', async () => {
    const spy = mockFetch({
      ok: true,
      status: 'published',
      commitHash: 'abc123',
      files: ['Notes/Reviewed.md'],
    }, 200, {
      fileRead: { body: { ok: true, hash: 'sha256:user-edit' } },
    })

    const res = await POST(makeRequest(), params('alice'))

    expect((await res.json()).ok).toBe(true)
    expect(spy).toHaveBeenLastCalledWith('http://agent:8080/kb/publish', expect.objectContaining({
      body: JSON.stringify({
        paths: ['Notes/Reviewed.md'],
        pathHashes: {},
      }),
    }))
    expect(mocks.markKnowledgeReviewChangesPublished).toHaveBeenCalledWith(expect.objectContaining({
      paths: ['Notes/Reviewed.md'],
    }))
    spy.mockRestore()
  })

  it('returns conflicts without calling the publish endpoint', async () => {
    const spy = mockFetch({ ok: true, status: 'published' }, 200, {
      diffs: [{ conflicted: true, path: 'Notes/Conflict.md' }],
      includeFileRead: false,
    })

    const res = await POST(makeRequest(), params('alice'))

    expect(await res.json()).toEqual({ ok: true, status: 'conflicts' })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(mocks.listAppliedKnowledgeReviewChanges).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('marks GitHub sync conflicts for BFF-side conflicted diffs', async () => {
    mocks.createWorkspaceRemoteConfig.mockResolvedValue({
      ok: true,
      remote: {
        branch: 'main',
        repoCloneUrl: 'https://github.com/acme/kb.git',
        token: 'token-1',
      },
    })
    const spy = mockFetch({ ok: true, status: 'published' }, 200, {
      diffs: [{ conflicted: true, path: 'Notes/Conflict.md' }],
      includeFileRead: false,
    })

    const res = await POST(makeRequest(), params('alice'))

    expect(await res.json()).toEqual({ ok: true, status: 'conflicts' })
    expect(mocks.updateSyncState).toHaveBeenCalledWith(expect.objectContaining({
      lastSyncStatus: 'conflicts',
    }))
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('filters hidden dot-prefixed diff paths out of the publish manifest', async () => {
    const spy = mockFetch(
      { ok: true, status: 'published', commitHash: 'abc123', files: ['Notes/Reviewed.md'] },
      200,
      { diffs: [{ path: 'Notes/Reviewed.md' }, { path: '.obsidian/workspace.json' }] },
    )

    const res = await POST(makeRequest(), params('alice'))

    expect((await res.json()).ok).toBe(true)
    expect(spy).not.toHaveBeenCalledWith('http://agent:8080/files/read', expect.objectContaining({
      body: JSON.stringify({ path: '.obsidian/workspace.json' }),
    }))
    expect(spy).toHaveBeenLastCalledWith('http://agent:8080/kb/publish', expect.objectContaining({
      body: JSON.stringify({
        paths: ['Notes/Reviewed.md'],
        pathHashes: { 'Notes/Reviewed.md': 'sha256:reviewed' },
      }),
    }))
    spy.mockRestore()
  })

  it('returns invalid_reviewed_path when every diff is a hidden dot-prefixed file', async () => {
    const spy = mockFetch(
      { ok: true, status: 'published', commitHash: 'abc123', files: [] },
      200,
      { diffs: [{ path: '.obsidian/workspace.json' }, { path: '.config/cache.json' }], includeFileRead: false },
    )

    const res = await POST(makeRequest(), params('alice'))
    const body = await res.json()

    expect(body).toEqual({
      ok: false,
      status: 'error',
      message: 'Publish includes hidden or internal files. Discard those changes before publishing.',
    })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).not.toHaveBeenCalledWith('http://agent:8080/kb/publish', expect.anything())
    expect(mocks.listAppliedKnowledgeReviewChanges).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('translates an agent invalid_reviewed_path error into a readable message', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, diffs: [] }), {
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValue(new Response(JSON.stringify({ ok: false, status: 'error', message: 'invalid_reviewed_path' }), {
        headers: { 'Content-Type': 'application/json' },
      }))

    const res = await POST(makeRequest(), params('alice'))
    const body = await res.json()

    expect(body.ok).toBe(false)
    expect(body.message).toBe('Publish includes hidden or internal files. Discard those changes before publishing.')
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

  it('returns GitHub remote configuration errors without publishing', async () => {
    mocks.createWorkspaceRemoteConfig.mockResolvedValue({ ok: false, error: 'token failed' })
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      diffs: [{ path: 'Notes/Reviewed.md' }],
    }), {
      headers: { 'Content-Type': 'application/json' },
    }))

    const res = await POST(makeRequest(), params('alice'))
    const body = await res.json()

    expect(body).toEqual({ ok: false, status: 'error', message: 'token failed' })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).not.toHaveBeenCalledWith('http://agent:8080/kb/publish', expect.anything())
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
        pathHashes: { 'Notes/Reviewed.md': 'sha256:reviewed' },
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

  it('sends a deleted sentinel hash for delete changes so the agent verifies absence', async () => {
    mocks.listAppliedKnowledgeReviewChanges.mockResolvedValue([
      { kbPath: 'Notes/Reviewed.md', operation: 'delete', appliedHash: 'sha256:gone' },
    ])
    const spy = mockFetch({ ok: true, status: 'published', commitHash: 'abc' }, 200, {
      fileRead: { body: { ok: false, error: 'not_found' }, status: 404 },
    })

    const res = await POST(makeRequest(), params('alice'))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(spy).toHaveBeenLastCalledWith('http://agent:8080/kb/publish', expect.objectContaining({
      body: JSON.stringify({
        paths: ['Notes/Reviewed.md'],
        pathHashes: { 'Notes/Reviewed.md': 'deleted' },
      }),
    }))
    spy.mockRestore()
  })

  it('omits the deleted sentinel when an applied delete was overridden by a recreated file', async () => {
    mocks.listAppliedKnowledgeReviewChanges.mockResolvedValue([
      { kbPath: 'Notes/Reviewed.md', operation: 'delete', appliedHash: 'sha256:gone' },
    ])
    const spy = mockFetch({
      ok: true,
      status: 'published',
      commitHash: 'abc123',
      files: ['Notes/Reviewed.md'],
    }, 200, {
      fileRead: { body: { ok: true, hash: 'sha256:recreated' } },
    })

    const res = await POST(makeRequest(), params('alice'))

    expect((await res.json()).ok).toBe(true)
    expect(spy).toHaveBeenLastCalledWith('http://agent:8080/kb/publish', expect.objectContaining({
      body: JSON.stringify({
        paths: ['Notes/Reviewed.md'],
        pathHashes: {},
      }),
    }))
    expect(mocks.markKnowledgeReviewChangesPublished).toHaveBeenCalledWith(expect.objectContaining({
      paths: ['Notes/Reviewed.md'],
    }))
    spy.mockRestore()
  })

  it('translates a reviewed-content mismatch into a readable message', async () => {
    const spy = mockFetch({ ok: false, status: 'error', message: 'reviewed_content_changed' })

    const res = await POST(makeRequest(), params('alice'))
    const body = await res.json()

    expect(body.message).toBe('A reviewed file changed after it was applied. Re-apply or discard the newer edits before publishing.')
    spy.mockRestore()
  })

  it('publishes an applied change without a recorded hash as an override', async () => {
    mocks.listAppliedKnowledgeReviewChanges.mockResolvedValue([
      { kbPath: 'Notes/Reviewed.md', operation: 'update', appliedHash: null },
    ])
    const spy = mockFetch({ ok: true, status: 'published' }, 200, { includeFileRead: false })

    const res = await POST(makeRequest(), params('alice'))
    const body = await res.json()

    expect(body).toEqual({ ok: true, status: 'published' })
    // Nothing to attest: the read would be wasted, so it is skipped entirely.
    expect(spy).not.toHaveBeenCalledWith('http://agent:8080/files/read', expect.anything())
    expect(spy).toHaveBeenLastCalledWith('http://agent:8080/kb/publish', expect.objectContaining({
      body: JSON.stringify({
        paths: ['Notes/Reviewed.md'],
        pathHashes: {},
      }),
    }))
    spy.mockRestore()
  })

  it('uses the workspace owner records for admin cross-slug publishes', async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: 'admin-1', email: 'admin@test.com', slug: 'admin', role: 'ADMIN' },
      sessionId: 's-admin',
    })
    mocks.findIdBySlug.mockResolvedValue({ id: 'alice-owner' })
    mocks.listAppliedKnowledgeReviewChanges.mockResolvedValue([
      { kbPath: 'Notes/Reviewed.md', operation: 'update', appliedHash: 'sha256:reviewed' },
    ])
    mocks.markKnowledgeReviewChangesPublished.mockResolvedValue([])
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, diffs: [{ path: 'Notes/Reviewed.md' }] }), {
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, hash: 'sha256:reviewed' }), {
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValue(new Response(JSON.stringify({
        ok: true,
        status: 'published',
        commitHash: 'abc123',
        files: ['Notes/Reviewed.md'],
      }), {
        headers: { 'Content-Type': 'application/json' },
      }))

    const res = await POST(makeRequest(), params('alice'))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(mocks.listAppliedKnowledgeReviewChanges).toHaveBeenCalledWith({
      paths: ['Notes/Reviewed.md'],
      userId: 'alice-owner',
    })
    expect(mocks.markKnowledgeReviewChangesPublished).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'alice-owner',
    }))
    spy.mockRestore()
  })

  it('rejects publishing when the workspace owner cannot be resolved', async () => {
    mocks.findIdBySlug.mockResolvedValue(null)

    const res = await POST(makeRequest(), params('alice'))
    const body = await res.json()

    expect(body).toEqual({
      ok: false,
      status: 'error',
      message: 'Could not resolve the workspace owner. Try again.',
    })
    expect(mocks.listAppliedKnowledgeReviewChanges).not.toHaveBeenCalled()
  })

  it('accepts an optional paths array in the body and publishes only those', async () => {
    mocks.listAppliedKnowledgeReviewChanges.mockResolvedValue([
      { kbPath: 'Notes/Reviewed.md', operation: 'update', appliedHash: 'sha256:reviewed' },
      { kbPath: 'Notes/Other.md', operation: 'update', appliedHash: 'sha256:other' },
    ])
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        diffs: [{ path: 'Notes/Reviewed.md' }, { path: 'Notes/Other.md' }],
      }), {
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, hash: 'sha256:reviewed' }), {
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValue(new Response(JSON.stringify({ ok: true, status: 'published', commitHash: 'abc123' }), {
        headers: { 'Content-Type': 'application/json' },
      }))

    const request = new NextRequest('http://localhost/api/instances/alice/publish-kb', {
      method: 'POST',
      headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: ['Notes/Reviewed.md'] }),
    })
    const res = await POST(request, params('alice'))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(spy).toHaveBeenLastCalledWith('http://agent:8080/kb/publish', expect.objectContaining({
      body: JSON.stringify({
        paths: ['Notes/Reviewed.md'],
        pathHashes: { 'Notes/Reviewed.md': 'sha256:reviewed' },
      }),
    }))
    expect(mocks.listAppliedKnowledgeReviewChanges).toHaveBeenCalledWith(expect.objectContaining({
      paths: ['Notes/Reviewed.md'],
    }))
    spy.mockRestore()
  })

  it('returns an error for a requested path absent from the current diffs', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({
        ok: true,
        diffs: [{ path: 'Notes/Reviewed.md' }],
      }), {
        headers: { 'Content-Type': 'application/json' },
      }))

    const request = new NextRequest('http://localhost/api/instances/alice/publish-kb', {
      method: 'POST',
      headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: ['Notes/Missing.md'] }),
    })
    const res = await POST(request, params('alice'))
    const body = await res.json()

    expect(body).toEqual({
      ok: false,
      status: 'error',
      message: 'One of the selected files has no pending changes to publish.',
    })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).not.toHaveBeenCalledWith('http://agent:8080/kb/publish', expect.anything())
    spy.mockRestore()
  })

  it('returns 400 when paths is present but not an array', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')

    const request = new NextRequest('http://localhost/api/instances/alice/publish-kb', {
      method: 'POST',
      headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: 'Notes/Reviewed.md' }),
    })
    const res = await POST(request, params('alice'))

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_paths' })
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('returns 400 when paths contains a non-string entry', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')

    const request = new NextRequest('http://localhost/api/instances/alice/publish-kb', {
      method: 'POST',
      headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: ['Notes/Reviewed.md', 42] }),
    })
    const res = await POST(request, params('alice'))

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_paths' })
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('returns 400 when paths is present but null', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')

    const request = new NextRequest('http://localhost/api/instances/alice/publish-kb', {
      method: 'POST',
      headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: null }),
    })
    const res = await POST(request, params('alice'))

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_paths' })
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('GET /api/instances/[slug]/publish-kb', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.isWorkspaceReachable.mockResolvedValue(true)
    mocks.createWorkspaceAgentClient.mockResolvedValue({
      baseUrl: 'http://agent:8080',
      authHeader: 'Bearer tok',
    })
  })

  function makeGetRequest() {
    return new NextRequest('http://localhost/api/instances/alice/publish-kb', {
      method: 'GET',
      headers: { Origin: 'http://localhost' },
    })
  }

  it('returns the outgoing files from the workspace agent', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      files: ['Notes/Committed.md'],
    }), {
      headers: { 'Content-Type': 'application/json' },
    }))

    const res = await GET(makeGetRequest(), params('alice'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true, files: ['Notes/Committed.md'] })
    expect(spy).toHaveBeenCalledWith('http://agent:8080/kb/outgoing', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
    }))
    spy.mockRestore()
  })

  it('returns 409 when the instance is not running', async () => {
    mocks.isWorkspaceReachable.mockResolvedValue(false)
    const res = await GET(makeGetRequest(), params('alice'))
    expect(res.status).toBe(409)
  })

  it('returns 409 when the agent is unavailable', async () => {
    mocks.createWorkspaceAgentClient.mockResolvedValue(null)
    const res = await GET(makeGetRequest(), params('alice'))
    expect(res.status).toBe(409)
  })

  it('returns an error payload when the agent fails', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not json', { status: 500 }),
    )
    const res = await GET(makeGetRequest(), params('alice'))
    const body = await res.json()

    expect(body).toEqual({ ok: false, files: [], message: 'workspace_agent_http_500' })
    spy.mockRestore()
  })
})
