import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getRuntimeCapabilities: vi.fn(() => ({ csrf: false, connectors: true })),
  isDesktop: vi.fn(() => false),
  getSession: vi.fn(),
  validateSameOrigin: vi.fn(() => ({ ok: true })),
  validateDesktopToken: vi.fn(() => true),
  requireCapability: vi.fn(() => null),
  auditEvent: vi.fn(),
  decryptConfig: vi.fn(),
  encryptConfig: vi.fn(),
  parseZendeskConnectorConfig: vi.fn(),
  parseZendeskConnectorPermissions: vi.fn(),
  getZendeskConnectorPermissionsConstraintMessage: vi.fn(() => null),
  connectorService: {
    findByIdAndUserId: vi.fn(),
    updateManyByIdAndUserId: vi.fn(),
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
vi.mock('@/lib/runtime/require-capability', () => ({ requireCapability: mocks.requireCapability }))
vi.mock('@/lib/auth', () => ({ auditEvent: mocks.auditEvent }))
vi.mock('@/lib/connectors/crypto', () => ({
  decryptConfig: mocks.decryptConfig,
  encryptConfig: mocks.encryptConfig,
}))
vi.mock('@/lib/connectors/zendesk', () => ({
  parseZendeskConnectorConfig: mocks.parseZendeskConnectorConfig,
  parseZendeskConnectorPermissions: mocks.parseZendeskConnectorPermissions,
  getZendeskConnectorPermissionsConstraintMessage: mocks.getZendeskConnectorPermissionsConstraintMessage,
}))
vi.mock('@/lib/services', () => ({
  connectorService: mocks.connectorService,
  userService: mocks.userService,
}))

import { GET, PATCH } from '../route'

const SESSION = {
  user: { id: 'u1', email: 'admin@test.com', slug: 'admin', role: 'ADMIN' },
  sessionId: 's1',
}

const CONNECTOR = { id: 'c1', type: 'zendesk', config: 'encrypted', enabled: true }

const PARSED_CONFIG = {
  ok: true as const,
  value: {
    subdomain: 'test',
    email: 'a@b.com',
    apiToken: 'tok',
    permissions: { tickets: { read: true, write: false } },
  },
}

function makeGetRequest() {
  return new NextRequest('http://localhost/api/u/admin/connectors/c1/zendesk-settings', { method: 'GET' })
}

function makePatchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/u/admin/connectors/c1/zendesk-settings', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
  })
}

function params() {
  return { params: Promise.resolve({ slug: 'admin', id: 'c1' }) }
}

describe('GET /api/u/[slug]/connectors/[id]/zendesk-settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.userService.findIdBySlug.mockResolvedValue({ id: 'u1' })
    mocks.connectorService.findByIdAndUserId.mockResolvedValue(CONNECTOR)
    mocks.decryptConfig.mockReturnValue({ subdomain: 'test' })
    mocks.parseZendeskConnectorConfig.mockReturnValue(PARSED_CONFIG)
  })

  it('returns permissions on success', async () => {
    const res = await GET(makeGetRequest(), params())
    const body = await res.json()
    expect(body.permissions).toEqual({ tickets: { read: true, write: false } })
  })

  it('returns 404 when user not found', async () => {
    mocks.userService.findIdBySlug.mockResolvedValue(null)
    const res = await GET(makeGetRequest(), params())
    expect(res.status).toBe(404)
  })

  it('returns 404 when connector not found', async () => {
    mocks.connectorService.findByIdAndUserId.mockResolvedValue(null)
    const res = await GET(makeGetRequest(), params())
    expect(res.status).toBe(404)
  })

  it('returns 400 when connector is not zendesk', async () => {
    mocks.connectorService.findByIdAndUserId.mockResolvedValue({ ...CONNECTOR, type: 'linear' })
    const res = await GET(makeGetRequest(), params())
    expect(res.status).toBe(400)
  })

  it('returns 500 when decryption fails', async () => {
    mocks.decryptConfig.mockImplementation(() => { throw new Error('bad') })
    const res = await GET(makeGetRequest(), params())
    expect(res.status).toBe(500)
  })

  it('returns 500 when config parsing fails', async () => {
    mocks.parseZendeskConnectorConfig.mockReturnValue({ ok: false, missing: ['subdomain'] })
    const res = await GET(makeGetRequest(), params())
    expect(res.status).toBe(500)
  })
})

