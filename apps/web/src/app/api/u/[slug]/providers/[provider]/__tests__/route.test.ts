import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRuntimeCapabilities: vi.fn(() => ({ csrf: false })),
  isDesktop: vi.fn(() => false),
  getSession: vi.fn(),
  validateSameOrigin: vi.fn(() => ({ ok: true })),
  validateDesktopToken: vi.fn(() => true),

  getInstanceUrl: vi.fn(() => 'http://test:3000'),
  syncProviderAccessForInstance: vi.fn().mockResolvedValue({ ok: true }),

  replaceApiCredential: vi.fn().mockResolvedValue({ id: 'cred-1', type: 'api', version: 1 }),

  userService: {
    findIdBySlug: vi.fn().mockResolvedValue({ id: 'u-1' }),
  },

  providerService: {
    findCredentialsByUserAndProviders: vi.fn().mockResolvedValue([]),
    disableEnabledForProvider: vi.fn().mockResolvedValue({ count: 1 }),
    markWorkspaceRestartRequired: vi.fn().mockResolvedValue(undefined),
    clearWorkspaceRestartRequired: vi.fn().mockResolvedValue(undefined),
    findActiveCredential: vi.fn().mockResolvedValue(null),
  },

  decryptPassword: vi.fn(() => 'password'),
  auditEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mocks.getRuntimeCapabilities }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mocks.isDesktop }))
vi.mock('@/lib/runtime/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/csrf', () => ({ validateSameOrigin: mocks.validateSameOrigin }))
vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
  validateDesktopToken: mocks.validateDesktopToken,
}))

vi.mock('@/lib/opencode/client', () => ({ getInstanceUrl: mocks.getInstanceUrl }))
vi.mock('@/lib/opencode/providers', () => ({ syncProviderAccessForInstance: mocks.syncProviderAccessForInstance }))
vi.mock('@/lib/providers/store', () => ({ replaceApiCredential: mocks.replaceApiCredential }))
vi.mock('@/lib/spawner/crypto', () => ({ decryptPassword: mocks.decryptPassword }))
vi.mock('@/lib/services', () => ({
  providerService: mocks.providerService,
  userService: mocks.userService,
  instanceService: { findCredentialsBySlug: vi.fn().mockResolvedValue({ status: 'running', serverPassword: 'enc' }) },
}))
vi.mock('@/lib/auth', () => ({ auditEvent: mocks.auditEvent }))

import { POST, DELETE } from '../route'

const ADMIN_SESSION = {
  user: { id: 'u-admin', email: 'admin@test.com', slug: 'admin', role: 'ADMIN' },
  sessionId: 's1',
}

