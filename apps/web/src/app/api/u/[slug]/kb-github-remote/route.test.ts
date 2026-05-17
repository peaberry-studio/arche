import { beforeEach, describe, expect, it, vi } from 'vitest'

const auditEventMock = vi.fn()
const clearIntegrationMock = vi.fn()
const createSessionMock = vi.fn()
const decryptIntegrationConfigMock = vi.fn()
const exchangeManifestCodeMock = vi.fn()
const findIntegrationMock = vi.fn()
const findSessionByIdWithUserMock = vi.fn()
const getInstallationReposMock = vi.fn()
const getInstallationTokenMock = vi.fn()
const requireCapabilityMock = vi.fn()
const saveAppConfigMock = vi.fn()
const saveInstallationMock = vi.fn()
const saveSelectedRepoMock = vi.fn()
const toSummaryMock = vi.fn()
const verifyInstallationMock = vi.fn()

const authState = {
  user: { email: 'admin@example.com', id: 'admin-1', role: 'ADMIN', slug: 'alice' },
}
let hasSession = true

vi.mock('@/lib/auth', () => ({
  auditEvent: (...args: unknown[]) => auditEventMock(...args),
  createSession: (...args: unknown[]) => createSessionMock(...args),
  getCookieDomain: () => undefined,
  SESSION_COOKIE_NAME: 'arche_session',
  shouldUseSecureCookies: () => false,
}))

vi.mock('@/lib/git/github-app-auth', () => ({
  exchangeManifestCode: (...args: unknown[]) => exchangeManifestCodeMock(...args),
  getInstallationRepos: (...args: unknown[]) => getInstallationReposMock(...args),
  getInstallationToken: (...args: unknown[]) => getInstallationTokenMock(...args),
  verifyInstallation: (...args: unknown[]) => verifyInstallationMock(...args),
}))

vi.mock('@/lib/runtime/require-capability', () => ({
  requireCapability: (...args: unknown[]) => requireCapabilityMock(...args),
}))

vi.mock('@/lib/runtime/session', () => ({
  getSession: () => Promise.resolve(hasSession ? { sessionId: 'session-1', user: authState.user } : null),
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
    clearIntegration: (...args: unknown[]) => clearIntegrationMock(...args),
    decryptIntegrationConfig: (...args: unknown[]) => decryptIntegrationConfigMock(...args),
    findIntegration: (...args: unknown[]) => findIntegrationMock(...args),
    saveAppConfig: (...args: unknown[]) => saveAppConfigMock(...args),
    saveInstallation: (...args: unknown[]) => saveInstallationMock(...args),
    saveSelectedRepo: (...args: unknown[]) => saveSelectedRepoMock(...args),
    toSummary: (...args: unknown[]) => toSummaryMock(...args),
  },
  sessionService: {
    findByIdWithUser: (...args: unknown[]) => findSessionByIdWithUserMock(...args),
  },
}))

const integrationRecord = {
  config: 'encrypted',
  configCorrupted: false,
  createdAt: new Date('2026-05-01T10:00:00.000Z'),
  key: 'kb_github_remote',
  state: {
    installationAccount: 'acme',
    installationId: 123,
    lastError: null,
    lastSyncAt: null,
    lastSyncStatus: null,
    repoCloneUrl: null,
    repoDefaultBranch: null,
    repoFullName: null,
  },
  updatedAt: new Date('2026-05-01T10:00:00.000Z'),
  version: 1,
}

const appConfig = {
  appId: '42',
  appSlug: 'arche-kb-sync',
  privateKey: 'private-key',
}

function params(slug = 'alice') {
  return { params: Promise.resolve({ slug }) }
}

function request(path: string, init?: RequestInit) {
  return new Request(`http://localhost${path}`, init) as never
}

