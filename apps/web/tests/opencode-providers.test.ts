import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('pg', () => ({
  Client: class {
    connect = vi.fn()
    end = vi.fn()
    on = vi.fn()
    query = vi.fn(async () => ({ rows: [{ locked: true }] }))
  },
}))

vi.mock('@/lib/providers/store', () => ({
  getEnabledProviderCredentialsForUser: vi.fn(),
}))

vi.mock('@/lib/services', () => ({
  instanceService: {
    findRuntimeKindBySlug: vi.fn(),
    setProviderSyncState: vi.fn(),
  },
  messageRunService: {
    hasActiveRunForSlug: vi.fn(),
  },
}))

vi.mock('@/lib/providers/tokens', () => ({
  issueGatewayToken: vi.fn(),
}))

import { syncRuntimeProviderAccess } from '@/lib/harness/registry'
import { getEnabledProviderCredentialsForUser } from '@/lib/providers/store'
import { instanceService, messageRunService } from '@/lib/services'

const mockGetEnabledProviderCredentialsForUser = vi.mocked(getEnabledProviderCredentialsForUser)
const mockFindRuntimeKindBySlug = vi.mocked(instanceService.findRuntimeKindBySlug)

const fakeInstance = {
  baseUrl: 'http://opencode-alice:4096',
  authHeader: 'Basic abc',
}

// Provider sync itself is covered against the real V2 adapter in
// src/lib/harness/adapters/opencode-v2/__tests__/providers.test.ts.
describe('syncRuntimeProviderAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('DATABASE_URL', 'postgresql://localhost/fixture')
    mockFindRuntimeKindBySlug.mockResolvedValue({ runtimeKind: 'opencode-v2' })
    vi.mocked(messageRunService.hasActiveRunForSlug).mockResolvedValue(false)
    vi.mocked(instanceService.setProviderSyncState).mockResolvedValue(undefined)
  })
  afterEach(() => { vi.unstubAllEnvs() })

  it('returns sync_failed when credential lookup throws', async () => {
    mockGetEnabledProviderCredentialsForUser.mockRejectedValue(new Error('db error'))

    const result = await syncRuntimeProviderAccess('alice', {
      connection: fakeInstance,
      userId: 'user-1',
    })

    expect(result).toEqual({ ok: false, error: { code: 'sync_failed', detail: 'runtime_error' } })
    expect(mockGetEnabledProviderCredentialsForUser).toHaveBeenCalledWith('user-1')
  })

  it.each([null, 'opencode-v1'])('refuses a workspace recorded as %s without reading credentials', async (runtimeKind) => {
    mockFindRuntimeKindBySlug.mockResolvedValue({ runtimeKind })

    const result = await syncRuntimeProviderAccess('alice', {
      connection: fakeInstance,
      userId: 'user-1',
    })

    expect(result).toMatchObject({ ok: false, error: { code: 'runtime_unsupported' } })
    expect(mockGetEnabledProviderCredentialsForUser).not.toHaveBeenCalled()
  })
})
