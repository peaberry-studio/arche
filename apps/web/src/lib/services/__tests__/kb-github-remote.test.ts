import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  externalIntegration: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    upsert: vi.fn(),
  },
}))

const mocks = vi.hoisted(() => ({
  decryptConfig: vi.fn((value: string) => JSON.parse(value)),
  encryptConfig: vi.fn((value: Record<string, unknown>) => JSON.stringify(value)),
  getInstallationToken: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/connectors/crypto', () => ({
  decryptConfig: mocks.decryptConfig,
  encryptConfig: mocks.encryptConfig,
}))
vi.mock('@/lib/git/github-app-auth', () => ({
  getInstallationToken: mocks.getInstallationToken,
}))

import {
  KB_GITHUB_REMOTE_INTEGRATION_KEY,
  clearIntegration,
  createWorkspaceRemoteConfig,
  decryptIntegrationConfig,
  findIntegration,
  saveAppConfig,
  saveInstallation,
  saveSelectedRepo,
  toSummary,
  updateSyncState,
} from '../kb-github-remote'

const NOW = new Date('2026-05-15T12:00:00.000Z')

function makeRow(config: Record<string, unknown> = {}, state: Record<string, unknown> = {}) {
  return {
    config: JSON.stringify(config),
    createdAt: NOW,
    key: KB_GITHUB_REMOTE_INTEGRATION_KEY,
    state,
    updatedAt: NOW,
    version: 1,
  }
}