describe('/api/u/[slug]/kb-github-remote', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.user = { email: 'admin@example.com', id: 'admin-1', role: 'ADMIN', slug: 'alice' }
    hasSession = true
    requireCapabilityMock.mockReturnValue(null)
    auditEventMock.mockResolvedValue(undefined)
    clearIntegrationMock.mockResolvedValue(integrationRecord)
    createSessionMock.mockResolvedValue({ expiresAt: new Date('2099-05-08T10:00:00.000Z'), token: 'restored-token' })
    decryptIntegrationConfigMock.mockReturnValue(appConfig)
    exchangeManifestCodeMock.mockResolvedValue({
      appId: 42,
      ok: true,
      owner: 'acme',
      pem: 'private-key',
      slug: 'arche-kb-sync',
    })
    findIntegrationMock.mockResolvedValue(integrationRecord)
    findSessionByIdWithUserMock.mockResolvedValue({
      expiresAt: new Date('2099-05-08T10:00:00.000Z'),
      id: 'session-1',
      revokedAt: null,
      user: authState.user,
      userId: 'admin-1',
    })
    getInstallationReposMock.mockResolvedValue({
      ok: true,
      repos: [
        {
          cloneUrl: 'https://github.com/acme/kb.git',
          defaultBranch: 'main',
          fullName: 'acme/kb',
          private: true,
        },
      ],
    })
    getInstallationTokenMock.mockResolvedValue({ expiresAt: '2026-05-01T11:00:00.000Z', ok: true, token: 'token-1' })
    saveAppConfigMock.mockResolvedValue(integrationRecord)
    saveInstallationMock.mockResolvedValue(undefined)
    saveSelectedRepoMock.mockResolvedValue(undefined)
    toSummaryMock.mockReturnValue({ appConfigured: true, ready: true, repoFullName: 'acme/kb' })
    verifyInstallationMock.mockResolvedValue({ account: 'acme', ok: true })
  })

  it('returns the deployment-wide GitHub KB summary for admins', async () => {
    const { GET } = await import('./route')

    const response = await GET(request('/api/u/alice/kb-github-remote'), params())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ appConfigured: true, ready: true, repoFullName: 'acme/kb' })
    expect(toSummaryMock).toHaveBeenCalledWith(integrationRecord, appConfig)
  })

  it('clears the integration for admins', async () => {
    const { DELETE } = await import('./route')

    const response = await DELETE(request('/api/u/alice/kb-github-remote', { method: 'DELETE' }), params())

    expect(response.status).toBe(200)
    expect(clearIntegrationMock).toHaveBeenCalled()
    expect(auditEventMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'kb_github_remote.deleted',
      actorUserId: 'admin-1',
    }))
  })

  it('rejects non-admin users', async () => {
    authState.user = { email: 'user@example.com', id: 'user-1', role: 'USER', slug: 'alice' }
    const { GET } = await import('./route')

    const response = await GET(request('/api/u/alice/kb-github-remote'), params())

    expect(response.status).toBe(403)
  })

  it('returns capability denial before admin checks', async () => {
    requireCapabilityMock.mockReturnValue(new Response(JSON.stringify({ error: 'disabled' }), { status: 404 }))
    const { GET } = await import('./route')

    const response = await GET(request('/api/u/alice/kb-github-remote'), params())

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'disabled' })
  })
})

describe('/api/u/[slug]/kb-github-remote/setup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.user = { email: 'admin@example.com', id: 'admin-1', role: 'ADMIN', slug: 'alice' }
    hasSession = true
    requireCapabilityMock.mockReturnValue(null)
    auditEventMock.mockResolvedValue(undefined)
    exchangeManifestCodeMock.mockResolvedValue({
      appId: 42,
      ok: true,
      owner: 'acme',
      pem: 'private-key',
      slug: 'arche-kb-sync',
    })
    saveAppConfigMock.mockResolvedValue(integrationRecord)
  })

  it('exchanges the manifest code and redirects to GitHub app installation', async () => {
    const { GET } = await import('./setup/route')

    const response = await GET(request('/api/u/alice/kb-github-remote/setup?code=abc'), params())

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://github.com/apps/arche-kb-sync/installations/new')
    expect(saveAppConfigMock).toHaveBeenCalledWith({
      appId: '42',
      appSlug: 'arche-kb-sync',
      privateKey: 'private-key',
    })
    expect(auditEventMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'kb_github_remote.app_created' }))
  })

  it('redirects back to management when the manifest code is missing', async () => {
    const { GET } = await import('./setup/route')

    const response = await GET(
      request('/api/u/alice/kb-github-remote/setup', {
        headers: { 'x-forwarded-host': 'josemi.peaberry.studio', 'x-forwarded-proto': 'https' },
      }),
      params(),
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://josemi.peaberry.studio/u/alice/settings/integrations/kb-github-remote?error=missing_code')
  })

  it('redirects back to management when GitHub rejects the manifest code', async () => {
    exchangeManifestCodeMock.mockResolvedValue({ message: 'expired', ok: false })
    const { GET } = await import('./setup/route')

    const response = await GET(request('/api/u/alice/kb-github-remote/setup?code=abc'), params())

    expect(response.headers.get('location')).toBe('http://localhost/u/alice/settings/integrations/kb-github-remote?error=exchange_failed')
  })
})

