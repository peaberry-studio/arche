import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock provider store
vi.mock('@/lib/providers/store', () => ({
  getEnabledProviderCredentialsForUser: vi.fn(),
}))

vi.mock('@/lib/opencode/client', () => ({
  getInstanceBasicAuth: vi.fn(),
}))

vi.mock('@/lib/providers/config', () => ({
  getGatewayTokenTtlSeconds: vi.fn(() => 3600),
}))

vi.mock('@/lib/services', () => ({
  instanceService: {
    findProviderSyncBySlug: vi.fn(),
    setProviderSyncState: vi.fn(),
  },
}))

// Mock provider tokens
vi.mock('@/lib/providers/tokens', () => ({
  issueGatewayToken: vi.fn(() => 'gateway-token-xyz'),
}))

import { getInstanceBasicAuth } from '@/lib/opencode/client'
import { getGatewayTokenTtlSeconds } from '@/lib/providers/config'
import { getEnabledProviderCredentialsForUser, type EnabledProviderCredentials } from '@/lib/providers/store'
import type { ProviderId } from '@/lib/providers/types'
import { instanceService } from '@/lib/services'
import { issueGatewayToken } from '@/lib/providers/tokens'
import { ensureProviderAccessFreshForExecution, getProviderSyncHashForUser, syncProviderAccessForInstance } from '../providers'

const mockGetInstanceBasicAuth = vi.mocked(getInstanceBasicAuth)
const mockGetGatewayTokenTtlSeconds = vi.mocked(getGatewayTokenTtlSeconds)
const mockGetEnabledCredentials = vi.mocked(getEnabledProviderCredentialsForUser)
const mockInstanceService = vi.mocked(instanceService)
const mockIssueToken = vi.mocked(issueGatewayToken)

type TestEnabledProviderCredential = {
  credentialId: string
  source: 'user' | 'organization'
  version: number
}

function enabledCredentials(
  entries: Array<[ProviderId, TestEnabledProviderCredential]> = [],
): EnabledProviderCredentials {
  return new Map(entries)
}

const fakeInstance = {
  baseUrl: 'http://opencode-alice:4096',
  authHeader: 'Basic b3BlbmNvZGU6cGFzcw==',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok', { status: 200 })))
  mockGetGatewayTokenTtlSeconds.mockReturnValue(3600)
  mockGetInstanceBasicAuth.mockResolvedValue(fakeInstance)
  mockInstanceService.findProviderSyncBySlug.mockResolvedValue({
    providerSyncHash: null,
    providerSyncedAt: null,
    status: 'running',
  })
  mockInstanceService.setProviderSyncState.mockResolvedValue(undefined)
})

