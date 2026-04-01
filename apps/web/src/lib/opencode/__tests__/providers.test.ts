import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock provider store
vi.mock('@/lib/providers/store', () => ({
  getActiveCredentialForUser: vi.fn(),
}))

// Mock provider tokens
vi.mock('@/lib/providers/tokens', () => ({
  issueGatewayToken: vi.fn(() => 'gateway-token-xyz'),
}))

import { getActiveCredentialForUser } from '@/lib/providers/store'
import { issueGatewayToken } from '@/lib/providers/tokens'
import { syncProviderAccessForInstance } from '../providers'

const mockGetCredential = vi.mocked(getActiveCredentialForUser)
const mockIssueToken = vi.mocked(issueGatewayToken)

const fakeInstance = {
  baseUrl: 'http://opencode-alice:4096',
  authHeader: 'Basic b3BlbmNvZGU6cGFzcw==',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
})

describe('syncProviderAccessForInstance', () => {
  it('calls provider auth endpoints for each enabled provider', async () => {
    const mockFetch = vi.mocked(globalThis.fetch)

    // openai enabled, anthropic enabled, fireworks/openrouter disabled,
    // opencode gets a gateway token even without a stored credential.
    mockGetCredential.mockImplementation(async ({ providerId }) => {
      if (providerId === 'openai') return { id: '1', version: 1 } as never
      if (providerId === 'anthropic') return { id: '2', version: 2 } as never
      return null
    })

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
    expect(deleteCalls).toHaveLength(2)
    expect(deleteCalls[0]![0]).toBe(`${fakeInstance.baseUrl}/auth/fireworks-ai`)
    expect(deleteCalls[1]![0]).toBe(`${fakeInstance.baseUrl}/auth/openrouter`)

    // Verify gateway tokens were issued for enabled providers
    expect(mockIssueToken).toHaveBeenCalledTimes(3)
    expect(mockIssueToken).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'opencode', version: 0 }),
    )
  })

  it('disposes instance by default', async () => {
    const mockFetch = vi.mocked(globalThis.fetch)
    mockGetCredential.mockResolvedValue(null)

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
    mockGetCredential.mockResolvedValue(null)

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

    mockGetCredential.mockResolvedValue({ id: '1', version: 1 } as never)

    const result = await syncProviderAccessForInstance({
      instance: fakeInstance,
      slug: 'alice',
      userId: 'user-1',
    })

    expect(result).toEqual({ ok: false, error: 'sync_failed' })
  })

  it('uses the provided instance auth, not a DB lookup', async () => {
    mockGetCredential.mockResolvedValue(null)
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
})
