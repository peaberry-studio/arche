import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getRuntimeCapabilities: vi.fn(() => ({ csrf: false })),
  isDesktop: vi.fn(() => false),
  getSession: vi.fn(),
  validateSameOrigin: vi.fn(() => ({ ok: true })),
  validateDesktopToken: vi.fn(() => true),
  decryptProviderSecret: vi.fn(),
  providerService: {
    findCredentialsByUserAndProviders: vi.fn(),
    findOrganizationCredentialsByProviders: vi.fn(),
  },
  userService: { findIdBySlug: vi.fn() },
}))

vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mocks.getRuntimeCapabilities }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mocks.isDesktop }))
vi.mock('@/lib/runtime/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/csrf', () => ({ validateSameOrigin: mocks.validateSameOrigin }))
vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
  validateDesktopToken: mocks.validateDesktopToken,
}))
vi.mock('@/lib/providers/crypto', () => ({ decryptProviderSecret: mocks.decryptProviderSecret }))
vi.mock('@/lib/services', () => ({
  providerService: mocks.providerService,
  userService: mocks.userService,
}))

import { GET } from '../route'

const SESSION = {
  user: { id: 'u1', email: 'admin@test.com', slug: 'admin', role: 'ADMIN' },
  sessionId: 's1',
}

function makeRequest(slug = 'admin') {
  return new NextRequest(`http://localhost/api/u/${slug}/providers`, { method: 'GET' })
}

function params(slug: string) {
  return { params: Promise.resolve({ slug }) }
}

describe('GET /api/u/[slug]/providers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.decryptProviderSecret.mockReturnValue({
      baseUrl: 'https://ollama.example.com/v1',
      discoveredAt: '2026-05-27T00:00:00.000Z',
      mode: 'remote',
      models: [{ id: 'gpt-oss:20b-cloud', name: 'gpt-oss:20b-cloud' }],
      apiKey: 'ollama-token',
    })
    mocks.userService.findIdBySlug.mockResolvedValue({ id: 'u1' })
    mocks.providerService.findCredentialsByUserAndProviders.mockResolvedValue([])
    mocks.providerService.findOrganizationCredentialsByProviders.mockResolvedValue([])
  })

  it('returns providers list with missing status when no credentials', async () => {
    const res = await GET(makeRequest(), params('admin'))
    const body = await res.json()
    expect(body.providers).toBeDefined()
    expect(body.providers.length).toBeGreaterThan(0)
    expect(body.providers.every((p: { status: string }) => p.status === 'missing')).toBe(true)
  })

  it('returns enabled status for configured provider', async () => {
    mocks.providerService.findCredentialsByUserAndProviders.mockResolvedValue([
      { providerId: 'anthropic', status: 'enabled', type: 'api_key', version: 1 },
    ])

    const res = await GET(makeRequest(), params('admin'))
    const body = await res.json()
    const anthropic = body.providers.find((p: { providerId: string }) => p.providerId === 'anthropic')
    expect(anthropic.status).toBe('enabled')
    expect(anthropic.type).toBe('api_key')
  })

  it('omits inherited organization Ollama base URLs for non-admin users', async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: 'u1', email: 'alice@test.com', slug: 'alice', role: 'USER' },
      sessionId: 's-user',
    })
    mocks.providerService.findOrganizationCredentialsByProviders.mockResolvedValue([
      { providerId: 'ollama', status: 'enabled', type: 'api', version: 1, secret: 'encrypted' },
    ])

    const res = await GET(makeRequest('alice'), params('alice'))
    const body = await res.json()
    const ollama = body.providers.find((p: { providerId: string }) => p.providerId === 'ollama')

    expect(ollama.details).toEqual({
      discoveredAt: '2026-05-27T00:00:00.000Z',
      mode: 'remote',
      models: [{ id: 'gpt-oss:20b-cloud', name: 'gpt-oss:20b-cloud' }],
    })
  })

  it('includes organization Ollama base URLs for admins', async () => {
    mocks.providerService.findOrganizationCredentialsByProviders.mockResolvedValue([
      { providerId: 'ollama', status: 'enabled', type: 'api', version: 1, secret: 'encrypted' },
    ])

    const res = await GET(makeRequest(), params('admin'))
    const body = await res.json()
    const ollama = body.providers.find((p: { providerId: string }) => p.providerId === 'ollama')

    expect(ollama.details.baseUrl).toBe('https://ollama.example.com/v1')
  })

  it('returns 404 when user not found', async () => {
    mocks.userService.findIdBySlug.mockResolvedValue(null)
    const res = await GET(makeRequest(), params('admin'))
    expect(res.status).toBe(404)
  })

  it('returns 401 when not authenticated', async () => {
    mocks.getSession.mockResolvedValue(null)
    const res = await GET(makeRequest(), params('admin'))
    expect(res.status).toBe(401)
  })
})
