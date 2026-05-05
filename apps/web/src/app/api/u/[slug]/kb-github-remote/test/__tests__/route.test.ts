import { beforeEach, describe, expect, it, vi } from 'vitest'

const findIntegrationMock = vi.fn()
const decryptIntegrationConfigMock = vi.fn()
const getInstallationTokenMock = vi.fn()

const authState = {
  user: { id: 'admin-1', role: 'ADMIN', slug: 'alice' },
}

vi.mock('@/lib/runtime/require-capability', () => ({
  requireCapability: () => null,
}))

vi.mock('@/lib/runtime/with-auth', () => ({
  withAuth: (_options: unknown, handler: (request: Request, context: unknown) => Promise<Response>) => {
    return async (request: Request, { params }: { params: Promise<{ slug: string }> }) => {
      const resolvedParams = await params
      return handler(request, {
        params: resolvedParams,
        sessionId: 'session-1',
        slug: resolvedParams.slug,
        user: authState.user,
      })
    }
  },
}))

vi.mock('@/lib/services', () => ({
  kbGithubRemoteService: {
    findIntegration: (...args: unknown[]) => findIntegrationMock(...args),
    decryptIntegrationConfig: (...args: unknown[]) => decryptIntegrationConfigMock(...args),
  },
}))

vi.mock('@/lib/git/github-app-auth', () => ({
  getInstallationToken: (...args: unknown[]) => getInstallationTokenMock(...args),
}))

function makeRecord(overrides?: Partial<{ state: Record<string, unknown> }>) {
  return {
    singletonKey: 'kb_github_remote',
    config: 'enc:test',
    state: {
      installationId: 99,
      repoFullName: 'owner/repo',
      repoCloneUrl: 'https://github.com/owner/repo.git',
      lastSyncAt: null,
      lastSyncStatus: null,
      lastError: null,
      remoteBranch: null,
      lastPushAt: null,
      lastPullAt: null,
      ...overrides?.state,
    },
    version: 1,
    createdAt: new Date('2026-04-27T10:00:00Z'),
    updatedAt: new Date('2026-04-27T10:00:00Z'),
  }
}

describe('/api/u/[slug]/kb-github-remote/test', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.user = { id: 'admin-1', role: 'ADMIN', slug: 'alice' }
    findIntegrationMock.mockResolvedValue(makeRecord())
    decryptIntegrationConfigMock.mockReturnValue({
      appId: '12345',
      privateKey: 'pem-data',
    })
    getInstallationTokenMock.mockResolvedValue({
      ok: true,
      token: 'ghs_abc123',
      expiresAt: '2026-04-27T11:00:00Z',
    })
  })

  it('returns success when token acquisition works', async () => {
    const { POST } = await import('../route')
    const response = await POST(
      new Request('http://localhost/api/u/alice/kb-github-remote/test', {
        method: 'POST',
      }) as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(getInstallationTokenMock).toHaveBeenCalledWith('12345', 'pem-data', 99)
  })

  it('returns failure when token acquisition fails', async () => {
    getInstallationTokenMock.mockResolvedValue({
      ok: false,
      status: 'auth_failed',
      message: 'GitHub App credentials are invalid',
    })

    const { POST } = await import('../route')
    const response = await POST(
      new Request('http://localhost/api/u/alice/kb-github-remote/test', {
        method: 'POST',
      }) as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.message).toContain('invalid')
  })

  it('returns 400 when not configured', async () => {
    findIntegrationMock.mockResolvedValue(null)

    const { POST } = await import('../route')
    const response = await POST(
      new Request('http://localhost/api/u/alice/kb-github-remote/test', {
        method: 'POST',
      }) as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(400)
  })

  it('returns 400 when not installed', async () => {
    findIntegrationMock.mockResolvedValue(makeRecord({ state: { installationId: null } }))

    const { POST } = await import('../route')
    const response = await POST(
      new Request('http://localhost/api/u/alice/kb-github-remote/test', {
        method: 'POST',
      }) as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'not_installed' })
  })

  it('returns 403 for non-admin users', async () => {
    authState.user = { id: 'user-1', role: 'USER', slug: 'alice' }

    const { POST } = await import('../route')
    const response = await POST(
      new Request('http://localhost/api/u/alice/kb-github-remote/test', {
        method: 'POST',
      }) as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(403)
  })
})
