import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockEncryptConfig = vi.fn()
const mockDecryptConfig = vi.fn()
const mockPrismaUpsert = vi.fn()
const mockPrismaFindUnique = vi.fn()

vi.mock('@/lib/connectors/crypto', () => ({
  encryptConfig: (...args: unknown[]) => mockEncryptConfig(...args),
  decryptConfig: (...args: unknown[]) => mockDecryptConfig(...args),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    externalIntegration: {
      findUnique: (...args: unknown[]) => mockPrismaFindUnique(...args),
      upsert: (...args: unknown[]) => mockPrismaUpsert(...args),
    },
  },
}))

const originalGoogleClientId = process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_ID
const originalGoogleClientSecret = process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_SECRET

describe('googleWorkspaceService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEncryptConfig.mockImplementation((config: Record<string, unknown>) => `enc:${JSON.stringify(config)}`)
    mockDecryptConfig.mockImplementation((encrypted: string) => {
      const raw = encrypted.replace(/^enc:/, '')
      return JSON.parse(raw)
    })
    mockPrismaFindUnique.mockResolvedValue(null)
    mockPrismaUpsert.mockImplementation(({ create, update }: { create: unknown; update: unknown }) => {
      const result = update ?? create
      return Promise.resolve({
        ...result,
        version: 1,
        createdAt: new Date('2026-04-25T10:00:00Z'),
        updatedAt: new Date('2026-04-25T10:00:00Z'),
      })
    })

    if (originalGoogleClientId === undefined) {
      delete process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_ID
    } else {
      process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_ID = originalGoogleClientId
    }
    if (originalGoogleClientSecret === undefined) {
      delete process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_SECRET
    } else {
      process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_SECRET = originalGoogleClientSecret
    }
  })

  it('seeds env credentials into DB when no persisted row exists', async () => {
    process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_ID = 'env-client-id'
    process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_SECRET = 'env-client-secret'

    const { getResolvedCredentials } = await import('@/lib/services/google-workspace')
    const result = await getResolvedCredentials()

    expect(result).toEqual({
      clientId: 'env-client-id',
      clientSecret: 'env-client-secret',
    })
    expect(mockPrismaUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'google_workspace' },
        create: expect.objectContaining({
          key: 'google_workspace',
          config: expect.stringContaining('env-client-id'),
        }),
        update: expect.objectContaining({
          config: expect.stringContaining('env-client-id'),
        }),
      }),
    )
  })

  it('returns null when no row exists and no env credentials are set', async () => {
    delete process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_ID
    delete process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_SECRET

    const { getResolvedCredentials } = await import('@/lib/services/google-workspace')
    const result = await getResolvedCredentials()

    expect(result).toBeNull()
    expect(mockPrismaUpsert).not.toHaveBeenCalled()
  })

  it('uses persisted credentials and does not reseed when a row exists', async () => {
    process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_ID = 'env-client-id'
    process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_SECRET = 'env-client-secret'

    mockPrismaFindUnique.mockResolvedValue({
      key: 'google_workspace',
      config: 'enc:{"clientId":"persisted-id","clientSecret":"persisted-secret"}',
      state: null,
      version: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const { getResolvedCredentials } = await import('@/lib/services/google-workspace')
    const result = await getResolvedCredentials()

    expect(result).toEqual({
      clientId: 'persisted-id',
      clientSecret: 'persisted-secret',
    })
    expect(mockPrismaUpsert).not.toHaveBeenCalled()
  })

  it('returns null for explicitly cleared config and does not reseed even when env is set', async () => {
    process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_ID = 'env-client-id'
    process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_SECRET = 'env-client-secret'

    mockPrismaFindUnique.mockResolvedValue({
      key: 'google_workspace',
      config: 'enc:{}',
      state: null,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const { getResolvedCredentials } = await import('@/lib/services/google-workspace')
    const result = await getResolvedCredentials()

    expect(result).toBeNull()
    expect(mockPrismaUpsert).not.toHaveBeenCalled()
  })

  it('preserves existing secret when saving with blank secret', async () => {
    mockPrismaFindUnique.mockResolvedValue({
      key: 'google_workspace',
      config: 'enc:{"clientId":"old-id","clientSecret":"old-secret"}',
      state: null,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const { saveIntegrationConfig } = await import('@/lib/services/google-workspace')
    await saveIntegrationConfig({ clientId: 'new-id' })

    expect(mockEncryptConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({
        clientId: 'new-id',
        clientSecret: 'old-secret',
      })
    )
  })

  it('saves new secret when provided', async () => {
    mockPrismaFindUnique.mockResolvedValue({
      key: 'google_workspace',
      config: 'enc:{"clientId":"old-id","clientSecret":"old-secret"}',
      state: null,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const { saveIntegrationConfig } = await import('@/lib/services/google-workspace')
    await saveIntegrationConfig({ clientId: 'new-id', clientSecret: 'new-secret' })

    expect(mockEncryptConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({
        clientId: 'new-id',
        clientSecret: 'new-secret',
      })
    )
  })

  it('creates a new row when none exists during save', async () => {
    mockPrismaFindUnique.mockResolvedValue(null)

    const { saveIntegrationConfig } = await import('@/lib/services/google-workspace')
    await saveIntegrationConfig({ clientId: 'new-id', clientSecret: 'new-secret' })

    expect(mockPrismaUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          key: 'google_workspace',
          config: expect.stringContaining('enc:'),
        }),
      })
    )
  })

  it('clearIntegration stores an empty encrypted config', async () => {
    const { clearIntegration } = await import('@/lib/services/google-workspace')
    await clearIntegration()

    expect(mockEncryptConfig).toHaveBeenLastCalledWith({})
  })

  it('isConfigured returns true when both clientId and clientSecret exist', async () => {
    mockPrismaFindUnique.mockResolvedValue({
      key: 'google_workspace',
      config: 'enc:{"clientId":"old-id","clientSecret":"old-secret"}',
      state: null,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const { isConfigured } = await import('@/lib/services/google-workspace')
    const result = await isConfigured()

    expect(result).toBe(true)
  })

  it('isConfigured returns false when config is missing secret', async () => {
    mockPrismaFindUnique.mockResolvedValue({
      key: 'google_workspace',
      config: 'enc:{"clientId":"id"}',
      state: null,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const { isConfigured } = await import('@/lib/services/google-workspace')
    const result = await isConfigured()

    expect(result).toBe(false)
  })

  it('isConfigured returns false when no row exists', async () => {
    mockPrismaFindUnique.mockResolvedValue(null)

    const { isConfigured } = await import('@/lib/services/google-workspace')
    const result = await isConfigured()

    expect(result).toBe(false)
  })

  describe('ensureIntegrationSeededFromEnv', () => {
    it('creates a row from env credentials when none exists', async () => {
      process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_ID = 'env-id'
      process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_SECRET = 'env-secret'

      const { ensureIntegrationSeededFromEnv } = await import('@/lib/services/google-workspace')
      const result = await ensureIntegrationSeededFromEnv()

      expect(result).not.toBeNull()
      expect(mockPrismaUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'google_workspace' },
          create: expect.objectContaining({
            key: 'google_workspace',
            config: expect.stringContaining('env-id'),
          }),
          update: expect.objectContaining({
            config: expect.stringContaining('env-id'),
          }),
        }),
      )
    })

    it('returns existing row without upsert when row already exists', async () => {
      process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_ID = 'env-id'
      process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_SECRET = 'env-secret'

      mockPrismaFindUnique.mockResolvedValue({
        key: 'google_workspace',
        config: 'enc:{"clientId":"persisted-id","clientSecret":"persisted-secret"}',
        state: null,
        version: 3,
        createdAt: new Date('2026-04-25T10:00:00Z'),
        updatedAt: new Date('2026-04-25T11:00:00Z'),
      })

      const { ensureIntegrationSeededFromEnv } = await import('@/lib/services/google-workspace')
      const result = await ensureIntegrationSeededFromEnv()

      expect(result).toMatchObject({
        singletonKey: 'google_workspace',
        version: 3,
      })
      expect(mockPrismaUpsert).not.toHaveBeenCalled()
    })

    it('returns existing cleared row without upsert and does not reseed from env', async () => {
      process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_ID = 'env-id'
      process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_SECRET = 'env-secret'

      mockPrismaFindUnique.mockResolvedValue({
        key: 'google_workspace',
        config: 'enc:{}',
        state: null,
        version: 2,
        createdAt: new Date('2026-04-25T10:00:00Z'),
        updatedAt: new Date('2026-04-25T10:00:00Z'),
      })

      const { ensureIntegrationSeededFromEnv } = await import('@/lib/services/google-workspace')
      const result = await ensureIntegrationSeededFromEnv()

      expect(result).toMatchObject({
        singletonKey: 'google_workspace',
        version: 2,
      })
      expect(mockPrismaUpsert).not.toHaveBeenCalled()
    })

    it('returns null when no row exists and no env credentials are set', async () => {
      delete process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_ID
      delete process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_SECRET

      const { ensureIntegrationSeededFromEnv } = await import('@/lib/services/google-workspace')
      const result = await ensureIntegrationSeededFromEnv()

      expect(result).toBeNull()
      expect(mockPrismaUpsert).not.toHaveBeenCalled()
    })
  })
})
