import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mocks ---

const mockCreateWorkspaceAgentClient = vi.fn()
vi.mock('@/lib/workspace-agent/client', () => ({
  createWorkspaceAgentClient: (...args: unknown[]) => mockCreateWorkspaceAgentClient(...args),
}))

const mockIsWorkspaceReachable = vi.fn()
vi.mock('@/lib/runtime/workspace-host', () => ({
  isWorkspaceReachable: (...args: unknown[]) => mockIsWorkspaceReachable(...args),
}))

const mockFindUnique = vi.fn()
vi.mock('@/lib/prisma', () => ({
  prisma: { instance: { findUnique: (...args: unknown[]) => mockFindUnique(...args) } },
}))

const mockGetAuthenticatedUser = vi.fn()
vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
  SESSION_COOKIE_NAME: 'arche_session',
}))

// --- Helpers ---

function session(slug: string, role = 'USER') {
  return { user: { id: '1', email: 'a@b.com', slug, role }, sessionId: 's1' }
}

function instance(status = 'running', containerId = 'ctr-1') {
  return { containerId, status }
}

function mockFetchResponse(payload: unknown, status = 200) {
  const ok = status >= 200 && status < 300
  const response = {
    ok,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  }
  ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(response)
}

async function callPOST(slug = 'alice') {
  const { POST } = await import(
    '@/app/api/instances/[slug]/publish-kb/route'
  )
  const req = new Request('http://localhost/api/instances/' + slug + '/publish-kb', {
    method: 'POST',
    headers: {
      host: 'localhost',
      origin: 'http://localhost',
    },
  })
  const res = await POST(req as never, { params: Promise.resolve({ slug }) })
  return { status: res.status, body: await res.json() }
}

// --- Tests ---

