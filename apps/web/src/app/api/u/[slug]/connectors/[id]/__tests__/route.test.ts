import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock state
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const findIdBySlugMock = vi.fn()
  const findByIdAndUserIdMock = vi.fn()
  const findByIdMock = vi.fn()
  const updateManyByIdAndUserIdMock = vi.fn()
  const deleteManyByIdAndUserIdMock = vi.fn()
  const auditEventMock = vi.fn()
  const decryptConfigMock = vi.fn()
  const encryptConfigMock = vi.fn()
  const getConnectorAuthTypeMock = vi.fn()
  const getConnectorOAuthConfigMock = vi.fn()
  const mergeConnectorConfigWithPreservedOAuthMock = vi.fn()
  const resolveLinearOAuthActorMock = vi.fn()
  const validateConnectorTypeMock = vi.fn()
  const validateConnectorConfigMock = vi.fn()
  const validateConnectorNameMock = vi.fn()

  return {
    findIdBySlugMock,
    findByIdAndUserIdMock,
    findByIdMock,
    updateManyByIdAndUserIdMock,
    deleteManyByIdAndUserIdMock,
    auditEventMock,
    decryptConfigMock,
    encryptConfigMock,
    getConnectorAuthTypeMock,
    getConnectorOAuthConfigMock,
    mergeConnectorConfigWithPreservedOAuthMock,
    resolveLinearOAuthActorMock,
    validateConnectorTypeMock,
    validateConnectorConfigMock,
    validateConnectorNameMock,
  }
})

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/runtime/capabilities', () => ({
  getRuntimeCapabilities: () => ({ connectors: true, csrf: false }),
}))

vi.mock('@/lib/runtime/mode', () => ({
  isDesktop: () => false,
  getRuntimeMode: () => 'web',
}))

vi.mock('@/lib/runtime/session', () => ({
  getSession: () =>
    Promise.resolve({
      user: { id: 'user-1', email: 'alice@test.com', slug: 'alice', role: 'USER' },
      sessionId: 'session-1',
    }),
}))

vi.mock('@/lib/csrf', () => ({
  validateSameOrigin: () => ({ ok: true }),
}))

vi.mock('@/lib/runtime/require-capability', () => ({
  requireCapability: () => null,
}))

vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
  validateDesktopToken: () => true,
}))

vi.mock('@/lib/auth', () => ({
  auditEvent: (...args: unknown[]) => mocks.auditEventMock(...args),
}))

vi.mock('@/lib/services', () => ({
  connectorService: {
    findByIdAndUserId: (...args: unknown[]) => mocks.findByIdAndUserIdMock(...args),
    findById: (...args: unknown[]) => mocks.findByIdMock(...args),
    updateManyByIdAndUserId: (...args: unknown[]) => mocks.updateManyByIdAndUserIdMock(...args),
    deleteManyByIdAndUserId: (...args: unknown[]) => mocks.deleteManyByIdAndUserIdMock(...args),
  },
  userService: {
    findIdBySlug: (...args: unknown[]) => mocks.findIdBySlugMock(...args),
  },
}))

vi.mock('@/lib/connectors/crypto', () => ({
  decryptConfig: (...args: unknown[]) => mocks.decryptConfigMock(...args),
  encryptConfig: (...args: unknown[]) => mocks.encryptConfigMock(...args),
}))

vi.mock('@/lib/connectors/linear', () => ({
  resolveLinearOAuthActor: (...args: unknown[]) => mocks.resolveLinearOAuthActorMock(...args),
}))

vi.mock('@/lib/connectors/oauth-config', () => ({
  getConnectorAuthType: (...args: unknown[]) => mocks.getConnectorAuthTypeMock(...args),
  getConnectorOAuthConfig: (...args: unknown[]) => mocks.getConnectorOAuthConfigMock(...args),
  mergeConnectorConfigWithPreservedOAuth: (...args: unknown[]) =>
    mocks.mergeConnectorConfigWithPreservedOAuthMock(...args),
}))