describe('PATCH /api/u/[slug]/connectors/[id]/zendesk-settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.userService.findIdBySlug.mockResolvedValue({ id: 'u1' })
    mocks.connectorService.findByIdAndUserId.mockResolvedValue(CONNECTOR)
    mocks.decryptConfig.mockReturnValue({ subdomain: 'test' })
    mocks.parseZendeskConnectorConfig.mockReturnValue(PARSED_CONFIG)
    mocks.parseZendeskConnectorPermissions.mockReturnValue({
      ok: true,
      value: { tickets: { read: true, write: true } },
    })
    mocks.getZendeskConnectorPermissionsConstraintMessage.mockReturnValue(null)
    mocks.encryptConfig.mockReturnValue('new-encrypted')
    mocks.connectorService.updateManyByIdAndUserId.mockResolvedValue({ count: 1 })
  })

  it('updates permissions and audits', async () => {
    const res = await PATCH(
      makePatchRequest({ permissions: { tickets: { read: true, write: true } } }),
      params(),
    )
    const body = await res.json()
    expect(body.permissions).toEqual({ tickets: { read: true, write: true } })
    expect(mocks.auditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'connector.zendesk_settings_updated' }),
    )
  })

  it('returns 400 for invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/u/admin/connectors/c1/zendesk-settings', {
      method: 'PATCH',
      body: 'bad json',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
    })
    const res = await PATCH(req, params())
    expect(res.status).toBe(400)
  })

  it('returns 400 when permissions validation fails', async () => {
    mocks.parseZendeskConnectorPermissions.mockReturnValue({
      ok: false,
      message: 'invalid field',
    })
    const res = await PATCH(makePatchRequest({ permissions: {} }), params())
    expect(res.status).toBe(400)
  })

  it('returns 400 when constraint message exists', async () => {
    mocks.getZendeskConnectorPermissionsConstraintMessage.mockReturnValue('At least one must be enabled')
    const res = await PATCH(makePatchRequest({ permissions: {} }), params())
    expect(res.status).toBe(400)
  })

  it('returns 404 when update affects 0 rows', async () => {
    mocks.connectorService.updateManyByIdAndUserId.mockResolvedValue({ count: 0 })
    const res = await PATCH(makePatchRequest({ permissions: {} }), params())
    expect(res.status).toBe(404)
  })

  it('returns 400 when encryption fails', async () => {
    mocks.encryptConfig.mockImplementation(() => { throw new Error('too large') })
    const res = await PATCH(makePatchRequest({ permissions: {} }), params())
    expect(res.status).toBe(400)
  })

  it('returns 404 when user is not found', async () => {
    mocks.userService.findIdBySlug.mockResolvedValue(null)
    const res = await PATCH(makePatchRequest({ permissions: {} }), params())
    expect(res.status).toBe(404)
  })

  it('returns 404 when connector is not found', async () => {
    mocks.connectorService.findByIdAndUserId.mockResolvedValue(null)
    const res = await PATCH(makePatchRequest({ permissions: {} }), params())
    expect(res.status).toBe(404)
  })

  it('returns 400 when connector is not zendesk', async () => {
    mocks.connectorService.findByIdAndUserId.mockResolvedValue({ ...CONNECTOR, type: 'linear' })
    const res = await PATCH(makePatchRequest({ permissions: {} }), params())
    expect(res.status).toBe(400)
  })

  it('returns 400 when body is not an object', async () => {
    const res = await PATCH(makePatchRequest(null), params())
    expect(res.status).toBe(400)
  })

  it('returns 500 when decryption fails', async () => {
    mocks.decryptConfig.mockImplementation(() => { throw new Error('bad') })
    const res = await PATCH(makePatchRequest({ permissions: {} }), params())
    expect(res.status).toBe(500)
  })

  it('returns 500 when existing config parsing fails', async () => {
    mocks.parseZendeskConnectorConfig.mockReturnValue({ ok: false, message: 'invalid config' })
    const res = await PATCH(makePatchRequest({ permissions: {} }), params())
    expect(res.status).toBe(500)
  })
})
