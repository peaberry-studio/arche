import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock state
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const findIdBySlugMock = vi.fn()
  const findManyByUserIdMock = vi.fn()
  const findFirstByUserIdAndTypeMock = vi.fn()
  const createMock = vi.fn()
  const auditEventMock = vi.fn()
  const decryptConfigMock = vi.fn()
  const encryptConfigMock = vi.fn()
  const validateConnectorConfigMock = vi.fn()

  return {
    findIdBySlugMock,
    findManyByUserIdMock,
    findFirstByUserIdAndTypeMock,
    createMock,
    auditEventMock,
    decryptConfigMock,
    encryptConfigMock,
    validateConnectorConfigMock,
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
    findManyByUserId: (...args: unknown[]) => mocks.findManyByUserIdMock(...args),
    findFirstByUserIdAndType: (...args: unknown[]) => mocks.findFirstByUserIdAndTypeMock(...args),
    create: (...args: unknown[]) => mocks.createMock(...args),
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
  resolveLinearOAuthActor: () => undefined,
}))

vi.mock('@/lib/connectors/oauth-config', () => ({
  getConnectorAuthType: () => 'manual',
  getConnectorOAuthConfig: () => null,
}))

vi.mock('@/lib/connectors/types', () => ({
  CONNECTOR_TYPES: ['linear', 'notion', 'zendesk', 'ahrefs', 'umami', 'custom'],
  isSingleInstanceConnectorType: (type: string) =>
    ['linear', 'notion', 'zendesk', 'ahrefs', 'umami'].includes(type),
}))

vi.mock('@/lib/connectors/validators', () => ({
  validateConnectorType: (type: string) =>
    ['linear', 'notion', 'zendesk', 'ahrefs', 'umami', 'custom'].includes(type),
  validateConnectorConfig: (...args: unknown[]) => mocks.validateConnectorConfigMock(...args),
  validateConnectorName: (name: unknown) => {
    if (typeof name !== 'string' || name.trim().length === 0) {
      return { valid: false, error: 'Name cannot be empty' }
    }
    if (name.trim().length > 100) {
      return { valid: false, error: 'Name exceeds maximum length of 100' }
    }
    return { valid: true }
  },
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost'), init)
}

function slugParams(slug = 'alice') {
  return { params: Promise.resolve({ slug }) }
}

const NOW = new Date('2025-01-15T12:00:00Z')

function makeConnectorRow(overrides: Partial<{
  id: string
  type: string
  name: string
  enabled: boolean
  config: string
  createdAt: Date
}> = {}) {
  return {
    id: overrides.id ?? 'conn-1',
    type: overrides.type ?? 'notion',
    name: overrides.name ?? 'My Notion',
    enabled: overrides.enabled ?? true,
    config: overrides.config ?? 'encrypted-config',
    createdAt: overrides.createdAt ?? NOW,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/u/[slug]/connectors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findIdBySlugMock.mockResolvedValue({ id: 'user-1' })
    mocks.findManyByUserIdMock.mockResolvedValue([])
    mocks.decryptConfigMock.mockReturnValue({ apiKey: 'key-123' })
    mocks.auditEventMock.mockResolvedValue(undefined)
    mocks.validateConnectorConfigMock.mockReturnValue({ valid: true })
  })

  it('returns an empty list when user has no connectors', async () => {
    const { GET } = await import('../route')
    const res = await GET(
      makeRequest('http://localhost/api/u/alice/connectors'),
      slugParams(),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.connectors).toEqual([])
    expect(mocks.findManyByUserIdMock).toHaveBeenCalledWith('user-1')
  })

  it('lists connectors with computed status', async () => {
    const row = makeConnectorRow()
    mocks.findManyByUserIdMock.mockResolvedValue([row])

    const { GET } = await import('../route')
    const res = await GET(
      makeRequest('http://localhost/api/u/alice/connectors'),
      slugParams(),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.connectors).toHaveLength(1)
    expect(body.connectors[0]).toMatchObject({
      id: 'conn-1',
      type: 'notion',
      name: 'My Notion',
      enabled: true,
      status: 'ready',
      authType: 'manual',
      oauthConnected: false,
      createdAt: NOW.toISOString(),
    })
  })

  it('returns disabled status for disabled connectors', async () => {
    const row = makeConnectorRow({ enabled: false })
    mocks.findManyByUserIdMock.mockResolvedValue([row])

    const { GET } = await import('../route')
    const res = await GET(
      makeRequest('http://localhost/api/u/alice/connectors'),
      slugParams(),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.connectors[0].status).toBe('disabled')
  })

  it('handles decryption errors gracefully and falls back to manual authType', async () => {
    mocks.decryptConfigMock.mockImplementation(() => {
      throw new Error('decrypt failed')
    })
    mocks.findManyByUserIdMock.mockResolvedValue([makeConnectorRow()])

    const { GET } = await import('../route')
    const res = await GET(
      makeRequest('http://localhost/api/u/alice/connectors'),
      slugParams(),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.connectors[0].authType).toBe('manual')
    expect(body.connectors[0].status).toBe('ready')
  })

  it('filters out connectors with invalid type', async () => {
    const validRow = makeConnectorRow({ id: 'conn-1', type: 'notion' })
    const invalidRow = makeConnectorRow({ id: 'conn-2', type: 'unknown_type' })
    mocks.findManyByUserIdMock.mockResolvedValue([validRow, invalidRow])

    const { GET } = await import('../route')
    const res = await GET(
      makeRequest('http://localhost/api/u/alice/connectors'),
      slugParams(),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.connectors).toHaveLength(1)
    expect(body.connectors[0].id).toBe('conn-1')
  })

  it('returns 404 for unknown user', async () => {
    mocks.findIdBySlugMock.mockResolvedValue(null)

    const { GET } = await import('../route')
    const res = await GET(
      makeRequest('http://localhost/api/u/alice/connectors'),
      slugParams(),
    )

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('user_not_found')
  })
})

