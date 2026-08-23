import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auditEvent: vi.fn(),
  createWorkspaceAgentClient: vi.fn(),
  createWorkspaceRemoteConfig: vi.fn(),
  findIdBySlug: vi.fn(),
  listAppliedKnowledgeReviewChanges: vi.fn(),
  markKnowledgeReviewChangesPublished: vi.fn(),
  updateSyncState: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auditEvent: mocks.auditEvent }))
vi.mock('@/lib/workspace-agent/client', () => ({ createWorkspaceAgentClient: mocks.createWorkspaceAgentClient }))
vi.mock('@/lib/services/user', () => ({ findIdBySlug: mocks.findIdBySlug }))
vi.mock('@/lib/learning/service', () => ({
  listAppliedKnowledgeReviewChanges: mocks.listAppliedKnowledgeReviewChanges,
  markKnowledgeReviewChangesPublished: mocks.markKnowledgeReviewChangesPublished,
}))
vi.mock('@/lib/services', () => ({
  kbGithubRemoteService: {
    createWorkspaceRemoteConfig: mocks.createWorkspaceRemoteConfig,
    updateSyncState: mocks.updateSyncState,
  },
}))

import { publishKnowledgeBasePaths } from '@/lib/learning/publish-kb'

const AGENT = { baseUrl: 'http://agent:8080', authHeader: 'Bearer tok' }

type MockDiff = { conflicted?: boolean; path: string }

function mockFetch(options: {
  diffs?: MockDiff[]
  fileReads?: Record<string, { body: object; status?: number }>
  publish?: object
} = {}) {
  const diffs = options.diffs ?? [{ path: 'Notes/A.md' }, { path: 'Notes/B.md' }]
  const publish = options.publish ?? { ok: true, status: 'published', commitHash: 'abc123' }
  const fileReads = options.fileReads ?? {}
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString()
    if (url.endsWith('/git/diffs')) {
      return Promise.resolve(new Response(JSON.stringify({ ok: true, diffs }), {
        headers: { 'Content-Type': 'application/json' },
      }))
    }
    if (url.endsWith('/files/read')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { path?: string }
      const read: { body: object; status?: number } = fileReads[body.path ?? '']
        ?? { body: { ok: true, hash: 'sha256:unexpected' }, status: 200 }
      return Promise.resolve(new Response(JSON.stringify(read.body), {
        status: read.status,
        headers: { 'Content-Type': 'application/json' },
      }))
    }
    return Promise.resolve(new Response(JSON.stringify(publish), {
      headers: { 'Content-Type': 'application/json' },
    }))
  })
}

