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
vi.mock('@/lib/services', () => ({
  connectorService: mocks.connectorService,
  userService: mocks.userService,
}))

import { GET, PATCH } from '../route'
import { DEFAULT_ZENDESK_ACTION_PERMISSIONS } from '@/lib/connectors/zendesk-types'

const SESSION = {
  user: { id: 'u1', email: 'admin@test.com', slug: 'admin', role: 'ADMIN' },
  sessionId: 's1',
}

const CONNECTOR = { id: 'c1', type: 'zendesk', config: 'encrypted', enabled: true }

const LEGACY_CONFIG = {
  subdomain: 'test',
  email: 'a@b.com',
  apiToken: 'tok',
  permissions: {
    allowRead: true,
    allowCreateTickets: true,
    allowUpdateTickets: true,
    allowPublicComments: true,
    allowInternalComments: true,
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
    mocks.decryptConfig.mockReturnValue({ ...LEGACY_CONFIG })
  })

  it('returns legacy permissions and normalized canonical actions', async () => {
    const res = await GET(makeGetRequest(), params())
    const body = await res.json()
    expect(body.permissions).toEqual(LEGACY_CONFIG.permissions)
    expect(body.zendeskActionPermissions).toEqual({
      version: 1,
      actions: DEFAULT_ZENDESK_ACTION_PERMISSIONS,
    })
  })

  it('normalizes disabled legacy booleans in memory without a save', async () => {
    mocks.decryptConfig.mockReturnValue({
      ...LEGACY_CONFIG,
      permissions: { ...LEGACY_CONFIG.permissions, allowPublicComments: false },
    })
    const res = await GET(makeGetRequest(), params())
    const body = await res.json()
    expect(body.zendeskActionPermissions.actions.create_ticket_public).toBe('deny')
    expect(body.zendeskActionPermissions.actions.create_ticket_internal).toBe('allow')
  })

  it('returns stored canonical actions when present', async () => {
    const actions = { ...DEFAULT_ZENDESK_ACTION_PERMISSIONS, update_ticket_fields: 'ask' as const }
    mocks.decryptConfig.mockReturnValue({
      ...LEGACY_CONFIG,
      zendeskActionPermissions: { version: 1, actions },
    })
    const res = await GET(makeGetRequest(), params())
    const body = await res.json()
    expect(body.zendeskActionPermissions).toEqual({ version: 1, actions })
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
    mocks.decryptConfig.mockReturnValue({ subdomain: 'test' })
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
    mocks.decryptConfig.mockReturnValue({ ...LEGACY_CONFIG })
    mocks.encryptConfig.mockReturnValue('new-encrypted')
    mocks.connectorService.updateManyByIdAndUserId.mockResolvedValue({ count: 1 })
  })

  it('persists canonical actions and dual-writes the legacy projection in one update', async () => {
    const actions = {
      ...DEFAULT_ZENDESK_ACTION_PERMISSIONS,
      create_ticket_public: 'deny' as const,
      update_ticket_with_internal_note: 'ask' as const,
    }
    const res = await PATCH(
      makePatchRequest({ zendeskActionPermissions: { version: 1, actions } }),
      params(),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.zendeskActionPermissions).toEqual({ version: 1, actions })

    const written = mocks.encryptConfig.mock.calls[0][0] as Record<string, unknown>
    expect(written.zendeskActionPermissions).toEqual({ version: 1, actions })
    expect(written.permissions).toEqual({
      allowRead: true,
      allowCreateTickets: false,
      allowUpdateTickets: true,
      allowPublicComments: false,
      allowInternalComments: true,
    })
    expect(written.mcpToolPermissions).toEqual({
      search_tickets: 'allow',
      get_ticket: 'allow',
      list_ticket_comments: 'allow',
      create_ticket: 'deny',
      update_ticket: 'ask',
    })
    expect(mocks.connectorService.updateManyByIdAndUserId).toHaveBeenCalledTimes(1)
    expect(mocks.auditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'connector.zendesk_settings_updated',
        metadata: expect.objectContaining({ connectorId: 'c1', zendeskActionPermissions: { version: 1, actions } }),
      }),
    )
  })

  it('normalizes a legacy boolean request into canonical actions', async () => {
    const res = await PATCH(
      makePatchRequest({
        permissions: {
          allowRead: true,
          allowCreateTickets: true,
          allowUpdateTickets: true,
          allowPublicComments: false,
          allowInternalComments: true,
        },
      }),
      params(),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.zendeskActionPermissions.actions.create_ticket_public).toBe('deny')
    expect(body.zendeskActionPermissions.actions.create_ticket_internal).toBe('allow')

    const written = mocks.encryptConfig.mock.calls[0][0] as Record<string, unknown>
    expect(written.zendeskActionPermissions).toEqual(body.zendeskActionPermissions)
  })

  it('preserves unrelated stored tool-permission entries when projecting', async () => {
    mocks.decryptConfig.mockReturnValue({
      ...LEGACY_CONFIG,
      mcpToolPermissions: { custom_entry: 'deny' },
    })
    await PATCH(
      makePatchRequest({ zendeskActionPermissions: { version: 1, actions: DEFAULT_ZENDESK_ACTION_PERMISSIONS } }),
      params(),
    )
    const written = mocks.encryptConfig.mock.calls[0][0] as Record<string, unknown>
    expect(written.mcpToolPermissions).toEqual(
      expect.objectContaining({ custom_entry: 'deny', create_ticket: 'allow', update_ticket: 'allow' })
    )
  })

  it('preserves credentials in the updated config', async () => {
    await PATCH(
      makePatchRequest({ zendeskActionPermissions: { version: 1, actions: DEFAULT_ZENDESK_ACTION_PERMISSIONS } }),
      params(),
    )
    const written = mocks.encryptConfig.mock.calls[0][0] as Record<string, unknown>
    expect(written.subdomain).toBe('test')
    expect(written.email).toBe('a@b.com')
    expect(written.apiToken).toBe('tok')
  })

  it('returns 400 for an invalid canonical payload', async () => {
    const res = await PATCH(
      makePatchRequest({ zendeskActionPermissions: { version: 1, actions: { search_tickets: 'allow' } } }),
      params(),
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 for an invalid legacy permissions payload', async () => {
    const res = await PATCH(
      makePatchRequest({ permissions: { allowRead: 'yes' } }),
      params(),
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 when neither shape is provided', async () => {
    const res = await PATCH(makePatchRequest({}), params())
    expect(res.status).toBe(400)
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

  it('returns 404 when update affects 0 rows', async () => {
    mocks.connectorService.updateManyByIdAndUserId.mockResolvedValue({ count: 0 })
    const res = await PATCH(makePatchRequest({ zendeskActionPermissions: { version: 1, actions: DEFAULT_ZENDESK_ACTION_PERMISSIONS } }), params())
    expect(res.status).toBe(404)
  })

  it('returns 400 when encryption fails', async () => {
    mocks.encryptConfig.mockImplementation(() => { throw new Error('too large') })
    const res = await PATCH(makePatchRequest({ zendeskActionPermissions: { version: 1, actions: DEFAULT_ZENDESK_ACTION_PERMISSIONS } }), params())
    expect(res.status).toBe(400)
  })

  it('returns 404 when user is not found', async () => {
    mocks.userService.findIdBySlug.mockResolvedValue(null)
    const res = await PATCH(makePatchRequest({ zendeskActionPermissions: { version: 1, actions: DEFAULT_ZENDESK_ACTION_PERMISSIONS } }), params())
    expect(res.status).toBe(404)
  })

  it('returns 404 when connector is not found', async () => {
    mocks.connectorService.findByIdAndUserId.mockResolvedValue(null)
    const res = await PATCH(makePatchRequest({ zendeskActionPermissions: { version: 1, actions: DEFAULT_ZENDESK_ACTION_PERMISSIONS } }), params())
    expect(res.status).toBe(404)
  })

  it('returns 400 when connector is not zendesk', async () => {
    mocks.connectorService.findByIdAndUserId.mockResolvedValue({ ...CONNECTOR, type: 'linear' })
    const res = await PATCH(makePatchRequest({ zendeskActionPermissions: { version: 1, actions: DEFAULT_ZENDESK_ACTION_PERMISSIONS } }), params())
    expect(res.status).toBe(400)
  })

  it('returns 400 when body is not an object', async () => {
    const res = await PATCH(makePatchRequest(null), params())
    expect(res.status).toBe(400)
  })

  it('returns 500 when decryption fails', async () => {
    mocks.decryptConfig.mockImplementation(() => { throw new Error('bad') })
    const res = await PATCH(makePatchRequest({ zendeskActionPermissions: { version: 1, actions: DEFAULT_ZENDESK_ACTION_PERMISSIONS } }), params())
    expect(res.status).toBe(500)
  })
})
