import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockEncryptConfig = vi.fn()
const mockDecryptConfig = vi.fn()
const mockPrismaUpsert = vi.fn()
const mockPrismaFindUnique = vi.fn()
const mockPrismaUpdateMany = vi.fn()

vi.mock('@/lib/connectors/crypto', () => ({
  encryptConfig: (...args: unknown[]) => mockEncryptConfig(...args),
  decryptConfig: (...args: unknown[]) => mockDecryptConfig(...args),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    externalIntegration: {
      findUnique: (...args: unknown[]) => mockPrismaFindUnique(...args),
      upsert: (...args: unknown[]) => mockPrismaUpsert(...args),
      updateMany: (...args: unknown[]) => mockPrismaUpdateMany(...args),
    },
  },
}))

function makeRow(config: string, state: unknown = {}) {
  return {
    key: 'kb_github_remote',
    config,
    state,
    version: 1,
    createdAt: new Date('2026-04-27T10:00:00Z'),
    updatedAt: new Date('2026-04-27T10:00:00Z'),
  }
}

describe('kbGithubRemoteService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
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
        createdAt: new Date('2026-04-27T10:00:00Z'),
        updatedAt: new Date('2026-04-27T10:00:00Z'),
      })
    })
    mockPrismaUpdateMany.mockResolvedValue({ count: 1 })
  })

  it('findIntegration returns null when no row exists', async () => {
    const { findIntegration } = await import('../kb-github-remote')
    const result = await findIntegration()
    expect(result).toBeNull()
  })

  it('findIntegration returns record with parsed state', async () => {
    mockPrismaFindUnique.mockResolvedValue(
      makeRow('enc:{"appId":"12345","privateKey":"-----BEGIN RSA PRIVATE KEY-----"}', {
        installationId: 99,
        repoFullName: 'owner/repo',
        repoCloneUrl: 'https://github.com/owner/repo.git',
        lastSyncAt: '2026-04-27T09:00:00Z',
        lastSyncStatus: 'success',
        remoteBranch: 'main',
      }),
    )

    const { findIntegration } = await import('../kb-github-remote')
    const result = await findIntegration()

    expect(result).toMatchObject({
      singletonKey: 'kb_github_remote',
      state: {
        installationId: 99,
        repoFullName: 'owner/repo',
        repoCloneUrl: 'https://github.com/owner/repo.git',
        lastSyncAt: '2026-04-27T09:00:00Z',
        lastSyncStatus: 'success',
        remoteBranch: 'main',
        lastError: null,
      },
    })
  })

  it('decryptIntegrationConfig returns config object', async () => {
    const { findIntegration, decryptIntegrationConfig } = await import('../kb-github-remote')
    mockPrismaFindUnique.mockResolvedValue(
      makeRow('enc:{"appId":"12345","privateKey":"pem-data","appSlug":"my-app"}'),
    )
    const record = await findIntegration()
    const config = decryptIntegrationConfig(record)

    expect(config).toEqual({
      appId: '12345',
      privateKey: 'pem-data',
      appSlug: 'my-app',
    })
  })

  it('decryptIntegrationConfig returns null on decryption failure', async () => {
    mockDecryptConfig.mockImplementation(() => {
      throw new Error('decryption failed')
    })

    const { decryptIntegrationConfig } = await import('../kb-github-remote')
    const result = decryptIntegrationConfig({
      singletonKey: 'kb_github_remote',
      config: 'corrupted',
      state: {
        installationId: null,
        repoFullName: null,
        repoCloneUrl: null,
        lastSyncAt: null,
        lastSyncStatus: null,
        lastError: null,
        remoteBranch: null,
        lastPushAt: null,
        lastPullAt: null,
      },
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    expect(result).toBeNull()
  })

  it('saveIntegrationConfig preserves existing privateKey when not provided', async () => {
    mockPrismaFindUnique.mockResolvedValue(
      makeRow('enc:{"appId":"12345","privateKey":"existing-pem","appSlug":"my-app"}'),
    )

    const { saveIntegrationConfig } = await import('../kb-github-remote')
    await saveIntegrationConfig({ appId: '12345' })

    expect(mockEncryptConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({
        appId: '12345',
        privateKey: 'existing-pem',
        appSlug: 'my-app',
      }),
    )
  })

  it('saveIntegrationConfig stores new privateKey when provided', async () => {
    mockPrismaFindUnique.mockResolvedValue(
      makeRow('enc:{"appId":"12345","privateKey":"old-pem"}'),
    )

    const { saveIntegrationConfig } = await import('../kb-github-remote')
    await saveIntegrationConfig({ appId: '12345', privateKey: 'new-pem' })

    expect(mockEncryptConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({
        appId: '12345',
        privateKey: 'new-pem',
      }),
    )
  })

  it('saveIntegrationConfig preserves existing appSlug when not provided', async () => {
    mockPrismaFindUnique.mockResolvedValue(
      makeRow('enc:{"appId":"12345","privateKey":"pem","appSlug":"my-app"}'),
    )

    const { saveIntegrationConfig } = await import('../kb-github-remote')
    await saveIntegrationConfig({ appId: '12345' })

    expect(mockEncryptConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({
        appSlug: 'my-app',
      }),
    )
  })

  it('clearIntegration stores empty encrypted config', async () => {
    const { clearIntegration } = await import('../kb-github-remote')
    await clearIntegration()

    expect(mockEncryptConfig).toHaveBeenLastCalledWith({})
  })

  it('isConfigured returns true when appId and privateKey exist', async () => {
    mockPrismaFindUnique.mockResolvedValue(
      makeRow('enc:{"appId":"12345","privateKey":"pem-data"}'),
    )

    const { isConfigured } = await import('../kb-github-remote')
    expect(await isConfigured()).toBe(true)
  })

  it('isConfigured returns false when privateKey is missing', async () => {
    mockPrismaFindUnique.mockResolvedValue(
      makeRow('enc:{"appId":"12345"}'),
    )

    const { isConfigured } = await import('../kb-github-remote')
    expect(await isConfigured()).toBe(false)
  })

  it('isConfigured returns false when no row exists', async () => {
    const { isConfigured } = await import('../kb-github-remote')
    expect(await isConfigured()).toBe(false)
  })

  it('isFullyReady returns true when all fields present', async () => {
    const { isFullyReady } = await import('../kb-github-remote')
    expect(
      isFullyReady(
        { appId: '12345', privateKey: 'pem' },
        {
          installationId: 99,
          repoFullName: 'owner/repo',
          repoCloneUrl: 'https://github.com/owner/repo.git',
          lastSyncAt: null,
          lastSyncStatus: null,
          lastError: null,
          remoteBranch: null,
          lastPushAt: null,
          lastPullAt: null,
        },
      ),
    ).toBe(true)
  })

  it('isFullyReady returns false without installationId', async () => {
    const { isFullyReady } = await import('../kb-github-remote')
    expect(
      isFullyReady(
        { appId: '12345', privateKey: 'pem' },
        {
          installationId: null,
          repoFullName: null,
          repoCloneUrl: null,
          lastSyncAt: null,
          lastSyncStatus: null,
          lastError: null,
          remoteBranch: null,
          lastPushAt: null,
          lastPullAt: null,
        },
      ),
    ).toBe(false)
  })

  it('updateSyncState merges with existing state', async () => {
    mockPrismaFindUnique.mockResolvedValue(
      makeRow('enc:{}', {
        installationId: 99,
        repoFullName: 'owner/repo',
        repoCloneUrl: 'https://github.com/owner/repo.git',
        lastSyncAt: '2026-04-27T08:00:00Z',
        lastSyncStatus: 'success',
        remoteBranch: 'main',
      }),
    )

    const { updateSyncState } = await import('../kb-github-remote')
    await updateSyncState({ lastSyncStatus: 'error', lastError: 'push failed' })

    expect(mockPrismaUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'kb_github_remote' },
        data: expect.objectContaining({
          state: expect.objectContaining({
            installationId: 99,
            repoFullName: 'owner/repo',
            lastSyncAt: '2026-04-27T08:00:00Z',
            lastSyncStatus: 'error',
            lastError: 'push failed',
            remoteBranch: 'main',
          }),
        }),
      }),
    )
  })

  it('getSyncState returns defaults when no row exists', async () => {
    const { getSyncState } = await import('../kb-github-remote')
    const state = await getSyncState()

    expect(state).toEqual({
      installationId: null,
      repoFullName: null,
      repoCloneUrl: null,
      lastSyncAt: null,
      lastSyncStatus: null,
      lastError: null,
      remoteBranch: null,
      lastPushAt: null,
      lastPullAt: null,
    })
  })
})
