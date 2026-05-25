import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auditEvent: vi.fn(),
  clearWorkspaceRestartRequired: vi.fn(),
  decryptPassword: vi.fn(),
  disableEnabledForProvider: vi.fn(),
  disableEnabledOrganizationProvider: vi.fn(),
  findCredentialsBySlug: vi.fn(),
  getInstanceUrl: vi.fn(),
  invalidateProviderSyncStateForAllInstances: vi.fn(),
  markWorkspaceRestartRequired: vi.fn(),
  replaceApiCredential: vi.fn(),
  replaceOrganizationApiCredential: vi.fn(),
  syncProviderAccessForInstance: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auditEvent: mocks.auditEvent,
}))

vi.mock('@/lib/opencode/client', () => ({
  getInstanceUrl: mocks.getInstanceUrl,
}))

vi.mock('@/lib/opencode/providers', () => ({
  syncProviderAccessForInstance: mocks.syncProviderAccessForInstance,
}))

vi.mock('@/lib/services', () => ({
  instanceService: {
    findCredentialsBySlug: mocks.findCredentialsBySlug,
    invalidateProviderSyncStateForAllInstances: mocks.invalidateProviderSyncStateForAllInstances,
  },
  providerService: {
    clearWorkspaceRestartRequired: mocks.clearWorkspaceRestartRequired,
    disableEnabledForProvider: mocks.disableEnabledForProvider,
    disableEnabledOrganizationProvider: mocks.disableEnabledOrganizationProvider,
    markWorkspaceRestartRequired: mocks.markWorkspaceRestartRequired,
  },
}))

vi.mock('@/lib/spawner/crypto', () => ({
  decryptPassword: mocks.decryptPassword,
}))

vi.mock('../store', () => ({
  replaceApiCredential: mocks.replaceApiCredential,
  replaceOrganizationApiCredential: mocks.replaceOrganizationApiCredential,
}))

import {
  disableOrganizationProviderApiCredential,
  disableUserProviderApiCredential,
  replaceOrganizationProviderApiCredential,
  replaceUserProviderApiCredential,
} from '@/lib/providers/credential-mutations'

