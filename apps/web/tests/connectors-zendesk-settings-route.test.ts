import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetAuthenticatedUser = vi.fn()
const mockAuditEvent = vi.fn()
vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
  auditEvent: (...args: unknown[]) => mockAuditEvent(...args),
}))

const mockValidateSameOrigin = vi.fn()
vi.mock('@/lib/csrf', () => ({
  validateSameOrigin: (...args: unknown[]) => mockValidateSameOrigin(...args),
}))

const mockDecryptConfig = vi.fn()
const mockEncryptConfig = vi.fn()
vi.mock('@/lib/connectors/crypto', () => ({
  decryptConfig: (...args: unknown[]) => mockDecryptConfig(...args),
  encryptConfig: (...args: unknown[]) => mockEncryptConfig(...args),
}))

const mockFindIdBySlug = vi.fn()
const mockFindByIdAndUserId = vi.fn()
const mockUpdateManyByIdAndUserId = vi.fn()
vi.mock('@/lib/services', () => ({
  userService: {
    findIdBySlug: (...args: unknown[]) => mockFindIdBySlug(...args),
  },
  connectorService: {
    findByIdAndUserId: (...args: unknown[]) => mockFindByIdAndUserId(...args),
    updateManyByIdAndUserId: (...args: unknown[]) => mockUpdateManyByIdAndUserId(...args),
  },
}))

function session(slug: string) {
  return {
    user: { id: 'user-1', email: 'alice@example.com', slug, role: 'USER' },
    sessionId: 'session-1',
  }
}

async function callGetRoute(slug = 'alice', id = 'conn-zendesk-1') {
  const { GET } = await import('@/app/api/u/[slug]/connectors/[id]/zendesk-settings/route')
  const request = new Request(`http://localhost/api/u/${slug}/connectors/${id}/zendesk-settings`, {
    method: 'GET',
    headers: { host: 'localhost' },
  })

  const response = await GET(request as never, { params: Promise.resolve({ slug, id }) })
  return { status: response.status, body: await response.json() }
}

async function callPatchRoute(
  body: unknown,
  slug = 'alice',
  id = 'conn-zendesk-1',
  headers?: Record<string, string>
) {
  const { PATCH } = await import('@/app/api/u/[slug]/connectors/[id]/zendesk-settings/route')
  const request = new Request(`http://localhost/api/u/${slug}/connectors/${id}/zendesk-settings`, {
    method: 'PATCH',
    headers: {
      host: 'localhost',
      origin: 'http://localhost',
      'content-type': 'application/json',
      ...(headers ?? {}),
    },
    body: JSON.stringify(body),
  })

  const response = await PATCH(request as never, { params: Promise.resolve({ slug, id }) })
  return { status: response.status, body: await response.json() }
}

describe('Zendesk connector settings route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    mockGetAuthenticatedUser.mockResolvedValue(session('alice'))
    mockValidateSameOrigin.mockReturnValue({ ok: true })
    mockFindIdBySlug.mockResolvedValue({ id: 'user-1' })
    mockFindByIdAndUserId.mockResolvedValue({
      id: 'conn-zendesk-1',
      userId: 'user-1',
      type: 'zendesk',
      name: 'Zendesk',
      config: 'encrypted-config',
      enabled: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    mockDecryptConfig.mockReturnValue({
      subdomain: 'acme',
      email: 'agent@example.com',
      apiToken: 'token-123',
    })
    mockEncryptConfig.mockReturnValue('encrypted-updated-config')
    mockUpdateManyByIdAndUserId.mockResolvedValue({ count: 1 })
  })

  it('returns normalized default permissions without exposing credentials', async () => {
    const { status, body } = await callGetRoute()

    expect(status).toBe(200)
    expect(body).toEqual({
      permissions: {
        allowRead: true,
        allowCreateTickets: true,
        allowUpdateTickets: true,
        allowPublicComments: true,
        allowInternalComments: true,
      },
    })
  })

  it('updates Zendesk permissions while preserving the stored credentials', async () => {
    const nextPermissions = {
      allowRead: true,
      allowCreateTickets: false,
      allowUpdateTickets: true,
      allowPublicComments: false,
      allowInternalComments: true,
    }

    const { status, body } = await callPatchRoute({ permissions: nextPermissions })

    expect(status).toBe(200)
    expect(body).toEqual({ permissions: nextPermissions })
    expect(mockEncryptConfig).toHaveBeenCalledWith({
      subdomain: 'acme',
      email: 'agent@example.com',
      apiToken: 'token-123',
      permissions: nextPermissions,
    })
    expect(mockUpdateManyByIdAndUserId).toHaveBeenCalledWith('conn-zendesk-1', 'user-1', {
      config: 'encrypted-updated-config',
    })
    expect(mockAuditEvent).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      action: 'connector.zendesk_settings_updated',
      metadata: {
        connectorId: 'conn-zendesk-1',
        permissions: nextPermissions,
      },
    })
  })

  it('rejects incomplete permissions payloads', async () => {
    const { status, body } = await callPatchRoute({
      permissions: {
        allowRead: true,
      },
    })

    expect(status).toBe(400)
    expect(body).toEqual({
      error: 'invalid_permissions',
      message: 'allowCreateTickets is required',
    })
    expect(mockEncryptConfig).not.toHaveBeenCalled()
  })

  it('rejects ticket creation without any allowed comment visibility', async () => {
    const { status, body } = await callPatchRoute({
      permissions: {
        allowRead: true,
        allowCreateTickets: true,
        allowUpdateTickets: true,
        allowPublicComments: false,
        allowInternalComments: false,
      },
    })

    expect(status).toBe(400)
    expect(body).toEqual({
      error: 'invalid_permissions',
      message: 'Ticket creation requires public comments or internal notes to stay enabled.',
    })
    expect(mockEncryptConfig).not.toHaveBeenCalled()
  })

  it('rejects non-Zendesk connectors', async () => {
    mockFindByIdAndUserId.mockResolvedValueOnce({
      id: 'conn-custom-1',
      userId: 'user-1',
      type: 'custom',
      name: 'Custom',
      config: 'encrypted-config',
      enabled: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    const { status, body } = await callPatchRoute({
      permissions: {
        allowRead: true,
        allowCreateTickets: true,
        allowUpdateTickets: true,
        allowPublicComments: true,
        allowInternalComments: true,
      },
    }, 'alice', 'conn-custom-1')

    expect(status).toBe(400)
    expect(body).toEqual({ error: 'unsupported_connector' })
  })
})