describe('/api/u/[slug]/providers/[provider]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue(ADMIN_SESSION)
    mocks.getRuntimeCapabilities.mockReturnValue({ csrf: false })
    mocks.isDesktop.mockReturnValue(false)
    mocks.validateSameOrigin.mockReturnValue({ ok: true })
    mocks.validateDesktopToken.mockReturnValue(true)
    mocks.userService.findIdBySlug.mockResolvedValue({ id: 'u-1' })
    mocks.providerService.disableEnabledForProvider.mockResolvedValue({ count: 1 })
    mocks.providerService.markWorkspaceRestartRequired.mockResolvedValue(undefined)
    mocks.providerService.clearWorkspaceRestartRequired.mockResolvedValue(undefined)
    mocks.syncProviderAccessForInstance.mockResolvedValue({ ok: true })
    mocks.replaceApiCredential.mockResolvedValue({ id: 'cred-1', type: 'api', version: 1 })
    mocks.auditEvent.mockResolvedValue(undefined)
  })

  function makePostRequest(provider: string, body: unknown, slug = 'admin') {
    return new NextRequest(`http://localhost/api/u/${slug}/providers/${provider}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost',
      },
    })
  }

  function makeDeleteRequest(provider: string, slug = 'admin') {
    return new NextRequest(`http://localhost/api/u/${slug}/providers/${provider}`, {
      method: 'DELETE',
      headers: { Origin: 'http://localhost' },
    })
  }

  function routeParams(slug: string, provider: string) {
    return { params: Promise.resolve({ slug, provider }) }
  }

  describe('POST', () => {
    it('creates a provider credential and returns 201', async () => {
      const res = await POST(makePostRequest('anthropic', { apiKey: 'sk-ant-123' }), routeParams('admin', 'anthropic'))
      expect(res.status).toBe(201)
      const json = await res.json()
      expect(json.credential.providerId).toBe('anthropic')
      expect(json.restartRequired).toBe(false)
      expect(mocks.auditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'provider_credential.created' }),
      )
    })

    it('returns 403 for non-admin users', async () => {
      mocks.getSession.mockResolvedValue({
        user: { id: 'u-user', email: 'u@test.com', slug: 'admin', role: 'USER' },
        sessionId: 's2',
      })
      const res = await POST(makePostRequest('openai', { apiKey: 'sk-xxx' }), routeParams('admin', 'openai'))
      expect(res.status).toBe(403)
      const json = await res.json()
      expect(json.error).toBe('forbidden')
    })

    it('returns 400 for invalid provider', async () => {
      const res = await POST(makePostRequest('bogus', { apiKey: 'sk-xxx' }), routeParams('admin', 'bogus'))
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('invalid_provider')
    })

    it('returns 404 for unknown user', async () => {
      mocks.userService.findIdBySlug.mockResolvedValue(null)
      const res = await POST(makePostRequest('openai', { apiKey: 'sk-xxx' }), routeParams('unknown', 'openai'))
      expect(res.status).toBe(404)
      const json = await res.json()
      expect(json.error).toBe('user_not_found')
    })

    it('returns 400 for invalid JSON', async () => {
      const req = new NextRequest('http://localhost/api/u/admin/providers/openai', {
        method: 'POST',
        body: 'not json{',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost',
        },
      })
      const res = await POST(req, routeParams('admin', 'openai'))
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('invalid_body')
    })

    it('returns 400 when body is not an object', async () => {
      const res = await POST(makePostRequest('openai', null), routeParams('admin', 'openai'))
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('invalid_body')
    })

    it('returns 400 for missing apiKey', async () => {
      const res = await POST(makePostRequest('openai', {}), routeParams('admin', 'openai'))
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('missing_fields')
    })

    it('returns restartRequired true when instance sync fails (not running)', async () => {
      mocks.syncProviderAccessForInstance.mockResolvedValue({ ok: false, error: 'instance_unavailable' })
      const res = await POST(makePostRequest('openai', { apiKey: 'sk-xxx' }), routeParams('admin', 'openai'))
      expect(res.status).toBe(201)
      const json = await res.json()
      expect(json.restartRequired).toBe(false)
    })

    it('returns restartRequired true when sync returns non-instance_unavailable error', async () => {
      mocks.syncProviderAccessForInstance.mockResolvedValue({ ok: false, error: 'some_error' })
      const res = await POST(makePostRequest('openai', { apiKey: 'sk-xxx' }), routeParams('admin', 'openai'))
      expect(res.status).toBe(201)
      const json = await res.json()
      expect(json.restartRequired).toBe(true)
    })
  })

  describe('DELETE', () => {
    it('disables a provider credential', async () => {
      const res = await DELETE(makeDeleteRequest('openai'), routeParams('admin', 'openai'))
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.ok).toBe(true)
      expect(json.status).toBe('disabled')
      expect(mocks.auditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'provider_credential.disabled' }),
      )
    })

    it('returns missing status when no credential to disable', async () => {
      mocks.providerService.disableEnabledForProvider.mockResolvedValue({ count: 0 })
      const res = await DELETE(makeDeleteRequest('openai'), routeParams('admin', 'openai'))
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.status).toBe('missing')
    })

    it('returns 403 for non-admin', async () => {
      mocks.getSession.mockResolvedValue({
        user: { id: 'u-user', email: 'u@test.com', slug: 'admin', role: 'USER' },
        sessionId: 's2',
      })
      const res = await DELETE(makeDeleteRequest('openai'), routeParams('admin', 'openai'))
      expect(res.status).toBe(403)
      const json = await res.json()
      expect(json.error).toBe('forbidden')
    })

    it('returns 400 for invalid provider', async () => {
      const res = await DELETE(makeDeleteRequest('bogus'), routeParams('admin', 'bogus'))
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('invalid_provider')
    })

    it('returns 404 for unknown user', async () => {
      mocks.userService.findIdBySlug.mockResolvedValue(null)
      const res = await DELETE(makeDeleteRequest('openai'), routeParams('unknown', 'openai'))
      expect(res.status).toBe(404)
      const json = await res.json()
      expect(json.error).toBe('user_not_found')
    })
  })
})