describe('POST /api/instances/[slug]/publish-kb', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn())
    mockIsWorkspaceReachable.mockResolvedValue(true)
  })

  it('returns 401 without session cookie', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(null)
    const { status, body } = await callPOST()
    expect(status).toBe(401)
    expect(body.error).toBe('unauthorized')
  })

  it('returns 403 when Origin is missing', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session('alice'))
    const { POST } = await import(
      '@/app/api/instances/[slug]/publish-kb/route'
    )

    const req = new Request('http://localhost/api/instances/alice/publish-kb', {
      method: 'POST',
      headers: {
        host: 'localhost',
      },
    })
    const res = await POST(req as never, { params: Promise.resolve({ slug: 'alice' }) })

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'forbidden' })
  })

  it('returns 403 for wrong user', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session('bob'))
    const { status, body } = await callPOST('alice')
    expect(status).toBe(403)
    expect(body.error).toBe('forbidden')
  })

  it('returns 409 when instance not found', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session('alice'))
    mockFindUnique.mockResolvedValue(null)
    mockIsWorkspaceReachable.mockResolvedValue(false)
    const { status, body } = await callPOST('alice')
    expect(status).toBe(409)
    expect(body.error).toBe('instance_not_running')
  })

  it('returns 409 when instance not running', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session('alice'))
    mockFindUnique.mockResolvedValue(instance('stopped'))
    mockIsWorkspaceReachable.mockResolvedValue(false)
    const { status, body } = await callPOST('alice')
    expect(status).toBe(409)
    expect(body.error).toBe('instance_not_running')
  })

  it('returns no_remote when git remote fails', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session('alice'))
    mockFindUnique.mockResolvedValue(instance())
    mockCreateWorkspaceAgentClient.mockResolvedValue({
      baseUrl: 'http://agent',
      authHeader: 'Basic abc'
    })
    mockFetchResponse({
      ok: false,
      status: 'no_remote',
      message: 'KB remote not configured.'
    })
    const { status, body } = await callPOST('alice')
    expect(status).toBe(200)
    expect(body.status).toBe('no_remote')
    expect(body.ok).toBe(false)
  })

  it('returns nothing_to_publish when workspace is clean', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session('alice'))
    mockFindUnique.mockResolvedValue(instance())
    mockCreateWorkspaceAgentClient.mockResolvedValue({
      baseUrl: 'http://agent',
      authHeader: 'Basic abc'
    })
    mockFetchResponse({
      ok: true,
      status: 'nothing_to_publish',
      message: 'Nothing to publish.'
    })
    const { status, body } = await callPOST('alice')
    expect(status).toBe(200)
    expect(body.status).toBe('nothing_to_publish')
    expect(body.ok).toBe(true)
  })

  it('returns published with commitHash and files', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session('alice'))
    mockFindUnique.mockResolvedValue(instance())
    mockCreateWorkspaceAgentClient.mockResolvedValue({
      baseUrl: 'http://agent',
      authHeader: 'Basic abc'
    })
    mockFetchResponse({
      ok: true,
      status: 'published',
      commitHash: 'abc1234',
      files: ['file1.md', 'file2.md']
    })
    const { status, body } = await callPOST('alice')
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.status).toBe('published')
    expect(body.commitHash).toBe('abc1234')
    expect(body.files).toEqual(['file1.md', 'file2.md'])
  })

  it('returns push_rejected when push fails with rejected', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session('alice'))
    mockFindUnique.mockResolvedValue(instance())
    mockCreateWorkspaceAgentClient.mockResolvedValue({
      baseUrl: 'http://agent',
      authHeader: 'Basic abc'
    })
    mockFetchResponse({
      ok: false,
      status: 'push_rejected',
      commitHash: 'def5678',
      files: ['file1.md'],
      message: 'Sync KB first'
    })
    const { status, body } = await callPOST('alice')
    expect(status).toBe(200)
    expect(body.ok).toBe(false)
    expect(body.status).toBe('push_rejected')
    expect(body.message).toBe('Sync KB first')
  })

  it('allows admin to publish for another user', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session('admin-user', 'ADMIN'))
    mockFindUnique.mockResolvedValue(instance())
    mockCreateWorkspaceAgentClient.mockResolvedValue({
      baseUrl: 'http://agent',
      authHeader: 'Basic abc'
    })
    mockFetchResponse({
      ok: true,
      status: 'nothing_to_publish',
      message: 'Nothing to publish.'
    })
    const { status, body } = await callPOST('alice')
    expect(status).toBe(200)
    expect(body.status).toBe('nothing_to_publish')
  })

  it('returns error when agent reports error', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session('alice'))
    mockFindUnique.mockResolvedValue(instance())
    mockCreateWorkspaceAgentClient.mockResolvedValue({
      baseUrl: 'http://agent',
      authHeader: 'Basic abc'
    })
    mockFetchResponse({
      ok: false,
      status: 'error',
      message: 'git add failed: index locked'
    })
    const { status, body } = await callPOST('alice')
    expect(status).toBe(200)
    expect(body.ok).toBe(false)
    expect(body.status).toBe('error')
    expect(body.message).toBe('git add failed: index locked')
  })

  it('returns conflicts when merge conflicts arise during publish', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session('alice'))
    mockFindUnique.mockResolvedValue(instance())
    mockCreateWorkspaceAgentClient.mockResolvedValue({
      baseUrl: 'http://agent',
      authHeader: 'Basic abc'
    })
    mockFetchResponse({
      ok: false,
      status: 'conflicts',
      files: ['doc.md', 'readme.md'],
      message: 'Merge conflicts during publish. Resolve and retry.'
    })
    const { status, body } = await callPOST('alice')
    expect(status).toBe(200)
    expect(body.ok).toBe(false)
    expect(body.status).toBe('conflicts')
    expect(body.files).toEqual(['doc.md', 'readme.md'])
  })

  it('returns error when agent request fails', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session('alice'))
    mockFindUnique.mockResolvedValue(instance())
    mockCreateWorkspaceAgentClient.mockResolvedValue({
      baseUrl: 'http://agent',
      authHeader: 'Basic abc'
    })
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('agent down'))
    const { status, body } = await callPOST('alice')
    expect(status).toBe(200)
    expect(body.ok).toBe(false)
    expect(body.status).toBe('error')
    expect(body.message).toBe('agent down')
  })
})
