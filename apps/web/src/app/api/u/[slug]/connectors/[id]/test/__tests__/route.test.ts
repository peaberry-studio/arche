import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getRuntimeCapabilities: vi.fn(() => ({ csrf: false, connectors: true })),
  isDesktop: vi.fn(() => false),
  getSession: vi.fn(),
  validateSameOrigin: vi.fn(() => ({ ok: true })),
  validateDesktopToken: vi.fn(() => true),
  requireCapability: vi.fn(() => null),
  decryptConfig: vi.fn(),
  getConnectorAuthType: vi.fn(() => 'manual'),
  refreshConnectorOAuthConfigIfNeeded: vi.fn(),
  getCustomConnectorTestEndpoint: vi.fn(),
  testConnectorConnection: vi.fn(),
  validateConnectorType: vi.fn(() => true),
  validateConnectorTestEndpoint: vi.fn(),
  connectorService: { findByIdAndUserId: vi.fn() },
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
vi.mock('@/lib/runtime/require-capability', () => ({ requireCapability: mocks.requireCapability }))
vi.mock('@/lib/connectors/crypto', () => ({ decryptConfig: mocks.decryptConfig }))
vi.mock('@/lib/connectors/oauth-config', () => ({ getConnectorAuthType: mocks.getConnectorAuthType }))
vi.mock('@/lib/connectors/oauth-refresh', () => ({
  refreshConnectorOAuthConfigIfNeeded: mocks.refreshConnectorOAuthConfigIfNeeded,
}))
vi.mock('@/lib/connectors/test-connection', () => ({
  getCustomConnectorTestEndpoint: mocks.getCustomConnectorTestEndpoint,
  testConnectorConnection: mocks.testConnectorConnection,
}))
vi.mock('@/lib/connectors/validators', () => ({ validateConnectorType: mocks.validateConnectorType }))
vi.mock('@/lib/security/ssrf', () => ({
  validateConnectorTestEndpoint: mocks.validateConnectorTestEndpoint,
}))
vi.mock('@/lib/services', () => ({
  connectorService: mocks.connectorService,
  userService: mocks.userService,
}))

import { POST } from '../route'

const SESSION = {
  user: { id: 'u1', email: 'admin@test.com', slug: 'admin', role: 'ADMIN' },
  sessionId: 's1',
}

const CONNECTOR = {
  id: 'c1',
  type: 'linear',
  config: 'encrypted',
  enabled: true,
  name: 'My Linear',
}

function makeRequest() {
  return new NextRequest('http://localhost/api/u/admin/connectors/c1/test', {
    method: 'POST',
    headers: { origin: 'http://localhost' },
  })
}

function params(slug: string, id: string) {
  return { params: Promise.resolve({ slug, id }) }
}

describe('POST /api/u/[slug]/connectors/[id]/test', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.userService.findIdBySlug.mockResolvedValue({ id: 'u1' })
    mocks.connectorService.findByIdAndUserId.mockResolvedValue(CONNECTOR)
    mocks.refreshConnectorOAuthConfigIfNeeded.mockResolvedValue(null)
    mocks.decryptConfig.mockReturnValue({ apiKey: 'key' })
    mocks.testConnectorConnection.mockResolvedValue({ ok: true, tested: true, message: 'OK' })
    mocks.getConnectorAuthType.mockReturnValue('manual')
    mocks.validateConnectorType.mockReturnValue(true)
  })

  it('tests connection and returns result', async () => {
    const res = await POST(makeRequest(), params('admin', 'c1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, tested: true, message: 'OK' })
  })

  it('appends restart message for successful OAuth test', async () => {
    mocks.getConnectorAuthType.mockReturnValue('oauth')

    const res = await POST(makeRequest(), params('admin', 'c1'))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.message).toContain('Restart the workspace')
  })

  it('returns 404 when user not found', async () => {
    mocks.userService.findIdBySlug.mockResolvedValue(null)

    const res = await POST(makeRequest(), params('admin', 'c1'))
    expect(res.status).toBe(404)
  })

  it('returns 404 when connector not found', async () => {
    mocks.connectorService.findByIdAndUserId.mockResolvedValue(null)

    const res = await POST(makeRequest(), params('admin', 'c1'))
    expect(res.status).toBe(404)
  })

  it('returns 409 when connector is disabled', async () => {
    mocks.connectorService.findByIdAndUserId.mockResolvedValue({ ...CONNECTOR, enabled: false })

    const res = await POST(makeRequest(), params('admin', 'c1'))
    expect(res.status).toBe(409)
  })

  it('returns 500 when decryption fails', async () => {
    mocks.decryptConfig.mockImplementation(() => { throw new Error('bad') })

    const res = await POST(makeRequest(), params('admin', 'c1'))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('config_corrupted')
  })

  it('returns 400 for unsupported connector type', async () => {
    mocks.validateConnectorType.mockReturnValue(false)

    const res = await POST(makeRequest(), params('admin', 'c1'))
    expect(res.status).toBe(400)
  })

  it('uses refreshed config when available', async () => {
    mocks.refreshConnectorOAuthConfigIfNeeded.mockResolvedValue('refreshed-encrypted')
    mocks.decryptConfig.mockReturnValue({ apiKey: 'refreshed' })

    await POST(makeRequest(), params('admin', 'c1'))
    expect(mocks.decryptConfig).toHaveBeenCalledWith('refreshed-encrypted')
  })

  it('validates SSRF for custom connector endpoint', async () => {
    mocks.connectorService.findByIdAndUserId.mockResolvedValue({ ...CONNECTOR, type: 'custom' })
    mocks.validateConnectorType.mockReturnValue(true)
    mocks.getCustomConnectorTestEndpoint.mockReturnValue('http://internal:8080')
    mocks.validateConnectorTestEndpoint.mockResolvedValue({
      ok: false,
      error: 'ssrf_blocked',
    })

    const res = await POST(makeRequest(), params('admin', 'c1'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('ssrf_blocked')
  })

  it('returns 401 when not authenticated', async () => {
    mocks.getSession.mockResolvedValue(null)
    const res = await POST(makeRequest(), params('admin', 'c1'))
    expect(res.status).toBe(401)
  })
})