describe('publishKnowledgeBasePaths', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createWorkspaceAgentClient.mockResolvedValue(AGENT)
    mocks.findIdBySlug.mockResolvedValue({ id: 'owner-1' })
    mocks.createWorkspaceRemoteConfig.mockResolvedValue({ ok: true, remote: null })
    mocks.updateSyncState.mockResolvedValue(undefined)
    mocks.listAppliedKnowledgeReviewChanges.mockResolvedValue([])
    mocks.markKnowledgeReviewChangesPublished.mockResolvedValue([])
  })

  it('returns a readable message when the workspace agent is unavailable', async () => {
    mocks.createWorkspaceAgentClient.mockResolvedValue(null)

    const result = await publishKnowledgeBasePaths({ slug: 'alice', actorUserId: 'u1' })

    expect(result).toEqual({
      ok: false,
      status: 'error',
      message: 'The workspace runtime is unavailable. Try again in a moment.',
    })
  })

  it('publishes all diffs when no paths are given', async () => {
    const spy = mockFetch()

    const result = await publishKnowledgeBasePaths({ slug: 'alice', actorUserId: 'u1' })

    expect(result).toEqual({ ok: true, status: 'published', commitHash: 'abc123' })
    expect(spy).toHaveBeenLastCalledWith('http://agent:8080/kb/publish', expect.objectContaining({
      body: JSON.stringify({
        paths: ['Notes/A.md', 'Notes/B.md'],
        pathHashes: {},
      }),
    }))
    expect(mocks.listAppliedKnowledgeReviewChanges).toHaveBeenCalledWith({
      paths: ['Notes/A.md', 'Notes/B.md'],
      userId: 'owner-1',
    })
    spy.mockRestore()
  })

  it('publishes only the requested paths when paths are given', async () => {
    const spy = mockFetch()

    const result = await publishKnowledgeBasePaths({ slug: 'alice', actorUserId: 'u1', paths: ['Notes/B.md'] })

    expect(result).toEqual({ ok: true, status: 'published', commitHash: 'abc123' })
    expect(spy).toHaveBeenLastCalledWith('http://agent:8080/kb/publish', expect.objectContaining({
      body: JSON.stringify({
        paths: ['Notes/B.md'],
        pathHashes: {},
      }),
    }))
    expect(mocks.listAppliedKnowledgeReviewChanges).toHaveBeenCalledWith({
      paths: ['Notes/B.md'],
      userId: 'owner-1',
    })
    spy.mockRestore()
  })

  it('rejects a requested path that is not in the current diffs', async () => {
    const spy = mockFetch()

    const result = await publishKnowledgeBasePaths({ slug: 'alice', actorUserId: 'u1', paths: ['Notes/Missing.md'] })

    expect(result).toEqual({
      ok: false,
      status: 'error',
      message: 'One of the selected files has no pending changes to publish.',
    })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).not.toHaveBeenCalledWith('http://agent:8080/kb/publish', expect.anything())
    spy.mockRestore()
  })

  it('returns no_paths_selected for an explicitly empty paths array', async () => {
    const spy = mockFetch()

    const result = await publishKnowledgeBasePaths({ slug: 'alice', actorUserId: 'u1', paths: [] })

    expect(result).toEqual({ ok: false, status: 'error', message: 'Select at least one file to publish.' })
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('blocks publish when a requested path is conflicted but allows non-conflicted paths', async () => {
    const spy = mockFetch({
      diffs: [{ conflicted: true, path: 'Notes/Conflict.md' }, { path: 'Notes/Clean.md' }],
    })

    const blocked = await publishKnowledgeBasePaths({ slug: 'alice', actorUserId: 'u1', paths: ['Notes/Conflict.md'] })
    expect(blocked).toEqual({ ok: true, status: 'conflicts' })
    expect(spy).toHaveBeenCalledTimes(1)

    const allowed = await publishKnowledgeBasePaths({ slug: 'alice', actorUserId: 'u1', paths: ['Notes/Clean.md'] })
    expect(allowed).toEqual({ ok: true, status: 'published', commitHash: 'abc123' })
    expect(spy).toHaveBeenLastCalledWith('http://agent:8080/kb/publish', expect.objectContaining({
      body: JSON.stringify({
        paths: ['Notes/Clean.md'],
        pathHashes: {},
      }),
    }))
    spy.mockRestore()
  })

  it('translates a sibling-conflict agent error into a readable message', async () => {
    mockFetch({ publish: { ok: false, status: 'error', message: 'resolve_conflicts_before_publishing' } })

    const result = await publishKnowledgeBasePaths({ slug: 'alice', actorUserId: 'u1' })

    expect(result.message).toBe('Resolve the conflicted files before publishing other changes.')
  })

  it('marks applied changes published only for the published paths', async () => {
    mocks.listAppliedKnowledgeReviewChanges.mockResolvedValue([
      { kbPath: 'Notes/A.md', operation: 'update', appliedHash: 'sha256:a' },
      { kbPath: 'Notes/B.md', operation: 'update', appliedHash: 'sha256:b' },
    ])
    const spy = mockFetch({
      fileReads: {
        'Notes/A.md': { body: { ok: true, hash: 'sha256:a' } },
        'Notes/B.md': { body: { ok: true, hash: 'sha256:b' } },
      },
      publish: { ok: true, status: 'published', commitHash: 'abc123', files: ['Notes/A.md'] },
    })

    const result = await publishKnowledgeBasePaths({ slug: 'alice', actorUserId: 'u1' })

    expect(result.ok).toBe(true)
    expect(mocks.markKnowledgeReviewChangesPublished).toHaveBeenCalledTimes(1)
    expect(mocks.markKnowledgeReviewChangesPublished).toHaveBeenCalledWith(expect.objectContaining({
      paths: ['Notes/A.md'],
      commitSha: 'abc123',
      userId: 'owner-1',
    }))
    expect(mocks.auditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'knowledge.review_published',
      metadata: expect.objectContaining({ paths: ['Notes/A.md'] }),
    }))
    // B has an applied row but was never shipped by the agent, so it is
    // neither marked published nor audited.
    expect(mocks.markKnowledgeReviewChangesPublished).not.toHaveBeenCalledWith(expect.objectContaining({
      paths: expect.arrayContaining(['Notes/B.md']),
    }))
    expect(mocks.auditEvent).not.toHaveBeenCalledWith(expect.objectContaining({
      action: 'knowledge.user_published',
    }))
    spy.mockRestore()
  })
})