vi.mock('@/lib/connectors/types', () => ({
  CONNECTOR_TYPES: ['linear', 'notion', 'zendesk', 'ahrefs', 'umami', 'custom'],
  isSingleInstanceConnectorType: (type: string) =>
    ['linear', 'notion', 'zendesk', 'ahrefs', 'umami'].includes(type),
}))

vi.mock('@/lib/connectors/validators', () => ({
  validateConnectorType: (...args: unknown[]) => mocks.validateConnectorTypeMock(...args),
  validateConnectorConfig: (...args: unknown[]) => mocks.validateConnectorConfigMock(...args),
  validateConnectorName: (...args: unknown[]) => mocks.validateConnectorNameMock(...args),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost'), init)
}

function idParams(slug = 'alice', id = 'conn-1') {
  return { params: Promise.resolve({ slug, id }) }
}

const NOW = new Date('2025-01-15T12:00:00Z')
const UPDATED = new Date('2025-01-16T08:00:00Z')

function makeConnectorRecord(overrides: Partial<{
  id: string
  userId: string
  type: string
  name: string
  config: string
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}> = {}) {
  return {
    id: overrides.id ?? 'conn-1',
    userId: overrides.userId ?? 'user-1',
    type: overrides.type ?? 'notion',
    name: overrides.name ?? 'My Notion',
    config: overrides.config ?? 'encrypted-config',
    enabled: overrides.enabled ?? true,
    createdAt: overrides.createdAt ?? NOW,
    updatedAt: overrides.updatedAt ?? UPDATED,
  }
}

function setupDefaultMocks() {
  mocks.findIdBySlugMock.mockResolvedValue({ id: 'user-1' })
  mocks.findByIdAndUserIdMock.mockResolvedValue(makeConnectorRecord())
  mocks.findByIdMock.mockResolvedValue(makeConnectorRecord())
  mocks.updateManyByIdAndUserIdMock.mockResolvedValue({ count: 1 })
  mocks.deleteManyByIdAndUserIdMock.mockResolvedValue({ count: 1 })
  mocks.auditEventMock.mockResolvedValue(undefined)
  mocks.decryptConfigMock.mockReturnValue({ apiKey: 'key-123' })
  mocks.encryptConfigMock.mockReturnValue('encrypted-updated')
  mocks.getConnectorAuthTypeMock.mockReturnValue('manual')
  mocks.getConnectorOAuthConfigMock.mockReturnValue(null)
  mocks.mergeConnectorConfigWithPreservedOAuthMock.mockImplementation(
    ({ nextConfig }: { nextConfig: Record<string, unknown> }) => nextConfig,
  )
  mocks.resolveLinearOAuthActorMock.mockReturnValue(undefined)
  mocks.validateConnectorTypeMock.mockReturnValue(true)
  mocks.validateConnectorConfigMock.mockReturnValue({ valid: true })
  mocks.validateConnectorNameMock.mockReturnValue({ valid: true })
}

// ---------------------------------------------------------------------------
// GET /api/u/[slug]/connectors/[id]
// ---------------------------------------------------------------------------

describe('GET /api/u/[slug]/connectors/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupDefaultMocks()
  })

  it('returns connector detail with decrypted config', async () => {
    const { GET } = await import('../route')
    const res = await GET(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1'),
      idParams(),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      id: 'conn-1',
      type: 'notion',
      name: 'My Notion',
      config: { apiKey: 'key-123' },
      enabled: true,
      authType: 'manual',
      oauthConnected: false,
      createdAt: NOW.toISOString(),
      updatedAt: UPDATED.toISOString(),
    })

    expect(mocks.decryptConfigMock).toHaveBeenCalledWith('encrypted-config')
  })

  it('returns 404 when user is not found', async () => {
    mocks.findIdBySlugMock.mockResolvedValue(null)

    const { GET } = await import('../route')
    const res = await GET(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1'),
      idParams(),
    )

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('user_not_found')
  })

  it('returns 404 when connector is not found', async () => {
    mocks.findByIdAndUserIdMock.mockResolvedValue(null)

    const { GET } = await import('../route')
    const res = await GET(
      makeRequest('http://localhost/api/u/alice/connectors/missing'),
      idParams('alice', 'missing'),
    )

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('connector_not_found')
  })

  it('returns 500 when config decryption fails (corrupted)', async () => {
    mocks.decryptConfigMock.mockImplementation(() => {
      throw new Error('decrypt failed')
    })

    const { GET } = await import('../route')
    const res = await GET(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1'),
      idParams(),
    )

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('config_corrupted')
  })
})