describe('/api/u/[slug]/kb-github-remote/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.user = { email: 'admin@example.com', id: 'admin-1', role: 'ADMIN', slug: 'alice' }
    hasSession = true
    requireCapabilityMock.mockReturnValue(null)
    auditEventMock.mockResolvedValue(undefined)
    createSessionMock.mockResolvedValue({ expiresAt: new Date('2099-05-08T10:00:00.000Z'), token: 'restored-token' })
    decryptIntegrationConfigMock.mockReturnValue(appConfig)
    findIntegrationMock.mockResolvedValue(integrationRecord)
    findSessionByIdWithUserMock.mockResolvedValue({
      expiresAt: new Date('2099-05-08T10:00:00.000Z'),
      id: 'session-1',
      revokedAt: null,
      user: authState.user,
      userId: 'admin-1',
    })
    saveInstallationMock.mockResolvedValue(undefined)
    verifyInstallationMock.mockResolvedValue({ account: 'acme', ok: true })
  })

  it('verifies and stores the installation before redirecting to management', async () => {
    const { GET } = await import('./callback/route')

    const response = await GET(
      request('/api/u/alice/kb-github-remote/callback?installation_id=123', {
        headers: { 'x-forwarded-host': 'josemi.peaberry.studio', 'x-forwarded-proto': 'https' },
      }),
      params(),
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://josemi.peaberry.studio/u/alice/settings/integrations/kb-github-remote?installed=true')
    expect(verifyInstallationMock).toHaveBeenCalledWith('42', 'private-key', 123)
    expect(saveInstallationMock).toHaveBeenCalledWith({ account: 'acme', installationId: 123 })
  })

  it('redirects back to management for invalid installation IDs', async () => {
    const { GET } = await import('./callback/route')

    const response = await GET(request('/api/u/alice/kb-github-remote/callback?installation_id=abc'), params())

    expect(response.headers.get('location')).toBe('http://localhost/u/alice/settings/integrations/kb-github-remote?error=invalid_installation_id')
  })

  it('redirects back to management when app credentials are missing', async () => {
    decryptIntegrationConfigMock.mockReturnValue(null)
    const { GET } = await import('./callback/route')

    const response = await GET(request('/api/u/alice/kb-github-remote/callback?installation_id=123'), params())

    expect(response.headers.get('location')).toBe('http://localhost/u/alice/settings/integrations/kb-github-remote?error=not_configured')
  })

  it('restores the admin session from setup state on GitHub return', async () => {
    hasSession = false
    const {
      createKbGithubRemoteSetupState,
      KB_GITHUB_REMOTE_SETUP_COOKIE_NAME,
    } = await import('@/lib/kb-github-remote/setup-state')
    const state = createKbGithubRemoteSetupState({
      sessionId: 'session-1',
      slug: 'alice',
      userId: 'admin-1',
    })
    const { GET } = await import('./callback/route')

    const response = await GET(
      request(`/api/u/alice/kb-github-remote/callback?installation_id=123&state=${encodeURIComponent(state)}`, {
        headers: { cookie: `${KB_GITHUB_REMOTE_SETUP_COOKIE_NAME}=${state}` },
      }),
      params(),
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost/u/alice/settings/integrations/kb-github-remote?installed=true')
    expect(findSessionByIdWithUserMock).toHaveBeenCalledWith('session-1')
    expect(createSessionMock).toHaveBeenCalledWith(expect.objectContaining({ userId: 'admin-1' }))
    expect(response.headers.get('set-cookie')).toContain('arche_session=restored-token')
    expect(saveInstallationMock).toHaveBeenCalledWith({ account: 'acme', installationId: 123 })
  })
})

describe('/api/u/[slug]/kb-github-remote/setup-state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.user = { email: 'admin@example.com', id: 'admin-1', role: 'ADMIN', slug: 'alice' }
    hasSession = true
    requireCapabilityMock.mockReturnValue(null)
  })

  it('creates a setup state and stores it in a temporary cookie', async () => {
    const { POST } = await import('./setup-state/route')

    const response = await POST(request('/api/u/alice/kb-github-remote/setup-state', { method: 'POST' }), params())

    expect(response.status).toBe(200)
    const data = await response.json() as { state?: string }
    expect(typeof data.state).toBe('string')
    expect(response.headers.get('set-cookie')).toContain('arche_kb_github_setup=')
  })
})

describe('/api/u/[slug]/kb-github-remote/install', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.user = { email: 'admin@example.com', id: 'admin-1', role: 'ADMIN', slug: 'alice' }
    hasSession = true
    requireCapabilityMock.mockReturnValue(null)
    decryptIntegrationConfigMock.mockReturnValue(appConfig)
    findIntegrationMock.mockResolvedValue(integrationRecord)
  })

  it('redirects admins to the GitHub App installation page', async () => {
    const { GET } = await import('./install/route')

    const response = await GET(request('/api/u/alice/kb-github-remote/install'), params())

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toMatch(/^https:\/\/github\.com\/apps\/arche-kb-sync\/installations\/new\?state=.+/)
    expect(response.headers.get('set-cookie')).toContain('arche_kb_github_setup=')
  })

  it('returns not_configured when no app slug is stored', async () => {
    decryptIntegrationConfigMock.mockReturnValue({ appId: '42', privateKey: 'private-key' })
    const { GET } = await import('./install/route')

    const response = await GET(request('/api/u/alice/kb-github-remote/install'), params())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'not_configured' })
  })
})