describe('POST /api/u/[slug]/connectors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findIdBySlugMock.mockResolvedValue({ id: 'user-1' })
    mocks.encryptConfigMock.mockReturnValue('encrypted-config')
    mocks.findFirstByUserIdAndTypeMock.mockResolvedValue(null)
    mocks.auditEventMock.mockResolvedValue(undefined)
    mocks.validateConnectorConfigMock.mockReturnValue({ valid: true })
    mocks.createMock.mockResolvedValue({
      id: 'conn-new',
      type: 'notion',
      name: 'My Notion',
      enabled: true,
      createdAt: NOW,
    })
  })

  it('creates a connector successfully and returns 201', async () => {
    const { POST } = await import('../route')
    const res = await POST(
      makeRequest('http://localhost/api/u/alice/connectors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'notion',
          name: 'My Notion',
          config: { apiKey: 'ntn_xxx' },
        }),
      }),
      slugParams(),
    )

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toMatchObject({
      id: 'conn-new',
      type: 'notion',
      name: 'My Notion',
      enabled: true,
      createdAt: NOW.toISOString(),
    })

    expect(mocks.createMock).toHaveBeenCalledWith({
      userId: 'user-1',
      type: 'notion',
      name: 'My Notion',
      config: 'encrypted-config',
      enabled: true,
    })

    expect(mocks.auditEventMock).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      action: 'connector.created',
      metadata: { connectorId: 'conn-new', type: 'notion' },
    })
  })

  it('returns 400 for invalid JSON body', async () => {
    const { POST } = await import('../route')
    const res = await POST(
      makeRequest('http://localhost/api/u/alice/connectors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not valid json',
      }),
      slugParams(),
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_json')
  })

  it('returns 400 when body is not an object (array)', async () => {
    const { POST } = await import('../route')
    const res = await POST(
      makeRequest('http://localhost/api/u/alice/connectors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify([1, 2, 3]),
      }),
      slugParams(),
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_body')
  })

  it('returns 400 when required fields are missing', async () => {
    const { POST } = await import('../route')
    const res = await POST(
      makeRequest('http://localhost/api/u/alice/connectors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'notion' }),
      }),
      slugParams(),
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('missing_fields')
  })

  it('returns 400 when config is not an object', async () => {
    const { POST } = await import('../route')
    const res = await POST(
      makeRequest('http://localhost/api/u/alice/connectors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'notion', name: 'Test', config: 'string-config' }),
      }),
      slugParams(),
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_config')
  })

  it('returns 400 for invalid connector type', async () => {
    const { POST } = await import('../route')
    const res = await POST(
      makeRequest('http://localhost/api/u/alice/connectors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'bogus',
          name: 'Test',
          config: { apiKey: 'x' },
        }),
      }),
      slugParams(),
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_type')
  })

  it('returns 400 for invalid connector name (empty)', async () => {
    const { POST } = await import('../route')
    const res = await POST(
      makeRequest('http://localhost/api/u/alice/connectors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'notion',
          name: '   ',
          config: { apiKey: 'x' },
        }),
      }),
      slugParams(),
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_name')
  })

  it('returns 409 for duplicate single-instance connector', async () => {
    mocks.findFirstByUserIdAndTypeMock.mockResolvedValue({ id: 'existing-conn' })

    const { POST } = await import('../route')
    const res = await POST(
      makeRequest('http://localhost/api/u/alice/connectors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'notion',
          name: 'Duplicate Notion',
          config: { apiKey: 'x' },
        }),
      }),
      slugParams(),
    )

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('connector_already_exists')
  })

  it('allows duplicate custom connectors (multi-instance type)', async () => {
    mocks.createMock.mockResolvedValue({
      id: 'conn-custom-2',
      type: 'custom',
      name: 'Custom 2',
      enabled: true,
      createdAt: NOW,
    })

    const { POST } = await import('../route')
    const res = await POST(
      makeRequest('http://localhost/api/u/alice/connectors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'custom',
          name: 'Custom 2',
          config: { endpoint: 'https://example.com' },
        }),
      }),
      slugParams(),
    )

    expect(res.status).toBe(201)
    // findFirstByUserIdAndType should NOT be called for multi-instance types
    expect(mocks.findFirstByUserIdAndTypeMock).not.toHaveBeenCalled()
  })

  it('returns 400 when encryption fails', async () => {
    mocks.encryptConfigMock.mockImplementation(() => {
      throw new Error('Connector configuration exceeds maximum size')
    })

    const { POST } = await import('../route')
    const res = await POST(
      makeRequest('http://localhost/api/u/alice/connectors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'notion',
          name: 'Encrypted fail',
          config: { apiKey: 'x' },
        }),
      }),
      slugParams(),
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_config')
    expect(body.message).toBe('Connector configuration exceeds maximum size')
  })

  it('returns 404 for unknown user on POST', async () => {
    mocks.findIdBySlugMock.mockResolvedValue(null)

    const { POST } = await import('../route')
    const res = await POST(
      makeRequest('http://localhost/api/u/alice/connectors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'notion',
          name: 'Test',
          config: { apiKey: 'x' },
        }),
      }),
      slugParams(),
    )

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('user_not_found')
  })

  it('returns 400 when config validation fails', async () => {
    mocks.validateConnectorConfigMock.mockReturnValueOnce({
      valid: false,
      missing: ['apiKey'],
    })

    const { POST } = await import('../route')
    const res = await POST(
      makeRequest('http://localhost/api/u/alice/connectors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'notion',
          name: 'Test',
          config: { wrong: 'field' },
        }),
      }),
      slugParams(),
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_config')
    expect(body.message).toContain('apiKey')
  })
})