describe('kbGithubRemoteService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when no integration is stored', async () => {
    mockPrisma.externalIntegration.findUnique.mockResolvedValue(null)

    await expect(findIntegration()).resolves.toBeNull()
  })

  it('marks corrupted config and normalizes invalid state', async () => {
    mocks.decryptConfig.mockImplementationOnce(() => {
      throw new Error('bad cipher')
    })
    mockPrisma.externalIntegration.findUnique.mockResolvedValue(makeRow({}, { lastSyncStatus: 'invalid' }))

    await expect(findIntegration()).resolves.toMatchObject({
      configCorrupted: true,
      state: {
        installationAccount: null,
        installationId: null,
        lastError: null,
        lastSyncAt: null,
        lastSyncStatus: null,
        repoCloneUrl: null,
        repoDefaultBranch: null,
        repoFullName: null,
      },
    })
  })

  it('saves GitHub App credentials encrypted in ExternalIntegration', async () => {
    mockPrisma.externalIntegration.upsert.mockResolvedValue(makeRow({
      appId: '123',
      appSlug: 'arche-kb-sync',
      privateKey: 'pem',
    }))

    const record = await saveAppConfig({
      appId: '123',
      appSlug: 'arche-kb-sync',
      privateKey: 'pem',
    })

    expect(mockPrisma.externalIntegration.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ key: KB_GITHUB_REMOTE_INTEGRATION_KEY }),
      update: expect.objectContaining({ version: { increment: 1 } }),
    }))
    expect(decryptIntegrationConfig(record)).toEqual({
      appId: '123',
      appSlug: 'arche-kb-sync',
      privateKey: 'pem',
    })
  })

  it('builds a ready summary from config and state', () => {
    const record = {
      config: JSON.stringify({ appId: '123', appSlug: 'arche-kb-sync', privateKey: 'pem' }),
      configCorrupted: false,
      createdAt: NOW,
      key: KB_GITHUB_REMOTE_INTEGRATION_KEY,
      state: {
        installationAccount: 'acme',
        installationId: 456,
        lastError: null,
        lastSyncAt: null,
        lastSyncStatus: null,
        repoCloneUrl: 'https://github.com/acme/kb.git',
        repoDefaultBranch: 'main',
        repoFullName: 'acme/kb',
      },
      updatedAt: NOW,
      version: 2,
    }

    expect(toSummary(record, decryptIntegrationConfig(record))).toMatchObject({
      appConfigured: true,
      installationAccount: 'acme',
      ready: true,
      repoDefaultBranch: 'main',
      repoFullName: 'acme/kb',
    })
  })

  it('updates installation and selected repository state', async () => {
    mockPrisma.externalIntegration.findUnique
      .mockResolvedValueOnce(makeRow({ appId: '123', privateKey: 'pem' }, {}))
      .mockResolvedValueOnce(makeRow({ appId: '123', privateKey: 'pem' }, { installationId: 456 }))
    mockPrisma.externalIntegration.updateMany.mockResolvedValue({ count: 1 })

    await saveInstallation({ account: 'acme', installationId: 456 })
    await saveSelectedRepo({
      cloneUrl: 'https://github.com/acme/kb.git',
      defaultBranch: 'main',
      fullName: 'acme/kb',
    })

    expect(mockPrisma.externalIntegration.updateMany).toHaveBeenCalledTimes(2)
    expect(mockPrisma.externalIntegration.updateMany).toHaveBeenLastCalledWith({
      where: { key: KB_GITHUB_REMOTE_INTEGRATION_KEY },
      data: {
        state: expect.objectContaining({
          repoCloneUrl: 'https://github.com/acme/kb.git',
          repoDefaultBranch: 'main',
          repoFullName: 'acme/kb',
        }),
      },
    })
  })

  it('resets repository state when the installation changes', async () => {
    mockPrisma.externalIntegration.findUnique.mockResolvedValue(makeRow(
      { appId: '123', privateKey: 'pem' },
      {
        installationId: 111,
        repoCloneUrl: 'https://github.com/acme/old.git',
        repoDefaultBranch: 'main',
        repoFullName: 'acme/old',
      },
    ))
    mockPrisma.externalIntegration.updateMany.mockResolvedValue({ count: 1 })

    await saveInstallation({ account: 'acme', installationId: 456 })

    expect(mockPrisma.externalIntegration.updateMany).toHaveBeenCalledWith({
      where: { key: KB_GITHUB_REMOTE_INTEGRATION_KEY },
      data: {
        state: expect.objectContaining({
          installationAccount: 'acme',
          installationId: 456,
          lastError: null,
          lastSyncAt: null,
          lastSyncStatus: null,
          repoCloneUrl: null,
          repoDefaultBranch: null,
          repoFullName: null,
        }),
      },
    })
  })

  it('clears the integration and updates sync state', async () => {
    mockPrisma.externalIntegration.findUnique.mockResolvedValue(makeRow())
    mockPrisma.externalIntegration.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.externalIntegration.upsert.mockResolvedValue(makeRow())

    await expect(clearIntegration()).resolves.toMatchObject({ key: KB_GITHUB_REMOTE_INTEGRATION_KEY })
    await updateSyncState({ lastError: 'failed', lastSyncAt: 'now', lastSyncStatus: 'error' })

    expect(mockPrisma.externalIntegration.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ state: expect.objectContaining({ repoFullName: null }) }),
    }))
    expect(mockPrisma.externalIntegration.updateMany).toHaveBeenCalledWith({
      where: { key: KB_GITHUB_REMOTE_INTEGRATION_KEY },
      data: {
        state: expect.objectContaining({
          lastError: 'failed',
          lastSyncAt: 'now',
          lastSyncStatus: 'error',
        }),
      },
    })
  })

  it('creates transient workspace remote config with an installation token', async () => {
    mockPrisma.externalIntegration.findUnique.mockResolvedValue(makeRow(
      { appId: '123', privateKey: 'pem' },
      {
        installationId: 456,
        repoCloneUrl: 'https://github.com/acme/kb.git',
        repoDefaultBranch: 'main',
      },
    ))
    mocks.getInstallationToken.mockResolvedValue({ ok: true, token: 'token-1', expiresAt: 'later' })

    await expect(createWorkspaceRemoteConfig()).resolves.toEqual({
      ok: true,
      remote: {
        branch: 'main',
        repoCloneUrl: 'https://github.com/acme/kb.git',
        token: 'token-1',
      },
    })
  })

  it('returns no workspace remote config when setup is incomplete', async () => {
    mockPrisma.externalIntegration.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeRow({ appId: '123', privateKey: 'pem' }, { installationId: 456 }))

    await expect(createWorkspaceRemoteConfig()).resolves.toEqual({ ok: true, remote: null })
    await expect(createWorkspaceRemoteConfig()).resolves.toEqual({ ok: true, remote: null })
  })

  it('records token failures while creating workspace remote config', async () => {
    mockPrisma.externalIntegration.findUnique.mockResolvedValue(makeRow(
      { appId: '123', privateKey: 'pem' },
      {
        installationId: 456,
        repoCloneUrl: 'https://github.com/acme/kb.git',
        repoDefaultBranch: null,
      },
    ))
    mockPrisma.externalIntegration.updateMany.mockResolvedValue({ count: 1 })
    mocks.getInstallationToken.mockResolvedValue({ ok: false, message: 'bad token' })

    await expect(createWorkspaceRemoteConfig()).resolves.toEqual({ ok: false, error: 'bad token' })
    expect(mockPrisma.externalIntegration.updateMany).toHaveBeenCalledWith({
      where: { key: KB_GITHUB_REMOTE_INTEGRATION_KEY },
      data: {
        state: expect.objectContaining({
          lastError: 'bad token',
          lastSyncStatus: 'error',
        }),
      },
    })
  })
})