describe('provider credential mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auditEvent.mockResolvedValue(undefined)
    mocks.clearWorkspaceRestartRequired.mockResolvedValue(undefined)
    mocks.decryptPassword.mockReturnValue('password')
    mocks.disableEnabledForProvider.mockResolvedValue({ count: 1 })
    mocks.disableEnabledOrganizationProvider.mockResolvedValue({ count: 2 })
    mocks.findCredentialsBySlug.mockResolvedValue(null)
    mocks.getInstanceUrl.mockReturnValue('http://opencode-alice:4096')
    mocks.invalidateProviderSyncStateForAllInstances.mockResolvedValue({ count: 3 })
    mocks.markWorkspaceRestartRequired.mockResolvedValue(undefined)
    mocks.replaceApiCredential.mockResolvedValue({ id: 'cred-1', secret: 'encrypted', type: 'api', version: 1 })
    mocks.replaceOrganizationApiCredential.mockResolvedValue({ id: 'org-cred-1', secret: 'encrypted', type: 'api', version: 4 })
    mocks.syncProviderAccessForInstance.mockResolvedValue({ ok: true })
  })

  it('replaces a user credential and clears restart state when the workspace is not running', async () => {
    const result = await replaceUserProviderApiCredential({
      actorUserId: 'admin-1',
      apiKey: 'sk-user',
      providerId: 'openai',
      targetSlug: 'alice',
      targetUserId: 'user-1',
    })

    expect(result).toEqual({
      credential: { id: 'cred-1', secret: 'encrypted', type: 'api', version: 1 },
      restartRequired: false,
    })
    expect(mocks.replaceApiCredential).toHaveBeenCalledWith({
      apiKey: 'sk-user',
      providerId: 'openai',
      userId: 'user-1',
    })
    expect(mocks.clearWorkspaceRestartRequired).toHaveBeenCalledWith('user-1')
    expect(mocks.auditEvent).toHaveBeenCalledWith({
      actorUserId: 'admin-1',
      action: 'provider_credential.created',
      metadata: { credentialId: 'cred-1', providerId: 'openai' },
    })
  })

  it('marks restart required when live provider sync fails with a sync error', async () => {
    mocks.findCredentialsBySlug.mockResolvedValue({
      serverPassword: 'encrypted-password',
      status: 'running',
    })
    mocks.syncProviderAccessForInstance.mockResolvedValue({ ok: false, error: 'provider_sync_failed' })

    const result = await replaceUserProviderApiCredential({
      actorUserId: 'admin-1',
      apiKey: 'sk-user',
      providerId: 'anthropic',
      targetSlug: 'alice',
      targetUserId: 'user-1',
    })

    expect(result.restartRequired).toBe(true)
    expect(mocks.syncProviderAccessForInstance).toHaveBeenCalledWith({
      instance: {
        authHeader: `Basic ${Buffer.from('opencode:password').toString('base64')}`,
        baseUrl: 'http://opencode-alice:4096',
      },
      slug: 'alice',
      userId: 'user-1',
    })
    expect(mocks.markWorkspaceRestartRequired).toHaveBeenCalledWith('user-1')
  })

  it('disables a user credential and handles sync exceptions as restart-required', async () => {
    mocks.findCredentialsBySlug.mockResolvedValue({
      serverPassword: 'encrypted-password',
      status: 'running',
    })
    mocks.syncProviderAccessForInstance.mockRejectedValue(new Error('offline'))

    const result = await disableUserProviderApiCredential({
      actorUserId: 'admin-1',
      providerId: 'openrouter',
      targetSlug: 'alice',
      targetUserId: 'user-1',
    })

    expect(result).toEqual({ disabledCount: 1, restartRequired: true })
    expect(mocks.disableEnabledForProvider).toHaveBeenCalledWith('user-1', 'openrouter')
    expect(mocks.auditEvent).toHaveBeenCalledWith({
      actorUserId: 'admin-1',
      action: 'provider_credential.disabled',
      metadata: {
        disabledCount: 1,
        providerId: 'openrouter',
        targetSlug: 'alice',
      },
    })
  })

  it('replaces organization credentials and invalidates provider sync state', async () => {
    const result = await replaceOrganizationProviderApiCredential({
      actorUserId: 'admin-1',
      apiKey: 'sk-org',
      providerId: 'fireworks',
    })

    expect(result).toEqual({
      credential: { id: 'org-cred-1', secret: 'encrypted', type: 'api', version: 4 },
      invalidatedInstanceCount: 3,
    })
    expect(mocks.replaceOrganizationApiCredential).toHaveBeenCalledWith({
      apiKey: 'sk-org',
      providerId: 'fireworks',
    })
    expect(mocks.auditEvent).toHaveBeenCalledWith({
      actorUserId: 'admin-1',
      action: 'organization_provider_credential.created',
      metadata: {
        credentialId: 'org-cred-1',
        invalidatedInstanceCount: 3,
        providerId: 'fireworks',
      },
    })
  })

  it('disables organization credentials and records the invalidation count', async () => {
    const result = await disableOrganizationProviderApiCredential({
      actorUserId: 'admin-1',
      providerId: 'opencode',
    })

    expect(result).toEqual({ disabledCount: 2, invalidatedInstanceCount: 3 })
    expect(mocks.disableEnabledOrganizationProvider).toHaveBeenCalledWith('opencode')
    expect(mocks.auditEvent).toHaveBeenCalledWith({
      actorUserId: 'admin-1',
      action: 'organization_provider_credential.disabled',
      metadata: {
        disabledCount: 2,
        invalidatedInstanceCount: 3,
        providerId: 'opencode',
      },
    })
  })
})
