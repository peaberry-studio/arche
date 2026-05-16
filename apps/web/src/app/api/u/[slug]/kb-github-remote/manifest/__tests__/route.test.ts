/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const createKbGithubRemoteSetupStateMock = vi.fn()
const getPublicBaseUrlMock = vi.fn()
const getSessionMock = vi.fn()
const requireKbGithubRemoteAdminMock = vi.fn()
const setKbGithubRemoteSetupCookieMock = vi.fn()

vi.mock('@/lib/http', () => ({
  getPublicBaseUrl: (...args: unknown[]) => getPublicBaseUrlMock(...args),
}))

vi.mock('@/lib/kb-github-remote/setup-state', () => ({
  createKbGithubRemoteSetupState: (...args: unknown[]) => createKbGithubRemoteSetupStateMock(...args),
  setKbGithubRemoteSetupCookie: (...args: unknown[]) => setKbGithubRemoteSetupCookieMock(...args),
}))

vi.mock('@/lib/kb-github-remote/route-auth', () => ({
  requireKbGithubRemoteAdmin: (...args: unknown[]) => requireKbGithubRemoteAdminMock(...args),
}))

vi.mock('@/lib/runtime/session', () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}))

const adminUser = { email: 'admin@example.com', id: 'admin-1', role: 'ADMIN', slug: 'alice' }

function params(slug = 'alice') {
  return { params: Promise.resolve({ slug }) }
}

function request(path: string, init?: RequestInit) {
  return new Request(`http://localhost${path}`, init) as never
}

describe('GET /api/u/[slug]/kb-github-remote/manifest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getPublicBaseUrlMock.mockReturnValue('https://example.com')
    createKbGithubRemoteSetupStateMock.mockReturnValue('setup-state-1')
    setKbGithubRemoteSetupCookieMock.mockImplementation(() => undefined)
    getSessionMock.mockResolvedValue({ sessionId: 'session-1', user: adminUser })
    requireKbGithubRemoteAdminMock.mockReturnValue({ ok: true })
  })

  it('returns HTML form with personal GitHub App creation URL', async () => {
    const { GET } = await import('../route')

    const response = await GET(request('/api/u/alice/kb-github-remote/manifest'), params())

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html;charset=utf-8')
    const body = await response.text()
    expect(body).toContain('<form method="post" action="https://github.com/settings/apps/new?state=setup-state-1">')
    expect(body).toContain('Redirecting to GitHub')
    expect(body).toContain('https://example.com/api/u/alice/kb-github-remote/callback?state=setup-state-1')
    expect(setKbGithubRemoteSetupCookieMock).toHaveBeenCalled()
    expect(createKbGithubRemoteSetupStateMock).toHaveBeenCalledWith({
      sessionId: 'session-1',
      slug: 'alice',
      userId: 'admin-1',
    })
  })

  it('returns HTML form with organization GitHub App creation URL', async () => {
    const { GET } = await import('../route')

    const response = await GET(request('/api/u/alice/kb-github-remote/manifest?owner=acme-org'), params())

    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).toContain('<form method="post" action="https://github.com/organizations/acme-org/settings/apps/new?state=setup-state-1">')
    expect(body).toContain('https://example.com/api/u/alice/kb-github-remote/callback?state=setup-state-1')
  })

  it('redirects with invalid_owner for invalid organization name', async () => {
    const { GET } = await import('../route')

    const response = await GET(request('/api/u/alice/kb-github-remote/manifest?owner=../bad'), params())

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost/u/alice/settings/integrations/kb-github-remote?error=invalid_owner')
    expect(createKbGithubRemoteSetupStateMock).not.toHaveBeenCalled()
  })

  it('redirects with unauthorized when no session', async () => {
    getSessionMock.mockResolvedValue(null)
    const { GET } = await import('../route')

    const response = await GET(request('/api/u/alice/kb-github-remote/manifest'), params())

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost/u/alice/settings/integrations/kb-github-remote?error=unauthorized')
  })

  it('redirects with forbidden for non-admin users', async () => {
    requireKbGithubRemoteAdminMock.mockReturnValue({ ok: false, response: new Response(null, { status: 403 }) })
    const { GET } = await import('../route')

    const response = await GET(request('/api/u/alice/kb-github-remote/manifest'), params())

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost/u/alice/settings/integrations/kb-github-remote?error=forbidden')
  })
})