describe('syncProviderAccessForInstance', () => {
  it('calls provider auth endpoints for each enabled provider', async () => {
    const mockFetch = vi.mocked(globalThis.fetch)

    // openai enabled, anthropic enabled, fireworks/openrouter/opencode-go/ollama disabled,
    // opencode gets a gateway token even without a stored credential.
    mockGetEnabledCredentials.mockResolvedValue(enabledCredentials([
      ['openai', { credentialId: '1', source: 'user', version: 1 }],
      ['anthropic', { credentialId: '2', source: 'organization', version: 2 }],
    ]))

    const result = await syncProviderAccessForInstance({
      instance: fakeInstance,
      slug: 'alice',
      userId: 'user-1',
    })

    expect(result).toEqual({ ok: true })

    // Verify PUT for enabled providers
    const putCalls = mockFetch.mock.calls.filter(
      (call) => (call[1] as RequestInit)?.method === 'PUT',
    )
    expect(putCalls).toHaveLength(3)
    expect(putCalls[0]![0]).toBe(`${fakeInstance.baseUrl}/auth/openai`)
    expect(putCalls[1]![0]).toBe(`${fakeInstance.baseUrl}/auth/anthropic`)
    expect(putCalls[2]![0]).toBe(`${fakeInstance.baseUrl}/auth/opencode`)

    // Verify DELETE for disabled managed providers
    const deleteCalls = mockFetch.mock.calls.filter(
      (call) => (call[1] as RequestInit)?.method === 'DELETE',
    )
    expect(deleteCalls).toHaveLength(4)
    expect(deleteCalls[0]![0]).toBe(`${fakeInstance.baseUrl}/auth/fireworks-ai`)
    expect(deleteCalls[1]![0]).toBe(`${fakeInstance.baseUrl}/auth/openrouter`)
    expect(deleteCalls[2]![0]).toBe(`${fakeInstance.baseUrl}/auth/opencode-go`)
    expect(deleteCalls[3]![0]).toBe(`${fakeInstance.baseUrl}/auth/ollama`)

    // Verify gateway tokens were issued for enabled providers
    expect(mockIssueToken).toHaveBeenCalledTimes(3)
    expect(mockIssueToken).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'opencode', version: 0 }),
    )
    expect(mockIssueToken).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialId: '1',
        credentialSource: 'user',
        providerId: 'openai',
        version: 1,
      }),
    )
    expect(mockIssueToken).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialId: '2',
        credentialSource: 'organization',
        providerId: 'anthropic',
        version: 2,
      }),
    )
    expect(mockInstanceService.setProviderSyncState).toHaveBeenCalledWith(
      'alice',
      await getProviderSyncHashForUser('user-1'),
      expect.any(Date),
    )
  })

  it('disposes instance by default', async () => {
    const mockFetch = vi.mocked(globalThis.fetch)
    mockGetEnabledCredentials.mockResolvedValue(enabledCredentials())

    await syncProviderAccessForInstance({
      instance: fakeInstance,
      slug: 'alice',
      userId: 'user-1',
    })

    const disposeCalls = mockFetch.mock.calls.filter(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('/instance/dispose') &&
        (call[1] as RequestInit)?.method === 'POST',
    )
    expect(disposeCalls).toHaveLength(1)
  })

  it('skips dispose when disposeInstance is false', async () => {
    const mockFetch = vi.mocked(globalThis.fetch)
    mockGetEnabledCredentials.mockResolvedValue(enabledCredentials())

    await syncProviderAccessForInstance({
      instance: fakeInstance,
      slug: 'alice',
      userId: 'user-1',
      disposeInstance: false,
    })

    const disposeCalls = mockFetch.mock.calls.filter(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('/instance/dispose') &&
        (call[1] as RequestInit)?.method === 'POST',
    )
    expect(disposeCalls).toHaveLength(0)
  })

  it('returns sync_failed on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

    mockGetEnabledCredentials.mockResolvedValue(enabledCredentials([
      ['openai', { credentialId: '1', source: 'user', version: 1 }],
    ]))

    const result = await syncProviderAccessForInstance({
      instance: fakeInstance,
      slug: 'alice',
      userId: 'user-1',
    })

    expect(result).toEqual({ ok: false, error: 'sync_failed' })
  })

  it('returns sync_failed when an auth endpoint responds with an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(new Response('boom', { status: 500 }))
    )

    mockGetEnabledCredentials.mockResolvedValue(enabledCredentials([
      ['openai', { credentialId: '1', source: 'user', version: 1 }],
    ]))

    const result = await syncProviderAccessForInstance({
      instance: fakeInstance,
      slug: 'alice',
      userId: 'user-1',
    })

    expect(result).toEqual({ ok: false, error: 'sync_failed' })
  })

  it('uses the provided instance auth, not a DB lookup', async () => {
    mockGetEnabledCredentials.mockResolvedValue(enabledCredentials())
    const mockFetch = vi.mocked(globalThis.fetch)

    await syncProviderAccessForInstance({
      instance: fakeInstance,
      slug: 'alice',
      userId: 'user-1',
    })

    // All fetch calls should use the provided instance auth
    for (const call of mockFetch.mock.calls) {
      const headers = (call[1] as RequestInit)?.headers as Record<string, string> | undefined
      if (headers?.Authorization) {
        expect(headers.Authorization).toBe(fakeInstance.authHeader)
      }
    }
  })

  it('returns success when provider sync state persistence fails after auth succeeds', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockGetEnabledCredentials.mockResolvedValue(enabledCredentials())
    mockInstanceService.setProviderSyncState.mockRejectedValue(new Error('db unavailable'))

    const result = await syncProviderAccessForInstance({
      instance: fakeInstance,
      slug: 'alice',
      userId: 'user-1',
    })

    expect(result).toEqual({ ok: true })
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[opencode/providers] Failed to persist provider sync state',
      expect.any(Error),
    )

    consoleErrorSpy.mockRestore()
  })

  it('skips provider sync refresh when the running instance already matches the expected hash', async () => {
    mockGetEnabledCredentials.mockResolvedValue(enabledCredentials([
      ['openai', { credentialId: 'org-1', source: 'organization', version: 3 }],
    ]))

    mockInstanceService.findProviderSyncBySlug.mockResolvedValue({
      providerSyncHash: await getProviderSyncHashForUser('user-1'),
      providerSyncedAt: new Date(),
      status: 'running',
    })

    await ensureProviderAccessFreshForExecution({ slug: 'alice', userId: 'user-1' })

    expect(mockGetInstanceBasicAuth).not.toHaveBeenCalled()
  })

  it('refreshes provider access when the sync record is stale by age', async () => {
    mockGetEnabledCredentials.mockResolvedValue(enabledCredentials([
      ['openai', { credentialId: 'org-1', source: 'organization', version: 3 }],
    ]))
    mockGetGatewayTokenTtlSeconds.mockReturnValue(120)
    mockInstanceService.findProviderSyncBySlug.mockResolvedValue({
      providerSyncHash: await getProviderSyncHashForUser('user-1'),
      providerSyncedAt: new Date(Date.now() - 120_000),
      status: 'running',
    })

    await ensureProviderAccessFreshForExecution({ slug: 'alice', userId: 'user-1' })

    expect(mockGetInstanceBasicAuth).toHaveBeenCalledWith('alice')
  })
})