// ---------------------------------------------------------------------------
// PATCH /api/u/[slug]/connectors/[id]
// ---------------------------------------------------------------------------

describe('PATCH /api/u/[slug]/connectors/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupDefaultMocks()
  })

  it('updates connector name', async () => {
    const updatedRecord = makeConnectorRecord({ name: 'Renamed' })
    mocks.findByIdMock.mockResolvedValue(updatedRecord)

    const { PATCH } = await import('../route')
    const res = await PATCH(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed' }),
      }),
      idParams(),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe('Renamed')
    expect(mocks.updateManyByIdAndUserIdMock).toHaveBeenCalledWith(
      'conn-1',
      'user-1',
      expect.objectContaining({ name: 'Renamed' }),
    )
    expect(mocks.auditEventMock).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      action: 'connector.updated',
      metadata: { connectorId: 'conn-1', fields: ['name'] },
    })
  })

  it('updates enabled flag', async () => {
    const updatedRecord = makeConnectorRecord({ enabled: false })
    mocks.findByIdMock.mockResolvedValue(updatedRecord)

    const { PATCH } = await import('../route')
    const res = await PATCH(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      }),
      idParams(),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.enabled).toBe(false)
    expect(mocks.updateManyByIdAndUserIdMock).toHaveBeenCalledWith(
      'conn-1',
      'user-1',
      expect.objectContaining({ enabled: false }),
    )
  })

  it('updates config with merge', async () => {
    const mergedConfig = { apiKey: 'new-key', extra: 'value' }
    mocks.mergeConnectorConfigWithPreservedOAuthMock.mockReturnValue(mergedConfig)
    mocks.findByIdMock.mockResolvedValue(makeConnectorRecord())

    const { PATCH } = await import('../route')
    const res = await PATCH(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ config: { apiKey: 'new-key', extra: 'value' } }),
      }),
      idParams(),
    )

    expect(res.status).toBe(200)
    expect(mocks.mergeConnectorConfigWithPreservedOAuthMock).toHaveBeenCalledWith({
      connectorType: 'notion',
      currentConfig: { apiKey: 'key-123' },
      nextConfig: { apiKey: 'new-key', extra: 'value' },
    })
    expect(mocks.encryptConfigMock).toHaveBeenCalledWith(mergedConfig)
    expect(mocks.updateManyByIdAndUserIdMock).toHaveBeenCalledWith(
      'conn-1',
      'user-1',
      expect.objectContaining({ config: 'encrypted-updated' }),
    )
  })

  it('returns 400 for invalid JSON', async () => {
    const { PATCH } = await import('../route')
    const res = await PATCH(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: '{bad json',
      }),
      idParams(),
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_json')
  })

  it('returns 400 when body is an array', async () => {
    const { PATCH } = await import('../route')
    const res = await PATCH(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify([1, 2]),
      }),
      idParams(),
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_body')
  })

  it('returns 400 for invalid name', async () => {
    mocks.validateConnectorNameMock.mockReturnValue({
      valid: false,
      error: 'Name cannot be empty',
    })

    const { PATCH } = await import('../route')
    const res = await PATCH(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      }),
      idParams(),
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_name')
  })

  it('returns 400 when enabled is not a boolean', async () => {
    const { PATCH } = await import('../route')
    const res = await PATCH(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: 'yes' }),
      }),
      idParams(),
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_enabled')
  })

  it('returns 400 when config is not an object', async () => {
    const { PATCH } = await import('../route')
    const res = await PATCH(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ config: 'not-an-object' }),
      }),
      idParams(),
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_config')
  })

  it('returns 400 when config validation fails', async () => {
    mocks.validateConnectorConfigMock.mockReturnValue({
      valid: false,
      missing: ['apiKey'],
    })
    mocks.mergeConnectorConfigWithPreservedOAuthMock.mockReturnValue({ wrong: 'field' })

    const { PATCH } = await import('../route')
    const res = await PATCH(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ config: { wrong: 'field' } }),
      }),
      idParams(),
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_config')
    expect(body.message).toContain('apiKey')
  })

  it('returns 400 when no updatable fields are provided', async () => {
    const { PATCH } = await import('../route')
    const res = await PATCH(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
      idParams(),
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('no_fields')
  })

  it('returns 404 when user is not found', async () => {
    mocks.findIdBySlugMock.mockResolvedValue(null)

    const { PATCH } = await import('../route')
    const res = await PATCH(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      }),
      idParams(),
    )

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('user_not_found')
  })

  it('returns 404 when connector is not found', async () => {
    mocks.findByIdAndUserIdMock.mockResolvedValue(null)

    const { PATCH } = await import('../route')
    const res = await PATCH(
      makeRequest('http://localhost/api/u/alice/connectors/missing', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      }),
      idParams('alice', 'missing-conn'),
    )

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('connector_not_found')
  })

  it('returns 500 when existing config is corrupted', async () => {
    mocks.decryptConfigMock.mockImplementation(() => {
      throw new Error('corrupted')
    })

    const { PATCH } = await import('../route')
    const res = await PATCH(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      }),
      idParams(),
    )

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('config_corrupted')
  })

  it('returns 400 when encryption fails during config update', async () => {
    mocks.encryptConfigMock.mockImplementation(() => {
      throw new Error('Connector configuration exceeds maximum size')
    })
    mocks.mergeConnectorConfigWithPreservedOAuthMock.mockReturnValue({ apiKey: 'x' })

    const { PATCH } = await import('../route')
    const res = await PATCH(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ config: { apiKey: 'x' } }),
      }),
      idParams(),
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_config')
    expect(body.message).toBe('Connector configuration exceeds maximum size')
  })

  it('returns 404 when concurrent ownership change causes updateMany to match 0', async () => {
    mocks.updateManyByIdAndUserIdMock.mockResolvedValue({ count: 0 })

    const { PATCH } = await import('../route')
    const res = await PATCH(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      }),
      idParams(),
    )

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('connector_not_found')
  })

  it('returns 500 when connector type is invalid in database during config update', async () => {
    mocks.validateConnectorTypeMock.mockReturnValue(false)

    const { PATCH } = await import('../route')
    const res = await PATCH(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ config: { apiKey: 'x' } }),
      }),
      idParams(),
    )

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('invalid_connector_type')
  })
})

