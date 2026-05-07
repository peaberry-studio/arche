import { beforeEach, describe, expect, it, vi } from 'vitest'

const findIntegrationMock = vi.fn()
const decryptIntegrationConfigMock = vi.fn()
const updateSyncStateMock = vi.fn()
const verifyInstallationMock = vi.fn()
const auditEventMock = vi.fn()
const getSessionMock = vi.fn()

vi.mock('@/lib/auth', () => ({
  auditEvent: (...args: unknown[]) => auditEventMock(...args),
}))

vi.mock('@/lib/runtime/require-capability', () => ({
  requireCapability: () => null,
}))

vi.mock('@/lib/runtime/session', () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}))

vi.mock('@/lib/services', () => ({
  kbGithubRemoteService: {
    findIntegration: (...args: unknown[]) => findIntegrationMock(...args),
    decryptIntegrationConfig: (...args: unknown[]) => decryptIntegrationConfigMock(...args),
    updateSyncState: (...args: unknown[]) => updateSyncStateMock(...args),
  },
}))

vi.mock('@/lib/git/github-app-auth', () => ({
  verifyInstallation: (...args: unknown[]) => verifyInstallationMock(...args),
}))

function makeRecord() {
  return {
    singletonKey: 'kb_github_remote',
    config: 'enc:test',
    state: {
      installationId: null,
      repoFullName: null,
      repoCloneUrl: null,
      lastSyncAt: null,
      lastSyncStatus: null,
      lastError: null,
      remoteBranch: null,
      lastPushAt: null,
      lastPullAt: null,
    },
    version: 1,
    createdAt: new Date('2026-04-27T10:00:00Z'),
    updatedAt: new Date('2026-04-27T10:00:00Z'),
  }
}

describe('/api/u/[slug]/kb-github-remote/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auditEventMock.mockResolvedValue(undefined)
    updateSyncStateMock.mockResolvedValue(undefined)
    findIntegrationMock.mockResolvedValue(makeRecord())
    decryptIntegrationConfigMock.mockReturnValue({
      appId: '12345',
      privateKey: 'pem-data',
      appSlug: 'my-app',
    })
    verifyInstallationMock.mockResolvedValue({ ok: true, account: 'my-org' })
    getSessionMock.mockResolvedValue({
      user: { id: 'admin-1', role: 'ADMIN', slug: 'alice' },
      sessionId: 'session-1',
    })
  })

  it('stores installation ID and redirects on success', async () => {
    const { GET } = await import('../route')
    const response = await GET(
      new Request('http://localhost/api/u/alice/kb-github-remote/callback?installation_id=99') as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(307)
    const location = response.headers.get('location')
    expect(location).toContain('/u/alice/settings/integrations/kb-github-remote')
    expect(location).toContain('installed=true')

    expect(updateSyncStateMock).toHaveBeenCalledWith({ installationId: 99 })
    expect(auditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'kb_github_remote.installed',
        metadata: expect.objectContaining({ installationId: 99, account: 'my-org' }),
      }),
    )
  })

  it('redirects with error when session is missing', async () => {
    getSessionMock.mockResolvedValue(null)

    const { GET } = await import('../route')
    const response = await GET(
      new Request('http://localhost/api/u/alice/kb-github-remote/callback?installation_id=99') as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('error=unauthorized')
  })

  it('redirects with error when installation_id is missing', async () => {
    const { GET } = await import('../route')
    const response = await GET(
      new Request('http://localhost/api/u/alice/kb-github-remote/callback') as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('error=missing_installation_id')
  })

  it('redirects with error when installation_id is invalid', async () => {
    const { GET } = await import('../route')
    const response = await GET(
      new Request('http://localhost/api/u/alice/kb-github-remote/callback?installation_id=-1') as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('error=invalid_installation_id')
  })

  it('redirects with error when integration is not configured', async () => {
    findIntegrationMock.mockResolvedValue(null)

    const { GET } = await import('../route')
    const response = await GET(
      new Request('http://localhost/api/u/alice/kb-github-remote/callback?installation_id=99') as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('error=not_configured')
  })

  it('redirects with error when config is missing credentials', async () => {
    decryptIntegrationConfigMock.mockReturnValue({ appId: null, privateKey: null })

    const { GET } = await import('../route')
    const response = await GET(
      new Request('http://localhost/api/u/alice/kb-github-remote/callback?installation_id=99') as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('error=not_configured')
  })

  it('resets repo state when installation ID changes', async () => {
    findIntegrationMock.mockResolvedValue({
      ...makeRecord(),
      state: {
        ...makeRecord().state,
        installationId: 50,
        repoFullName: 'owner/old-repo',
        repoCloneUrl: 'https://github.com/owner/old-repo.git',
        lastSyncAt: '2026-04-27T10:00:00Z',
        lastSyncStatus: 'success',
        lastError: null,
        remoteBranch: 'main',
        lastPushAt: '2026-04-27T10:00:00Z',
        lastPullAt: '2026-04-27T10:00:00Z',
      },
    })

    const { GET } = await import('../route')
    const response = await GET(
      new Request('http://localhost/api/u/alice/kb-github-remote/callback?installation_id=99') as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('installed=true')
    expect(updateSyncStateMock).toHaveBeenCalledWith({
      installationId: 99,
      repoFullName: null,
      repoCloneUrl: null,
      lastSyncAt: null,
      lastSyncStatus: null,
      lastError: null,
      remoteBranch: null,
      lastPushAt: null,
      lastPullAt: null,
    })
  })

  it('redirects with error when verification fails', async () => {
    verifyInstallationMock.mockResolvedValue({ ok: false, message: 'API error' })

    const { GET } = await import('../route')
    const response = await GET(
      new Request('http://localhost/api/u/alice/kb-github-remote/callback?installation_id=99') as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('error=verification_failed')
  })

  it('redirects with error for non-admin users', async () => {
    getSessionMock.mockResolvedValue({
      user: { id: 'user-1', role: 'USER', slug: 'alice' },
      sessionId: 'session-1',
    })

    const { GET } = await import('../route')
    const response = await GET(
      new Request('http://localhost/api/u/alice/kb-github-remote/callback?installation_id=99') as never,
      { params: Promise.resolve({ slug: 'alice' }) },
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('error=forbidden')
  })
})
