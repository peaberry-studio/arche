import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  disableOrganizationProviderApiCredential: vi.fn(),
  getRuntimeCapabilities: vi.fn(() => ({ csrf: false })),
  getSession: vi.fn(),
  isDesktop: vi.fn(() => false),
  replaceOrganizationProviderApiCredential: vi.fn(),
  validateDesktopToken: vi.fn(() => true),
  validateSameOrigin: vi.fn(() => ({ ok: true })),
}))

vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mocks.getRuntimeCapabilities }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mocks.isDesktop }))
vi.mock('@/lib/runtime/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/csrf', () => ({ validateSameOrigin: mocks.validateSameOrigin }))
vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
  validateDesktopToken: mocks.validateDesktopToken,
}))
vi.mock('@/lib/providers/credential-mutations', () => ({
  disableOrganizationProviderApiCredential: mocks.disableOrganizationProviderApiCredential,
  replaceOrganizationProviderApiCredential: mocks.replaceOrganizationProviderApiCredential,
}))

import { DELETE, POST } from '../route'

const ADMIN_SESSION = {
  user: { id: 'admin-1', email: 'admin@test.com', slug: 'admin', role: 'ADMIN' },
  sessionId: 'session-1',
}

function makePostRequest(provider: string, body: unknown) {
  return new NextRequest(`http://localhost/api/u/admin/organization-providers/${provider}`, {
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost',
    },
    method: 'POST',
  })
}

function makeDeleteRequest(provider: string) {
  return new NextRequest(`http://localhost/api/u/admin/organization-providers/${provider}`, {
    headers: { Origin: 'http://localhost' },
    method: 'DELETE',
  })
}

function routeParams(provider: string, slug = 'admin') {
  return { params: Promise.resolve({ provider, slug }) }
}

describe('/api/u/[slug]/organization-providers/[provider]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.disableOrganizationProviderApiCredential.mockResolvedValue({ disabledCount: 1, invalidatedInstanceCount: 2 })
    mocks.getRuntimeCapabilities.mockReturnValue({ csrf: false })
    mocks.getSession.mockResolvedValue(ADMIN_SESSION)
    mocks.isDesktop.mockReturnValue(false)
    mocks.replaceOrganizationProviderApiCredential.mockResolvedValue({
      credential: {
        id: 'org-cred-1',
        type: 'api',
        version: 4,
      },
      invalidatedInstanceCount: 2,
    })
    mocks.validateDesktopToken.mockReturnValue(true)
    mocks.validateSameOrigin.mockReturnValue({ ok: true })
  })

  describe('POST', () => {
    it('creates an organization provider credential', async () => {
      const response = await POST(makePostRequest('openai', { apiKey: '  sk-org  ' }), routeParams('openai'))
      const body = await response.json()

      expect(response.status).toBe(201)
      expect(mocks.replaceOrganizationProviderApiCredential).toHaveBeenCalledWith({
        actorUserId: 'admin-1',
        apiKey: 'sk-org',
        providerId: 'openai',
      })
      expect(body).toEqual({
        credential: {
          id: 'org-cred-1',
          providerId: 'openai',
          status: 'enabled',
          type: 'api',
          version: 4,
        },
      })
    })

    it('returns 403 for non-admin users', async () => {
      mocks.getSession.mockResolvedValue({
        user: { id: 'user-1', email: 'user@test.com', slug: 'admin', role: 'USER' },
        sessionId: 'session-2',
      })

      const response = await POST(makePostRequest('openai', { apiKey: 'sk-org' }), routeParams('openai'))
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error).toBe('forbidden')
      expect(mocks.replaceOrganizationProviderApiCredential).not.toHaveBeenCalled()
    })

    it('returns 400 for invalid providers', async () => {
      const response = await POST(makePostRequest('bogus', { apiKey: 'sk-org' }), routeParams('bogus'))
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toBe('invalid_provider')
    })

    it('returns 400 for invalid JSON', async () => {
      const request = new NextRequest('http://localhost/api/u/admin/organization-providers/openai', {
        body: 'not json{',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost',
        },
        method: 'POST',
      })

      const response = await POST(request, routeParams('openai'))
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toBe('invalid_body')
    })

    it('rethrows non-syntax JSON parsing errors', async () => {
      const request = makePostRequest('openai', { apiKey: 'sk-org' })
      Object.defineProperty(request, 'json', { value: vi.fn().mockRejectedValue(new Error('stream failed')) })

      await expect(POST(request, routeParams('openai'))).rejects.toThrow('stream failed')
    })

    it('returns 400 when body is not an object', async () => {
      const response = await POST(makePostRequest('openai', []), routeParams('openai'))
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toBe('invalid_body')
    })

    it('returns 400 when apiKey is missing', async () => {
      const response = await POST(makePostRequest('openai', { apiKey: '   ' }), routeParams('openai'))
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toBe('missing_fields')
    })
  })

  describe('DELETE', () => {
    it('disables an organization provider credential', async () => {
      const response = await DELETE(makeDeleteRequest('openai'), routeParams('openai'))
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(mocks.disableOrganizationProviderApiCredential).toHaveBeenCalledWith({
        actorUserId: 'admin-1',
        providerId: 'openai',
      })
      expect(body).toEqual({ ok: true, status: 'disabled' })
    })

    it('returns missing when there is no credential to disable', async () => {
      mocks.disableOrganizationProviderApiCredential.mockResolvedValue({ disabledCount: 0, invalidatedInstanceCount: 0 })

      const response = await DELETE(makeDeleteRequest('openai'), routeParams('openai'))
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toEqual({ ok: true, status: 'missing' })
    })

    it('returns 403 for non-admin users', async () => {
      mocks.getSession.mockResolvedValue({
        user: { id: 'user-1', email: 'user@test.com', slug: 'admin', role: 'USER' },
        sessionId: 'session-2',
      })

      const response = await DELETE(makeDeleteRequest('openai'), routeParams('openai'))
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error).toBe('forbidden')
      expect(mocks.disableOrganizationProviderApiCredential).not.toHaveBeenCalled()
    })

    it('returns 400 for invalid providers', async () => {
      const response = await DELETE(makeDeleteRequest('bogus'), routeParams('bogus'))
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toBe('invalid_provider')
    })
  })
})