describe('/api/u/[slug]/kb-github-remote/repos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.user = { email: 'admin@example.com', id: 'admin-1', role: 'ADMIN', slug: 'alice' }
    hasSession = true
    requireCapabilityMock.mockReturnValue(null)
    auditEventMock.mockResolvedValue(undefined)
    decryptIntegrationConfigMock.mockReturnValue(appConfig)
    findIntegrationMock.mockResolvedValue(integrationRecord)
    getInstallationReposMock.mockResolvedValue({
      ok: true,
      repos: [
        {
          cloneUrl: 'https://github.com/acme/kb.git',
          defaultBranch: 'main',
          fullName: 'acme/kb',
          private: true,
        },
      ],
    })
    saveSelectedRepoMock.mockResolvedValue(undefined)
  })

  it('lists repositories available to the GitHub App installation', async () => {
    const { GET } = await import('./repos/route')

    const response = await GET(request('/api/u/alice/kb-github-remote/repos'), params())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      repos: [{ defaultBranch: 'main', fullName: 'acme/kb', private: true }],
    })
  })

  it('saves a selected repository after verifying installation access', async () => {
    const { PUT } = await import('./repos/route')

    const response = await PUT(
      request('/api/u/alice/kb-github-remote/repos', {
        body: JSON.stringify({ repoFullName: 'acme/kb' }),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      }),
      params(),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, repoFullName: 'acme/kb' })
    expect(saveSelectedRepoMock).toHaveBeenCalledWith({
      cloneUrl: 'https://github.com/acme/kb.git',
      defaultBranch: 'main',
      fullName: 'acme/kb',
    })
    expect(auditEventMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'kb_github_remote.repo_selected' }))
  })

  it('rejects missing repository names', async () => {
    const { PUT } = await import('./repos/route')

    const response = await PUT(
      request('/api/u/alice/kb-github-remote/repos', {
        body: JSON.stringify({ repoFullName: ' ' }),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      }),
      params(),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'missing_repo' })
  })

  it('rejects repositories outside the installation access list', async () => {
    const { PUT } = await import('./repos/route')

    const response = await PUT(
      request('/api/u/alice/kb-github-remote/repos', {
        body: JSON.stringify({ repoFullName: 'acme/other' }),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      }),
      params(),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'repo_not_found' })
  })

  it('requires GitHub App credentials before listing repos', async () => {
    decryptIntegrationConfigMock.mockReturnValue(null)
    const { GET } = await import('./repos/route')

    const response = await GET(request('/api/u/alice/kb-github-remote/repos'), params())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'not_configured' })
  })
})

describe('/api/u/[slug]/kb-github-remote/test', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.user = { email: 'admin@example.com', id: 'admin-1', role: 'ADMIN', slug: 'alice' }
    hasSession = true
    requireCapabilityMock.mockReturnValue(null)
    decryptIntegrationConfigMock.mockReturnValue(appConfig)
    findIntegrationMock.mockResolvedValue(integrationRecord)
    getInstallationTokenMock.mockResolvedValue({ expiresAt: '2026-05-01T11:00:00.000Z', ok: true, token: 'token-1' })
  })

  it('tests the GitHub App installation token', async () => {
    const { POST } = await import('./test/route')

    const response = await POST(request('/api/u/alice/kb-github-remote/test', { method: 'POST' }), params())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, message: 'GitHub installation token acquired.' })
    expect(getInstallationTokenMock).toHaveBeenCalledWith('42', 'private-key', 123)
  })

  it('returns a non-throwing failed test result when GitHub rejects the token request', async () => {
    getInstallationTokenMock.mockResolvedValue({ message: 'GitHub App credentials are invalid.', ok: false })
    const { POST } = await import('./test/route')

    const response = await POST(request('/api/u/alice/kb-github-remote/test', { method: 'POST' }), params())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: false, message: 'GitHub App credentials are invalid.' })
  })

  it('requires an installed GitHub App before testing the connection', async () => {
    findIntegrationMock.mockResolvedValue({
      ...integrationRecord,
      state: { ...integrationRecord.state, installationId: null },
    })
    const { POST } = await import('./test/route')

    const response = await POST(request('/api/u/alice/kb-github-remote/test', { method: 'POST' }), params())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'not_installed' })
  })
})