// ---------------------------------------------------------------------------
// DELETE /api/u/[slug]/connectors/[id]
// ---------------------------------------------------------------------------

describe('DELETE /api/u/[slug]/connectors/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupDefaultMocks()
  })

  it('deletes a connector and audits the event', async () => {
    const { DELETE } = await import('../route')
    const res = await DELETE(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1', { method: 'DELETE' }),
      idParams(),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true })

    expect(mocks.deleteManyByIdAndUserIdMock).toHaveBeenCalledWith('conn-1', 'user-1')
    expect(mocks.auditEventMock).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      action: 'connector.deleted',
      metadata: { connectorId: 'conn-1' },
    })
  })

  it('returns 404 when connector does not exist', async () => {
    mocks.deleteManyByIdAndUserIdMock.mockResolvedValue({ count: 0 })

    const { DELETE } = await import('../route')
    const res = await DELETE(
      makeRequest('http://localhost/api/u/alice/connectors/missing', { method: 'DELETE' }),
      idParams('alice', 'missing'),
    )

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('connector_not_found')
    expect(mocks.auditEventMock).not.toHaveBeenCalled()
  })

  it('returns 404 when user is not found', async () => {
    mocks.findIdBySlugMock.mockResolvedValue(null)

    const { DELETE } = await import('../route')
    const res = await DELETE(
      makeRequest('http://localhost/api/u/alice/connectors/conn-1', { method: 'DELETE' }),
      idParams(),
    )

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('user_not_found')
    expect(mocks.auditEventMock).not.toHaveBeenCalled()
  })
})
